// LDH label per RFC 1035 §2.3.1 as amended by RFC 1123 §2.1: letters, digits and
// hyphens, no leading or trailing hyphen. The §2.3.4 length limits are not enforced --
// detection finds links in prose, it does not validate names. `-+` admits the double
// hyphen of a punycode A-label (xn--80ak6aa92e), and this shape leaves the engine no
// ambiguous split to explore, so a failure costs one pass instead of many.
//
// Both cases are spelled out instead of an `i` flag: with `u` also set, Unicode
// case-folding makes [a-z] match U+017F and U+212A, admitting "ſ.com" and "httpſ://"
// to a grammar documented as ASCII.
const LABEL = '[A-Za-z0-9]+(?:-+[A-Za-z0-9]+)*'

// Spelled out for the same reason as LABEL.
const SCHEME = '[Hh][Tt][Tt][Pp][Ss]?'

// RFC 3986 §3.2: the authority ends at "/", "?", "#" or end of input, and the port is
// inside it. Five digits covers every real port -- the RFC itself says `port = *DIGIT`
// -- and (?!\d) makes a longer run fail the group outright instead of matching a
// prefix, so "example.com:123456/path" is not "example.com:12345".
const PORT = '(?::\\d{1,5}(?!\\d))?'

// The tail runs to the next whitespace, excluding angle brackets alone: RFC 3986
// Appendix C wraps a URI in them precisely because they cannot occur inside one. That is
// a fact about the character rather than its width, so the fullwidth and small spellings
// are excluded beside the ASCII pair, as they are from AUTHORITY_STOP below. Quotes can
// occur -- https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic is a real page -- so what
// closes a quoted URL is decided in detectFacets, from the wrapper that opened it.
const ANGLE_BRACKETS = '<>\\uFF1C\\uFF1E\\uFE64\\uFE65'
const TAIL = `(?:[/?#][^\\s${ANGLE_BRACKETS}]*)?`

// A schemed URL's authority in the shape RFC 3986 §3.2 gives it: an optional userinfo
// ending in "@", then a host. Neither is held to the LDH grammar above, which would
// truncate IDN hosts ("https://münchen.de" -> "https://m") and drop IPv6 literals
// ("https://[::1]:8080"). Both end at the §3.2 delimiters and at the wrappers prose puts
// around a URL.
//
// Only the host also ends at an apostrophe, which keeps Turkish suffixation out of it:
// "https://example.com'dan" links to example.com. That is practical rather than
// normative -- RFC 3986 §2.2 makes "'" a sub-delim, legal in a host as in a path -- so
// "'" and "’" are excluded from the host class, not from AUTHORITY_STOP, leaving
// userinfo free to carry them ("https://o'reilly@example.com"). Splitting the two also
// confines the "@" to the authority: the userinfo run ends where the authority does, so
// in "https://o'reilly\"@example.com" the quote stops it, there is no userinfo, and the
// host ends at the apostrophe. With no "@" ahead of it the run gives back a character at
// a time, linear in what it scanned.
//
// Cutting the host there leaves the rest as unread text, so an apostrophe typed *inside*
// a host -- "https://exam'ple.com/x" -- gives two facets, https://exam and then
// ple.com/x, the apostrophe being an admitted lead-in for a bare domain. Accepted rather
// than special-cased: no registrable name carries one, so the input is a typo either way.
//
// U+FF02 and U+FF40 close the list: they are the fullwidth spellings of the quote and the
// backtick already in it, WRAPPER_PAIRS pairs them as such, and an authority ends at one
// for the same reason it ends at the ASCII pair. The angle brackets carry their own
// spellings for the same reason. Escaped rather than written out, being hard to tell
// apart from those on the page.
const AUTHORITY_STOP = `\\s/?#"“”‘«»\`${ANGLE_BRACKETS}\\uFF02\\uFF40`
const AUTHORITY = `(?:[^${AUTHORITY_STOP}]*@)?[^${AUTHORITY_STOP}'’]+`

// What may precede a URL or a handle: anything that is not a letter, a digit or a
// combining mark, and not "@", "#" or "$". A deny-list rather than an allow-list, so
// quotes, brackets, apostrophes, arrows and emoji all work without being enumerated.
// Each exclusion earns its place: letters and digits stop a URL being found part-way
// through a word, "@" keeps "foo@example.com" out, "#" keeps "#example.com" from
// overlapping its hashtag facet, and "$" keeps cashtags clear. "-", "_", "." and "/"
// are *not* excluded here; detectFacets rejects those separately for schemeless
// matches, which keeps "trailing_example.com" and "path/to/site.com" out.
//
// The classes are Unicode, which needs the `u` flag below. An ASCII-only boundary
// treats any accented or non-Latin letter as a separator, making "josé@example.com" a
// mention of @example.com and "naïve.com" a link to ve.com. Marks are excluded for the
// same reason, NFD spelling "josé" as "jose" + U+0301, but one may still *follow* the
// boundary character, so "⚠️example.com" works. The cost is that a URL run straight
// against letters, as CJK is, is not found.
//
// Keycaps are the one emoji family the deny-list cannot express, so they are enumerated:
// "1️⃣" is a digit, a variation selector and U+20E3 -- a base the list excludes, followed
// by marks. The variation selector is optional, since older text writes the sequence
// without it, and the "#" form costs nothing: TAG_REGEX's guard below refuses both
// spellings as hashtags.
// Split into its parts, since detection.ts reads a keycap backwards -- the mark first,
// the base last -- rather than as a sequence.
const KEYCAP_BASE = '[0-9#*]'
export const KEYCAP_MARK = '\u20E3'
export const KEYCAP_BASE_REGEX = new RegExp(`^${KEYCAP_BASE}$`, 'u')
const KEYCAP = `${KEYCAP_BASE}\\uFE0F?${KEYCAP_MARK}`
// Named once and exported, since detection.ts asks the same question of the character a
// match really stands on: what the lead-in denies here it must deny there, or an invisible
// or a mapping buys passage past the whole list. The two are built from one fragment so
// they cannot drift. The trailing "$" anchors the test at the end of what it is given --
// a mapping may expand, and the character that ends up against the match is the one that
// decides -- and is not the "$" inside the class, which is the cashtag sigil.
// rich-text/index.ts re-exports a fixed list, so this stays internal.
const LEAD_EXCLUDED = '\\p{L}\\p{N}\\p{M}@#$'
export const LEAD_EXCLUDED_REGEX = new RegExp(`[${LEAD_EXCLUDED}]$`, 'u')
const LEAD = `(^|${KEYCAP}|[^${LEAD_EXCLUDED}]\\p{M}*)`

// A handle takes the same lead-in as a URL, so it shares LEAD rather than restating it.
export const MENTION_REGEX = new RegExp(`${LEAD}(@)([a-zA-Z0-9.-]+)(\\b)`, 'gu')
// The branch alternatives capture, so the numbered groups carry: 1 the lead-in, either
// a keycap sequence or a boundary character with any combining marks that follow it;
// 2 the whole URL; 3 schemed URL; 4 bare domain with tail; 5 host; 6 its last
// dot-label. detectFacets uses only 1, 2 and `groups.domain`, but the rest are part of
// the exported regex's contract.
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
 * `\ufe0f` variation selector-16, `\u20e3` combining enclosing keycap: a "#" carrying either
 * opens the keycap emoji KEYCAP admits above, not a hashtag.
 * `\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2` zero-width spaces (likely incomplete)
 */
export const TAG_REGEX =
  // eslint-disable-next-line no-misleading-character-class
  /(^|\s)[#＃]((?![\ufe0f\u20e3])[^\s\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2]*[^\d\s\p{P}\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2]+[^\s\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2]*)?/gu

export const CASHTAG_REGEX =
  /(^|\s|\()\$([A-Za-z][A-Za-z0-9]{0,4})(?=\s|$|[.,;:!?)"'\u2019])/gu
