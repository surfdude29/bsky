import type { AtprotoDid, HandleResolver } from '@atproto-labs/handle-resolver'
import { describe, expect, it } from 'vitest'
import { app } from '../src/lexicons/index.js'
import {
  MENTION_REGEX,
  RichText,
  RichTextSegment,
  URL_REGEX,
} from '../src/rich-text/index.js'
import { is$typedObject } from '../src/utils/types.js'

const isLink = <T extends Record<string, unknown>>(f: T) =>
  is$typedObject(f, app.bsky.richtext.facet.link.$type)
const isMention = <T extends Record<string, unknown>>(f: T) =>
  is$typedObject(f, app.bsky.richtext.facet.mention.$type)
const isTag = <T extends Record<string, unknown>>(f: T) =>
  is$typedObject(f, app.bsky.richtext.facet.tag.$type)

// Stub resolver: mirrors the old AtpAgent mock — resolves every handle to did:fake:<handle>
const resolver: HandleResolver = {
  async resolve(handle) {
    return `did:fake:${handle}` as unknown as AtprotoDid
  },
}

describe('detectFacets', () => {
  const inputs = [
    'no mention',
    '@handle.com middle end',
    'start @handle.com end',
    'start middle @handle.com',
    '@handle.com @handle.com @handle.com',
    '@full123-chars.test',
    'not@right',
    '@handle.com!@#$chars',
    '@handle.com\n@handle.com',
    'parenthetical (@handle.com)',
    '👨‍👩‍👧‍👧 @handle.com 👨‍👩‍👧‍👧',

    'start https://middle.com end',
    'start https://middle.com/foo/bar end',
    'start https://middle.com/foo/bar?baz=bux end',
    'start https://middle.com/foo/bar?baz=bux#hash end',
    'https://start.com/foo/bar?baz=bux#hash middle end',
    'start middle https://end.com/foo/bar?baz=bux#hash',
    'https://newline1.com\nhttps://newline2.com',
    '👨‍👩‍👧‍👧 https://middle.com 👨‍👩‍👧‍👧',

    'start middle.com end',
    'start middle.com/foo/bar end',
    'start middle.com/foo/bar?baz=bux end',
    'start middle.com/foo/bar?baz=bux#hash end',
    'start.com/foo/bar?baz=bux#hash middle end',
    'start middle end.com/foo/bar?baz=bux#hash',
    'newline1.com\nnewline2.com',
    'a example.com/index.php php link',
    'a trailing bsky.app: colon',

    'not.. a..url ..here',
    'e.g.',
    'something-cool.jpg',
    'website.com.jpg',
    'e.g./foo',
    'website.com.jpg/foo',

    'Classic article https://socket3.wordpress.com/2018/02/03/designing-windows-95s-user-interface/',
    'Classic article https://socket3.wordpress.com/2018/02/03/designing-windows-95s-user-interface/ ',
    'https://foo.com https://bar.com/whatever https://baz.com',
    'punctuation https://foo.com, https://bar.com/whatever; https://baz.com.',
    'parenthentical (https://foo.com)',
    'except for https://foo.com/thing_(cool)',
  ]
  const outputs: string[][][] = [
    [['no mention']],
    [['@handle.com', 'did:fake:handle.com'], [' middle end']],
    [['start '], ['@handle.com', 'did:fake:handle.com'], [' end']],
    [['start middle '], ['@handle.com', 'did:fake:handle.com']],
    [
      ['@handle.com', 'did:fake:handle.com'],
      [' '],
      ['@handle.com', 'did:fake:handle.com'],
      [' '],
      ['@handle.com', 'did:fake:handle.com'],
    ],
    [['@full123-chars.test', 'did:fake:full123-chars.test']],
    [['not@right']],
    [['@handle.com', 'did:fake:handle.com'], ['!@#$chars']],
    [
      ['@handle.com', 'did:fake:handle.com'],
      ['\n'],
      ['@handle.com', 'did:fake:handle.com'],
    ],
    [['parenthetical ('], ['@handle.com', 'did:fake:handle.com'], [')']],
    [['👨‍👩‍👧‍👧 '], ['@handle.com', 'did:fake:handle.com'], [' 👨‍👩‍👧‍👧']],

    [['start '], ['https://middle.com', 'https://middle.com'], [' end']],
    [
      ['start '],
      ['https://middle.com/foo/bar', 'https://middle.com/foo/bar'],
      [' end'],
    ],
    [
      ['start '],
      [
        'https://middle.com/foo/bar?baz=bux',
        'https://middle.com/foo/bar?baz=bux',
      ],
      [' end'],
    ],
    [
      ['start '],
      [
        'https://middle.com/foo/bar?baz=bux#hash',
        'https://middle.com/foo/bar?baz=bux#hash',
      ],
      [' end'],
    ],
    [
      [
        'https://start.com/foo/bar?baz=bux#hash',
        'https://start.com/foo/bar?baz=bux#hash',
      ],
      [' middle end'],
    ],
    [
      ['start middle '],
      [
        'https://end.com/foo/bar?baz=bux#hash',
        'https://end.com/foo/bar?baz=bux#hash',
      ],
    ],
    [
      ['https://newline1.com', 'https://newline1.com'],
      ['\n'],
      ['https://newline2.com', 'https://newline2.com'],
    ],
    [['👨‍👩‍👧‍👧 '], ['https://middle.com', 'https://middle.com'], [' 👨‍👩‍👧‍👧']],

    [['start '], ['middle.com', 'https://middle.com'], [' end']],
    [
      ['start '],
      ['middle.com/foo/bar', 'https://middle.com/foo/bar'],
      [' end'],
    ],
    [
      ['start '],
      ['middle.com/foo/bar?baz=bux', 'https://middle.com/foo/bar?baz=bux'],
      [' end'],
    ],
    [
      ['start '],
      [
        'middle.com/foo/bar?baz=bux#hash',
        'https://middle.com/foo/bar?baz=bux#hash',
      ],
      [' end'],
    ],
    [
      [
        'start.com/foo/bar?baz=bux#hash',
        'https://start.com/foo/bar?baz=bux#hash',
      ],
      [' middle end'],
    ],
    [
      ['start middle '],
      ['end.com/foo/bar?baz=bux#hash', 'https://end.com/foo/bar?baz=bux#hash'],
    ],
    [
      ['newline1.com', 'https://newline1.com'],
      ['\n'],
      ['newline2.com', 'https://newline2.com'],
    ],
    [
      ['a '],
      ['example.com/index.php', 'https://example.com/index.php'],
      [' php link'],
    ],
    [['a trailing '], ['bsky.app', 'https://bsky.app'], [': colon']],

    [['not.. a..url ..here']],
    [['e.g.']],
    [['something-cool.jpg']],
    [['website.com.jpg']],
    [['e.g./foo']],
    [['website.com.jpg/foo']],

    [
      ['Classic article '],
      [
        'https://socket3.wordpress.com/2018/02/03/designing-windows-95s-user-interface/',
        'https://socket3.wordpress.com/2018/02/03/designing-windows-95s-user-interface/',
      ],
    ],
    [
      ['Classic article '],
      [
        'https://socket3.wordpress.com/2018/02/03/designing-windows-95s-user-interface/',
        'https://socket3.wordpress.com/2018/02/03/designing-windows-95s-user-interface/',
      ],
      [' '],
    ],
    [
      ['https://foo.com', 'https://foo.com'],
      [' '],
      ['https://bar.com/whatever', 'https://bar.com/whatever'],
      [' '],
      ['https://baz.com', 'https://baz.com'],
    ],
    [
      ['punctuation '],
      ['https://foo.com', 'https://foo.com'],
      [', '],
      ['https://bar.com/whatever', 'https://bar.com/whatever'],
      ['; '],
      ['https://baz.com', 'https://baz.com'],
      ['.'],
    ],
    [['parenthentical ('], ['https://foo.com', 'https://foo.com'], [')']],
    [
      ['except for '],
      ['https://foo.com/thing_(cool)', 'https://foo.com/thing_(cool)'],
    ],
  ]
  it('correctly handles a set of text inputs', async () => {
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]
      const rt = new RichText({ text: input })
      await rt.detectFacets(resolver)
      expect(Array.from(rt.segments(), segmentToOutput)).toEqual(outputs[i])
    }
  })

  describe('correctly detects tags inline', () => {
    const inputs: [
      string,
      string[],
      { byteStart: number; byteEnd: number }[],
    ][] = [
      ['#a', ['a'], [{ byteStart: 0, byteEnd: 2 }]],
      [
        '#a #b',
        ['a', 'b'],
        [
          { byteStart: 0, byteEnd: 2 },
          { byteStart: 3, byteEnd: 5 },
        ],
      ],
      ['#1', [], []],
      ['#1a', ['1a'], [{ byteStart: 0, byteEnd: 3 }]],
      ['#tag', ['tag'], [{ byteStart: 0, byteEnd: 4 }]],
      ['body #tag', ['tag'], [{ byteStart: 5, byteEnd: 9 }]],
      ['#tag body', ['tag'], [{ byteStart: 0, byteEnd: 4 }]],
      ['body #tag body', ['tag'], [{ byteStart: 5, byteEnd: 9 }]],
      ['body #1', [], []],
      ['body #1a', ['1a'], [{ byteStart: 5, byteEnd: 8 }]],
      ['body #a1', ['a1'], [{ byteStart: 5, byteEnd: 8 }]],
      ['#', [], []],
      ['#?', [], []],
      ['text #', [], []],
      ['text # text', [], []],
      [
        'body #thisisa64characterstring_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ['thisisa64characterstring_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
        [{ byteStart: 5, byteEnd: 70 }],
      ],
      [
        'body #thisisa65characterstring_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab',
        [],
        [],
      ],
      [
        // 33 butterflies: 66 UTF-16 units but 33 graphemes — within the
        // 64-grapheme limit (upstream #2657)
        `body #${'🦋'.repeat(33)}`,
        ['🦋'.repeat(33)],
        [{ byteStart: 5, byteEnd: 5 + 1 + 33 * 4 }],
      ],
      [
        // 65 butterflies: over the limit in graphemes too — rejected
        `body #${'🦋'.repeat(65)}`,
        [],
        [],
      ],
      [
        'body #thisisa64characterstring_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!',
        ['thisisa64characterstring_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
        [{ byteStart: 5, byteEnd: 70 }],
      ],
      [
        'its a #double#rainbow',
        ['double#rainbow'],
        [{ byteStart: 6, byteEnd: 21 }],
      ],
      ['##hashash', ['#hashash'], [{ byteStart: 0, byteEnd: 9 }]],
      ['##', [], []],
      ['some #n0n3s@n5e!', ['n0n3s@n5e'], [{ byteStart: 5, byteEnd: 15 }]],
      [
        'works #with,punctuation',
        ['with,punctuation'],
        [{ byteStart: 6, byteEnd: 23 }],
      ],
      [
        'strips trailing #punctuation, #like. #this!',
        ['punctuation', 'like', 'this'],
        [
          { byteStart: 16, byteEnd: 28 },
          { byteStart: 30, byteEnd: 35 },
          { byteStart: 37, byteEnd: 42 },
        ],
      ],
      [
        'strips #multi_trailing___...',
        ['multi_trailing'],
        [{ byteStart: 7, byteEnd: 22 }],
      ],
      [
        'works with #🦋 emoji, and #butter🦋fly',
        ['🦋', 'butter🦋fly'],
        [
          { byteStart: 11, byteEnd: 16 },
          { byteStart: 28, byteEnd: 42 },
        ],
      ],
      [
        '#same #same #but #diff',
        ['same', 'same', 'but', 'diff'],
        [
          { byteStart: 0, byteEnd: 5 },
          { byteStart: 6, byteEnd: 11 },
          { byteStart: 12, byteEnd: 16 },
          { byteStart: 17, byteEnd: 22 },
        ],
      ],
      ['this #️⃣tag should not be a tag', [], []],
      [
        'this ##️⃣tag should be a tag',
        ['#️⃣tag'],
        [
          {
            byteStart: 5,
            byteEnd: 16,
          },
        ],
      ],
      [
        'this #t\nag should be a tag',
        ['t'],
        [
          {
            byteStart: 5,
            byteEnd: 7,
          },
        ],
      ],
      ['no match (\\u200B): #​', [], []],
      ['no match (\\u200Ba): #​a', [], []],
      ['match (a\\u200Bb): #a​b', ['a'], [{ byteStart: 18, byteEnd: 20 }]],
      ['match (ab\\u200B): #ab​', ['ab'], [{ byteStart: 18, byteEnd: 21 }]],
      ['no match (\\u20e2tag): #⃢tag', [], []],
      ['no match (a\\u20e2b): #a⃢b', ['a'], [{ byteStart: 21, byteEnd: 23 }]],
      [
        'match full width number sign (tag): ＃tag',
        ['tag'],
        [{ byteStart: 36, byteEnd: 42 }],
      ],
      [
        'match full width number sign (tag): ＃#️⃣tag',
        ['#️⃣tag'],
        [{ byteStart: 36, byteEnd: 49 }],
      ],
      ['no match 1?: #1?', [], []],
    ]

    it.each(inputs)('%s', async (input, tags, indices) => {
      const rt = new RichText({ text: input })
      await rt.detectFacets(resolver)

      const detectedTags: string[] = []
      const detectedIndices: { byteStart: number; byteEnd: number }[] = []

      for (const { facet } of rt.segments()) {
        if (!facet) continue
        for (const feature of facet.features) {
          if (isTag(feature)) {
            detectedTags.push(feature.tag)
          }
        }
        detectedIndices.push(facet.index)
      }

      expect(detectedTags).toEqual(tags)
      expect(detectedIndices).toEqual(indices)
    })
  })

  describe('correctly detects cashtags inline', () => {
    const inputs: [
      string,
      string[],
      { byteStart: number; byteEnd: number }[],
    ][] = [
      ['$AAPL', ['$AAPL'], [{ byteStart: 0, byteEnd: 5 }]],
      ['$aapl', ['$AAPL'], [{ byteStart: 0, byteEnd: 5 }]], // normalized to uppercase
      ['$A', ['$A'], [{ byteStart: 0, byteEnd: 2 }]],
      ['$a', ['$A'], [{ byteStart: 0, byteEnd: 2 }]], // single char normalized
      [
        '$BTC $ETH',
        ['$BTC', '$ETH'],
        [
          { byteStart: 0, byteEnd: 4 },
          { byteStart: 5, byteEnd: 9 },
        ],
      ],
      ['$100', [], []], // starts with digit - not a cashtag
      ['$GOOGL', ['$GOOGL'], [{ byteStart: 0, byteEnd: 6 }]], // 5 chars - max length
      ['$TOOLONG', [], []], // >5 chars
      ['check $LEGO now', ['$LEGO'], [{ byteStart: 6, byteEnd: 11 }]],
      ['($GOOG)', ['$GOOG'], [{ byteStart: 1, byteEnd: 6 }]],
      ['$AAPL.', ['$AAPL'], [{ byteStart: 0, byteEnd: 5 }]], // trailing punctuation
      [
        '$AAPL, $MSFT!',
        ['$AAPL', '$MSFT'],
        [
          { byteStart: 0, byteEnd: 5 },
          { byteStart: 7, byteEnd: 12 },
        ],
      ],
      ['no$SPACE', [], []], // must have leading space or start
      ['$', [], []], // just dollar sign
      ['$ AAPL', [], []], // space after $
      ['$123ABC', [], []], // starts with digit
      ['$ABC12', ['$ABC12'], [{ byteStart: 0, byteEnd: 6 }]], // digits after letters OK (5 chars)
      ['$ABC123', [], []], // 6 chars - too long
    ]

    it.each(inputs)('%s', (input, tags, indices) => {
      const rt = new RichText({ text: input })
      rt.detectFacetsWithoutResolution()

      const detectedTags: string[] = []
      const detectedIndices: { byteStart: number; byteEnd: number }[] = []

      for (const { facet } of rt.segments()) {
        if (!facet) continue
        for (const feature of facet.features) {
          if (isTag(feature) && feature.tag.startsWith('$')) {
            detectedTags.push(feature.tag)
          }
        }
        if (facet.features.some((f) => isTag(f) && f.tag.startsWith('$'))) {
          detectedIndices.push(facet.index)
        }
      }

      expect(detectedTags).toEqual(tags)
      expect(detectedIndices).toEqual(indices)
    })
  })
})

function segmentToOutput(segment: RichTextSegment): string[] {
  if (segment.facet) {
    return [
      segment.text,
      segment.facet?.features.map((f) => {
        if (isMention(f)) return f.did
        if (isLink(f)) return f.uri
        return undefined
      })?.[0] || '',
    ]
  }
  return [segment.text]
}

describe('detectFacets with Client', () => {
  it('resolves mentions using a Client instance', async () => {
    // Use a HandleResolver directly to test the resolve path
    const mockResolver: HandleResolver = {
      async resolve(handle: string) {
        return `did:plc:resolved-${handle}` as const
      },
    }

    const rt = new RichText({ text: 'hello @alice.test' })
    await rt.detectFacets(mockResolver)

    const mentions = rt.facets?.filter((f) => f.features.some(isMention)) ?? []
    expect(mentions.length).toBe(1)
    const mention = mentions[0]?.features.find(isMention)
    expect(mention?.did).toBe('did:plc:resolved-alice.test')
  })
})

describe('RichText.resolve', () => {
  it('creates rich text with facets detected and mentions resolved', async () => {
    const rt = await RichText.resolve(
      'hello @alice.test check https://example.com',
      {
        resolver,
      },
    )

    expect(rt).toBeInstanceOf(RichText)
    expect(rt.text).toBe('hello @alice.test check https://example.com')

    const mention = rt.facets?.flatMap((f) => f.features).find(isMention)
    expect(mention?.did).toBe('did:fake:alice.test')

    const link = rt.facets?.flatMap((f) => f.features).find(isLink)
    expect(link?.uri).toBe('https://example.com')
  })

  it('honors RichTextOpts (cleanNewlines)', async () => {
    const rt = await RichText.resolve('hello\n\n\n\n\nworld', {
      resolver,
      cleanNewlines: true,
    })
    expect(rt.text).toBe('hello\n\nworld')
  })

  it('produces no facets for plain text', async () => {
    const rt = await RichText.resolve('just plain text', { resolver })
    expect(rt.facets).toBeUndefined()
  })
})

/**
 * Facets are read from `rt.facets` rather than `rt.segments()`: segments skip any facet
 * that starts before the previous one ended, so an overlapping pair would look correct
 * through that lens while both were written into the record.
 */
const facetsOf = (text: string) => {
  const rt = new RichText({ text })
  rt.detectFacetsWithoutResolution()
  return (rt.facets ?? []).map((facet) => ({
    text: rt.unicodeText.slice(facet.index.byteStart, facet.index.byteEnd),
    index: facet.index,
    features: facet.features,
  }))
}

/** Every link facet as [matched text, uri]. */
const links = (text: string): [string, string][] =>
  facetsOf(text).flatMap((f) =>
    f.features.filter(isLink).map((l): [string, string] => [f.text, l.uri]),
  )

/** Every mention facet as [matched text, handle]. */
const mentions = (text: string): [string, string][] =>
  facetsOf(text).flatMap((f) =>
    f.features.filter(isMention).map((m): [string, string] => [f.text, m.did]),
  )

const link = (text: string, uri = text): [string, string][] => [[text, uri]]
const bare = (text: string): [string, string][] => [[text, `https://${text}`]]

const linkCases: [string, [string, string][]][] = [
  // Case folding, on the scheme and on the TLD comparison (social-app issue 6332).
  ['HTTPS://EXAMPLE.COM/Path', link('HTTPS://EXAMPLE.COM/Path')],
  ['visit Example.Com', bare('Example.Com')],

  // Hyphens and digit-leading labels (social-app issue 8372), punycode A-labels among
  // them. The negatives fail on their final label, never their first.
  ['my-site.example.com is up', bare('my-site.example.com')],
  ['xn--80ak6aa92e.com', bare('xn--80ak6aa92e.com')],
  ['v1.2-example.com', bare('v1.2-example.com')],
  ['1.org', bare('1.org')],
  ['404media.co', bare('404media.co')],
  ['-bad.com', []],
  ['bad-.com', []],
  ['ping 192.168.1.1 now', []],
  ['meet at 12.30am tomorrow', []],
  ['it costs 4.99 total', []],

  // Internationalized TLDs are compared as A-labels, the spelling ASCII text carries.
  ['example.xn--q9jyb4c', bare('example.xn--q9jyb4c')],
  ['example.xn--fake', []],

  // A bare domain ends at its last label, a port, or a "/", "?" or "#" tail, so prose
  // running straight on stays prose.
  ['go to example.com,then click', bare('example.com')],
  ['example.com。', bare('example.com')],
  ['bsky.appを見て', bare('bsky.app')],
  ['example.com:8080/health', bare('example.com:8080/health')],
  ['example.com#section', bare('example.com#section')],
  // An over-long port fails the port group rather than matching a prefix of it.
  ['example.com:123456/path', bare('example.com')],

  // Trailing sentence punctuation is stripped in any script, and as a run.
  ['see https://example.com/foo… ok', link('https://example.com/foo')],
  ['example.com/foo!!', bare('example.com/foo')],
  ['Here: https://example.com/article.', link('https://example.com/article')],
  ['https://example.com？', link('https://example.com')],
  ['これを見て https://example.com/記事。', link('https://example.com/記事')],
  // ...including outside the BMP (U+10A56 KHAROSHTHI PUNCTUATION DANDA).
  ['https://example.com/path\u{10A56}', link('https://example.com/path')],

  // Excess closing brackets are stripped; balanced ones stay.
  ['nested (example.com/a(b)) done', bare('example.com/a(b)')],
  ['[example.com/x] bracketed', bare('example.com/x')],
  [
    'except for https://foo.com/thing_(cool)',
    link('https://foo.com/thing_(cool)'),
  ],
  ['https://example.com(x)', link('https://example.com(x)')],

  // A bare domain followed by "(" is a method call (social-app issue 8896): ".now",
  // ".map" and ".next" are real TLDs. Schemed URLs are exempt.
  ['performance.now() is fast', []],
  ['array.map(fn) works', []],
  ['router.next() called', []],

  // The lead-in is a deny-list, so emoji, arrows and quotes may precede a URL...
  ['\u{1F517}https://example.com/', link('https://example.com/')],
  ['\u{1F517}example.com', bare('example.com')],
  ['emoji\u{1F389}bsky.app here', bare('bsky.app')],
  ['→https://example.com', link('https://example.com')],
  ['⚠️example.com', bare('example.com')],
  ['1\uFE0F\u20E3https://example.com', link('https://example.com')],
  ['quote "example.com" end', bare('example.com')],
  // ...while a letter in any script may not, and the grammar is ASCII without an `i`
  // flag, so U+017F and U+212A do not case-fold into it.
  ['naïve.com', []],
  ['señor.org here', []],
  ['日本語bsky.app', []],
  ['\u017F.com', []],
  ['\u212A.com', []],
  ['http\u017F://example.com', []],
  // "-", "_", "." and "/" are rejected before a bare domain only.
  ['path/to/site.com here', []],
  ['trailing_example.com', []],
  ['...example.com', []],
  ['foo@example.com is my email', []],
  ['#example.com tag', []],
  ['$AAPL example.com', bare('example.com')],

  // "@" and "*" end prose when they end an authority (social-app issue 8552) and are
  // path characters otherwise (RFC 3986 §3.3); "'" is a path character too.
  ['https://example.com@', link('https://example.com')],
  ['https://example.com*', link('https://example.com')],
  ['https://example.com@?', link('https://example.com')],
  ['https://example.com/path@', link('https://example.com/path@')],
  ['https://example.com/glob/*', link('https://example.com/glob/*')],
  ["https://example.com/foo'", link("https://example.com/foo'")],

  // A quoted or bracketed URL ends at the closer, so prose running straight on from it
  // is not absorbed, while a quote nothing opened is path content.
  ['<https://example.com>following', link('https://example.com')],
  ['"https://example.com/path"following', link('https://example.com/path')],
  [
    '\u201Chttps://example.com/path\u201Dfollowing',
    link('https://example.com/path'),
  ],
  ['«https://example.com»following', link('https://example.com')],
  ['`https://example.com/a`following', link('https://example.com/a')],
  ['‘https://example.com/a’', link('https://example.com/a')],
  [
    '"https://one.com/path"https://two.com',
    [...link('https://one.com/path'), ...link('https://two.com')],
  ],
  [
    'https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic',
    link('https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic'),
  ],
  [
    'https://fr.wikipedia.org/wiki/«_A_»_de_Charlemagne',
    link('https://fr.wikipedia.org/wiki/«_A_»_de_Charlemagne'),
  ],

  // A bare name that carries on past the ASCII grammar -- into a further label, or into
  // a combining mark or non-ASCII Latin letter on the last one -- names another host, so
  // the ASCII part is not linked. A letter in another script, or a digit, is prose.
  ['example.com.みんな', []],
  ['example.com-みんな', []],
  ['example.com-', bare('example.com')],
  ['example.coｍ', []],
  ['example.co\u1E3F', []],
  ['example.com\u0301', []],
  ['example.com:8080abc', []],
  ['example.com\u0661', bare('example.com')],
  ['https://example.com.みんな', link('https://example.com.みんな')],

  // A match that trims down to nothing but its scheme is not a link.
  ['https://,,,', []],
  ['(https://)', []],
]

const schemedCases: [string, [string, string][]][] = [
  // A schemed authority is not held to the ASCII grammar: IDN hosts and IPv6 literals.
  ['https://münchen.de/straße', link('https://münchen.de/straße')],
  ['see https://例え.jp/foo here', link('https://例え.jp/foo')],
  ['https://[::1]:8080/api', link('https://[::1]:8080/api')],
  [
    'https://ru.wikipedia.org/wiki/Кошка',
    link('https://ru.wikipedia.org/wiki/Кошка'),
  ],
  ['https://user@example.com/x', link('https://user@example.com/x')],
]

const apostropheCases: [string, [string, string][]][] = [
  // social-app issue 8164: "example.com'dan" is Turkish for "from example.com", in either
  // apostrophe spelling, with or without a scheme. A path keeps its apostrophes.
  ["example.com'dan", bare('example.com')],
  ['example.com’dan', bare('example.com')],
  ["https://example.com'dan", link('https://example.com')],
  ['https://example.com’dan', link('https://example.com')],
  ["bsky.app'de yayınlandı", bare('bsky.app')],
  ["https://example.com/it's-fine", link("https://example.com/it's-fine")],
]

const mentionCases: [string, [string, string][]][] = [
  // social-app issue 7341: a handle after an apostrophe.
  ['l’@bsky.app a dit', [['@bsky.app', 'bsky.app']]],
  ["l'@atproto.com", [['@atproto.com', 'atproto.com']]],
  ['.@bsky.app hi', [['@bsky.app', 'bsky.app']]],
  ['\u{1F517}@bsky.app hi', [['@bsky.app', 'bsky.app']]],
  ['1\uFE0F\u20E3@bsky.app', [['@bsky.app', 'bsky.app']]],
  ['wow!@alice.test', [['@alice.test', 'alice.test']]],
  ['@alice.TEST hello', [['@alice.TEST', 'alice.TEST']]],
  ['@alice.xn--q9jyb4c hi', [['@alice.xn--q9jyb4c', 'alice.xn--q9jyb4c']]],
  ['@alice.comを見て', [['@alice.com', 'alice.com']]],
  // Not handles: no dot or unknown TLD, an email address, a path.
  ['not@right', []],
  ['@alice', []],
  ['@alice.invalid', []],
  ['foo_@example.com', []],
  ['foo-@example.com', []],
  ['foo+@example.com', []],
  ['path/@alice.com', []],
  ['https://example.com/@bsky.app', []],
  ['josé@example.com', []],
  ['josé@example.com'.normalize('NFD'), []],
  ['мария@example.com', []],
  // A handle is ASCII, so a name carrying on past it is not one.
  ['@alice.coｍ', []],
  ['@alice.com.みんな', []],
]

const nestedCases: [string, [string, string][]][] = [
  ['https://example.com/($AAPL)', link('https://example.com/($AAPL)')],
  ['see https://example.com/($BTC) ok', link('https://example.com/($BTC)')],
  [
    'https://example.com/?q=@bsky.app',
    link('https://example.com/?q=@bsky.app'),
  ],
]

describe('the exported regexes keep their documented contract', () => {
  // detectFacets reads groups 1, 2 and `domain` alone, so a shift in 3 to 6 would leave
  // every case above green while breaking a consumer that reads them positionally.
  const exec = (re: RegExp, text: string) => {
    re.lastIndex = 0
    try {
      return re.exec(text)
    } finally {
      re.lastIndex = 0
    }
  }

  it('URL_REGEX numbers the schemed branch', () => {
    const match = exec(URL_REGEX, 'see https://a.example.com:8080/p?q#f end')
    const url = 'https://a.example.com:8080/p?q#f'
    expect(match?.slice(0, 7)).toEqual([
      ' ' + url,
      ' ',
      url,
      url,
      undefined,
      undefined,
      undefined,
    ])
    expect(match?.groups?.domain).toBeUndefined()
  })

  it('URL_REGEX numbers the bare-domain branch', () => {
    const match = exec(URL_REGEX, 'see my-site.example.com:8080/p end')
    const url = 'my-site.example.com:8080/p'
    expect(match?.slice(0, 7)).toEqual([
      ' ' + url,
      ' ',
      url,
      undefined,
      url,
      'my-site.example.com',
      '.com',
    ])
    expect(match?.groups?.domain).toBe('my-site.example.com')
  })

  it('MENTION_REGEX numbers the lead-in, the sigil and the handle', () => {
    const match = exec(MENTION_REGEX, 'hi @alice.example.com!')
    expect(match?.slice(0, 5)).toEqual([
      ' @alice.example.com',
      ' ',
      '@',
      'alice.example.com',
      '',
    ])
  })

  it('carries the flags the grammar depends on', () => {
    expect(URL_REGEX.unicode).toBe(true)
    expect(URL_REGEX.ignoreCase).toBe(false)
    expect(MENTION_REGEX.unicode).toBe(true)
    expect(MENTION_REGEX.ignoreCase).toBe(false)
  })
})

describe('detectFacets link detection', () => {
  it.each(linkCases)('%s', (input, expected) => {
    expect(links(input)).toEqual(expected)
  })
})

describe('detectFacets does not truncate schemed URLs', () => {
  it.each(schemedCases)('%s', (input, expected) => {
    expect(links(input)).toEqual(expected)
  })
})

describe('detectFacets does not swallow apostrophe suffixes', () => {
  it.each(apostropheCases)('%s', (input, expected) => {
    expect(links(input)).toEqual(expected)
  })
})

describe('detectFacets mention detection', () => {
  it.each(mentionCases)('%s', (input, expected) => {
    expect(mentions(input)).toEqual(expected)
  })
})

describe('detectFacets does not nest facets inside a link', () => {
  // The link pass runs first and wins: a handle or a cashtag written inside a URL is part
  // of that URL, and nothing else is emitted for it.
  it.each(nestedCases)('%s', (input, expected) => {
    expect(links(input)).toEqual(expected)
    expect(facetsOf(input)).toHaveLength(1)
  })
})

describe('detectFacets leaves a fullwidth hashtag its text', () => {
  // TAG_REGEX opens on "#" or "＃", so a link facet after either would win overlap
  // resolution and take the tag's text with it.
  it.each(['#example.com', '＃example.com'])('%s', (input) => {
    const facets = facetsOf(input)
    expect(facets).toHaveLength(1)
    expect(facets[0].features.filter(isTag)).toHaveLength(1)
  })
})

describe('detectFacets never emits overlapping facets', () => {
  // A consumer walking facets in order (as segments() does) silently drops the second of
  // any two that overlap, so an overlap corrupts the record while staying invisible.
  const inputs = [
    ...new Set([
      ...linkCases.map(([input]) => input),
      ...schemedCases.map(([input]) => input),
      ...apostropheCases.map(([input]) => input),
      ...mentionCases.map(([input]) => input),
      ...nestedCases.map(([input]) => input),
      'https://example.com/#tag $USD',
      'hey @alice.test check bsky.app #tag $BTC',
      'https://example.com/@a.com @b.com #c $D',
      '@handle.com!@#$chars',
    ]),
  ]

  it.each(inputs)('%s', (input) => {
    const rt = new RichText({ text: input })
    rt.detectFacetsWithoutResolution()
    const ranges = (rt.facets ?? [])
      .map((f) => f.index)
      .sort((a, b) => a.byteStart - b.byteStart)
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].byteStart).toBeGreaterThanOrEqual(ranges[i - 1].byteEnd)
    }
  })
})
