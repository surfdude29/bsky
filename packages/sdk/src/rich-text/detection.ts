import type { DidString, UriString } from '@atproto/lex'
import { graphemeLen } from '@atproto/lex'
import TLDs from 'tlds' with { type: 'json' }
import { app } from '../lexicons/index.js'
import { type UnicodeString } from './unicode.js'
import {
  CASHTAG_REGEX,
  KEYCAP_BASE_REGEX,
  KEYCAP_MARK,
  LEAD_EXCLUDED_REGEX,
  MENTION_REGEX,
  TAG_REGEX,
  TRAILING_PUNCTUATION_REGEX,
  URL_REGEX,
} from './util.js'

export type Facet = app.bsky.richtext.facet.Main

const SCHEME_ONLY_REGEX = /^https?:\/\/$/i

/**
 * Whether the host runs on past a bare match, into a further label or further inside the
 * current one: "example.com.みんな" and "example.coｍ" each name one host, so linking the
 * "example.com" inside either would point somewhere else. An internationalized domain is
 * detected only with a scheme, whose authority is not held to the ASCII label grammar.
 *
 * The text is first put through the IDNA mappings that decide where a label ends: NFKC
 * folds the compatibility forms onto the first alternative, IDNA_DOT_REGEX folds the
 * other separators onto the second, and IDNA_IGNORED_REGEX drops what cannot separate
 * two labels. The label grammar is greedy, so what follows a match never begins with a
 * real ASCII letter or digit, and the first alternative fires on a character one of those
 * mappings put there, or on a combining mark. The hyphen branch is the same: an ASCII one
 * is inside LABEL already, so only a mapped hyphen -- "example.com\uFF0Dfoo" is
 * example.com-foo -- ever reaches it. It reads a run of them only where a label character
 * follows, a trailing hyphen ending a name rather than continuing it.
 *
 * A mark is in that branch because it attaches to the letter the match just ended on
 * rather than beginning anything after it: "example.com\u0301" is example.coḿ, which is
 * example.xn--co-1ws, and a facet over the example.com inside it would cut a grapheme
 * cluster in half as well as name the wrong host. An unmapped *letter* there is prose
 * instead, which leaves "bsky.appを見て" linking bsky.app -- CJK is written without spaces
 * and the host is already complete -- and so is a separator with nothing after it:
 * "example.com。" ends a sentence. The two rules part over the spelling of a diacritic,
 * precomposed "example.comé" still linking example.com where the decomposed form now
 * links nothing. That is the safe direction of the two, and composing the mark onto its
 * base instead would mean reading back past the match.
 */
const HOST_CONTINUES_REGEX =
  /^(?:[A-Za-z0-9\p{M}]|-+[A-Za-z0-9]|\.[\p{L}\p{N}\p{M}])/u

/** The label separators IDNA accepts besides ".", per UTS 46 and RFC 3490 §3.1. */
const IDNA_DOT_REGEX = /[\u3002\uFF0E\uFF61]/g

/**
 * Invisible characters IDNA drops from a name or refuses it for. Either way they cannot
 * hold two labels apart, so what reads as one name is one name: "example.co\u00ADm"
 * renders as example.com, and linking the example.co inside it would point somewhere
 * else. The property is tested rather than a list, since anything a list omits is a way
 * past the test. It is wider than the set UTS 46 ignores, but what it adds is disallowed
 * in a name, so the answer here is the same.
 */
const IDNA_IGNORED_REGEX = /\p{Default_Ignorable_Code_Point}/u

/** What a separator maps to, so a run of them can be read through rather than measured. */
const IDNA_SEPARATOR_REGEX = /^[-.]+$/

/** A mark belongs to the character before it, on either side of a match. */
const MARK_REGEX = /\p{M}/u

/**
 * What a schemeless match may not follow, over and above the lead-in's own exclusions: a
 * domain preceded by one of these is part of a longer token rather than a URL. Anchored
 * whole rather than at the end, since a mapping that expands to several characters is no
 * separator -- "\u2026" folds to "..." and no name carries that, so an ellipsis before a
 * URL stays the prose it reads as, where a fullwidth stop is a label separator.
 */
const SCHEMELESS_STOP_REGEX = /^[-_./]$/

/**
 * Characters that end prose rather than a URL, wherever they fall. "_" and "~" are left
 * out, since example.com/foo_bar and example.com/~user are legitimate endings, and so
 * are the quotes: WRAPPER_PAIRS below cuts a quoted URL at its closer, so a quote
 * reaching the trim is one the path itself carries. What remains is sentence
 * punctuation, prose after a link far more often than the last character of a path; the
 * cost is that a path genuinely ending in one is truncated. AUTHORITY_ONLY_STRIP below
 * strikes the opposite balance for characters common in real paths.
 *
 * Terminal_Punctuation is that set in every script rather than in ASCII alone. Its ASCII
 * members are exactly the six characters the property replaces -- "!", ",", ".", ":", ";"
 * and "?" -- so nothing about an ASCII URL changes, while the sentence a CJK or Arabic
 * reader writes now ends the same way an English one does: "https://example.com？"
 * otherwise carries a host no URL parser accepts, and "https://example.com/記事。" a path
 * that 404s. The ellipsis and the dashes carry no such property and stay enumerated. No
 * `g` flag: this is used with `.test()` on single characters, which `g` would make
 * stateful.
 */
const TRAILING_STRIP_REGEX = /[\p{Terminal_Punctuation}\u2026\u2013\u2014]/u

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
 * quotes its path carries. Angle brackets need no entry: the grammar excludes them from
 * a match entirely.
 *
 * The criterion is an unambiguous *opener*: none of these begins a word, so one sitting
 * against a URL is quoting it. An ASCII apostrophe fails that test and is deliberately
 * absent, since it is an apostrophe at least as often as a quote and pairing it would cut
 * 'https://example.com/it's-fine' down to /it. Where one ends a host the authority
 * grammar decides instead, which keeps example.com'dan linking example.com.
 *
 * The closers are not held to the same standard, and \u2019 is the cost of that: a path
 * carrying one inside a ‘...’ wrapper is cut at it. Dropping the pair would put a stray
 * ’ on the end of every single-quoted URL instead, which is the commoner text of the two.
 */
const WRAPPER_PAIRS: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ['\u201C', '\u201D'],
  ['\u2018', '\u2019'],
  ['\u00AB', '\u00BB'],
  ['`', '`'],
])

/**
 * Where the wrapper `opener` opened closes, or -1. A pair the text nests --
 * «https://fr.wikipedia.org/wiki/«_A_»_de_Charlemagne» -- closes at the outer mark, so an
 * inner opener spends the closer that follows it, the counting trimTrailing does for
 * brackets. Where the two marks are one character ("..." and `...`) there is nothing to
 * count and the first closes.
 */
function closerAt(text: string, opener: string, closer: string): number {
  if (opener === closer) return text.indexOf(closer)
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === opener) depth++
    else if (text[i] === closer) {
      if (depth === 0) return i
      depth--
    }
  }
  return -1
}

/** The IDNA mappings that decide where a label ends, as far as this test reads them. */
function idnaMap(text: string): string {
  return text.normalize('NFKC').replace(IDNA_DOT_REGEX, '.')
}

function hostContinues(text: string, at: number): boolean {
  // Invisibles are dropped as they are read, so any number of them read as none, on
  // either side of a separator. An invisible is not itself evidence that the host carries
  // on -- what follows it is -- which keeps right-to-left prose working:
  // "example.com\u200F " is a host, a right-to-left mark and then a space.
  //
  // A separator says nothing on its own either -- "example.com\u3002" ends a sentence
  // where "example.com\u3002みんな" names a host -- so a run of them is read through and
  // the code point past it decides. Anything else answers the test by itself and ends the
  // read, which keeps the scan linear and leaves no window to size.
  let after = ''
  for (let i = at; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i)!)
    i += ch.length
    if (IDNA_IGNORED_REGEX.test(ch)) continue
    after += ch
    if (!IDNA_SEPARATOR_REGEX.test(idnaMap(ch))) break
  }
  return HOST_CONTINUES_REGEX.test(idnaMap(after))
}

/**
 * The character a match really begins after, as the mappings leave it. LEAD reads the raw
 * text, so it takes an invisible for a boundary and misses what a mapping folds a
 * character into; this rebuilds what it was looking at. The mirror of hostContinues, and
 * it reads the same way: invisibles are dropped as they are read, marks belong to the
 * character before them, and the mappings decide what a name is written with. So
 * "foo\u00ADexample.com" is the one name fooexample.com, "foo\uFF20example.com" an email
 * address and "\u24D0example.com" the name aexample.com, none of which holds an
 * example.com to link.
 *
 * The character comes back rather than a verdict, since every rule the lead-in applies
 * applies to it: one answering a single rule would buy passage past the rest. "" is a
 * boundary in its own right -- the start of the text, or a keycap, which LEAD admits
 * outright and whose U+20E3 is a mark like any other, so it is recognized at its base
 * rather than refused at its mark.
 *
 * NFKC is wider than UTS 46 in one place: it folds the squared CJK emoji ("\u{1F233}" to
 * "空"), which UTS 46 leaves alone, so a URL run straight against one of those is not
 * detected. Ordinary emoji have no such mapping and are untouched, and hostContinues has
 * read text this way all along, so both ends of a match answer alike.
 */
function boundaryBefore(text: string, at: number): string {
  let marks = ''
  for (let i = at; i > 0;) {
    const ch = codePointBefore(text, i)
    i -= ch.length
    if (IDNA_IGNORED_REGEX.test(ch)) continue
    if (MARK_REGEX.test(ch)) {
      marks += ch
      continue
    }
    if (marks.includes(KEYCAP_MARK) && KEYCAP_BASE_REGEX.test(ch)) return ''
    return idnaMap(ch)
  }
  return ''
}

function countChar(str: string, char: string): number {
  let n = 0
  for (const ch of str) {
    if (ch === char) n++
  }
  return n
}

/**
 * The code point ending at `end`, as text. `str[end - 1]` is one UTF-16 code unit, which
 * for an astral character is a lone low surrogate -- a code point in its own right, but
 * not a Terminal_Punctuation one, so a mark outside the BMP would go untrimmed.
 */
function codePointBefore(str: string, end: number): string {
  const at = end - 2
  return at >= 0 && str.codePointAt(at)! > 0xffff
    ? str.slice(at, end)
    : str[end - 1]
}

/**
 * Strips trailing characters that belong to the surrounding sentence rather than to the
 * URL. Counting brackets instead of testing for their presence lets example.com/a(b))
 * lose only the unbalanced ")" while https://foo.com/thing_(cool) keeps both of its own.
 *
 * Excess closers are all it removes. The loop only ever shortens, so an unmatched
 * *opener* stays (example.com/path( keeps its "(") and nesting is never checked
 * (example.com/a([)] keeps its crossed pair). Neither ends a sentence, which is the only
 * thing this is for.
 */
function trimTrailing(uri: string): string {
  let end = uri.length

  // Both of the loop's questions are answered up front rather than per character, since
  // a long run of either kind would otherwise rescan the whole prefix once per step.
  //
  // How many closers of each kind the prefix has in excess of their openers. Stripping
  // one takes a closer off the prefix, so decrementing keeps this true as the loop
  // shortens, and neither of the two tests below matches a bracket, so nothing else
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
    const ch = codePointBefore(uri, end)
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
      if (firstDelimiter < end - ch.length) break
      end -= ch.length
      continue
    }
    if (TRAILING_STRIP_REGEX.test(ch)) {
      end -= ch.length
      continue
    }
    const surplus = excess.get(ch)
    if (surplus !== undefined && surplus > 0) {
      excess.set(ch, surplus - 1)
      end -= ch.length
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

      // The lead-in's own exclusions, asked of the character the match really stands on
      // rather than of the one LEAD happened to read. Asked of a schemed match too:
      // "foo\u00ADhttps://example.com" reads as foohttps://example.com, a URL against a
      // word as "foohttps://..." is.
      const before = boundaryBefore(text.utf16, start)
      if (LEAD_EXCLUDED_REGEX.test(before)) {
        continue
      }
      if (domain) {
        // Required by the deny-list lead-in of URL_REGEX: a schemeless domain
        // preceded by "-", "_", "." or "/" is part of a longer token, not a URL --
        // path/to/site.com, trailing_example.com. This is twitter-text's
        // invalidUrlWithoutProtocolPrecedingChars. Schemed URLs are exempt.
        if (SCHEMELESS_STOP_REGEX.test(before)) {
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
      // The wrapper that opened the match, which is the boundary read the same way: an
      // invisible after the opener hides it from match[1] entirely, and
      // "\u201C\u00ADhttps://example.com/path\u201Dfollowing" would swallow its closer.
      const opener = before ? codePointBefore(before, before.length) : ''
      const closer = WRAPPER_PAIRS.get(opener)
      if (closer !== undefined) {
        const at = closerAt(matched, opener, closer)
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
            // boundary: detected text, bounded by URL_REGEX rather than validated by
            // it -- a schemed authority is a boundary scan, so "https://%" reaches here
            uri: uri as UriString,
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
      // ...however it is written, as for the rest of the lead-in's exclusions: an
      // invisible or a mapping stands in for the character just as well, so
      // "foo\u00AD@alice.com" and "foo\uFF20@alice.com" are both the address
      // foo@alice.com that the "@" the lead-in excludes would have kept out.
      const start = text.utf16.indexOf(match[3], match.index) - 1
      const end = start + match[3].length + 1
      const before = boundaryBefore(text.utf16, start)
      if (before === '/' || LEAD_EXCLUDED_REGEX.test(before)) {
        continue
      }
      if (
        !isValidDomain(match[3]) &&
        !match[3].toLowerCase().endsWith('.test')
      ) {
        continue // probably not a handle
      }
      // A handle is ASCII -- @atproto/syntax admits [a-zA-Z0-9.-] alone -- so a name
      // carrying on into a further label, or into a character IDNA maps inside this one,
      // is not one: it is written @alice.xn--q9jyb4c. An unmapped letter is prose here as
      // it is for a link, so "@alice.comを見て" still mentions alice.com.
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
 * Known TLDs, as A-labels. The `tlds` package spells an internationalized TLD as its
 * Unicode U-label -- "みんな", not "xn--q9jyb4c" -- but every candidate reaching
 * isValidDomain is ASCII, since URL_REGEX's label grammar and MENTION_REGEX's handle
 * class both are, so a U-label could never match one. Each is converted to the punycode
 * A-label ASCII text writes such a name as, which for a handle is the only legal
 * spelling, @atproto/syntax admitting [a-zA-Z0-9.-] alone. Conversion is one pass at
 * module load, so isValidDomain stays an O(1) lookup. Where the runtime's URL parser
 * does not implement IDNA the U-label is kept and that TLD goes unrecognized, rather
 * than the set being wrong.
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
