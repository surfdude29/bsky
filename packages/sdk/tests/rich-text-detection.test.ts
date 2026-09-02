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
      ['nor is this #⃣tag, written without the variation selector', [], []],
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
 * Facets are read from `rt.facets` rather than from `rt.segments()`: segments skip
 * any facet that starts before the previous one ended, so a detector emitting two
 * overlapping facets looks correct through that lens while writing both into the
 * record. See the no-overlap test below.
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

/** Every link facet as [matched text, uri], so byte offsets are covered too. */
const links = (text: string): [string, string][] =>
  facetsOf(text).flatMap((f) =>
    f.features.filter(isLink).map((l): [string, string] => [f.text, l.uri]),
  )

/** Every mention facet as [matched text, handle]. */
const mentions = (text: string): [string, string][] =>
  facetsOf(text).flatMap((f) =>
    f.features.filter(isMention).map((m): [string, string] => [f.text, m.did]),
  )

const linkCases: [string, [string, string][]][] = [
  // Case folding. The host comparison and the scheme match are both ASCII
  // case-insensitive.
  [
    'HTTPS://EXAMPLE.COM/Path',
    [['HTTPS://EXAMPLE.COM/Path', 'HTTPS://EXAMPLE.COM/Path']],
  ],
  ['visit Example.Com', [['Example.Com', 'https://Example.Com']]],
  ['BSKY.APP', [['BSKY.APP', 'https://BSKY.APP']]],

  // Hyphens in labels (RFC 1123 §2.1), including punycode A-labels.
  [
    'my-site.example.com is up',
    [['my-site.example.com', 'https://my-site.example.com']],
  ],
  ['a--b.com', [['a--b.com', 'https://a--b.com']]],
  [
    'xn--80ak6aa92e.com test',
    [['xn--80ak6aa92e.com', 'https://xn--80ak6aa92e.com']],
  ],
  // A punycoded *final* label. The TLD list spells an internationalized TLD as its
  // U-label ("みんな"), which ASCII text never carries, so the set holds the A-label.
  [
    'example.xn--q9jyb4c',
    [['example.xn--q9jyb4c', 'https://example.xn--q9jyb4c']],
  ],
  [
    'xn--80ak6aa92e.xn--q9jyb4c',
    [['xn--80ak6aa92e.xn--q9jyb4c', 'https://xn--80ak6aa92e.xn--q9jyb4c']],
  ],
  // Still an exact comparison: "xn--" is not a license to invent a TLD.
  ['example.xn--fake', []],
  // A link: every label is LDH-conformant and ".com" is a real TLD.
  ['v1.2-example.com', [['v1.2-example.com', 'https://v1.2-example.com']]],
  // No leading or trailing hyphen in a label.
  ['-bad.com', []],
  ['bad-.com', []],

  // Digit-leading and single-digit first labels, all live sites: 1.org, 404media.co and
  // 7.zip. What keeps the negatives below plain is the final label, never the first --
  // 192.com and 192.168.1.1 differ only in their last. "1" and "99" are absent from the
  // TLD set because RFC 1123 §2.1, restated in RFC 3696 §2, rules out an all-numeric
  // TLD; "30am" is simply not a TLD.
  ['1.org', [['1.org', 'https://1.org']]],
  ['404media.co', [['404media.co', 'https://404media.co']]],
  ['192.com', [['192.com', 'https://192.com']]],
  ['short link 7.zip/AbC123 here', [['7.zip/AbC123', 'https://7.zip/AbC123']]],
  ['ping 192.168.1.1 now', []],
  ['meet at 12.30am tomorrow', []],
  ['it costs 4.99 total', []],
  ['See Section 4. In the box.', []],

  // Run-on: a bare domain is dot-separated LDH labels, an optional port and a tail that
  // opens at "/", "?" or "#", so prose running straight on falls outside the match. A
  // schemed URL is not bound this way: a comma is a sub-delim, legal in a reg-name, so
  // https://example.com,then is a single match.
  ['go to example.com,then click', [['example.com', 'https://example.com']]],
  ['see example.com* for more', [['example.com', 'https://example.com']]],
  ['wait… example.com… hmm', [['example.com', 'https://example.com']]],

  // Excess trailing closers are stripped, rather than every bracket regardless. An
  // unmatched opener inside the match is left alone -- the trim only ever shortens.
  [
    'nested (example.com/a(b)) done',
    [['example.com/a(b)', 'https://example.com/a(b)']],
  ],
  ['[example.com/x] bracketed', [['example.com/x', 'https://example.com/x']]],
  [
    'example.com/a{b}} done',
    [['example.com/a{b}', 'https://example.com/a{b}']],
  ],
  ['quote "example.com" end', [['example.com', 'https://example.com']]],
  [
    'except for https://foo.com/thing_(cool)',
    [['https://foo.com/thing_(cool)', 'https://foo.com/thing_(cool)']],
  ],

  // Method calls. ".now", ".map" and ".next" are all real TLDs, so the host grammar
  // alone would match these. Heuristic: a bare domain followed by "(" is not a URL.
  ['performance.now() is fast', []],
  ['array.map(fn) works', []],
  ['router.next() called', []],
  // The heuristic is scoped to schemeless matches.
  [
    'https://example.com(x)',
    [['https://example.com(x)', 'https://example.com(x)']],
  ],

  // Port and fragment stay inside the match.
  [
    'example.com:8080/health',
    [['example.com:8080/health', 'https://example.com:8080/health']],
  ],
  [
    'example.com#section',
    [['example.com#section', 'https://example.com#section']],
  ],
  [
    'http://localhost:3000/api',
    [['http://localhost:3000/api', 'http://localhost:3000/api']],
  ],

  // Lead-in is a deny-list, so anything that is not alphanumeric, "@", "#" or "$"
  // may precede a link -- emoji and arrows included, which no allow-list covers.
  [
    '\u{1F517}https://example.com/',
    [['https://example.com/', 'https://example.com/']],
  ],
  ['\u{1F517}example.com', [['example.com', 'https://example.com']]],
  // A keycap is the one emoji family the deny-list cannot express on its own: the base
  // is a digit (or "#"), which the lead-in excludes, and the rest is combining marks.
  // TAG_REGEX already refuses "#\uFE0F\u20E3" as a tag, so there is no contest.
  [
    '1\uFE0F\u20E3https://example.com',
    [['https://example.com', 'https://example.com']],
  ],
  // ...on each base KEYCAP admits, not the digit alone. The "#" spelling is the one to
  // watch: it is a keycap emoji rather than a hashtag, so the link stands and TAG_REGEX's
  // guard leaves no tag facet to contend with.
  ['#\uFE0F\u20E3example.com', [['example.com', 'https://example.com']]],
  ['*\u20E3example.com', [['example.com', 'https://example.com']]],
  ['emoji\u{1F389}bsky.app here', [['bsky.app', 'https://bsky.app']]],
  ['→https://example.com', [['https://example.com', 'https://example.com']]],
  // A combining mark is not a boundary in its own right, but it may follow one:
  // the variation selector belongs to the emoji, not to the URL.
  ['⚠️example.com', [['example.com', 'https://example.com']]],
  // The lead-in boundary is Unicode, not ASCII. With an ASCII-only boundary an
  // accented or non-Latin letter reads as a separator, so the tail of a word
  // becomes a domain in its own right.
  ['naïve.com', []],
  ['señor.org here', []],
  ['мой сайт.com', []],
  // A letter directly before a URL suppresses detection in every script. CJK is
  // written without spaces, so a URL run straight against it is not detected.
  ['日本語bsky.app', []],
  // ...and an invisible between the two does not make it one, IDNA dropping the
  // character rather than reading a boundary in it: written out, these are the single
  // names fooexample.com and 日本語example.com. Escaped, being invisible on the page.
  ['foo\u00ADexample.com', []],
  ['foo\u200Bexample.com', []],
  ['日本語\u200Cexample.com', []],
  // ...however many of them, as on the other side.
  [`foo${'\u00AD'.repeat(6)}example.com`, []],
  // What lies past them is what decides, so with nothing before them the name is
  // example.com and the link stands.
  ['\u00ADexample.com', [['example.com', 'https://example.com']]],
  // A schemed URL reaches the same rule: this is foohttps://example.com, a URL written
  // against a word.
  ['foo\u00ADhttps://example.com', []],
  // ...and every other exclusion the lead-in makes is asked of the character behind the
  // invisible too, or one would buy passage past the whole list rather than being
  // ignored. Written out, these are an email address, a path, a hashtag and a cashtag.
  ['foo@\u00ADexample.com', []],
  ['path/\u00ADexample.com', []],
  ['#\u00ADexample.com', []],
  ['$\u00ADexample.com', []],
  ['foo@\u00AD\u00ADexample.com', []],
  // The lead-in's own exclusions reach a schemed URL as well...
  ['foo@\u00ADhttps://example.com', []],
  // ...while "-", "_", "." and "/" stay schemeless-only, as they are when written
  // directly, so this one keeps its link where the line above loses it.
  [
    'path/\u00ADhttps://example.com',
    [['https://example.com', 'https://example.com']],
  ],
  // ...and a character the mappings fold into one of them stands in for it too, the
  // lead-in reading raw text where the far end of a match reads mapped. U+FF20 FULLWIDTH
  // COMMERCIAL AT, U+FF0E FULLWIDTH FULL STOP, U+FF0D FULLWIDTH HYPHEN-MINUS, U+FF0F
  // FULLWIDTH SOLIDUS: written out, these are an email address and three longer names.
  ['foo\uFF20example.com', []],
  ['foo\uFF0Eexample.com', []],
  ['foo\uFF0Dexample.com', []],
  ['path\uFF0Fexample.com', []],
  // ...the cashtag and hashtag sigils among them (U+FF04, U+FF03), the second of which a
  // link facet would otherwise take the text of.
  ['\uFF04example.com', []],
  ['\uFF03example.com', []],
  // U+24D0 CIRCLED LATIN SMALL LETTER A, which folds to "a": this names aexample.com.
  ['\u24D0example.com', []],
  // ...but only as far as the mappings go. A fullwidth bracket is a bracket, and an
  // ellipsis folds to "...", which no name can carry, so both stay boundaries -- the
  // second where the ASCII "...example.com" is a longer token and does not link.
  ['\uFF08example.com\uFF09', [['example.com', 'https://example.com']]],
  ['\u2026example.com', [['example.com', 'https://example.com']]],
  ['...example.com', []],
  // An invisible after a wrapper hides the opener from the match, so the closer and the
  // prose after it were swallowed. The boundary is read the same way for both.
  [
    '\u201C\u00ADhttps://example.com/path\u201Dfollowing',
    [['https://example.com/path', 'https://example.com/path']],
  ],
  [
    '\u00AB\u00ADexample.com/path\u00BBfollowing',
    [['example.com/path', 'https://example.com/path']],
  ],
  [
    '`\u00ADhttps://example.com/a`following',
    [['https://example.com/a', 'https://example.com/a']],
  ],
  // A wrapper closes in the spelling it opened in: U+FF02 FULLWIDTH QUOTATION MARK and
  // U+FF40 FULLWIDTH GRAVE ACCENT pair with themselves...
  [
    '\uFF02https://example.com/path\uFF02following',
    [['https://example.com/path', 'https://example.com/path']],
  ],
  [
    '\uFF40https://example.com/path\uFF40following',
    [['https://example.com/path', 'https://example.com/path']],
  ],
  // ...and not with the ASCII quote a path carries, which would cut this at /wiki/.
  [
    '\uFF02https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic\uFF02following',
    [
      [
        'https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic',
        'https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic',
      ],
    ],
  ],
  // An authority ends at a wrapper in either spelling, nothing having opened these.
  [
    'https://example.com\uFF02following',
    [['https://example.com', 'https://example.com']],
  ],
  [
    'https://example.com\uFF40following',
    [['https://example.com', 'https://example.com']],
  ],
  // ...while a path keeps one, as it keeps the quotes in the Weird_Al URL above.
  [
    'https://example.com/path\uFF02',
    [['https://example.com/path\uFF02', 'https://example.com/path\uFF02']],
  ],
  // A keycap is admitted whole, so it is read at its base rather than refused at its
  // U+20E3, which is a mark like any other -- as are the marks on any other boundary.
  ['1\uFE0F\u20E3\u00ADexample.com', [['example.com', 'https://example.com']]],
  // ...in the spellings KEYCAP admits, which is the mark alone after the base: an acute
  // in between is no keycap, and an invisible after it does not make one.
  ['1\u20E3\u00ADexample.com', [['example.com', 'https://example.com']]],
  ['1\u0301\u20E3\u00ADexample.com', []],
  ['1\u20E3\u0301\u00ADexample.com', []],
  ['\u26A0\u0301\u00ADexample.com', [['example.com', 'https://example.com']]],
  // The same rule on the other side. A dot and a label character continue the host
  // into a label the ASCII grammar cannot reach, so an internationalized domain is
  // detected only with a scheme.
  ['example.com.みんな', []],
  ['example.com.みんな/path', []],
  // The same rule reaching inside a label rather than across a dot: UTS 46 maps the
  // fullwidth "ｍ" into it, so this names example.com and not the example.co inside it.
  ['example.coｍ', []],
  // ...and the separators and invisibles IDNA folds into a name reach it the same way.
  ['example.com\u3002みんな', []],
  ['example.com\uFF61みんな', []],
  ['example.co\u00ADm', []],
  ['example.co\u034Fm', []],
  // ...however many of them, and on either side of a separator: they are dropped as the
  // text is read rather than measured against a window a run could walk past.
  [`example.co${'\u00AD'.repeat(6)}m`, []],
  [`example.com\u3002${'\u00AD'.repeat(6)}みんな`, []],
  // Dropped rather than treated as a stop, since what follows one is what says whether
  // the host carries on. Here that is a space, the shape right-to-left prose produces.
  ['example.com\u200F next', [['example.com', 'https://example.com']]],
  [
    'https://example.com.みんな',
    [['https://example.com.みんな', 'https://example.com.みんな']],
  ],
  // Without a dot the host is complete and what follows is prose. CJK is written
  // without spaces, so this is the common shape rather than a curiosity.
  ['bsky.appを見て', [['bsky.app', 'https://bsky.app']]],
  ['example.com。', [['example.com', 'https://example.com']]],
  // ...and the same rule reaching inside a label with no separator at all: a combining
  // mark attaches to the "m" the match ended on, so this names example.coḿ --
  // example.xn--co-1ws -- and a facet over the example.com inside it would split a
  // grapheme cluster as well. Written as escapes, a mark being invisible beside its base.
  ['example.com\u0301.org', []],
  ['example.com\u0301', []],
  // ...and a hyphen IDNA maps into the label: U+FF0D FULLWIDTH HYPHEN-MINUS folds to
  // "-", so this names example.com-foo. An ASCII hyphen never reaches the test -- LABEL
  // takes "example.com-foo" whole and its TLD is not one.
  ['example.com\uFF0Dfoo', []],
  ['example.com\uFF0D\uFF0Dfoo', []],
  // ...however long the run: the scan reads through separators rather than measuring a
  // fixed window, so the label character past them is always what decides.
  ['example.com\uFF0D\uFF0D\uFF0Dfoo', []],
  ['example.com\uFF0D\uFF0D\uFF0D\uFF0D\uFF0Dfoo', []],
  // ...but a trailing hyphen ends a name rather than continuing it, mapped or not.
  ['example.com\uFF0D', [['example.com', 'https://example.com']]],
  // A mark inside a path is part of the path: the tail runs to the next whitespace, so it
  // falls inside the match rather than after it.
  [
    'example.com/cafe\u0301',
    [['example.com/cafe\u0301', 'https://example.com/cafe\u0301']],
  ],

  // An over-long port fails the whole port group rather than matching a
  // five-digit prefix of it.
  ['example.com:123456/path', [['example.com', 'https://example.com']]],
  [
    'example.com:99999/ok',
    [['example.com:99999/ok', 'https://example.com:99999/ok']],
  ],

  // A trailing "@" closes a userinfo and leaves the host empty, and angle brackets are
  // RFC 3986 Appendix C delimiters, so neither belongs to the URL.
  ['https://example.com@', [['https://example.com', 'https://example.com']]],
  ['<https://example.com>', [['https://example.com', 'https://example.com']]],
  // ...and the closing bracket is not absorbed when prose runs straight on from it.
  // Angle brackets are outside the match grammar, so this holds with a path too.
  [
    '<https://example.com>following',
    [['https://example.com', 'https://example.com']],
  ],
  [
    '<https://example.com/path>following',
    [['https://example.com/path', 'https://example.com/path']],
  ],
  // Each wrapper WRAPPER_PAIRS lists, closed with prose running straight on. The closer
  // belongs to the sentence, not to the URL. LEAD admits "(", "[" and "{" as openers too,
  // but bounding a path is out of scope, so only these are paired.
  [
    '"https://example.com/path"following',
    [['https://example.com/path', 'https://example.com/path']],
  ],
  [
    '\u201Chttps://example.com/path\u201Dfollowing',
    [['https://example.com/path', 'https://example.com/path']],
  ],
  [
    '\u00ABhttps://example.com\u00BBfollowing',
    [['https://example.com', 'https://example.com']],
  ],
  [
    '`https://example.com`following',
    [['https://example.com', 'https://example.com']],
  ],
  // The tail ran past the closer, so what follows it is still unread text rather than
  // part of the match: both of these are links.
  [
    '"https://one.com/path"https://two.com',
    [
      ['https://one.com/path', 'https://one.com/path'],
      ['https://two.com', 'https://two.com'],
    ],
  ],
  // A quote nothing opened is path content. These are real pages, which MediaWiki serves
  // without percent-encoding, so banning the character outright would point them at
  // /wiki/.
  [
    'https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic',
    [
      [
        'https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic',
        'https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic',
      ],
    ],
  ],
  // The rule belongs to the tail, so a schemeless host reaches it the same way.
  [
    'en.wikipedia.org/wiki/"Weird_Al"_Yankovic',
    [
      [
        'en.wikipedia.org/wiki/"Weird_Al"_Yankovic',
        'https://en.wikipedia.org/wiki/"Weird_Al"_Yankovic',
      ],
    ],
  ],
  // Guillemets likewise, and a closer mid-path does not end the URL either.
  [
    'https://fr.wikipedia.org/wiki/«_A_»_de_Charlemagne',
    [
      [
        'https://fr.wikipedia.org/wiki/«_A_»_de_Charlemagne',
        'https://fr.wikipedia.org/wiki/«_A_»_de_Charlemagne',
      ],
    ],
  ],
  // ...but RFC 3986 §3.3 puts "@" in pchar, so it is legal in a path, a query and a
  // fragment, and must survive there.
  [
    'https://example.com/path@',
    [['https://example.com/path@', 'https://example.com/path@']],
  ],
  [
    'https://example.com/?q=@',
    [['https://example.com/?q=@', 'https://example.com/?q=@']],
  ],
  [
    'https://example.com/#@',
    [['https://example.com/#@', 'https://example.com/#@']],
  ],
  // "'" and "*" are sub-delims, so they are legal in a path for the same reason and
  // are kept there -- but they still end an authority.
  [
    "https://example.com/foo'",
    [["https://example.com/foo'", "https://example.com/foo'"]],
  ],
  [
    'https://example.com/glob/*',
    [['https://example.com/glob/*', 'https://example.com/glob/*']],
  ],
  ['https://example.com*', [['https://example.com', 'https://example.com']]],
  // A quoted URL ends at the quote that opened it, whichever pair was used.
  [
    '“https://example.com/foo”',
    [['https://example.com/foo', 'https://example.com/foo']],
  ],
  [
    '‘https://example.com/a’',
    [['https://example.com/a', 'https://example.com/a']],
  ],
  // A wrapper closes at the mark that answers the one that opened it, so the pair this
  // path carries is counted through rather than cut at.
  [
    '«https://fr.wikipedia.org/wiki/«_A_»_de_Charlemagne»',
    [
      [
        'https://fr.wikipedia.org/wiki/«_A_»_de_Charlemagne',
        'https://fr.wikipedia.org/wiki/«_A_»_de_Charlemagne',
      ],
    ],
  ],
  // With nothing to pair against, the same mark is part of the path.
  [
    'https://example.com/a’',
    [['https://example.com/a’', 'https://example.com/a’']],
  ],
  // Sentence punctuation is trimmed regardless, having no opener to pair with. That
  // holds after a path too, which is the trim's known limit.
  [
    'see https://example.com/foo… ok',
    [['https://example.com/foo', 'https://example.com/foo']],
  ],
  // ...including the en and em dashes, which the strip enumerates beside the ellipsis
  // rather than reading from Terminal_Punctuation. Schemed, since a dash after a bare
  // domain falls outside the match and never reaches the trim.
  [
    'https://example.com\u2013',
    [['https://example.com', 'https://example.com']],
  ],
  [
    'https://example.com\u2014',
    [['https://example.com', 'https://example.com']],
  ],
  [
    'Here: https://example.com/article.',
    [['https://example.com/article', 'https://example.com/article']],
  ],
  [
    'check out https://example.com/foo!',
    [['https://example.com/foo', 'https://example.com/foo']],
  ],
  // The trim is not ASCII-only: these end a sentence the way the writing system ends one.
  // Left in place, the first is a host no URL parser accepts and the second a path that
  // does not exist.
  ['https://example.com？', [['https://example.com', 'https://example.com']]],
  [
    'これを見て https://example.com/記事。',
    [['https://example.com/記事', 'https://example.com/記事']],
  ],
  ['example.com/foo！', [['example.com/foo', 'https://example.com/foo']]],
  ['https://example.com؟', [['https://example.com', 'https://example.com']]],
  // ...and it reads code points rather than code units: the last unit of an astral
  // character is a lone surrogate, which Terminal_Punctuation does not match. U+10A56 is
  // KHAROSHTHI PUNCTUATION DANDA.
  [
    'https://example.com/path\u{10A56}',
    [['https://example.com/path', 'https://example.com/path']],
  ],
  // ...a run of them included, a decrement of one leaving half a character behind.
  [
    'example.com/path\u{10A56}\u{10A56}',
    [['example.com/path', 'https://example.com/path']],
  ],
  // Which component the "@" sits in is decided per "@", not once per URL: stripping
  // the trailing "?" moves it into the authority in the first two and leaves it in
  // the path in the third.
  ['https://example.com@?', [['https://example.com', 'https://example.com']]],
  ['https://example.com@??', [['https://example.com', 'https://example.com']]],
  [
    'https://example.com/path@?',
    [['https://example.com/path@', 'https://example.com/path@']],
  ],

  // The host grammar is ASCII by construction, not by an `i` flag: under Unicode
  // case-folding /[a-z]/iu also matches U+017F and U+212A, which would admit these
  // to a grammar documented as ASCII-LDH -- and the third is not even a scheme.
  // Written as escapes because they are visually indistinguishable from ASCII.
  ['\u017F.com', []],
  ['\u212A.com', []],
  ['http\u017F://example.com', []],

  // ...and what the excluded set plus the schemeless guard keep out.
  ['path/to/site.com here', []],
  ['trailing_example.com', []],
  ['foo@example.com is my email', []],
  ['#example.com tag', []],
  ['$AAPL example.com', [['example.com', 'https://example.com']]],
]

const schemedCases: [string, [string, string][]][] = [
  [
    'https://münchen.de/straße',
    [['https://münchen.de/straße', 'https://münchen.de/straße']],
  ],
  [
    'see https://例え.jp/foo here',
    [['https://例え.jp/foo', 'https://例え.jp/foo']],
  ],
  [
    'https://[::1]:8080/api',
    [['https://[::1]:8080/api', 'https://[::1]:8080/api']],
  ],
  [
    'https://ru.wikipedia.org/wiki/Кошка',
    [
      [
        'https://ru.wikipedia.org/wiki/Кошка',
        'https://ru.wikipedia.org/wiki/Кошка',
      ],
    ],
  ],
  [
    'https://user@example.com/x',
    [['https://user@example.com/x', 'https://user@example.com/x']],
  ],
  // An apostrophe ends the authority only when it is a suffix. Followed by an
  // "@" in the same authority it is userinfo, and truncating there would emit a
  // broken "https://o".
  [
    "https://o'reilly@example.com/",
    [["https://o'reilly@example.com/", "https://o'reilly@example.com/"]],
  ],
  // Length does not enter into it: userinfo is part of the authority grammar, not a
  // decision taken per apostrophe within a window.
  [
    `https://o'${'a'.repeat(256)}@example.com/`,
    [
      [
        `https://o'${'a'.repeat(256)}@example.com/`,
        `https://o'${'a'.repeat(256)}@example.com/`,
      ],
    ],
  ],
  // ...and only when that "@" is inside the authority. A quote is a hard stop, so the
  // userinfo run cannot reach that "@" and there is none: the host ends at the
  // apostrophe, exactly as "https://example.com'dan" does.
  ['https://o\'reilly"@example.com', [['https://o', 'https://o']]],
  // A match that trims down to nothing but its scheme is not a link.
  ['https://,,,', []],
  ['(https://)', []],
]

const apostropheCases: [string, [string, string][]][] = [
  ["example.com'dan", [['example.com', 'https://example.com']]],
  ['example.com’dan', [['example.com', 'https://example.com']]],
  ["https://example.com'dan", [['https://example.com', 'https://example.com']]],
  ['https://example.com’dan', [['https://example.com', 'https://example.com']]],
  ["bsky.app'de yayınlandı", [['bsky.app', 'https://bsky.app']]],
  [
    "example.com'dan bsky.app'e",
    [
      ['example.com', 'https://example.com'],
      ['bsky.app', 'https://bsky.app'],
    ],
  ],
  ["GitHub.com'a git", [['GitHub.com', 'https://GitHub.com']]],
  // Only the authority stops at an apostrophe; it stays legal in a path.
  [
    "https://example.com/it's-fine",
    [["https://example.com/it's-fine", "https://example.com/it's-fine"]],
  ],
]

const mentionCases: [string, [string, string][]][] = [
  // social-app issue 7341: a handle after an apostrophe.
  ['l’@bsky.app a dit', [['@bsky.app', 'bsky.app']]],
  ["l'@atproto.com", [['@atproto.com', 'atproto.com']]],
  // The Twitter-style leading ".@" is a mention too.
  ['.@bsky.app hi', [['@bsky.app', 'bsky.app']]],
  ['\u{1F517}@bsky.app hi', [['@bsky.app', 'bsky.app']]],
  // Non-regressions.
  ['1\uFE0F\u20E3@bsky.app', [['@bsky.app', 'bsky.app']]],
  ['not@right', []],
  // A handle needs a dot and a known TLD, or the ".test" suffix: neither of these is a
  // candidate, and the first is the shape ordinary prose produces.
  ['@alice', []],
  ['@alice.invalid', []],
  ['@handle.com!@#$chars', [['@handle.com', 'handle.com']]],
  // A handle in a URL is part of the URL, not a mention -- these would otherwise
  // overlap the link facet the same text produces. segments() hides an overlap,
  // so these assert through rt.facets; see the no-overlap test below.
  ['https://example.com/@bsky.app', []],
  ['https://example.com/?q=@bsky.app', []],
  ['https://example.com/foo-@bsky.app', []],
  // An internationalized email address is not a mention. With an ASCII-only
  // lead-in the accented letter reads as a boundary and @example.com matches.
  ['josé@example.com', []],
  ['josé@example.com'.normalize('NFD'), []],
  ['мария@example.com', []],
  // An internationalized handle can only be written as an A-label: @atproto/syntax
  // admits [a-zA-Z0-9.-] alone.
  ['@alice.xn--q9jyb4c hi', [['@alice.xn--q9jyb4c', 'alice.xn--q9jyb4c']]],
  // ...and only that spelling: a handle is ASCII, so a name that carries on past what
  // that grammar can see is not one.
  ['@alice.com.みんな', []],
  ['@alice.coｍ', []],
  ['@alice.co\u00ADm', []],
  // ...and the same on the other side of the handle: written out this is the email
  // address foo@alice.com, which the "@" the lead-in excludes would have kept out.
  ['foo\u00AD@alice.com', []],
  // ...and the rest of the lead-in's exclusions reach behind it as well: a "/" makes
  // this a path, and an "@" an email address.
  ['path/\u00AD@alice.com', []],
  ['foo@\u00AD@alice.com', []],
  // ...and a mapping stands in for the character as an invisible does: U+24D0 folds to
  // "a" and U+FF20 to "@", so these are the name aexample and an email address.
  ['\u24D0@alice.com', []],
  ['foo\uFF20@alice.com', []],
  // ...while a keycap is still a boundary behind one.
  ['1\uFE0F\u20E3\u00AD@alice.com', [['@alice.com', 'alice.com']]],
  // ...a mark continuing the last label among them: this names alice.coḿ, and the
  // facet would resolve and notify a different account.
  ['@alice.com\u0301.org', []],
  ['@alice.com\u0301 hi', []],
  // An unmapped letter is prose here as it is for a link: CJK runs straight against a
  // handle that is already complete.
  ['@alice.comを見て', [['@alice.com', 'alice.com']]],
  // The ".test" suffix folds case, like every other TLD comparison.
  ['@alice.TEST hello', [['@alice.TEST', 'alice.TEST']]],
]

const nestedCases: [string, [string, string][]][] = [
  [
    'https://example.com/($AAPL)',
    [['https://example.com/($AAPL)', 'https://example.com/($AAPL)']],
  ],
  [
    'see https://example.com/($BTC) ok',
    [['https://example.com/($BTC)', 'https://example.com/($BTC)']],
  ],
  [
    'https://example.com/?q=@bsky.app',
    [['https://example.com/?q=@bsky.app', 'https://example.com/?q=@bsky.app']],
  ],
]

describe('the exported regexes keep their documented contract', () => {
  // detectFacets reads groups 1, 2 and `domain` alone, so a shift in 3 to 6 would leave
  // every case above green while breaking a consumer that reads them positionally --
  // which util.ts documents that they may. Both regexes carry `g`, so lastIndex is put
  // back afterwards: exec leaves it where the match ended, and detection shares these
  // very instances.
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
      ' ' + url, // 0 the whole match, lead-in included
      ' ', // 1 the lead-in
      url, // 2 the URL
      url, // 3 the schemed branch
      undefined, // 4 the bare-domain branch
      undefined, // 5 its host
      undefined, // 6 its last dot-label
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
      ' ', // 1 the lead-in
      '@', // 2 the sigil
      'alice.example.com', // 3 the handle
      '', // 4 the word boundary it ends at
    ])
  })

  it('carries the flags the grammar depends on', () => {
    // `u` is what makes the classes Unicode; `i` is deliberately absent, since with `u`
    // case-folding admits U+017F and U+212A to a grammar documented as ASCII.
    expect(URL_REGEX.unicode).toBe(true)
    expect(URL_REGEX.ignoreCase).toBe(false)
    expect(URL_REGEX.multiline).toBe(true)
    expect(MENTION_REGEX.unicode).toBe(true)
    expect(MENTION_REGEX.ignoreCase).toBe(false)
  })
})

describe('detectFacets link detection', () => {
  const cases = linkCases

  it.each(cases)('%s', (input, expected) => {
    expect(links(input)).toEqual(expected)
  })
})

describe('detectFacets does not truncate schemed URLs', () => {
  // The host of a schemed URL is deliberately not held to the ASCII LDH grammar
  // used for bare domains: an ASCII-only host class would cut IDN hosts down to
  // their first label and drop IPv6 literals entirely.
  const cases = schemedCases

  it.each(cases)('%s', (input, expected) => {
    expect(links(input)).toEqual(expected)
  })
})

describe('detectFacets does not swallow apostrophe suffixes', () => {
  // social-app issue 8164: "example.com'dan" is Turkish for "from example.com". The
  // suffix belongs to the sentence, not to the host.
  const cases = apostropheCases

  it.each(cases)('%s', (input, expected) => {
    expect(links(input)).toEqual(expected)
  })
})

describe('detectFacets mention detection', () => {
  const cases = mentionCases

  it.each(cases)('%s', (input, expected) => {
    expect(mentions(input)).toEqual(expected)
  })
})

describe('detectFacets does not nest facets inside a link', () => {
  // The link pass runs first and wins: a handle or a cashtag written inside a URL is
  // part of that URL. Cashtags are the easy one to miss -- CASHTAG_REGEX's lead-in
  // includes "(", so it fires inside a path that the URL itself contains.
  const cases = nestedCases

  it.each(cases)('%s', (input, expected) => {
    expect(links(input)).toEqual(expected)
    // and nothing else at all -- no nested tag or mention facet alongside the link
    expect(facetsOf(input)).toHaveLength(1)
  })
})

describe('detectFacets leaves a fullwidth hashtag its text', () => {
  // TAG_REGEX opens on "#" or "＃", and U+FF03 folds to "#", so a link facet starting at
  // the character after it would win overlap resolution and take the tag's text with it.
  it('＃example.com', () => {
    const facets = facetsOf('\uFF03example.com')
    expect(facets).toHaveLength(1)
    expect(facets[0].features.filter(isTag)).toHaveLength(1)
  })
})

describe('detectFacets never emits overlapping facets', () => {
  // Facet ranges are written into the record, and a consumer that walks them in order
  // (as segments() does) silently drops the second of any two that overlap, so an
  // overlap corrupts the record while staying invisible from segments().
  //
  // The corpus is every case the five tables above declare, so each is checked for
  // overlap automatically -- the older block at the top of the file is not. Only
  // combinations that no single table exercises are added explicitly.
  // Wrapped in a Set: the explicit combinations below repeat inputs the tables already
  // contribute, and a duplicate proves nothing twice.
  const inputs = [
    ...new Set([
      ...linkCases.map(([input]) => input),
      ...schemedCases.map(([input]) => input),
      ...apostropheCases.map(([input]) => input),
      ...mentionCases.map(([input]) => input),
      ...nestedCases.map(([input]) => input),
      'https://example.com/($AAPL)',
      'https://example.com/#tag $USD',
      'hey @alice.test check bsky.app #tag $BTC',
      'https://example.com/@a.com @b.com #c $D',
      '@handle.com!@#$chars',
      '#example.com tag',
      '$AAPL example.com',
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
