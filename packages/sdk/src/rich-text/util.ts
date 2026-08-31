// LDH label per RFC 1035 §2.3.1 as amended by RFC 1123 §2.1: letters, digits and
// hyphens, no leading or trailing hyphen. Written as [A-Za-z0-9]+(?:-+[A-Za-z0-9]+)*
// rather than [A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])? so the pattern is unambiguous
// and cannot backtrack. The `-+` (not `-`) keeps punycode A-labels such as
// xn--80ak6aa92e working.
//
// Both cases are spelled out rather than left to an `i` flag. Under Unicode
// case-folding -- which the `u` flag below brings with it -- /[a-z]/iu also matches
// U+017F and U+212A, so an `i` flag would quietly admit "\u017F.com" and "\u212A.com"
// to a grammar documented as ASCII-LDH, and "http\u017F://" as a scheme.
const LABEL = '[A-Za-z0-9]+(?:-+[A-Za-z0-9]+)*'

// Spelled out for the same reason as LABEL.
const SCHEME = '[Hh][Tt][Tt][Pp][Ss]?'

// RFC 3986 §3.2: the authority ends at "/", "?", "#" or end of input. The port is
// part of the authority, so ":" is handled here and not treated as a terminator.
// The (?!\d) makes an over-long port fail the whole group rather than matching a
// five-digit prefix of it: "example.com:123456/path" is not "example.com:12345".
const PORT = '(?::\\d{1,5}(?!\\d))?'
const TAIL = '(?:[/?#][^\\s]*)?'

// A schemed URL's authority: any non-space run up to an RFC 3986 §3.2 delimiter.
// Deliberately not the LDH grammar above — an ASCII-only host class would truncate
// IDN hosts ("https://münchen.de" -> "https://m") and drop IPv6 literals
// ("https://[::1]:8080"). A quote is not legal in a host; an apostrophe is, as RFC
// 3986 §2.2 lists it among sub-delims and §3.2.2 admits those to a reg-name -- but no
// registrable hostname uses one, so terminating on both is a practical rule rather
// than a normative one. It is what keeps suffixed forms out of the domain: Turkish
// "https://example.com'dan" links to example.com, not to example.com'dan. They stay
// legal in the path, which TAIL matches, and an apostrophe followed by an "@" in the
// same authority is userinfo, not a suffix ("https://o'reilly@example.com"). The two
// alternatives are disjoint, so the group stays unambiguous and cannot backtrack.
const AUTHORITY = "(?:[^\\s/?#'\"‘’“”]|['’](?=[^\\s/?#]*@))+"

// Anything that is not a letter, a digit, "@", "#" or "$" may precede a URL or a
// handle. A deny-list rather than an allow-list, so quotes, brackets, apostrophes and
// emoji all work without having to enumerate them; emoji and arrows are \p{S} rather
// than \p{L}, so they still count as a boundary. Excluding letters and digits is what
// stops a URL being detected part-way through a word; "@" keeps "foo@example.com" out,
// "#" keeps "#example.com" from overlapping the hashtag facet, and "$" keeps cashtags
// clear. A "-", "_", "." or "/" is *not* excluded here -- detectFacets rejects those
// separately for schemeless matches, which is what keeps "trailing_example.com" and
// "path/to/site.com" out.
//
// The classes are Unicode rather than ASCII, which needs the `u` flag below. An
// ASCII-only boundary treats every accented or non-Latin letter as a separator, so
// "josé@example.com" yields a mention of @example.com and "naïve.com" yields a link
// to ve.com. The cost is that a URL run directly against letters -- as CJK, which is
// written without spaces, does -- is not detected.
//
// Combining marks are excluded as well, or the same hole reopens for decomposed
// text: NFD spells "josé" as "jose" + U+0301, and a mark is neither \p{L} nor \p{N}.
// They are still allowed to *follow* the boundary character, so an emoji carrying a
// variation selector ("⚠️example.com") keeps working.
const LEAD = '(^|[^\\p{L}\\p{N}\\p{M}@#$]\\p{M}*)'

export const MENTION_REGEX =
  /(^|[^\p{L}\p{N}\p{M}@#$]\p{M}*)(@)([a-zA-Z0-9.-]+)(\b)/gu
// The branch alternatives are capturing so the numbered groups keep the meanings they
// had before this grammar was rewritten: 1 the preceding character, 2 the whole match,
// 3 a schemed URL, 4 a bare domain with its tail, 5 the host, 6 its last dot-label.
// detectFacets reads only 1, 2 and `groups.domain`; the rest exist for consumers of
// the exported regex.
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
 * `\ufe0f` emoji modifier
 * `\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2` zero-width spaces (likely incomplete)
 */
export const TAG_REGEX =
  // eslint-disable-next-line no-misleading-character-class
  /(^|\s)[#＃]((?!\ufe0f)[^\s\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2]*[^\d\s\p{P}\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2]+[^\s\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2]*)?/gu

export const CASHTAG_REGEX =
  /(^|\s|\()\$([A-Za-z][A-Za-z0-9]{0,4})(?=\s|$|[.,;:!?)"'\u2019])/gu
