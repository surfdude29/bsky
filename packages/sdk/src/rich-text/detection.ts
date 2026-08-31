import type { DidString, UriString } from '@atproto/lex'
import { graphemeLen } from '@atproto/lex'
import TLDs from 'tlds' with { type: 'json' }
import { app } from '../lexicons/index.js'
import { type UnicodeString } from './unicode.js'
import {
  CASHTAG_REGEX,
  MENTION_REGEX,
  TAG_REGEX,
  TRAILING_PUNCTUATION_REGEX,
  URL_REGEX,
} from './util.js'

export type Facet = app.bsky.richtext.facet.Main

const SCHEME_ONLY_REGEX = /^https?:\/\/$/i

/**
 * Characters that end prose rather than a URL, wherever they fall. "_" and "~" are
 * excluded, since example.com/foo_bar and example.com/~user are legitimate endings;
 * angle brackets are included, being RFC 3986 Appendix C delimiters rather than URI
 * characters. The typographic marks are legal in an IRI path -- RFC 3987 §2.2 admits
 * them to iunreserved -- and are stripped from one anyway: ending a match, they are the
 * prose around a link far more often than part of it, a smart-quoted URL or a
 * sentence-final ellipsis. AUTHORITY_ONLY_STRIP below strikes the opposite balance for
 * characters that are common in real paths; the cost here is a path genuinely ending in
 * one, which is truncated. No `g` flag: this is used with `.test()` on single
 * characters, which `g` would make stateful.
 */
const TRAILING_STRIP_REGEX =
  /[.,;:!?"<>\u2018\u2019\u201C\u201D\u00AB\u00BB\u2026\u2013\u2014]/

/**
 * Stripped only from an authority. All three are sub-delims or gen-delims that RFC 3986
 * §3.3 admits to a path, so removing them from one would change where the URL points:
 * https://example.com/glob/* and https://example.com/foo' are whole URLs.
 */
const AUTHORITY_ONLY_STRIP = new Set(['@', "'", '*'])

/** Strips the scheme so the remainder can be tested for authority delimiters. */
const SCHEME_PREFIX_REGEX = /^https?:\/\//i

const BRACKET_PAIRS: ReadonlyMap<string, string> = new Map([
  [')', '('],
  [']', '['],
  ['}', '{'],
])

function countChar(str: string, char: string): number {
  let n = 0
  for (const ch of str) {
    if (ch === char) n++
  }
  return n
}

/**
 * Strips trailing characters that belong to the surrounding sentence rather than to
 * the URL. Counting brackets rather than testing for their presence is what lets
 * example.com/a(b)) lose only the unbalanced ")" while
 * https://foo.com/thing_(cool) keeps both of its own.
 *
 * Excess closers are all it removes. The loop only ever shortens, so an unmatched
 * *opener* stays (example.com/path( keeps its "(") and nesting is never checked
 * (example.com/a([)] keeps its crossed pair). Neither ends a sentence, which is the
 * only thing this is for.
 */
function trimTrailing(uri: string): string {
  let end = uri.length
  while (end > 0) {
    const ch = uri[end - 1]
    if (AUTHORITY_ONLY_STRIP.has(ch)) {
      // These are legal in a path, so they are only prose punctuation when they end an
      // authority: "https://example.com@" closes a userinfo and leaves the host empty,
      // and "https://example.com*" is emphasis around the host. A bare-domain match
      // never reaches that case -- its tail opens with "/", "?" or "#", so everything
      // past the host is path, query or fragment -- though such matches do reach here
      // ("example.com/path@").
      //
      // Decided per character rather than once for the whole URI: "?" is both an
      // authority delimiter and strippable, so stripping one can move a character of
      // this set into the authority mid-loop.
      const before = uri.slice(0, end - 1).replace(SCHEME_PREFIX_REGEX, '')
      if (/[/?#]/.test(before)) break
      end--
      continue
    }
    if (TRAILING_STRIP_REGEX.test(ch)) {
      end--
      continue
    }
    const open = BRACKET_PAIRS.get(ch)
    const prefix = uri.slice(0, end)
    if (open !== undefined && countChar(prefix, open) < countChar(prefix, ch)) {
      end--
      continue
    }
    break
  }
  return uri.slice(0, end)
}

export function detectFacets(text: UnicodeString): Facet[] | undefined {
  let match
  const facets: Facet[] = []
  {
    // links
    const re = URL_REGEX
    while ((match = re.exec(text.utf16))) {
      const domain = match.groups?.domain
      const start = text.utf16.indexOf(match[2], match.index)
      const index = { start, end: start + match[2].length }

      if (domain) {
        // Required by the deny-list lead-in of URL_REGEX: a schemeless domain
        // preceded by "-", "_", "." or "/" is part of a longer token, not a URL --
        // path/to/site.com, trailing_example.com. This is twitter-text's
        // invalidUrlWithoutProtocolPrecedingChars. Schemed URLs are exempt.
        if (/[-_./]/.test(match[1])) {
          continue
        }
        if (!isValidDomain(domain)) {
          continue
        }
        // Heuristic: a bare domain immediately followed by "(" is a method call.
        // ".now", ".map", ".call" and ".run" are all real TLDs, so performance.now()
        // and array.map(fn) would otherwise linkify. Costs "example.com(new tab)".
        if (text.utf16[index.end] === '(') {
          continue
        }
      }

      const trimmed = trimTrailing(match[2])
      // A schemed match that trims down to nothing but its scheme ("https://,,,")
      // is not a link.
      if (!trimmed || (!domain && SCHEME_ONLY_REGEX.test(trimmed))) {
        continue
      }
      index.end = start + trimmed.length
      const uri = domain ? `https://${trimmed}` : trimmed

      facets.push({
        index: {
          byteStart: text.utf16IndexToUtf8Index(index.start),
          byteEnd: text.utf16IndexToUtf8Index(index.end),
        },
        features: [
          app.bsky.richtext.facet.link.$build({
            uri: uri as UriString, // boundary: detected text, format verified by URL_REGEX
          }),
        ],
      })
    }
  }
  {
    // mentions
    const re = MENTION_REGEX
    while ((match = re.exec(text.utf16))) {
      // A "/" before the "@" means the handle sits in a URL path
      // (https://example.com/@bsky.app), not a mention. MENTION_REGEX's lead-in admits
      // it, and the facet would overlap the link facet the same text produces.
      if (match[1].startsWith('/')) {
        continue
      }
      if (
        !isValidDomain(match[3]) &&
        !match[3].toLowerCase().endsWith('.test')
      ) {
        continue // probably not a handle
      }

      const start = text.utf16.indexOf(match[3], match.index) - 1
      const end = start + match[3].length + 1
      facets.push(
        app.bsky.richtext.facet.$build({
          index: {
            byteStart: text.utf16IndexToUtf8Index(start),
            byteEnd: text.utf16IndexToUtf8Index(end),
          },
          features: [
            app.bsky.richtext.facet.mention.$build({
              did: match[3] as DidString, // boundary: detected text must be resolved
            }),
          ],
        }),
      )
    }
  }
  {
    const re = TAG_REGEX
    while ((match = re.exec(text.utf16))) {
      const leading = match[1]
      let tag = match[2]

      if (!tag) continue

      // strip ending punctuation and any spaces
      tag = tag.trim().replace(TRAILING_PUNCTUATION_REGEX, '')

      // tag.length (UTF-16) is always >= graphemeLen(tag), so only pay for
      // the grapheme count when the UTF-16 length already exceeds the limit.
      // (upstream atproto#2657)
      if (tag.length === 0 || (tag.length > 64 && graphemeLen(tag) > 64))
        continue

      const index = match.index + leading.length

      facets.push({
        index: {
          byteStart: text.utf16IndexToUtf8Index(index),
          byteEnd: text.utf16IndexToUtf8Index(index + 1 + tag.length),
        },
        features: [
          app.bsky.richtext.facet.tag.$build({
            tag: tag,
          }),
        ],
      })
    }
  }
  {
    // cashtags
    const re = CASHTAG_REGEX
    while ((match = re.exec(text.utf16))) {
      const leading = match[1]
      let ticker = match[2]

      if (!ticker) continue

      // Normalize to uppercase
      ticker = ticker.toUpperCase()

      const index = match.index + leading.length

      facets.push({
        index: {
          byteStart: text.utf16IndexToUtf8Index(index),
          byteEnd: text.utf16IndexToUtf8Index(index + 1 + ticker.length), // +1 for $
        },
        features: [
          app.bsky.richtext.facet.tag.$build({
            tag: '$' + ticker, // Store with $ prefix
          }),
        ],
      })
    }
  }
  // Facet ranges must not overlap: a consumer walking them in order -- segments()
  // among them -- silently drops the second of any overlapping pair, so an overlap
  // corrupts the record invisibly. Detection order above is precedence order and links
  // run first, so a handle or cashtag inside a URL ("example.com/($AAPL)") loses.
  const kept: Facet[] = []
  for (const facet of facets) {
    const { byteStart, byteEnd } = facet.index
    const overlaps = kept.some(
      (k) => byteStart < k.index.byteEnd && byteEnd > k.index.byteStart,
    )
    if (!overlaps) kept.push(facet)
  }

  return kept.length > 0 ? kept : undefined
}

/**
 * Known TLDs, as A-labels. The `tlds` package spells an internationalised TLD as its
 * Unicode U-label -- "рф", not "xn--p1ai" -- but every candidate reaching
 * isValidDomain is ASCII, since URL_REGEX's label grammar and MENTION_REGEX's handle
 * class both are, so a U-label could never match one. Each is converted to the punycode
 * A-label that such a name is written as in ASCII text; for a handle that is the only
 * legal spelling, @atproto/syntax admitting [a-zA-Z0-9.-] alone. Conversion is one pass
 * at module load rather than per keystroke, so isValidDomain stays an O(1) lookup. On a
 * runtime whose URL parser does not implement IDNA the U-label is kept, and that TLD
 * goes unrecognised rather than the set being wrong.
 */
const TLD_SET = new Set(
  TLDs.map((tld) => {
    const lower = tld.toLowerCase()
    if (!/\P{ASCII}/u.test(lower)) return lower
    try {
      return new URL(`https://${lower}`).hostname
    } catch {
      return lower
    }
  }),
)

/**
 * A domain is valid when its final label is a known TLD. The comparison folds ASCII
 * case, per RFC 4343: DNS case-insensitivity is a property of comparison, not of
 * storage. The set keeps this an O(1) lookup over ~1,400 TLDs, which matters on every
 * keystroke in a composer.
 */
function isValidDomain(str: string): boolean {
  const i = str.lastIndexOf('.')
  if (i === -1) {
    return false
  }
  return TLD_SET.has(str.slice(i + 1).toLowerCase())
}
