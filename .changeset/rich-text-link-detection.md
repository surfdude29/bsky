---
'@bsky/sdk': minor
---

Fix a range of rich-text link and mention detection bugs.

`URL_REGEX` bounded the part of a URL that follows the host: it used to run to the
next whitespace and then get repaired by stripping at most one trailing character,
so `example.com,then` became one link, `example.com/foo!!` kept an exclamation mark,
and `example.com/a(b))` kept an unbalanced bracket. The authority now ends where
RFC 3986 §3.2 says it does, and the trailing trim strips any run of sentence
punctuation while balancing `()`, `[]` and `{}`. Notably this stops apostrophe
suffixation from being absorbed into the host, so Turkish `example.com'dan` links to
`example.com` rather than to `example.xn--comdan-5h0c`.

Host syntax now follows RFC 1035 §2.3.1 as amended by RFC 1123 §2.1, so labels may
contain hyphens and may begin with a digit: `my-site.example.com`,
`xn--80ak6aa92e.com`, `404media.co` and `1.org` are detected. What still keeps
`192.168.1.1`, `12.30am` and `4.99` plain is the all-numeric-TLD rule, not the first
label.

Domain and scheme comparisons are ASCII case-insensitive (RFC 4343), so
`HTTPS://EXAMPLE.COM/Path` and `Example.Com` are detected instead of dropped.

The character permitted before a URL or a handle is now a deny-list -- anything that
is not alphanumeric, `@`, `#` or `$` -- rather than "start of text, space or open
paren". Quotes, brackets, apostrophes, arrows and emoji no longer suppress detection,
so `l'@alice.bsky.social`, `"example.com"` and `🔗https://example.com` all work.

A bare domain followed immediately by `(` is treated as a method call rather than a
URL, since `.now`, `.map`, `.next`, `.call` and `.run` are all real TLDs and
`performance.now()` was being linkified. This is a heuristic: it costs
`visit example.com(new tab)`, and does not apply to URLs that carry a scheme.

Facets are written into the record at compose time, so this changes what clients
store, not just what they render. It does not retroactively repair existing posts.
