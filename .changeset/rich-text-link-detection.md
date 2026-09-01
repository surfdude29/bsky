---
'@bsky/sdk': minor
---

Fix a range of rich-text link and mention detection bugs. The host is no longer taken by
running to the next whitespace and repairing afterwards: the authority ends at the RFC
3986 §3.2 delimiters, plus apostrophes and quotes as a practical rule; the wrappers prose
puts around a URL -- quotes, guillemets, backticks and the RFC 3986 Appendix C angle
brackets -- are excluded from the whole match, so the closer is not absorbed when prose
runs on from it; and an enumerated set of trailing marks is stripped, along with any
excess trailing closing bracket. Bare-domain host syntax follows RFC 1035 §2.3.1 as
amended by RFC 1123 §2.1, so a label may carry hyphens and begin with a digit -- a schemed
URL's authority is deliberately exempt, so IDN hosts and IPv6 literals still work.
Comparisons are ASCII case-insensitive, and internationalised TLDs are compared as
punycode A-labels, the only form ASCII text can carry. The regex now allows a
Unicode-aware deny-list of characters before a URL or handle rather than "start of text,
space or open paren", with detection then rejecting `-`, `_`, `.` and `/` before a
schemeless URL and `/` before a mention. Together these fix run-on text
(`example.com,then`), suffixation absorbed into the host (`example.com'dan`), uppercase
(`HTTPS://EXAMPLE.COM`), hyphens and digit-leading labels (`my-site.example.com`,
`404media.co`), punycoded TLDs (`example.xn--p1ai`, `@alice.xn--p1ai`), wrapped URLs with
prose running straight on (`<https://example.com>following`,
`«https://example.com»following`), and detection after quotes, apostrophes and emoji,
keycaps (`1️⃣https://example.com`) included. Facets are no longer nested inside one
another, and a bare domain followed immediately by `(` is treated as a method call rather
than a URL, since `.now` and `.map` are real TLDs.

Facets are computed at compose time and written into the record, so this changes what
clients store, not only what they render; it does not repair existing posts.
`URL_REGEX`'s numbered capture groups keep their meanings, but `MENTION_REGEX` and
`URL_REGEX` now carry the `u` flag and `URL_REGEX` no longer carries `i`.
