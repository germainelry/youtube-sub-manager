import { channelVideosUrl, effectiveUcid, extractChannelData } from '../shared/enrichment';
import type {
  EnrichmentProgress,
  EnrichmentResult,
  EnrichmentStatus,
  EnrichmentTarget,
} from '../shared/types';
import {
  removeOverlay,
  setOverlayComplete,
  setOverlayError,
  showOverlay,
  updateOverlay,
} from './progress-overlay';

const CONCURRENCY = 4;
const DISPATCH_JITTER_MIN_MS = 150;
const DISPATCH_JITTER_MAX_MS = 350;
const FETCH_TIMEOUT_MS = 15_000;
const BATCH_SIZE = 25;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const jitterMs = (): number =>
  DISPATCH_JITTER_MIN_MS + Math.random() * (DISPATCH_JITTER_MAX_MS - DISPATCH_JITTER_MIN_MS);

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { credentials: 'omit', ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface ChannelFetchOutcome {
  status: EnrichmentStatus;
  ucid?: string;
  lastUploadAt?: number;
  videoCount?: number;
}

async function fetchChannelPage(channelIdOrHandle: string): Promise<ChannelFetchOutcome> {
  try {
    const url = channelVideosUrl(channelIdOrHandle);
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, {
      headers: { 'Accept-Language': 'en' },
    });
    if (!res.ok) return { status: 'unreachable' };
    const html = await res.text();
    const data = extractChannelData(html);

    if (!data.ucid) return { status: 'unreachable' };

    if (data.videoCount === 0 || data.lastUploadAt === undefined) {
      return { status: 'no-uploads', ucid: data.ucid, videoCount: 0 };
    }

    return {
      status: 'ok',
      ucid: data.ucid,
      lastUploadAt: data.lastUploadAt,
      videoCount: data.videoCount,
    };
  } catch {
    return { status: 'unreachable' };
  }
}

async function enrichOne(target: EnrichmentTarget): Promise<EnrichmentResult> {
  const existingUcid = effectiveUcid(target.channelId, target.resolvedUcid);
  const lookupId = existingUcid ?? target.channelId;
  const outcome = await fetchChannelPage(lookupId);
  return {
    channelId: target.channelId,
    resolvedUcid: outcome.ucid,
    lastUploadAt: outcome.lastUploadAt,
    videoCount: outcome.videoCount,
    enrichmentStatus: outcome.status,
  };
}

export interface EnrichRunOptions {
  onBatch: (results: EnrichmentResult[], progress: EnrichmentProgress) => void | Promise<void>;
  onProgress?: (progress: EnrichmentProgress) => void;
  shouldCancel?: () => boolean;
}

export async function enrichAll(
  targets: EnrichmentTarget[],
  options: EnrichRunOptions,
): Promise<EnrichmentProgress> {
  const total = targets.length;
  const progress: EnrichmentProgress = {
    processed: 0,
    total,
    ok: 0,
    noUploads: 0,
    unreachable: 0,
  };

  if (total === 0) return progress;

  const start = Date.now();
  await showOverlay('Enriching channels');
  updateOverlay(0, 'Starting…');

  const buffer: EnrichmentResult[] = [];
  let cursor = 0;
  const pickNext = (): EnrichmentTarget | undefined => {
    if (cursor >= targets.length) return undefined;
    return targets[cursor++];
  };

  async function worker(): Promise<void> {
    for (;;) {
      if (options.shouldCancel?.()) {
        throw new DOMException('Enrichment cancelled', 'AbortError');
      }
      const target = pickNext();
      if (!target) return;
      await sleep(jitterMs());
      if (options.shouldCancel?.()) {
        throw new DOMException('Enrichment cancelled', 'AbortError');
      }
      const result = await enrichOne(target);
      progress.processed++;
      if (result.enrichmentStatus === 'ok') progress.ok++;
      else if (result.enrichmentStatus === 'no-uploads') progress.noUploads++;
      else progress.unreachable++;
      progress.current = target.channelId;
      buffer.push(result);

      updateOverlay(
        progress.processed,
        `${progress.ok} ok · ${progress.noUploads} empty · ${progress.unreachable} skipped`,
      );

      if (buffer.length >= BATCH_SIZE) {
        const batch = buffer.splice(0, buffer.length);
        await options.onBatch(batch, { ...progress });
      } else {
        options.onProgress?.({ ...progress });
      }
    }
  }

  try {
    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);
    if (buffer.length > 0) {
      const batch = buffer.splice(0, buffer.length);
      await options.onBatch(batch, { ...progress });
    }
    setOverlayComplete(progress.processed, Date.now() - start);
    return progress;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    setOverlayError(msg);
    throw err;
  } finally {
    setTimeout(removeOverlay, 6000);
  }
}
