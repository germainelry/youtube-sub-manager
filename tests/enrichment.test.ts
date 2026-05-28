import { describe, expect, it } from 'vitest';
import {
  channelPageUrl,
  channelVideosUrl,
  effectiveUcid,
  extractCanonicalUcid,
  extractChannelData,
  isFreshEnrichment,
  isUcid,
  needsHandleResolution,
  parseRelativeDate,
} from '../src/shared/enrichment';

const SAMPLE_UCID = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
const SAMPLE_UCID_2 = 'UCq-Fj5jknLsUf-MWSy4_brA';

describe('parseRelativeDate', () => {
  const NOW = 1_700_000_000_000;

  it('parses "X days ago"', () => {
    expect(parseRelativeDate('11 days ago', NOW)).toBe(NOW - 11 * 86_400_000);
  });

  it('parses "X weeks ago"', () => {
    expect(parseRelativeDate('3 weeks ago', NOW)).toBe(NOW - 3 * 604_800_000);
  });

  it('parses "X months ago"', () => {
    expect(parseRelativeDate('1 month ago', NOW)).toBe(NOW - 2_592_000_000);
  });

  it('parses "X years ago"', () => {
    expect(parseRelativeDate('2 years ago', NOW)).toBe(NOW - 2 * 31_536_000_000);
  });

  it('parses "X hours ago"', () => {
    expect(parseRelativeDate('5 hours ago', NOW)).toBe(NOW - 5 * 3_600_000);
  });

  it('handles "Streamed X days ago"', () => {
    expect(parseRelativeDate('Streamed 4 days ago', NOW)).toBe(NOW - 4 * 86_400_000);
  });

  it('returns undefined for non-relative text', () => {
    expect(parseRelativeDate('71M views', NOW)).toBeUndefined();
    expect(parseRelativeDate('', NOW)).toBeUndefined();
    expect(parseRelativeDate('just now', NOW)).toBeUndefined();
  });
});

describe('extractChannelData', () => {
  function makeHtml(opts: {
    ucid?: string;
    externalId?: string;
    videos?: Array<{ published: string; type?: string }>;
    hasVideosTab?: boolean;
  }): string {
    const canonical = opts.ucid
      ? `<link rel="canonical" href="https://www.youtube.com/channel/${opts.ucid}">`
      : '';
    const metadata = opts.externalId
      ? `"metadata":{"channelMetadataRenderer":{"externalId":"${opts.externalId}"}}`
      : `"metadata":{}`;

    const videoItems = (opts.videos ?? []).map(
      (v) => `{
        "richItemRenderer":{
          "content":{
            "lockupViewModel":{
              "contentType":"${v.type ?? 'LOCKUP_CONTENT_TYPE_VIDEO'}",
              "metadata":{
                "lockupMetadataViewModel":{
                  "metadata":{
                    "contentMetadataViewModel":{
                      "metadataRows":[{
                        "metadataParts":[
                          {"text":{"content":"1M views"}},
                          {"text":{"content":"${v.published}"}}
                        ]
                      }]
                    }
                  }
                }
              }
            }
          }
        }
      }`,
    );

    const videosTab =
      opts.hasVideosTab !== false
        ? `{
        "tabRenderer":{
          "title":"Videos",
          "content":{
            "richGridRenderer":{
              "contents":[${videoItems.join(',')}]
            }
          }
        }
      }`
        : '';

    const tabs = `{"tabRenderer":{"title":"Home"}},${videosTab}`;

    const ytData = `{
      ${metadata},
      "contents":{
        "twoColumnBrowseResultsRenderer":{
          "tabs":[${tabs}]
        }
      }
    }`;

    return `<html><head>${canonical}</head><body><script>var ytInitialData = ${ytData};</script></body></html>`;
  }

  it('extracts UCID from canonical link', () => {
    const html = makeHtml({ ucid: SAMPLE_UCID, videos: [{ published: '3 days ago' }] });
    const data = extractChannelData(html);
    expect(data.ucid).toBe(SAMPLE_UCID);
  });

  it('extracts UCID from externalId when no canonical', () => {
    const html = makeHtml({ externalId: SAMPLE_UCID_2, videos: [{ published: '1 day ago' }] });
    const data = extractChannelData(html);
    expect(data.ucid).toBe(SAMPLE_UCID_2);
  });

  it('extracts lastUploadAt from the newest video', () => {
    const html = makeHtml({
      ucid: SAMPLE_UCID,
      videos: [
        { published: '2 days ago' },
        { published: '3 weeks ago' },
        { published: '1 month ago' },
      ],
    });
    const before = Date.now();
    const data = extractChannelData(html);
    expect(data.videoCount).toBe(3);
    expect(data.lastUploadAt).toBeDefined();
    expect(data.lastUploadAt!).toBeGreaterThan(before - 3 * 86_400_000);
  });

  it('returns videoCount 0 when Videos tab is empty', () => {
    const html = makeHtml({ ucid: SAMPLE_UCID, videos: [] });
    const data = extractChannelData(html);
    expect(data.videoCount).toBe(0);
    expect(data.lastUploadAt).toBeUndefined();
  });

  it('skips non-video items (shorts)', () => {
    const html = makeHtml({
      ucid: SAMPLE_UCID,
      videos: [
        { published: '1 day ago', type: 'LOCKUP_CONTENT_TYPE_SHORT' },
        { published: '5 days ago' },
      ],
    });
    const data = extractChannelData(html);
    expect(data.videoCount).toBe(1);
  });

  it('returns empty data when no ytInitialData', () => {
    const html = '<html><body>no data</body></html>';
    const data = extractChannelData(html);
    expect(data.ucid).toBeUndefined();
    expect(data.videoCount).toBeUndefined();
  });
});

describe('extractCanonicalUcid', () => {
  it('extracts UCID from a canonical link tag', () => {
    const html = `<html><head><link rel="canonical" href="https://www.youtube.com/channel/${SAMPLE_UCID}"></head></html>`;
    expect(extractCanonicalUcid(html)).toBe(SAMPLE_UCID);
  });

  it('finds the first UCID even when attribute order differs', () => {
    const html = `<meta itemprop="channelId" content="${SAMPLE_UCID_2}"><div data-href="/channel/${SAMPLE_UCID_2}">x</div>`;
    expect(extractCanonicalUcid(html)).toBe(SAMPLE_UCID_2);
  });

  it('returns undefined when no UCID is present', () => {
    expect(extractCanonicalUcid('<html><body>no channel here</body></html>')).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    expect(extractCanonicalUcid('')).toBeUndefined();
  });
});

describe('isUcid', () => {
  it('accepts valid UCIDs', () => {
    expect(isUcid(SAMPLE_UCID)).toBe(true);
    expect(isUcid(SAMPLE_UCID_2)).toBe(true);
  });

  it('rejects handles and other ids', () => {
    expect(isUcid('@handle')).toBe(false);
    expect(isUcid('UCshort')).toBe(false);
    expect(isUcid(undefined)).toBe(false);
    expect(isUcid('')).toBe(false);
  });
});

describe('effectiveUcid', () => {
  it('prefers resolvedUcid when valid', () => {
    expect(effectiveUcid('@handle', SAMPLE_UCID)).toBe(SAMPLE_UCID);
  });

  it('falls back to channelId when it is itself a UCID', () => {
    expect(effectiveUcid(SAMPLE_UCID, undefined)).toBe(SAMPLE_UCID);
  });

  it('returns undefined when neither is a UCID', () => {
    expect(effectiveUcid('@handle', undefined)).toBeUndefined();
    expect(effectiveUcid('@handle', 'not-a-ucid')).toBeUndefined();
  });
});

describe('needsHandleResolution', () => {
  it('returns false when resolvedUcid is already a UCID', () => {
    expect(needsHandleResolution('@handle', SAMPLE_UCID)).toBe(false);
  });

  it('returns false when channelId is itself a UCID', () => {
    expect(needsHandleResolution(SAMPLE_UCID, undefined)).toBe(false);
  });

  it('returns true for handle without a resolution', () => {
    expect(needsHandleResolution('@handle', undefined)).toBe(true);
  });
});

describe('isFreshEnrichment', () => {
  const ttl = 7 * 24 * 60 * 60 * 1000;

  it('returns false when never enriched', () => {
    expect(isFreshEnrichment(undefined)).toBe(false);
  });

  it('returns true within TTL', () => {
    const now = 10_000_000_000;
    expect(isFreshEnrichment(now - (ttl - 1000), now, ttl)).toBe(true);
  });

  it('returns false past TTL', () => {
    const now = 10_000_000_000;
    expect(isFreshEnrichment(now - (ttl + 1000), now, ttl)).toBe(false);
  });
});

describe('channelPageUrl', () => {
  it('builds a /channel/<ucid> URL', () => {
    expect(channelPageUrl(SAMPLE_UCID)).toBe(`https://www.youtube.com/channel/${SAMPLE_UCID}`);
  });

  it('builds a /@handle URL', () => {
    expect(channelPageUrl('@SomeHandle')).toBe('https://www.youtube.com/@SomeHandle');
  });
});

describe('channelVideosUrl', () => {
  it('appends /videos to a handle URL', () => {
    expect(channelVideosUrl('@SomeHandle')).toBe('https://www.youtube.com/@SomeHandle/videos');
  });

  it('appends /videos to a UCID URL', () => {
    expect(channelVideosUrl(SAMPLE_UCID)).toBe(
      `https://www.youtube.com/channel/${SAMPLE_UCID}/videos`,
    );
  });
});
