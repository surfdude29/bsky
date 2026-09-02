// A DNS label per RFC 1035 §2.3.1 as amended by RFC 1123 §2.1: letters, digits and
// hyphens, with no leading or trailing hyphen. Both cases are spelled out rather than
// using the `i` flag: combined with `u`, a case-insensitive [a-z] also matches U+017F and
// U+212A, which would admit "ſ.com" to a grammar meant to be ASCII.
const LABEL = '[A-Za-z0-9]+(?:-+[A-Za-z0-9]+)*'
const SCHEME = '[Hh][Tt][Tt][Pp][Ss]?'
// At most five digits; a longer run fails the group instead of matching a prefix.
const PORT = '(?::\\d{1,5}(?!\\d))?'

// Quote marks wrap a URL rather than belong to it. An authority never contains one, and
// a path may (https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic), so detectFacets cuts a
// path only at the closer of the quote that opened the match.
const QUOTES = '"\u201C\u201D\u2018\u2019\u00AB\u00BB`'
// RFC 3986 §3.2: the authority ends at "/", "?" or "#". It also ends at an apostrophe,
// which keeps Turkish suffixation out of the host ("example.com'dan"), and at angle
// brackets, which never occur inside a URL (RFC 3986 Appendix C).
const AUTHORITY = `[^\\s/?#'${QUOTES}<>]+`
const TAIL = '(?:[/?#][^\\s<>]*)?'

// What may precede a URL or a handle: anything that is not a letter, a digit or a
// combining mark, and not "@", "#" or "$" -- so quotes, brackets, apostrophes and emoji
// work without being enumerated. "＃" is excluded beside "#" because TAG_REGEX opens on
// either, and a link facet after it would take the hashtag's text. The classes are Unicode (the `u` flag), so an accented
// or non-Latin letter is not a boundary: "josé@example.com" is not a mention and
// "naïve.com" is not a link to ve.com. A keycap emoji (1️⃣) is a digit followed by marks,
// the one emoji shape the deny-list cannot express, so it is admitted explicitly.
const KEYCAP = '[0-9#*]\\uFE0F?\\u20E3'
const BOUNDARY = '\\p{L}\\p{N}\\p{M}@#\uFF03$'
const LEAD = `(^|${KEYCAP}|[^${BOUNDARY}]\\p{M}*)`

// A handle additionally may not follow "_", "+", "-" or "/": "foo_@example.com" is an
// email address and "https://example.com/@bsky.app" is a path.
export const MENTION_REGEX = new RegExp(
  `(^|${KEYCAP}|[^${BOUNDARY}_+/-]\\p{M}*)(@)([a-zA-Z0-9.-]+)(\\b)`,
  'gu',
)
// Numbered groups: 1 the lead-in, 2 the URL, 3 schemed URL, 4 bare domain with tail,
// 5 host, 6 its last dot-label. detectFacets reads 1, 2 and `groups.domain`.
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
