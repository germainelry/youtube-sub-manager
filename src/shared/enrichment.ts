const UCID_REGEX = /^UC[A-Za-z0-9_-]{22}$/;
const UCID_IN_PATH_REGEX = /\/channel\/(UC[A-Za-z0-9_-]{22})/;

const RELATIVE_DATE_RE = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i;
const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

export function parseRelativeDate(text: string, now: number = Date.now()): number | undefined {
  const match = text.match(RELATIVE_DATE_RE);
  if (!match?.[1] || !match[2]) return undefined;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms = UNIT_MS[unit];
  if (!ms || !isFinite(amount)) return undefined;
  return now - amount * ms;
}

export interface ChannelPageData {
  ucid?: string;
  lastUploadAt?: number;
  videoCount?: number;
}

export function extractChannelData(html: string): ChannelPageData {
  const result: ChannelPageData = {};

  result.ucid = extractCanonicalUcid(html);

  const marker = html.indexOf('var ytInitialData = ');
  if (marker === -1) return result;
  const jsonStart = marker + 'var ytInitialData = '.length;
  const jsonEnd = html.indexOf(';</script>', jsonStart);
  if (jsonEnd === -1) return result;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = JSON.parse(html.substring(jsonStart, jsonEnd));
  } catch {
    return result;
  }

  if (!result.ucid) {
    const extId = data?.metadata?.channelMetadataRenderer?.externalId;
    if (typeof extId === 'string' && isUcid(extId)) result.ucid = extId;
  }

  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
  if (!Array.isArray(tabs)) return result;

  for (const tab of tabs) {
    const tr = tab?.tabRenderer;
    if (!tr || tr.title !== 'Videos') continue;

    const items = tr.content?.richGridRenderer?.contents;
    if (!Array.isArray(items) || items.length === 0) {
      result.videoCount = 0;
      return result;
    }

    let videoCount = 0;
    let newestUpload = -Infinity;
    const now = Date.now();

    for (const item of items) {
      const lockup = item?.richItemRenderer?.content?.lockupViewModel;
      if (!lockup || lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') continue;
      videoCount++;

      const rows =
        lockup?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
      if (!Array.isArray(rows)) continue;

      for (const row of rows) {
        if (!Array.isArray(row.metadataParts)) continue;
        for (const part of row.metadataParts) {
          const text = part?.text?.content;
          if (typeof text !== 'string' || !text.includes('ago')) continue;
          const ts = parseRelativeDate(text, now);
          if (ts !== undefined && ts > newestUpload) newestUpload = ts;
        }
      }
    }

    result.videoCount = videoCount;
    if (Number.isFinite(newestUpload) && newestUpload > 0) {
      result.lastUploadAt = newestUpload;
    }
    break;
  }

  return result;
}

export function extractCanonicalUcid(html: string): string | undefined {
  if (!html) return undefined;
  const match = html.match(UCID_IN_PATH_REGEX);
  return match?.[1];
}

export function isUcid(value: string | undefined): boolean {
  return !!value && UCID_REGEX.test(value);
}

export function effectiveUcid(
  channelId: string,
  resolvedUcid: string | undefined,
): string | undefined {
  if (isUcid(resolvedUcid)) return resolvedUcid;
  if (isUcid(channelId)) return channelId;
  return undefined;
}

export function needsHandleResolution(
  channelId: string,
  resolvedUcid: string | undefined,
): boolean {
  if (isUcid(resolvedUcid)) return false;
  return !isUcid(channelId);
}

export const ENRICHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function isFreshEnrichment(
  enrichedAt: number | undefined,
  now: number = Date.now(),
  ttlMs: number = ENRICHMENT_TTL_MS,
): boolean {
  if (!enrichedAt) return false;
  return now - enrichedAt < ttlMs;
}

export function channelPageUrl(channelIdOrHandle: string): string {
  if (channelIdOrHandle.startsWith('@')) {
    return `https://www.youtube.com/${channelIdOrHandle}`;
  }
  if (isUcid(channelIdOrHandle)) {
    return `https://www.youtube.com/channel/${channelIdOrHandle}`;
  }
  return `https://www.youtube.com/${channelIdOrHandle}`;
}

export function channelVideosUrl(channelIdOrHandle: string): string {
  return `${channelPageUrl(channelIdOrHandle)}/videos`;
}
