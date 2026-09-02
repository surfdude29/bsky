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
 * Whether the host runs on past a bare match, either into a further label or further
 * inside the current one: "example.com.みんな" and "example.coｍ" each name one host, and
 * linking the "example.com" inside either would point somewhere else. An
 * internationalised domain is detected only when it carries a scheme, whose authority is
 * not held to the ASCII label grammar.
 *
 * Tested against text put through the IDNA mappings that decide where a label ends:
 * NFKC folds the compatibility forms -- fullwidth, roman-numeral and mathematical
 * letters alike -- onto the first alternative, IDNA_DOT_REGEX folds the other separators
 * onto the second, and IDNA_IGNORED_REGEX names what is dropped, neither side of a label
 * being separable by one. The text after a match never begins with a real ASCII letter or digit,
 * the label grammar being greedy, so the first alternative fires only on a character one
 * of those mappings put there. "-" is deliberately absent: a trailing hyphen ends a name
 * rather than continuing it.
 *
 * A letter that is not mapped stays prose, which is what leaves "bsky.appを見て" linking
 * bsky.app -- CJK is written without spaces, and the host is already complete. So does a
 * separator with nothing after it: "example.com。" ends a sentence.
 */
const HOST_CONTINUES_REGEX = /^(?:[A-Za-z0-9]|\.[\p{L}\p{N}\p{M}])/u

/** The label separators IDNA accepts besides ".", per UTS 46 and RFC 3490 §3.1. */
const IDNA_DOT_REGEX = /[\u3002\uFF0E\uFF61]/g

/**
 * Invisible characters IDNA drops from a name or refuses it for. Either way they cannot
 * hold two labels apart, so what reads as one name is one name: "example.co\u00ADm"
 * renders as example.com, and linking the example.co inside it would point somewhere else.
 * The property is tested rather than a list, an omission from a list being a way past the
 * test. It is wider than the set UTS 46 ignores, adding characters that are disallowed in
 * a name instead -- either way the name is not one, and the answer here is the same.
 */
const IDNA_IGNORED_REGEX = /\p{Default_Ignorable_Code_Point}/u

/** A separator and a code point, which may be astral: all the test reads. */
const HOST_CONTINUES_SPAN = 3

/**
 * Characters that end prose rather than a URL, wherever they fall. "_" and "~" are
 * excluded, since example.com/foo_bar and example.com/~user are legitimate endings, and
 * so are the quotes: a URL a quote opened is cut at its closer by WRAPPER_PAIRS below, so
 * a quote reaching the trim is one the path itself carries. What is left is sentence
 * punctuation, which is prose after a link far more often than the last character of a
 * path. AUTHORITY_ONLY_STRIP below strikes the opposite balance for characters that are
 * common in real paths; the cost here is a path genuinely ending in one, which is
 * truncated. No `g` flag: this is used with `.test()` on single characters, which `g`
 * would make stateful.
 */
const TRAILING_STRIP_REGEX = /[.,;:!?\u2026\u2013\u2014]/

/**
 * Stripped only from an authority. All three are sub-delims or gen-delims that RFC 3986
 * §3.3 admits to a path, so removing them from one would change where the URL points:
 * https://example.com/glob/* and https://example.com/foo' are whole URLs.
 */
const AUTHORITY_ONLY_STRIP = new Set(['@', "'", '*'])

/** Measures the scheme, so a delimiter inside it is not read as ending the authority. */
const SCHEME_PREFIX_REGEX = /^https?:\/\//i

const BRACKET_PAIRS: ReadonlyMap<string, string> = new Map([
  [')', '('],
  [']', '['],
  ['}', '{'],
])

/**
 * The closer for each wrapper the lead-in admits as an opener. A URL opened with one ends
 * at its closer, so «https://example.com/a»then links to /a, while
 * https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic, which nothing opened, keeps the
 * quotes its path carries. Angle brackets need no entry, the grammar excluding them from
 * a match entirely.
 *
 * Only the unambiguous openers are paired. An ASCII apostrophe is deliberately absent,
 * being an apostrophe at least as often as a quote: pairing it would cut
 * 'https://example.com/it's-fine' down to /it. Where one ends a host the authority grammar
 * decides instead, which is what keeps example.com'dan linking example.com.
 */
const WRAPPER_PAIRS: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ['\u201C', '\u201D'],
  ['\u2018', '\u2019'],
  ['\u00AB', '\u00BB'],
  ['`', '`'],
])

function hostContinues(text: string, at: number): boolean {
  // Invisibles are dropped as they are read rather than counted against the span, so any
  // number of them read as none, on either side of a separator. Matches do not overlap,
  // so each run is read once. An invisible is not itself evidence that the host carries
  // on -- what follows it is -- which is what keeps right-to-left prose working, where
  // "example.com\u200F " is a host, a right-to-left mark and then a space.
  let after = ''
  for (let i = at; i < text.length && after.length < HOST_CONTINUES_SPAN;) {
    const ch = String.fromCodePoint(text.codePointAt(i)!)
    i += ch.length
    if (!IDNA_IGNORED_REGEX.test(ch)) after += ch
  }
  return HOST_CONTINUES_REGEX.test(
    after.normalize('NFKC').replace(IDNA_DOT_REGEX, '.'),
  )
}

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

  // Both of the loop's questions are answered up front rather than per character, since
  // a long run of either kind would otherwise rescan the whole prefix once per step.
  //
  // How many closers of each kind the prefix has in excess of their openers. Stripping
  // one takes a closer off the prefix, so decrementing keeps this true as the loop
  // shortens; neither of the other two sets below contains a bracket, so nothing else
  // disturbs the count.
  const excess = new Map<string, number>()
  for (const [close, open] of BRACKET_PAIRS) {
    excess.set(close, countChar(uri, close) - countChar(uri, open))
  }
  // Where the authority ends, so "is this character in a path?" is a comparison.
  const schemeLength = SCHEME_PREFIX_REGEX.exec(uri)?.[0].length ?? 0
  const delimiterAt = uri.slice(schemeLength).search(/[/?#]/)
  const firstDelimiter =
    delimiterAt === -1 ? Infinity : schemeLength + delimiterAt

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
      if (firstDelimiter < end - 1) break
      end--
      continue
    }
    if (TRAILING_STRIP_REGEX.test(ch)) {
      end--
      continue
    }
    const surplus = excess.get(ch)
    if (surplus !== undefined && surplus > 0) {
      excess.set(ch, surplus - 1)
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
        if (hostContinues(text.utf16, index.end)) {
          continue
        }
      }

      let matched = match[2]
      const closer = WRAPPER_PAIRS.get(match[1][0])
      if (closer !== undefined) {
        const at = matched.indexOf(closer)
        if (at !== -1) {
          matched = matched.slice(0, at)
          // The tail ran to the next space, so the closer and everything after it are
          // text the scan has not read yet: "https://a.com/x"https://b.com holds two
          // links, and without this the second is stepped over.
          re.lastIndex = start + matched.length
        }
      }

      const trimmed = trimTrailing(matched)
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
      // A handle is ASCII -- @atproto/syntax admits [a-zA-Z0-9.-] alone -- so a host
      // continuing into another script is not one. It is written @alice.xn--q9jyb4c.
      if (hostContinues(text.utf16, end)) {
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
 * Unicode U-label -- "みんな", not "xn--q9jyb4c" -- but every candidate reaching
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
