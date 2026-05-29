import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '../shared/db';
import { downloadCSV, downloadJSON } from '../shared/export';
import {
  checkSubscriptionsTab,
  classifyTab,
  getActiveTab,
  openSubscriptionsTab,
  sendMessage,
  type TabContext,
} from '../lib/chrome';
import type {
  Channel,
  EnrichmentProgress,
  ExtractionProgress,
  ExtractionRun,
} from '../shared/types';
import type { Message } from '../shared/messages';
import { friendlyError } from '../shared/errors';
import { initTheme } from '../shared/theme';
import { ThemeToggle } from '../shared/ThemeToggle';
import { ToastHost, showToast } from './Toast';

type ExtractState =
  | { kind: 'idle' }
  | { kind: 'extracting'; progress: ExtractionProgress }
  | { kind: 'complete'; total: number }
  | { kind: 'error'; message: string };

type EnrichState =
  | { kind: 'idle' }
  | { kind: 'enriching'; progress: EnrichmentProgress }
  | { kind: 'complete'; progress: EnrichmentProgress }
  | { kind: 'error'; message: string };

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const HINTS: Record<TabContext, string> = {
  subscriptions: 'Ready to scan this page',
  'youtube-other': 'Will switch this tab to your subscriptions page',
  'off-youtube': 'Will open your YouTube subscriptions page',
};

function Popup() {
  const [state, setState] = useState<ExtractState>({ kind: 'idle' });
  const [enrichState, setEnrichState] = useState<EnrichState>({ kind: 'idle' });
  const [tabUrl, setTabUrl] = useState<string | undefined>();
  const [channelCount, setChannelCount] = useState(0);
  const [lastRun, setLastRun] = useState<ExtractionRun | undefined>();
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [tabAvailable, setTabAvailable] = useState(true);
  const [enrichCancelPending, setEnrichCancelPending] = useState(false);
  const enrichCancelRef = useRef(false);

  const tabContext = useMemo<TabContext>(() => classifyTab(tabUrl), [tabUrl]);

  useEffect(() => {
    enrichCancelRef.current = enrichCancelPending;
  }, [enrichCancelPending]);

  useEffect(() => {
    if (enrichState.kind !== 'enriching') setEnrichCancelPending(false);
  }, [enrichState.kind]);

  const refreshSummary = useCallback(async () => {
    const [count, runs] = await Promise.all([
      db()
        .channels.filter((c) => !c.unsubscribedAt)
        .count(),
      db().extractions.orderBy('startedAt').reverse().limit(1).toArray(),
    ]);
    setChannelCount(count);
    setLastRun(runs[0]);
  }, []);

  const refreshEnrichStatus = useCallback(() => {
    sendMessage({ action: 'enrich:status' })
      .then((reply) => {
        const r = reply as Extract<Message, { action: 'enrich:status:reply' }> | undefined;
        if (r?.action !== 'enrich:status:reply') return;
        setPendingCount(r.data.pendingCount);
        if (r.data.running && r.data.progress) {
          setEnrichState({ kind: 'enriching', progress: r.data.progress });
        }
      })
      .catch(() => {
        /* silent — status resyncs from subsequent messages */
      });
  }, []);

  useEffect(() => {
    getActiveTab().then((tab) => setTabUrl(tab?.url));
    refreshSummary();
    checkSubscriptionsTab()
      .then(setTabAvailable)
      .catch(() => {});

    sendMessage({ action: 'extract:status' })
      .then((reply) => {
        const r = reply as Extract<Message, { action: 'extract:status:reply' }> | undefined;
        if (r?.action === 'extract:status:reply' && r.data.running && r.data.progress) {
          setState({ kind: 'extracting', progress: r.data.progress });
        }
      })
      .catch(() => {
        /* silent — status resyncs from subsequent messages */
      });

    refreshEnrichStatus();
  }, [refreshSummary, refreshEnrichStatus]);

  useEffect(() => {
    const listener = (raw: unknown): void => {
      const msg = raw as Message;
      switch (msg.action) {
        case 'extract:progress':
          setState({ kind: 'extracting', progress: msg.data.progress });
          break;
        case 'extract:complete':
          setState({ kind: 'complete', total: msg.data.total });
          refreshSummary();
          refreshEnrichStatus();
          showToast(`Found ${msg.data.total.toLocaleString()} subscriptions`);
          break;
        case 'extract:error': {
          const friendly = friendlyError(msg.data.message, 'Scan');
          setState((prev) => {
            const loaded = prev.kind === 'extracting' ? prev.progress.loaded : 0;
            const message =
              loaded > 0
                ? `Stopped at ${loaded.toLocaleString()} channels. ${friendly} Progress saved.`
                : friendly;
            return { kind: 'error', message };
          });
          break;
        }
        case 'enrich:progress':
          setEnrichState((prev) => {
            if (prev.kind === 'complete' || enrichCancelRef.current) return prev;
            return { kind: 'enriching', progress: msg.data.progress };
          });
          break;
        case 'enrich:complete':
          setEnrichState({ kind: 'complete', progress: msg.data.progress });
          refreshSummary();
          refreshEnrichStatus();
          {
            const { ok, noUploads, unreachable } = msg.data.progress;
            const total = ok + noUploads + unreachable;
            showToast(
              `Checked ${total.toLocaleString()} channels · ${ok} active · ${noUploads} no videos · ${unreachable} couldn't reach`,
            );
          }
          break;
        case 'enrich:error': {
          const friendly = friendlyError(msg.data.message, 'Check');
          setEnrichState((prev) => {
            if (prev.kind === 'enriching') {
              const { processed, total } = prev.progress;
              if (processed > 0) {
                return {
                  kind: 'error',
                  message: `Checked ${processed.toLocaleString()}/${total.toLocaleString()}. ${friendly} Progress saved.`,
                };
              }
            }
            return { kind: 'error', message: friendly };
          });
          break;
        }
        case 'unsub:complete':
          refreshSummary();
          refreshEnrichStatus();
          break;
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refreshSummary, refreshEnrichStatus]);

  const handleOpenTab = useCallback(async () => {
    await openSubscriptionsTab();
    setTimeout(() => {
      checkSubscriptionsTab()
        .then(setTabAvailable)
        .catch(() => {});
    }, 1500);
  }, []);

  const handleExtract = useCallback(async () => {
    setState({ kind: 'extracting', progress: { loaded: 0 } });
    try {
      const reply = (await sendMessage({ action: 'extract:start' })) as
        | { ok: true }
        | { ok: false; error: string }
        | undefined;
      if (reply && reply.ok === false) {
        setState({ kind: 'error', message: friendlyError(reply.error, 'Scan') });
      }
    } catch {
      setState({ kind: 'error', message: 'Extension is reconnecting — please try again.' });
    }
  }, []);

  const handleCancel = useCallback(async () => {
    try {
      await sendMessage({ action: 'extract:cancel' });
    } catch {
      /* silent — cancel is best-effort */
    }
  }, []);

  const handleCancelEnrich = useCallback(async () => {
    setEnrichCancelPending(true);
    try {
      await sendMessage({ action: 'enrich:cancel' });
    } catch {
      /* silent — cancel is best-effort */
    }
  }, []);

  const handleExportCSV = useCallback(async () => {
    const channels = (await db().channels.toArray()) as Channel[];
    if (channels.length === 0) return;
    const filename = await downloadCSV(channels);
    showToast(`Downloaded ${filename}`);
  }, []);

  const handleExportJSON = useCallback(async () => {
    const channels = (await db().channels.toArray()) as Channel[];
    if (channels.length === 0) return;
    const filename = await downloadJSON(channels);
    showToast(`Downloaded ${filename}`);
  }, []);

  const handleEnrich = useCallback(async () => {
    if (pendingCount === 0) {
      showToast('All channels are already up to date.', 'info');
      return;
    }
    setEnrichState({
      kind: 'enriching',
      progress: { processed: 0, total: 0, ok: 0, noUploads: 0, unreachable: 0 },
    });
    try {
      const reply = (await sendMessage({ action: 'enrich:start' })) as
        | { ok: true }
        | { ok: false; error: string }
        | undefined;
      if (reply && reply.ok === false) {
        setEnrichState({ kind: 'error', message: friendlyError(reply.error, 'Check') });
      }
    } catch {
      setEnrichState({
        kind: 'error',
        message: 'Extension is reconnecting — please try again.',
      });
    }
  }, [pendingCount]);

  const handleOpenDashboard = useCallback(() => {
    sendMessage({ action: 'dashboard:open' }).catch(() => {
      /* tab opens once worker wakes */
    });
  }, []);

  const handleClearData = useCallback(async () => {
    if (channelCount === 0) return;
    const ok = window.confirm(
      `Delete ${channelCount.toLocaleString()} saved channels? Your YouTube subscriptions won't be affected.`,
    );
    if (!ok) return;
    await db().channels.clear();
    await db().extractions.clear();
    sendMessage({ action: 'clear:data' }).catch(() => {});
    setChannelCount(0);
    setLastRun(undefined);
    setPendingCount(0);
    setState({ kind: 'idle' });
    setEnrichState({ kind: 'idle' });
    refreshEnrichStatus();
    showToast('Cleared your saved list.');
  }, [channelCount, refreshEnrichStatus]);

  const dismissExtractError = useCallback(() => setState({ kind: 'idle' }), []);
  const dismissEnrichError = useCallback(() => setEnrichState({ kind: 'idle' }), []);

  const busy = state.kind === 'extracting' || enrichState.kind === 'enriching';
  const extractDisabled = busy;
  const enrichDisabled = busy || channelCount === 0;
  const exportDisabled = channelCount === 0 || busy;
  const dashboardDisabled = channelCount === 0;
  const clearDisabled = busy || channelCount === 0;

  return (
    <>
      <div className="header">
        <div className="header-row">
          <h1>YouTube Sub Manager</h1>
          <ThemeToggle />
        </div>
        <span className="subtitle">
          Find inactive subscriptions, track activity, and bulk unsubscribe
        </span>
      </div>

      <div className="summary">
        <span className="count">{channelCount.toLocaleString()}</span>
        <span>
          channels stored
          {lastRun?.completedAt && ` · ${formatRelative(lastRun.completedAt)}`}
        </span>
      </div>

      {state.kind === 'extracting' && (
        <div className="progress" role="status" aria-live="polite">
          <div className="label">
            <span>
              {state.progress.phase === 'setup'
                ? 'Preparing scan…'
                : state.progress.phase === 'parsing'
                  ? 'Reading your subscriptions…'
                  : 'Loading channels…'}
            </span>
            {state.progress.phase !== 'setup' && (
              <span>
                {state.progress.loaded.toLocaleString()}
                {state.progress.phase === 'parsing' && state.progress.total
                  ? ` of ${state.progress.total.toLocaleString()}`
                  : ''}
              </span>
            )}
          </div>
          {state.progress.phase === 'parsing' &&
          state.progress.total &&
          state.progress.total > 0 ? (
            <div className="bar">
              <div
                style={{
                  width: `${Math.min(100, (state.progress.loaded / state.progress.total) * 100)}%`,
                }}
              />
            </div>
          ) : (
            <div className="bar indeterminate">
              <div />
            </div>
          )}
          <button className="cancel" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="error" role="alert">
          <span className="message">{state.message}</span>
          <button className="dismiss" onClick={dismissExtractError} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      {enrichState.kind === 'enriching' && (
        <div className="progress" role="status" aria-live="polite">
          <div className="label">
            <span>Checking for recent uploads…</span>
            <span>
              {enrichState.progress.processed.toLocaleString()}
              {enrichState.progress.total
                ? ` of ${enrichState.progress.total.toLocaleString()}`
                : ''}
            </span>
          </div>
          {enrichState.progress.total > 0 ? (
            <div className="bar">
              <div
                style={{
                  width: `${Math.min(100, (enrichState.progress.processed / enrichState.progress.total) * 100)}%`,
                }}
              />
            </div>
          ) : (
            <div className="bar indeterminate">
              <div />
            </div>
          )}
          <button className="cancel" onClick={handleCancelEnrich} disabled={enrichCancelPending}>
            {enrichCancelPending ? 'Stopping…' : 'Cancel'}
          </button>
        </div>
      )}

      {enrichState.kind === 'complete' && (
        <div className="summary">
          <span>
            Checked{' '}
            {(
              enrichState.progress.ok +
              enrichState.progress.noUploads +
              enrichState.progress.unreachable
            ).toLocaleString()}{' '}
            channels · {enrichState.progress.ok} active · {enrichState.progress.noUploads} no videos
            · {enrichState.progress.unreachable} couldn&apos;t reach
          </span>
        </div>
      )}

      {enrichState.kind === 'error' && (
        <div className="error" role="alert">
          <span className="message">{enrichState.message}</span>
          <button className="dismiss" onClick={dismissEnrichError} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      {!tabAvailable && (
        <div className="tab-warning" role="alert">
          <span className="message">
            Keep your YouTube subscriptions tab open while using this extension.
          </span>
          <button className="warning-cta" onClick={handleOpenTab}>
            Open YouTube subscriptions
          </button>
        </div>
      )}

      <div className="actions">
        <button className="primary" onClick={handleExtract} disabled={extractDisabled}>
          {state.kind === 'extracting' ? 'Scanning…' : 'Scan my subscriptions'}
        </button>

        <button onClick={handleEnrich} disabled={enrichDisabled}>
          {enrichState.kind === 'enriching' ? 'Checking…' : 'Check for activity'}
        </button>

        <button onClick={handleOpenDashboard} disabled={dashboardDisabled}>
          Open Dashboard
        </button>

        <div className="export-row">
          <button onClick={handleExportCSV} disabled={exportDisabled}>
            Export CSV
          </button>
          <button onClick={handleExportJSON} disabled={exportDisabled}>
            Export JSON
          </button>
        </div>

        <div className="link-row">
          <button
            type="button"
            className="link-muted"
            onClick={handleClearData}
            disabled={clearDisabled}
          >
            Clear saved list
          </button>
        </div>
      </div>

      <div className="footer">{HINTS[tabContext]}</div>
      <ToastHost />
    </>
  );
}

initTheme();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  );
}
