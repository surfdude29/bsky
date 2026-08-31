// LDH label per RFC 1035 §2.3.1 as amended by RFC 1123 §2.1: letters, digits and
// hyphens, no leading or trailing hyphen. Written as [a-z0-9]+(?:-+[a-z0-9]+)*
// rather than [a-z0-9](?:[a-z0-9-]*[a-z0-9])? so the pattern is unambiguous and
// cannot backtrack. The `-+` (not `-`) keeps punycode A-labels such as
// xn--80ak6aa92e working.
const LABEL = '[a-z0-9]+(?:-+[a-z0-9]+)*'

// A schemeless host must carry at least one dot.
const DOMAIN = `${LABEL}(?:\\.${LABEL})+`

// RFC 3986 §3.2: the authority ends at "/", "?", "#" or end of input. The port is
// part of the authority, so ":" is handled here and not treated as a terminator.
const PORT = '(?::\\d{1,5})?'
const TAIL = '(?:[/?#][^\\s]*)?'

// A schemed URL's authority: any non-space run up to an RFC 3986 §3.2 delimiter.
// Deliberately not the LDH grammar above — an ASCII-only host class would truncate
// IDN hosts ("https://münchen.de" -> "https://m") and drop IPv6 literals
// ("https://[::1]:8080"). Apostrophes and quotes are never legal in a host, and
// terminating on them is what keeps suffixed forms out of the domain: Turkish
// "https://example.com'dan" links to example.com, not to example.com'dan. They stay
// legal in the path, which TAIL matches.
const AUTHORITY = '[^\\s/?#\'"‘’“”]+'

// Anything that is not alphanumeric, "@", "#" or "$" may precede a URL or a handle.
// A deny-list rather than an allow-list, so quotes, brackets, apostrophes and emoji
// all work without having to enumerate them. Excluding alphanumerics is what keeps
// "trailing_example.com" out; "@" keeps "foo@example.com" out, "#" keeps
// "#example.com" from overlapping the hashtag facet, and "$" keeps cashtags clear.
// Same excluded set as twitter-text's validUrlPrecedingChars.
const LEAD = '(^|[^A-Za-z0-9@#$])'

export const MENTION_REGEX = /(^|[^A-Za-z0-9@#$])(@)([a-zA-Z0-9.-]+)(\b)/g
export const URL_REGEX = new RegExp(
  LEAD +
    '(' +
    `https?:\\/\\/${AUTHORITY}${TAIL}` +
    '|' +
    `(?<domain>${DOMAIN})${PORT}${TAIL}` +
    ')',
  'gim',
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
