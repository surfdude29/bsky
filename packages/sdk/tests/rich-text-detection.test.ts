import type { AtprotoDid, HandleResolver } from '@atproto-labs/handle-resolver'
import { describe, expect, it } from 'vitest'
import { app } from '../src/lexicons/index.js'
import { RichText, RichTextSegment } from '../src/rich-text/index.js'
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
  // A link: every label is LDH-conformant and ".com" is a real TLD.
  ['v1.2-example.com', [['v1.2-example.com', 'https://v1.2-example.com']]],
  // No leading or trailing hyphen in a label.
  ['-bad.com', []],
  ['bad-.com', []],

  // Digit-leading and single-digit first labels. These are all live sites, so do
  // not "fix" this by rejecting them: 7.zip, 5.st and 3.uk are live short-link and
  // carrier domains on the same rule. What keeps the negatives below plain is the
  // all-numeric-TLD rule (RFC 1123 §2.1, restated in RFC 3696 §2), not the first
  // label -- note 192.com and 192.168.1.1 differ only in their final label.
  ['1.org', [['1.org', 'https://1.org']]],
  ['404media.co', [['404media.co', 'https://404media.co']]],
  ['192.com', [['192.com', 'https://192.com']]],
  ['short link 7.zip/AbC123 here', [['7.zip/AbC123', 'https://7.zip/AbC123']]],
  ['ping 192.168.1.1 now', []],
  ['meet at 12.30am tomorrow', []],
  ['it costs 4.99 total', []],
  ['See Section 4. In the box.', []],

  // Run-on: the authority ends at "/", "?", "#" or end of input (RFC 3986 §3.2),
  // so prose that follows without a space is outside the match.
  ['go to example.com,then click', [['example.com', 'https://example.com']]],
  ['see example.com* for more', [['example.com', 'https://example.com']]],
  ['wait… example.com… hmm', [['example.com', 'https://example.com']]],

  // Brackets are balanced rather than merely absent.
  [
    'nested (example.com/a(b)) done',
    [['example.com/a(b)', 'https://example.com/a(b)']],
  ],
  ['[example.com/x] bracketed', [['example.com/x', 'https://example.com/x']]],
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

  // An over-long port fails the whole port group rather than matching a
  // five-digit prefix of it.
  ['example.com:123456/path', [['example.com', 'https://example.com']]],
  [
    'example.com:99999/ok',
    [['example.com:99999/ok', 'https://example.com:99999/ok']],
  ],

  // A trailing "@" in the authority is empty userinfo, and angle brackets are RFC
  // 3986 Appendix C delimiters, so neither belongs to the URL.
  [
    'https://totallynotseth.dev@',
    [['https://totallynotseth.dev', 'https://totallynotseth.dev']],
  ],
  ['<https://example.com>', [['https://example.com', 'https://example.com']]],
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
    'https://ru.wikipedia.org/wiki/Кот',
    [
      [
        'https://ru.wikipedia.org/wiki/Кот',
        'https://ru.wikipedia.org/wiki/Кот',
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
  ['l’@alice.bsky.social a dit', [['@alice.bsky.social', 'alice.bsky.social']]],
  ["l'@bob.bsky.social", [['@bob.bsky.social', 'bob.bsky.social']]],
  // The Twitter-style leading ".@" is a mention too.
  ['.@alice.bsky.social hi', [['@alice.bsky.social', 'alice.bsky.social']]],
  [
    '\u{1F517}@alice.bsky.social hi',
    [['@alice.bsky.social', 'alice.bsky.social']],
  ],
  // Non-regressions.
  ['not@right', []],
  ['@handle.com!@#$chars', [['@handle.com', 'handle.com']]],
  // A handle in a URL is part of the URL, not a mention -- these would otherwise
  // overlap the link facet the same text produces. segments() hides an overlap,
  // so these assert through rt.facets; see the no-overlap test below.
  ['https://example.com/@bsky.app', []],
  ['https://example.com/?q=@bsky.app', []],
  ['https://example.com/foo-@bsky.app', []],
  // An internationalised email address is not a mention. With an ASCII-only
  // lead-in the accented letter reads as a boundary and @example.com matches.
  ['josé@example.com', []],
  ['josé@example.com'.normalize('NFD'), []],
  ['мария@example.com', []],
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

describe('detectFacets never emits overlapping facets', () => {
  // Facet ranges are written into the record, and a consumer that walks them in order
  // (as segments() does) silently drops the second of any two that overlap -- so an
  // overlap is invisible from segments() while still corrupting the record.
  //
  // The corpus is derived from every case the blocks above declare, so every input
  // this file exercises is checked for overlap automatically. Only combinations that
  // no single block exercises are added explicitly.
  const inputs = [
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
