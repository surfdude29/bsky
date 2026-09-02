---
'@bsky/sdk': minor
---

Fix link and mention detection in `detectFacets`.

- A bare domain follows the RFC 1123 label grammar, so hyphens and digit-leading labels
  (`my-site.example.com`, `404media.co`) are detected, and it ends at its last label, a
  port or a `/`, `?` or `#` tail, so prose running straight on (`example.com,then`,
  `example.com。`, `example.com'dan`) is no longer absorbed into the host. A schemed
  URL's authority ends at `/`, `?`, `#`, whitespace, quote marks, angle brackets and
  apostrophes.
- The TLD comparison folds ASCII case (`HTTPS://EXAMPLE.COM`, `Example.Com`) and matches
  internationalized TLDs in their punycode spelling (`example.xn--q9jyb4c`,
  `@alice.xn--q9jyb4c`), the only form a handle can take.
- A URL or handle may follow any character that is not a letter, a digit, a combining
  mark, `@`, `#` or `$`, so quotes, brackets, apostrophes (`l'@atproto.com`) and emoji no
  longer suppress detection. A quoted URL ends at its closing quote.
- Trailing sentence punctuation and any excess closing bracket are stripped; `@` and `*`
  are stripped from an authority but kept in a path. A bare domain followed by `(` is
  read as a method call (`performance.now()`), not a link.
- Facets never overlap: a handle or cashtag written inside a URL belongs to the URL.

Facets are written into the record at compose time, so this changes what clients store,
not only what they render. `URL_REGEX` and `MENTION_REGEX` gain the `u` flag and
`URL_REGEX` drops `i`; the numbered capture groups keep their meanings.
