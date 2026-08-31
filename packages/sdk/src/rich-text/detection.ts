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
 * Characters that end prose rather than a URL. Deliberately excludes "_" and "~":
 * example.com/foo_bar and example.com/~user are legitimate endings. A trailing "@" is
 * empty userinfo, and angle brackets are RFC 3986 Appendix C delimiters rather than
 * URI characters, so neither can end a URL. Must not carry the `g` flag -- it is used
 * with `.test()` on single characters below, and `g` would make `.test()` stateful.
 */
const TRAILING_STRIP_REGEX =
  /[.,;:!?'"*@<>\u2018\u2019\u201C\u201D\u00AB\u00BB\u2026\u2013\u2014]/

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
 */
function trimTrailing(uri: string): string {
  let end = uri.length
  while (end > 0) {
    const ch = uri[end - 1]
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
  // Ranges of the link facets emitted below, in UTF-16 indices; the mention pass
  // consults them so the two cannot produce overlapping facets.
  const linkRanges: [number, number][] = []
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
        // Heuristic: a bare domain immediately followed by "(" is a method call,
        // not a URL. ".now", ".map", ".next", ".call" and ".run" are all real
        // TLDs, so performance.now() and array.map(fn) would otherwise linkify.
        // Costs "visit example.com(new tab)"; schemed URLs are unaffected.
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
      linkRanges.push([index.start, index.end])

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
      // (https://example.com/@bsky.app), not a mention. The deny-list lead-in of
      // MENTION_REGEX newly lets it through, and the facet would overlap the link
      // facet the same text produces.
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
      // A handle inside a URL belongs to that URL -- https://example.com/?q=@bsky.app
      // is one link, not a link and a mention. Facet ranges must not overlap, and
      // segments() silently drops the second of two that do.
      if (linkRanges.some(([from, to]) => start < to && end > from)) {
        continue
      }
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
  return facets.length > 0 ? facets : undefined
}

const TLD_SET = new Set(TLDs.map((tld) => tld.toLowerCase()))

/**
 * The TLD list carries no dotted entries, so requiring the TLD to be preceded by a
 * dot and to sit at the end of the string -- as this predicate used to -- can only
 * ever match the final label. Taking that label directly is equivalent, adds ASCII
 * case folding (RFC 4343: DNS case-insensitivity is a property of comparison, not
 * of storage) and turns a linear scan over ~1,400 TLDs into an O(1) lookup, which
 * matters because this runs on every keystroke in a composer.
 */
function isValidDomain(str: string): boolean {
  const i = str.lastIndexOf('.')
  if (i === -1) {
    return false
  }
  return TLD_SET.has(str.slice(i + 1).toLowerCase())
}
