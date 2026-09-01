// LDH label per RFC 1035 §2.3.1 as amended by RFC 1123 §2.1: letters, digits and
// hyphens, no leading or trailing hyphen. The §2.3.4 length limits are not enforced --
// detection is about finding a link in prose, not validating a name. The `-+` (not
// `-`) keeps punycode A-labels such as xn--80ak6aa92e working, and this shape rather
// than the more obvious [A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])? leaves the engine no
// ambiguous split to explore, so a failure costs one pass instead of many.
//
// Both cases are spelled out instead of using an `i` flag: with `u` also set, Unicode
// case-folding makes [a-z] match U+017F and U+212A, which would admit "ſ.com" and
// "httpſ://" to a grammar documented as ASCII.
const LABEL = '[A-Za-z0-9]+(?:-+[A-Za-z0-9]+)*'

// Spelled out for the same reason as LABEL.
const SCHEME = '[Hh][Tt][Tt][Pp][Ss]?'

// RFC 3986 §3.2: the authority ends at "/", "?", "#" or end of input, and the port is
// inside it. Five digits is a practical cap covering every real port -- the RFC itself
// says `port = *DIGIT` -- and the (?!\d) makes a longer run fail the group outright
// rather than matching a prefix, so "example.com:123456/path" is not
// "example.com:12345".
const PORT = '(?::\\d{1,5}(?!\\d))?'

// Angle brackets are the only characters a path cannot carry: RFC 3986 Appendix C wraps a
// URI in them precisely because they cannot occur inside one. Quotes can and do --
// https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic is a real page -- so what closes a
// quoted URL is decided in detectFacets from the wrapper that opened it, not here.
const TAIL = '(?:[/?#][^\\s<>]*)?'

// A schemed URL's authority: any non-space run up to an RFC 3986 §3.2 delimiter, not
// the LDH grammar above, which would truncate IDN hosts ("https://münchen.de" ->
// "https://m") and drop IPv6 literals ("https://[::1]:8080").
//
// It also stops at the wrappers prose puts around a URL and at apostrophes, neither of
// which a registrable name carries. That is a practical rule rather than a normative
// one: RFC 3986 §2.2 makes "'" a sub-delim, so it is legal in a host and in a path.
// Stopping there is what keeps Turkish suffixation out of the domain --
// "https://example.com'dan" links to example.com -- while an apostrophe followed by an
// "@" in the same authority is userinfo and is kept ("https://o'reilly@example.com").
// The two alternatives are disjoint, so the group cannot backtrack.
//
// The lookahead spans AUTHORITY_STOP rather than the §3.2 delimiters alone, so it cannot
// admit an apostrophe on the strength of an "@" lying past the point the authority itself
// ends: in "https://o'reilly\"@example.com" the quote is a hard stop, so that "@" is no
// userinfo and the host ends at the apostrophe. "'" and "’" are deliberately absent from
// the stop set, being the conditional pair the lookahead must still be able to cross.
//
// It is bounded rather than open-ended because it runs once per apostrophe, each time
// rescanning to the same "@": unbounded that is quadratic in a run of them. The 255 is
// a cap on how far an apostrophe may look for its "@", not a limit the URI grammar
// imposes -- RFC 3986 gives userinfo no length at all. It is longer than any userinfo
// that fits in a post beside a URL, and overrunning it just reads the apostrophe as a
// suffix rather than userinfo, which is the commoner of the two.
const AUTHORITY_STOP = '\\s/?#"“”‘«»`<>'
const AUTHORITY = `(?:[^${AUTHORITY_STOP}'’]|['’](?=[^${AUTHORITY_STOP}]{0,255}@))+`

// What may precede a URL or a handle: anything that is not a letter, a digit or a
// combining mark, and not "@", "#" or "$". A deny-list rather than an allow-list, so
// quotes, brackets, apostrophes, arrows and emoji all work without being enumerated --
// none of them is a letter or a digit. Each exclusion buys something: letters and
// digits stop a URL being found part-way through a word, "@" keeps "foo@example.com"
// out, "#" keeps "#example.com" from overlapping its hashtag facet, and "$" keeps
// cashtags clear. "-", "_", "." and "/" are *not* excluded here; detectFacets rejects
// those separately for schemeless matches, which is what keeps "trailing_example.com"
// and "path/to/site.com" out.
//
// The classes are Unicode, which needs the `u` flag below. An ASCII-only boundary
// treats any accented or non-Latin letter as a separator, making "josé@example.com" a
// mention of @example.com and "naïve.com" a link to ve.com; marks are excluded for the
// same reason, since NFD spells "josé" as "jose" + U+0301. A mark may still *follow*
// the boundary character, so an emoji carrying a variation selector ("⚠️example.com")
// works. The cost is that a URL run straight against letters, as CJK is, is not found.
//
// Keycaps are the one emoji family the deny-list cannot express, so they are enumerated:
// "1️⃣" is a digit, a variation selector and U+20E3, which is a base the list excludes
// followed by marks. Spelling them out is what makes the "emoji" above true rather than
// nearly true. The variation selector is optional, since older text writes the sequence
// without it. The "#" form costs nothing here -- TAG_REGEX's guard below excludes both
// spellings from being read as a hashtag.
const KEYCAP = '[0-9#*]\\uFE0F?\\u20E3'
const LEAD = `(^|${KEYCAP}|[^\\p{L}\\p{N}\\p{M}@#$]\\p{M}*)`

// A handle takes the same lead-in as a URL, so it shares LEAD rather than restating it.
export const MENTION_REGEX = new RegExp(`${LEAD}(@)([a-zA-Z0-9.-]+)(\\b)`, 'gu')
// The branch alternatives capture, so the numbered groups carry: 1 the lead-in, being
// a keycap sequence or a boundary character with any combining marks that follow it,
// 2 whole match,
// 3 schemed URL, 4 bare domain with tail, 5 host, 6 its last dot-label. detectFacets
// uses only 1, 2 and `groups.domain`; the rest are part of the exported regex's
// contract.
export const URL_REGEX = new RegExp(
  LEAD +
    '(' +
    `(${SCHEME}:\\/\\/${AUTHORITY}${TAIL})` +
    '|' +
    `((?<domain>${LABEL}(\\.${LABEL})+)${PORT}${TAIL})` +
    ')',
  'gmu',
)
export const TRAILING_PUNCTUATION_REGEX = /\p{P}+$/gu

/**
 * `\ufe0f` emoji modifier, `\u20e3` combining enclosing keycap: a "#" carrying either
 * opens the keycap emoji KEYCAP admits above, not a hashtag.
 * `\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2` zero-width spaces (likely incomplete)
 */
export const TAG_REGEX =
  // eslint-disable-next-line no-misleading-character-class
  /(^|\s)[#＃]((?![\ufe0f\u20e3])[^\s\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2]*[^\d\s\p{P}\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2]+[^\s\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2]*)?/gu

export const CASHTAG_REGEX =
  /(^|\s|\()\$([A-Za-z][A-Za-z0-9]{0,4})(?=\s|$|[.,;:!?)"'\u2019])/gu
