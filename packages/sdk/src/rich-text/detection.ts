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

/**
 * Whether a bare domain or handle carries on past what the ASCII grammar matched, so that
 * linking the ASCII part would name the wrong host: a combining mark or a non-ASCII Latin
 * letter continues the last label ("example.coḿ", "example.coｍ"), and a dot or hyphen
 * plus a letter carries the name on ("example.com.みんな", "example.com-みんな", as the
 * ASCII "example.com-foo" is no facet either). A letter in another script is prose, so
 * "bsky.appを見て" links bsky.app. Bare internationalized domains are otherwise out of
 * scope; with a scheme, the authority is not held to the ASCII grammar at all.
 */
const HOST_CONTINUES_REGEX = /^(?:[\p{M}\p{Script=Latin}]|[.-]\p{L})/u

/** A URL opened by one of these ends at the matching closer, not at the next space. */
const QUOTE_PAIRS: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ['\u201C', '\u201D'],
  ['\u2018', '\u2019'],
  ['\u00AB', '\u00BB'],
  ['`', '`'],
])

const BRACKET_PAIRS: ReadonlyMap<string, string> = new Map([
  [')', '('],
  [']', '['],
  ['}', '{'],
])

// Sentence punctuation in any script (its ASCII members are ! , . : ; ?) plus the ellipsis.
const SENTENCE_PUNCTUATION_REGEX = /[\p{Terminal_Punctuation}\u2026]+$/u
// "@" and "*" are prose when they end an authority ("https://example.com@", emphasis
// around a host) but legal in a path (RFC 3986 §3.3), so they come off the former alone.
const AUTHORITY_PUNCTUATION_REGEX = /[@*]+$/
const SCHEME_PREFIX_REGEX = /^https?:\/\//i
const SCHEME_ONLY_REGEX = /^https?:\/\/$/i
// A bare domain after one of these is part of a longer token: path/to/site.com,
// trailing_example.com. The lead-in admits them so a schemed URL after them still links.
const SCHEMELESS_STOP_REGEX = /^[-_./]/

function count(str: string, char: string): number {
  let n = 0
  for (const ch of str) {
    if (ch === char) n++
  }
  return n
}

function hasPath(uri: string): boolean {
  return /[/?#]/.test(uri.replace(SCHEME_PREFIX_REGEX, ''))
}

/**
 * Strips trailing characters that belong to the sentence rather than to the URL, until
 * nothing more comes off: sentence punctuation, "@" and "*" from an authority, and any
 * closing bracket in excess of its opener -- "example.com/a(b))" loses one ")" while
 * "https://foo.com/thing_(cool)" keeps both.
 */
function trimTrailing(uri: string): string {
  let prev: string
  do {
    prev = uri
    uri = uri.replace(SENTENCE_PUNCTUATION_REGEX, '')
    if (!hasPath(uri)) {
      uri = uri.replace(AUTHORITY_PUNCTUATION_REGEX, '')
    }
    const last = uri[uri.length - 1]
    const opener = BRACKET_PAIRS.get(last)
    if (opener !== undefined && count(uri, last) > count(uri, opener)) {
      uri = uri.slice(0, -1)
    }
  } while (uri !== prev)
  return uri
}

export function detectFacets(text: UnicodeString): Facet[] | undefined {
  let match
  const facets: Facet[] = []
  {
    // links
    const re = URL_REGEX
    while ((match = re.exec(text.utf16))) {
      const lead = match[1]
      const domain = match.groups?.domain
      const start = text.utf16.indexOf(match[2], match.index)
      const end = start + match[2].length

      if (domain) {
        if (SCHEMELESS_STOP_REGEX.test(lead)) {
          continue
        }
        if (!isValidDomain(domain)) {
          continue
        }
        // Heuristic: a bare domain immediately followed by "(" is a method call. ".now",
        // ".map" and ".next" are real TLDs, so performance.now() would otherwise link.
        if (text.utf16[end] === '(') {
          continue
        }
        if (HOST_CONTINUES_REGEX.test(text.utf16.slice(end, end + 3))) {
          continue
        }
      }

      let matched = match[2]
      const closer = QUOTE_PAIRS.get(lead[0])
      if (closer !== undefined) {
        const at = matched.indexOf(closer)
        if (at !== -1) {
          matched = matched.slice(0, at)
          // The closer and what follows it have not been scanned yet:
          // "https://a.com/x"https://b.com holds two links.
          re.lastIndex = start + at
        }
      }

      const trimmed = trimTrailing(matched)
      if (!trimmed || (!domain && SCHEME_ONLY_REGEX.test(trimmed))) {
        continue
      }
      const uri = domain ? `https://${trimmed}` : trimmed

      facets.push({
        index: {
          byteStart: text.utf16IndexToUtf8Index(start),
          byteEnd: text.utf16IndexToUtf8Index(start + trimmed.length),
        },
        features: [
          app.bsky.richtext.facet.link.$build({
            uri: uri as UriString, // boundary: detected text, bounded by URL_REGEX
          }),
        ],
      })
    }
  }
  {
    // mentions
    const re = MENTION_REGEX
    while ((match = re.exec(text.utf16))) {
      const handle = match[3]
      if (!isValidDomain(handle) && !handle.toLowerCase().endsWith('.test')) {
        continue // probably not a handle
      }
      const start = text.utf16.indexOf(handle, match.index) - 1
      const end = start + handle.length + 1
      // A handle is ASCII, so a name that carries on past it is not one.
      if (HOST_CONTINUES_REGEX.test(text.utf16.slice(end, end + 3))) {
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
              did: handle as DidString, // boundary: detected text must be resolved
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
  // Facet ranges must not overlap: a consumer walking them in order (segments() among
  // them) silently drops the second of an overlapping pair. Links are detected first and
  // win, so a handle or cashtag inside a URL ("https://example.com/($AAPL)") belongs to it.
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
 * Known TLDs as lowercase A-labels. The `tlds` package spells an internationalized TLD as
 * its U-label ("みんな"), which the ASCII grammars above never match, so each is converted
 * once at module load to the punycode form ASCII text carries ("xn--q9jyb4c"). One the
 * runtime's URL parser cannot convert is kept as is and goes unrecognized.
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

/** The final label is a known TLD. The comparison folds case (RFC 4343); the text keeps its spelling. */
function isValidDomain(str: string): boolean {
  const i = str.lastIndexOf('.')
  return i !== -1 && TLD_SET.has(str.slice(i + 1).toLowerCase())
}
