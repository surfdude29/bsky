// LDH label per RFC 1035 §2.3.1 as amended by RFC 1123 §2.1: letters, digits and
// hyphens, no leading or trailing hyphen. The `-+` (not `-`) keeps punycode A-labels
// such as xn--80ak6aa92e working, and this shape rather than the more obvious
// [A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])? leaves the pattern unable to backtrack.
//
// Both cases are spelled out instead of using an `i` flag: with `u` also set, Unicode
// case-folding makes [a-z] match U+017F and U+212A, which would admit "ſ.com" and
// "httpſ://" to a grammar documented as ASCII.
const LABEL = '[A-Za-z0-9]+(?:-+[A-Za-z0-9]+)*'

// Spelled out for the same reason as LABEL.
const SCHEME = '[Hh][Tt][Tt][Pp][Ss]?'

// RFC 3986 §3.2: the authority ends at "/", "?", "#" or end of input, and the port is
// inside it. The (?!\d) fails an over-long port outright rather than matching a
// five-digit prefix, so "example.com:123456/path" is not "example.com:12345".
const PORT = '(?::\\d{1,5}(?!\\d))?'
const TAIL = '(?:[/?#][^\\s]*)?'

// A schemed URL's authority: any non-space run up to an RFC 3986 §3.2 delimiter, not
// the LDH grammar above, which would truncate IDN hosts ("https://münchen.de" ->
// "https://m") and drop IPv6 literals ("https://[::1]:8080").
//
// It also stops at apostrophes and quotes, which is a practical rule rather than a
// normative one: RFC 3986 §2.2 makes "'" a sub-delim, so it is legal in a host (and in
// a path) even though no registrable name uses it. Stopping there is what keeps
// Turkish suffixation out of the domain -- "https://example.com'dan" links to
// example.com -- while an apostrophe followed by an "@" in the same authority is
// userinfo and is kept ("https://o'reilly@example.com"). The two alternatives are
// disjoint, so the group cannot backtrack.
const AUTHORITY = "(?:[^\\s/?#'\"‘’“”]|['’](?=[^\\s/?#]*@))+"

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
const LEAD = '(^|[^\\p{L}\\p{N}\\p{M}@#$]\\p{M}*)'

export const MENTION_REGEX =
  /(^|[^\p{L}\p{N}\p{M}@#$]\p{M}*)(@)([a-zA-Z0-9.-]+)(\b)/gu
// The branch alternatives capture, so the numbered groups carry: 1 preceding
// character, 2 whole match, 3 schemed URL, 4 bare domain with tail, 5 host, 6 its last
// dot-label. detectFacets uses only 1, 2 and `groups.domain`; the rest are part of the
// exported regex's contract.
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
