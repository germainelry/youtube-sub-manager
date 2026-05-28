import type { Message } from '../shared/messages';
import { KEEPALIVE_PORT } from '../shared/messages';
import type {
  EnrichmentProgress,
  EnrichmentResult,
  EnrichmentTarget,
  UnsubTarget,
} from '../shared/types';
import { enrichAll } from './enrich';
import { extractAll } from './extractor';
import { unsubBatchOnPage } from './unsubscribe';

let extractRunning = false;
let extractAbortController: AbortController | undefined;
let lastExtractProgress: { loaded: number; total?: number } | undefined;

let enrichRunning = false;
let enrichAbortRequested = false;
let unsubRunning = false;
let unsubCancelRequested = false;

function send(msg: Message): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* popup may be closed; service worker is the canonical sink. */
  });
}

async function runExtraction(): Promise<void> {
  if (extractRunning) return;
  extractRunning = true;
  lastExtractProgress = { loaded: 0 };

  const abortController = new AbortController();
  extractAbortController = abortController;

  const port = chrome.runtime.connect({ name: KEEPALIVE_PORT });
  const started = Date.now();

  try {
    let lastSentAt = 0;
    const channels = await extractAll({
      onProgress: (progress) => {
        const now = Date.now();
        if (now - lastSentAt < 400) return;
        lastSentAt = now;
        lastExtractProgress = { loaded: progress.loaded, total: progress.total };
        send({
          action: 'extract:progress',
          data: { channels: [], progress },
        });
      },
      onBatch: async (batch, progress) => {
        lastExtractProgress = { loaded: progress.loaded, total: progress.total };
        send({
          action: 'extract:progress',
          data: { channels: batch, progress },
        });
      },
      signal: abortController.signal,
    });

    if (!abortController.signal.aborted) {
      send({
        action: 'extract:complete',
        data: { total: channels.length, durationMs: Date.now() - started },
      });
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    const message = err instanceof Error ? err.message : String(err);
    send({ action: 'extract:error', data: { message } });
  } finally {
    extractRunning = false;
    lastExtractProgress = undefined;
    extractAbortController = undefined;
    try {
      port.disconnect();
    } catch {
      /* noop */
    }
  }
}

async function runEnrichment(targets: EnrichmentTarget[]): Promise<void> {
  if (enrichRunning) return;
  enrichRunning = true;
  enrichAbortRequested = false;
  const port = chrome.runtime.connect({ name: KEEPALIVE_PORT });
  const started = Date.now();

  try {
    const finalProgress = await enrichAll(targets, {
      onBatch: async (results: EnrichmentResult[], progress: EnrichmentProgress) => {
        send({ action: 'enrich:progress', data: { results, progress } });
      },
      onProgress: (progress: EnrichmentProgress) => {
        send({ action: 'enrich:progress', data: { results: [], progress } });
      },
      shouldCancel: () => enrichAbortRequested,
    });

    if (!enrichAbortRequested) {
      send({
        action: 'enrich:complete',
        data: { progress: finalProgress, durationMs: Date.now() - started },
      });
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    const message = err instanceof Error ? err.message : String(err);
    send({ action: 'enrich:error', data: { message } });
  } finally {
    enrichRunning = false;
    enrichAbortRequested = false;
    try {
      port.disconnect();
    } catch {
      /* noop */
    }
  }
}

async function runUnsubBatch(batchId: string, targets: UnsubTarget[]): Promise<void> {
  if (unsubRunning) return;
  unsubRunning = true;
  unsubCancelRequested = false;

  const port = chrome.runtime.connect({ name: KEEPALIVE_PORT });
  const started = Date.now();

  try {
    const { progress, remaining } = await unsubBatchOnPage({
      batchId,
      targets,
      onResult: async (result, snapshot) => {
        send({ action: 'unsub:progress', data: { result, progress: snapshot } });
      },
      shouldCancel: () => unsubCancelRequested,
    });

    send({
      action: 'unsub:complete',
      data: { progress, remaining, durationMs: Date.now() - started },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ action: 'unsub:error', data: { message } });
  } finally {
    unsubRunning = false;
    unsubCancelRequested = false;
    try {
      port.disconnect();
    } catch {
      /* noop */
    }
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as Message;
  switch (msg.action) {
    case 'extract:start':
      runExtraction();
      sendResponse({ ok: true });
      return false;

    case 'enrich:run':
      runEnrichment(msg.data.targets);
      sendResponse({ ok: true });
      return false;

    case 'unsub:batch':
      runUnsubBatch(msg.data.batchId, msg.data.targets);
      sendResponse({ ok: true });
      return false;

    case 'unsub:cancel':
      unsubCancelRequested = true;
      sendResponse({ ok: true });
      return false;

    case 'extract:cancel':
      extractAbortController?.abort();
      sendResponse({ ok: true });
      return false;

    case 'enrich:cancel':
      enrichAbortRequested = true;
      sendResponse({ ok: true });
      return false;

    case 'extract:status':
      sendResponse({
        action: 'extract:status:reply',
        data: { running: extractRunning, progress: lastExtractProgress },
      });
      return false;

    case 'ping':
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});
