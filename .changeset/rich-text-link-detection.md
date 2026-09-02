---
'@bsky/sdk': minor
---

Fix a range of rich-text link and mention detection bugs, and one hashtag case.

- **The host is bounded.** `[\S]+` ran to the next whitespace and was repaired
  afterwards. The authority now ends at the RFC 3986 §3.2 delimiters, plus quotes and --
  in the host -- apostrophes, and the trim strips trailing sentence punctuation, in any
  script, along with any excess closing bracket.
- **A wrapper ends a URL when it is the one that opened it,** so the closer is not
  absorbed when prose runs on from it, while a quote the path itself carries survives
  (`https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic`). Only the unambiguous openers
  pair this way -- quotation marks, guillemets and backticks. An ASCII apostrophe is left
  to the authority grammar, which is what decides `example.com'dan`, and angle brackets
  are excluded from the match outright, being RFC 3986 Appendix C wrappers rather than
  URI characters.
- **Bare-domain host syntax follows RFC 1035 §2.3.1 as amended by RFC 1123 §2.1,** so a
  label may carry hyphens and begin with a digit. A schemed URL's authority is
  deliberately exempt, so IDN hosts and IPv6 literals still work.
- **Comparisons are ASCII case-insensitive, and internationalized TLDs are compared as
  punycode A-labels,** the only form ASCII text can carry. A bare domain is ASCII by
  grammar and is dropped when the name carries on past what that grammar can see, so an
  internationalized domain is detected only in its punycode spelling
  (`example.xn--q9jyb4c`) or with a scheme (`https://münchen.de`).
- **A Unicode-aware deny-list decides what may precede a URL or handle,** in place of
  "start of text, space or open paren", with detection then rejecting `-`, `_`, `.` and
  `/` before a schemeless URL and `/` before a mention.
- **Facets are no longer nested inside one another,** and a bare domain followed
  immediately by `(` is treated as a method call rather than a URL, since `.now` and
  `.map` are real TLDs.
- **`TAG_REGEX`'s keycap guard widens** from a lone variation selector to either spelling
  of the sequence, so `#⃣tag` -- a keycap emoji rather than a hashtag -- no longer produces
  a tag of `⃣tag`. This is the one hashtag behaviour that changes; `CASHTAG_REGEX` and
  `TRAILING_PUNCTUATION_REGEX` are untouched.

Together these fix run-on text (`example.com,then`), suffixation absorbed into the host
(`example.com'dan`), uppercase (`HTTPS://EXAMPLE.COM`), hyphens and digit-leading labels
(`my-site.example.com`, `404media.co`), punycoded TLDs (`example.xn--q9jyb4c`,
`@alice.xn--q9jyb4c`), wrapped URLs with prose running straight on
(`<https://example.com>following`, `«https://example.com»following`), and detection after
quotes, apostrophes and emoji, keycaps (`1️⃣https://example.com`) included.

Facets are computed at compose time and written into the record, so this changes what
clients store, not only what they render; it does not repair existing posts.
`URL_REGEX`'s numbered capture groups keep their meanings, but `MENTION_REGEX` and
`URL_REGEX` now carry the `u` flag and `URL_REGEX` no longer carries `i`.
