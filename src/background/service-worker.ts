import { createBackup } from '../shared/backup';
import { db } from '../shared/db';
import { isFreshEnrichment } from '../shared/enrichment';
import { downloadCSV, downloadJSON } from '../shared/export';
import { KEEPALIVE_PORT, type Message } from '../shared/messages';
import type {
  Channel,
  EnrichmentProgress,
  EnrichmentResult,
  EnrichmentTarget,
  ExtractionProgress,
  UnsubLogRow,
  UnsubProgress,
  UnsubResult,
  UnsubTarget,
} from '../shared/types';

const SUBSCRIPTIONS_URL = 'https://www.youtube.com/feed/channels';

const UNSUB_BATCH_CAP = 200;

let currentRunId: number | undefined;
let currentProgress: ExtractionProgress | undefined;
let currentExtractTabId: number | undefined;

let currentEnrichProgress: EnrichmentProgress | undefined;
let currentEnrichTabId: number | undefined;

let unsubRunning = false;
let unsubProgress: UnsubProgress | undefined;
let unsubBatchId: string | undefined;
let unsubTabId: number | undefined;
let unsubOverflow: string[] = [];
let unsubTargetIds: string[] = [];

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== KEEPALIVE_PORT) return;
  port.onDisconnect.addListener(() => {
    if (currentRunId !== undefined && currentExtractTabId !== undefined) {
      void handleExtractTabClosed();
    }
    if (currentEnrichProgress !== undefined && currentEnrichTabId !== undefined) {
      void handleEnrichTabClosed();
    }
    if (unsubRunning && unsubTabId !== undefined) {
      void handleUnsubTabClosed();
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId: number) => {
  if (currentExtractTabId !== undefined && tabId === currentExtractTabId) {
    void handleExtractTabClosed();
  }
  if (currentEnrichTabId !== undefined && tabId === currentEnrichTabId) {
    void handleEnrichTabClosed();
  }
  if (unsubTabId !== undefined && tabId === unsubTabId) {
    void handleUnsubTabClosed();
  }
});

async function hasSubscriptionsTab(): Promise<boolean> {
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/feed/channels*' });
  return tabs.length > 0;
}

async function findOrOpenSubscriptionsTab(activate = true): Promise<chrome.tabs.Tab> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id && active.url?.startsWith('https://www.youtube.com/feed/channels')) {
    return active;
  }

  const existing = await chrome.tabs.query({ url: 'https://www.youtube.com/feed/channels*' });
  if (existing[0]?.id !== undefined) {
    if (!activate) return existing[0];
    const focused = await chrome.tabs.update(existing[0].id, { active: true });
    if (focused) return focused;
    return existing[0];
  }

  if (active?.id && active.url && /^https?:\/\/[^/]*youtube\.com/.test(active.url)) {
    const updated = await chrome.tabs.update(active.id, { url: SUBSCRIPTIONS_URL });
    if (updated) return updated;
    return { ...active, url: SUBSCRIPTIONS_URL };
  }

  return chrome.tabs.create({ url: SUBSCRIPTIONS_URL, active: activate });
}

async function sendToTabWithRetry(tabId: number, msg: Message, retries = 4): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, msg);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const reply = (await chrome.tabs.sendMessage(tabId, { action: 'ping' } satisfies Message)) as
      | { ok?: boolean }
      | undefined;
    return reply?.ok === true;
  } catch {
    return false;
  }
}

async function ensureContentScriptInjected(tabId: number): Promise<void> {
  if (await pingContentScript(tabId)) return;

  // Content script may be missing because the YouTube tab was open before the
  // extension was installed/reloaded. Re-inject using the paths the manifest
  // already declares so this stays correct across builds.
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js;
  if (!files || files.length === 0) {
    throw new Error('No content script declared in manifest.');
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Extension failed to load. Refresh and retry. (${detail})`);
  }

  await new Promise((r) => setTimeout(r, 200));

  if (!(await pingContentScript(tabId))) {
    throw new Error('YouTube tab not responding. Refresh and retry.');
  }
}

async function assertTabIsSubscriptions(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error('YouTube tab was closed.');
  }
  if (!tab.url?.startsWith(SUBSCRIPTIONS_URL)) {
    throw new Error('YouTube page navigated away from subscriptions.');
  }
}

async function waitForTabComplete(tabId: number, timeoutMs = 15_000): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out waiting for YouTube tab to load.'));
    }, timeoutMs);

    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo): void => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function dispatchExtractStart(): Promise<void> {
  if (currentRunId !== undefined) {
    const staleRunId = currentRunId;
    currentRunId = undefined;
    currentProgress = undefined;
    currentExtractTabId = undefined;
    await db()
      .extractions.update(staleRunId, {
        completedAt: Date.now(),
        status: 'error',
        errorMessage: 'Interrupted by a new scan.',
      })
      .catch(() => {});
  }

  const tab = await findOrOpenSubscriptionsTab();
  if (tab.id === undefined) throw new Error('Could not open a YouTube tab.');

  currentExtractTabId = tab.id;

  const run = await db().extractions.add({
    startedAt: Date.now(),
    channelCount: 0,
    status: 'running',
  });
  currentRunId = typeof run === 'number' ? run : Number(run);
  currentProgress = { loaded: 0, phase: 'setup' };

  chrome.runtime
    .sendMessage({
      action: 'extract:progress',
      data: { channels: [], progress: { loaded: 0, phase: 'setup' } },
    } satisfies Message)
    .catch(() => {});

  await waitForTabComplete(tab.id);
  if (currentRunId === undefined) return;
  await assertTabIsSubscriptions(tab.id);

  await ensureContentScriptInjected(tab.id);
  if (currentRunId === undefined) return;
  await assertTabIsSubscriptions(tab.id);

  await sendToTabWithRetry(tab.id, { action: 'extract:start' });
}

async function dispatchEnrichStart(): Promise<void> {
  const all = await db().channels.toArray();
  const targets: EnrichmentTarget[] = all
    .filter((c) => !c.unsubscribedAt && !isFreshEnrichment(c.enrichedAt))
    .map((c) => ({ channelId: c.channelId, resolvedUcid: c.resolvedUcid }));

  if (targets.length === 0) {
    const empty: EnrichmentProgress = {
      processed: 0,
      total: 0,
      ok: 0,
      noUploads: 0,
      unreachable: 0,
    };
    chrome.runtime
      .sendMessage({
        action: 'enrich:complete',
        data: { progress: empty, durationMs: 0 },
      } satisfies Message)
      .catch(() => {
        /* popup closed */
      });
    return;
  }

  const tab = await findOrOpenSubscriptionsTab(false);
  if (tab.id === undefined) throw new Error('Could not open a YouTube tab.');

  currentEnrichProgress = {
    processed: 0,
    total: targets.length,
    ok: 0,
    noUploads: 0,
    unreachable: 0,
  };

  await waitForTabComplete(tab.id);
  await ensureContentScriptInjected(tab.id);
  currentEnrichTabId = tab.id;
  await sendToTabWithRetry(tab.id, { action: 'enrich:run', data: { targets } });
}

async function handleExtractProgress(
  payload: Extract<Message, { action: 'extract:progress' }>['data'],
): Promise<void> {
  currentProgress = payload.progress;
  await db().channels.bulkPut(payload.channels);

  chrome.runtime
    .sendMessage({
      action: 'extract:progress',
      data: { channels: [], progress: payload.progress },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function handleExtractComplete(
  payload: Extract<Message, { action: 'extract:complete' }>['data'],
): Promise<void> {
  if (currentRunId !== undefined) {
    await db().extractions.update(currentRunId, {
      completedAt: Date.now(),
      channelCount: payload.total,
      status: 'completed',
    });
  }

  chrome.runtime
    .sendMessage({
      action: 'extract:complete',
      data: { ...payload, runId: currentRunId },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });

  currentRunId = undefined;
  currentProgress = undefined;
  currentExtractTabId = undefined;
}

async function handleExtractError(message: string): Promise<void> {
  if (currentRunId !== undefined) {
    await db().extractions.update(currentRunId, {
      completedAt: Date.now(),
      status: 'error',
      errorMessage: message,
    });
  }
  currentRunId = undefined;
  currentProgress = undefined;
  currentExtractTabId = undefined;

  chrome.runtime
    .sendMessage({ action: 'extract:error', data: { message } } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function handleExtractCancel(): Promise<void> {
  if (currentRunId === undefined) return;

  const runId = currentRunId;
  const tabId = currentExtractTabId;

  // Clear globals synchronously before any await, so the port onDisconnect
  // and tabs.onRemoved handlers see undefined and skip.
  currentRunId = undefined;
  currentProgress = undefined;
  currentExtractTabId = undefined;

  if (tabId !== undefined) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'extract:cancel' } satisfies Message);
    } catch {
      /* tab may already be closed */
    }
  }

  await db().extractions.update(runId, {
    completedAt: Date.now(),
    status: 'cancelled',
  });

  chrome.runtime
    .sendMessage({
      action: 'extract:error',
      data: { message: 'Extraction cancelled.' },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function handleExtractTabClosed(): Promise<void> {
  if (currentRunId === undefined) return;

  await db().extractions.update(currentRunId, {
    completedAt: Date.now(),
    status: 'error',
    errorMessage: 'YouTube tab was closed during extraction.',
  });

  currentRunId = undefined;
  currentProgress = undefined;
  currentExtractTabId = undefined;

  chrome.runtime
    .sendMessage({
      action: 'extract:error',
      data: { message: 'YouTube tab was closed during extraction.' },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function applyEnrichmentResults(results: EnrichmentResult[]): Promise<void> {
  if (results.length === 0) return;
  const ids = results.map((r) => r.channelId);
  const existingRows = await db().channels.bulkGet(ids);
  const now = Date.now();
  const updates: Channel[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const existing = existingRows[i];
    if (!r || !existing) continue;
    updates.push({
      ...existing,
      resolvedUcid: r.resolvedUcid ?? existing.resolvedUcid,
      lastUploadAt: r.lastUploadAt ?? existing.lastUploadAt,
      videoCount: r.videoCount ?? existing.videoCount,
      enrichmentStatus: r.enrichmentStatus,
      enrichedAt: r.enrichmentStatus === 'unreachable' ? existing.enrichedAt : now,
    });
  }
  if (updates.length > 0) {
    await db().channels.bulkPut(updates);
  }
}

async function handleEnrichProgress(
  payload: Extract<Message, { action: 'enrich:progress' }>['data'],
  senderTabId?: number,
): Promise<void> {
  currentEnrichProgress = payload.progress;
  if (currentEnrichTabId === undefined && senderTabId !== undefined) {
    currentEnrichTabId = senderTabId;
  }
  await applyEnrichmentResults(payload.results);

  if (currentEnrichProgress === undefined) return;

  chrome.runtime
    .sendMessage({
      action: 'enrich:progress',
      data: { results: [], progress: payload.progress },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function handleEnrichComplete(
  payload: Extract<Message, { action: 'enrich:complete' }>['data'],
): Promise<void> {
  currentEnrichProgress = undefined;
  currentEnrichTabId = undefined;
  chrome.runtime
    .sendMessage({ action: 'enrich:complete', data: payload } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function handleEnrichError(message: string): Promise<void> {
  currentEnrichProgress = undefined;
  currentEnrichTabId = undefined;
  chrome.runtime
    .sendMessage({ action: 'enrich:error', data: { message } } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function handleEnrichCancel(): Promise<void> {
  const tabId = currentEnrichTabId;

  // Clear globals synchronously before any await, so the port onDisconnect
  // and tabs.onRemoved handlers see undefined and skip.
  currentEnrichProgress = undefined;
  currentEnrichTabId = undefined;

  if (tabId !== undefined) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'enrich:cancel' } satisfies Message);
    } catch {
      /* tab may already be closed */
    }
  } else {
    // Service worker may have been terminated mid-enrichment and lost the tab
    // reference. Broadcast cancel to every YouTube tab so the content script
    // still running enrichment can stop.
    const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
    await Promise.all(
      tabs.map((t) =>
        t.id === undefined
          ? Promise.resolve()
          : chrome.tabs
              .sendMessage(t.id, { action: 'enrich:cancel' } satisfies Message)
              .catch(() => {
                /* tab not running enrichment */
              }),
      ),
    );
  }

  chrome.runtime
    .sendMessage({
      action: 'enrich:error',
      data: { message: 'Check cancelled.' },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function handleEnrichTabClosed(): Promise<void> {
  if (currentEnrichProgress === undefined) return;

  currentEnrichProgress = undefined;
  currentEnrichTabId = undefined;

  chrome.runtime
    .sendMessage({
      action: 'enrich:error',
      data: { message: 'YouTube tab was closed while checking.' },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function applyUnsubResultFromContent(result: UnsubResult): Promise<void> {
  if (!unsubBatchId) return;
  const existing = await db().channels.get(result.channelId);
  const channelName = existing?.name;

  const updates: Partial<Channel> = {};
  if (result.outcome === 'ok' || result.outcome === 'already-unsubbed') {
    updates.unsubscribedAt = result.attemptedAt;
    updates.pendingUnsub = false;
  } else if (result.outcome === 'unreachable') {
    updates.pendingUnsub = false;
  }
  if (Object.keys(updates).length > 0) {
    try {
      await db().channels.update(result.channelId, updates);
    } catch {
      /* row may have been deleted concurrently; ignore */
    }
  }

  const logRow: UnsubLogRow = {
    batchId: unsubBatchId,
    channelId: result.channelId,
    channelName,
    outcome: result.outcome,
    detail: result.detail,
    attemptedAt: result.attemptedAt,
  };
  await db().unsubLog.add(logRow);
}

async function handleUnsubProgress(
  payload: Extract<Message, { action: 'unsub:progress' }>['data'],
): Promise<void> {
  unsubProgress = payload.progress;
  if (payload.result) {
    await applyUnsubResultFromContent(payload.result);
  }

  if (!unsubRunning) return;

  chrome.runtime
    .sendMessage({
      action: 'unsub:progress',
      data: { result: payload.result, progress: payload.progress },
    } satisfies Message)
    .catch(() => {
      /* popup/dashboard closed */
    });
}

async function handleUnsubComplete(
  payload: Extract<Message, { action: 'unsub:complete' }>['data'],
): Promise<void> {
  const allRemaining = [...payload.remaining, ...unsubOverflow];
  const seen = new Set<string>();
  const deduped = allRemaining.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  chrome.runtime
    .sendMessage({
      action: 'unsub:complete',
      data: {
        progress: payload.progress,
        durationMs: payload.durationMs,
        remaining: deduped,
      },
    } satisfies Message)
    .catch(() => {
      /* popup/dashboard closed */
    });

  unsubRunning = false;
  unsubProgress = undefined;
  unsubBatchId = undefined;
  unsubTabId = undefined;
  unsubOverflow = [];
  unsubTargetIds = [];
}

async function handleUnsubError(message: string): Promise<void> {
  chrome.runtime
    .sendMessage({ action: 'unsub:error', data: { message } } satisfies Message)
    .catch(() => {
      /* popup/dashboard closed */
    });
  unsubRunning = false;
  unsubProgress = undefined;
  unsubBatchId = undefined;
  unsubTabId = undefined;
  unsubOverflow = [];
  unsubTargetIds = [];
}

async function handleUnsubTabClosed(): Promise<void> {
  if (!unsubRunning) return;

  const remaining: string[] = [];
  if (unsubBatchId) {
    const loggedIds = new Set(
      (await db().unsubLog.where('batchId').equals(unsubBatchId).toArray()).map(
        (row) => row.channelId,
      ),
    );
    const seen = new Set<string>();
    for (const id of unsubTargetIds) {
      if (!loggedIds.has(id) && !seen.has(id)) {
        seen.add(id);
        remaining.push(id);
      }
    }
    for (const id of unsubOverflow) {
      if (!seen.has(id)) {
        seen.add(id);
        remaining.push(id);
      }
    }
  }

  const savedProgress = unsubProgress ? { ...unsubProgress } : undefined;

  unsubRunning = false;
  unsubProgress = undefined;
  unsubBatchId = undefined;
  unsubTabId = undefined;
  unsubOverflow = [];
  unsubTargetIds = [];

  chrome.runtime
    .sendMessage({
      action: 'unsub:paused',
      data: {
        progress: savedProgress ?? {
          processed: 0,
          total: 0,
          ok: 0,
          alreadyUnsubbed: 0,
          unreachable: 0,
          error: 0,
          halted: 0,
        },
        remaining,
      },
    } satisfies Message)
    .catch(() => {
      /* dashboard may be closed */
    });
}

async function dispatchUnsubStart(channelIds: string[]): Promise<void> {
  if (unsubRunning) throw new Error('An unsubscribe run is already in progress.');
  if (channelIds.length === 0) throw new Error('No channels selected.');

  const rows = await db().channels.bulkGet(channelIds);
  const targets: UnsubTarget[] = [];
  for (let i = 0; i < channelIds.length; i++) {
    const id = channelIds[i];
    const row = rows[i];
    if (!id || !row) continue;
    targets.push({ channelId: id, name: row.name });
  }
  if (targets.length === 0) throw new Error('Selected channels not found in storage.');

  const capped = targets.slice(0, UNSUB_BATCH_CAP);
  const overflowIds = targets.slice(UNSUB_BATCH_CAP).map((t) => t.channelId);

  let backupId: number;
  try {
    backupId = await createBackup(capped.map((t) => t.channelId));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to create backup before unsubscribing: ${detail}`);
  }
  chrome.runtime
    .sendMessage({ action: 'backup:created', data: { backupId } } satisfies Message)
    .catch(() => {});

  const tab = await findOrOpenSubscriptionsTab();
  if (tab.id === undefined) throw new Error('Could not open a YouTube tab.');
  await waitForTabComplete(tab.id);
  await ensureContentScriptInjected(tab.id);

  const batchId = `unsub-${Date.now()}`;
  unsubRunning = true;
  unsubBatchId = batchId;
  unsubTabId = tab.id;
  unsubOverflow = overflowIds;
  unsubTargetIds = capped.map((t) => t.channelId);
  unsubProgress = {
    processed: 0,
    total: capped.length,
    ok: 0,
    alreadyUnsubbed: 0,
    unreachable: 0,
    error: 0,
    halted: 0,
  };

  await sendToTabWithRetry(tab.id, {
    action: 'unsub:batch',
    data: { batchId, targets: capped },
  });
}

function forwardUnsubCancel(): void {
  if (!unsubRunning) return;
  if (unsubTabId === undefined) {
    void handleUnsubTabClosed();
    return;
  }
  chrome.tabs.sendMessage(unsubTabId, { action: 'unsub:cancel' } satisfies Message).catch(() => {
    void handleUnsubTabClosed();
  });
}

async function handleExportCSV(): Promise<void> {
  const channels = await db().channels.toArray();
  await downloadCSV(channels);
}

async function handleExportJSON(): Promise<void> {
  const channels = await db().channels.toArray();
  await downloadJSON(channels);
}

function openDashboard(): void {
  const url = chrome.runtime.getURL('src/dashboard/dashboard.html');
  chrome.tabs.create({ url, active: true });
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const msg = raw as Message;
  switch (msg.action) {
    case 'extract:start':
      dispatchExtractStart().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        handleExtractError(message);
      });
      sendResponse({ ok: true });
      return false;

    case 'extract:progress':
      handleExtractProgress(msg.data).then(() => sendResponse({ ok: true }));
      return true;

    case 'extract:complete':
      handleExtractComplete(msg.data).then(() => sendResponse({ ok: true }));
      return true;

    case 'extract:error':
      handleExtractError(msg.data.message).then(() => sendResponse({ ok: true }));
      return true;

    case 'extract:cancel':
      handleExtractCancel().catch(() => {});
      sendResponse({ ok: true });
      return false;

    case 'extract:status':
      sendResponse({
        action: 'extract:status:reply',
        data: {
          running: currentRunId !== undefined,
          progress: currentProgress,
        },
      } satisfies Message);
      return false;

    case 'enrich:start':
      dispatchEnrichStart().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        handleEnrichError(message);
      });
      sendResponse({ ok: true });
      return false;

    case 'enrich:progress':
      handleEnrichProgress(msg.data, sender.tab?.id).then(() => sendResponse({ ok: true }));
      return true;

    case 'enrich:complete':
      handleEnrichComplete(msg.data).then(() => sendResponse({ ok: true }));
      return true;

    case 'enrich:error':
      handleEnrichError(msg.data.message).then(() => sendResponse({ ok: true }));
      return true;

    case 'enrich:cancel':
      handleEnrichCancel().catch(() => {});
      sendResponse({ ok: true });
      return false;

    case 'enrich:status':
      void (async () => {
        try {
          const rows = await db().channels.toArray();
          const pendingCount = rows.filter(
            (c) => !c.unsubscribedAt && !isFreshEnrichment(c.enrichedAt),
          ).length;
          sendResponse({
            action: 'enrich:status:reply',
            data: {
              running: currentEnrichProgress !== undefined,
              progress: currentEnrichProgress,
              pendingCount,
            },
          } satisfies Message);
        } catch {
          sendResponse({
            action: 'enrich:status:reply',
            data: { running: false, progress: undefined, pendingCount: 0 },
          } satisfies Message);
        }
      })();
      return true;

    case 'unsub:start':
      dispatchUnsubStart(msg.data.channelIds)
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          sendResponse({ ok: false, error: message });
        });
      return true;

    case 'unsub:progress':
      handleUnsubProgress(msg.data).then(() => sendResponse({ ok: true }));
      return true;

    case 'unsub:complete':
      handleUnsubComplete(msg.data).then(() => sendResponse({ ok: true }));
      return true;

    case 'unsub:error':
      handleUnsubError(msg.data.message).then(() => sendResponse({ ok: true }));
      return true;

    case 'unsub:cancel':
      forwardUnsubCancel();
      sendResponse({ ok: true });
      return false;

    case 'unsub:status':
      sendResponse({
        action: 'unsub:status:reply',
        data: { running: unsubRunning, progress: unsubProgress },
      } satisfies Message);
      return false;

    case 'dashboard:open':
      openDashboard();
      sendResponse({ ok: true });
      return false;

    case 'export:csv':
      handleExportCSV()
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          sendResponse({ ok: false, error: message });
        });
      return true;

    case 'export:json':
      handleExportJSON()
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          sendResponse({ ok: false, error: message });
        });
      return true;

    case 'tab:check':
      void hasSubscriptionsTab()
        .then((found) => {
          sendResponse({ action: 'tab:check:reply', data: { found } } satisfies Message);
        })
        .catch(() => {
          sendResponse({ action: 'tab:check:reply', data: { found: false } } satisfies Message);
        });
      return true;

    case 'tab:open-subscriptions':
      void findOrOpenSubscriptionsTab(false)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case 'clear:data':
      void (async () => {
        try {
          await handleExtractCancel().catch(() => {});
          await handleEnrichCancel().catch(() => {});
          currentRunId = undefined;
          currentProgress = undefined;
          currentExtractTabId = undefined;
          currentEnrichProgress = undefined;
          currentEnrichTabId = undefined;
          unsubRunning = false;
          unsubProgress = undefined;
          unsubBatchId = undefined;
          unsubTabId = undefined;
          unsubOverflow = [];
          unsubTargetIds = [];
          await db().channels.clear();
          await db().extractions.clear();
        } catch {
          /* best effort */
        }
        sendResponse({ ok: true });
      })();
      return true;

    default:
      return false;
  }
});

async function cleanupStaleExtractions(): Promise<void> {
  try {
    const staleRuns = await db().extractions.where('status').equals('running').toArray();
    for (const run of staleRuns) {
      if (run.id !== undefined) {
        await db().extractions.update(run.id, {
          completedAt: Date.now(),
          status: 'error',
          errorMessage: 'Interrupted — browser ended the background process.',
        });
      }
    }
  } catch {
    /* best effort */
  }
}

void cleanupStaleExtractions();

chrome.runtime.onInstalled.addListener(() => {
  /* placeholder for first-run setup */
});
