---
'@bsky/sdk': minor
---

Fix a range of rich-text link and mention detection bugs. The host is no longer taken by
running to the next whitespace and repairing afterwards: the authority ends where RFC
3986 §3.2 says it does, and an enumerated set of trailing marks is stripped with
brackets balanced. Host syntax
follows RFC 1035 §2.3.1 as amended by RFC 1123 §2.1, so a label may carry hyphens and
begin with a digit; comparisons are ASCII case-insensitive; and the character allowed
before a URL or handle is a Unicode-aware deny-list rather than "start of text, space or
open paren". Together these fix run-on text (`example.com,then`), suffixation absorbed
into the host (`example.com'dan`), uppercase (`HTTPS://EXAMPLE.COM`), hyphens and
digit-leading labels (`my-site.example.com`, `404media.co`), and detection after quotes,
apostrophes and emoji. Facets are no longer nested inside one another, and a bare domain
followed immediately by `(` is treated as a method call rather than a URL, since `.now`
and `.map` are real TLDs.

Facets are computed at compose time and written into the record, so this changes what
clients store, not only what they render; it does not repair existing posts.
`URL_REGEX`'s numbered capture groups keep their meanings, but `MENTION_REGEX` and
`URL_REGEX` now carry the `u` flag and `URL_REGEX` no longer carries `i`.
