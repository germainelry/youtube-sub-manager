import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../shared/db';
import { checkSubscriptionsTab, openSubscriptionsTab, sendMessage } from '../lib/chrome';
import { friendlyError } from '../shared/errors';
import type { Message } from '../shared/messages';
import type { Channel, EnrichmentProgress, UnsubProgress } from '../shared/types';
import { ThemeToggle } from '../shared/ThemeToggle';
import { BackupSection } from './BackupSection';
import { ChannelTable } from './ChannelTable';
import { ConfirmDialog } from './ConfirmDialog';
import { SelectionBar } from './SelectionBar';
import {
  applyFilter,
  applySort,
  isStale,
  type FilterState,
  type SortKey,
  type SortState,
} from './filter';

type UnsubState =
  | { kind: 'idle' }
  | { kind: 'running'; progress: UnsubProgress }
  | { kind: 'paused'; progress: UnsubProgress; remaining: string[] }
  | { kind: 'complete'; progress: UnsubProgress; remaining: string[]; durationMs: number }
  | { kind: 'error'; message: string };

type EnrichState =
  | { kind: 'idle' }
  | { kind: 'enriching'; progress: EnrichmentProgress }
  | { kind: 'complete'; progress: EnrichmentProgress; durationMs: number }
  | { kind: 'error'; message: string };

const DEFAULT_FILTER: FilterState = {
  search: '',
  stalenessDays: 0,
  onlyEnriched: false,
};

const DEFAULT_SORT: SortState = { key: 'lastUpload', dir: 'asc' };

const SORT_OPTIONS: Array<{ value: `${SortKey}:asc` | `${SortKey}:desc`; label: string }> = [
  { value: 'lastUpload:asc', label: 'Least recent upload first' },
  { value: 'lastUpload:desc', label: 'Most recent upload first' },
  { value: 'name:asc', label: 'Name A → Z' },
  { value: 'name:desc', label: 'Name Z → A' },
  { value: 'subscriberCount:desc', label: 'Most subscribers first' },
  { value: 'subscriberCount:asc', label: 'Fewest subscribers first' },
];

const STALENESS_LABEL = (days: number): string => {
  if (days <= 0) return 'all';
  if (days < 365) return `${days} days`;
  const years = days / 365;
  if (years === Math.floor(years)) return `${years}y`;
  return `${years.toFixed(1)}y`;
};

const STALE_SHORT_LABEL = (days: number): string => {
  if (days <= 90) return `${days}d+`;
  if (days < 365) return `${Math.round(days / 30)}m+`;
  const years = days / 365;
  if (years === Math.floor(years)) return `${years}y+`;
  return `${years.toFixed(1)}y+`;
};

const BULK_CONFIRM_THRESHOLD = 100;

const STALE_PRESETS: Array<{ label: string; days: number }> = [
  { label: 'Any', days: 0 },
  { label: '3mo', days: 90 },
  { label: '6mo', days: 180 },
  { label: '1y', days: 365 },
  { label: '2y', days: 730 },
  { label: '3y', days: 1095 },
  { label: '5y', days: 1825 },
];

export function App(): JSX.Element {
  const [channels, setChannels] = useState<Channel[]>([]);
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unsubState, setUnsubState] = useState<UnsubState>({ kind: 'idle' });
  const [enrichState, setEnrichState] = useState<EnrichState>({ kind: 'idle' });
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [unsubErrors, setUnsubErrors] = useState<Array<{ channelName: string; detail: string }>>(
    [],
  );
  const [tabAvailable, setTabAvailable] = useState(true);

  const refresh = useCallback(async () => {
    const rows = await db().channels.toArray();
    setChannels(rows);
    setLoading(false);
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
    refresh();
    checkSubscriptionsTab()
      .then(setTabAvailable)
      .catch(() => {});
    sendMessage({ action: 'unsub:status' })
      .then((reply) => {
        const r = reply as Extract<Message, { action: 'unsub:status:reply' }> | undefined;
        if (r?.action === 'unsub:status:reply' && r.data.running && r.data.progress) {
          setUnsubState({ kind: 'running', progress: r.data.progress });
        }
      })
      .catch(() => {
        /* silent — status resyncs from subsequent progress messages */
      });
    refreshEnrichStatus();
  }, [refresh, refreshEnrichStatus]);

  useEffect(() => {
    const onFocus = (): void => {
      refresh();
      checkSubscriptionsTab()
        .then(setTabAvailable)
        .catch(() => {});
    };
    const onMessage = (raw: unknown): void => {
      const msg = raw as Message;
      switch (msg.action) {
        case 'enrich:progress':
          setEnrichState((prev) => {
            if (prev.kind === 'complete') return prev;
            return { kind: 'enriching', progress: msg.data.progress };
          });
          refresh();
          return;
        case 'enrich:complete':
          setEnrichState({
            kind: 'complete',
            progress: msg.data.progress,
            durationMs: msg.data.durationMs,
          });
          refresh();
          refreshEnrichStatus();
          return;
        case 'enrich:error':
          setEnrichState((prev) => {
            const friendly = friendlyError(msg.data.message, 'Check');
            if (prev.kind === 'enriching') {
              const { processed, total } = prev.progress;
              if (processed > 0) {
                return {
                  kind: 'error',
                  message: `Checked ${processed.toLocaleString()} of ${total.toLocaleString()} before stopping: ${friendly} Your progress is saved.`,
                };
              }
            }
            return { kind: 'error', message: friendly };
          });
          refresh();
          refreshEnrichStatus();
          return;
        case 'unsub:progress': {
          const result = msg.data.result;
          if (result) {
            if (result.outcome === 'ok' || result.outcome === 'already-unsubbed') {
              setChannels((prev) =>
                prev.map((c) =>
                  c.channelId === result.channelId
                    ? { ...c, unsubscribedAt: result.attemptedAt, pendingUnsub: false }
                    : c,
                ),
              );
            } else {
              setChannels((prev) =>
                prev.map((c) =>
                  c.channelId === result.channelId ? { ...c, pendingUnsub: false } : c,
                ),
              );
              if (
                result.outcome === 'error' ||
                result.outcome === 'halted' ||
                result.outcome === 'unreachable'
              ) {
                setUnsubErrors((prev) => [
                  ...prev,
                  {
                    channelName:
                      channelsRef.current.find((c) => c.channelId === result.channelId)?.name ??
                      result.channelId,
                    detail: result.detail ?? 'Unknown error',
                  },
                ]);
              }
            }
          }
          setUnsubState((prev) => {
            if (prev.kind === 'complete') return prev;
            return { kind: 'running', progress: msg.data.progress };
          });
          refresh();
          return;
        }
        case 'unsub:complete':
          setUnsubState({
            kind: 'complete',
            progress: msg.data.progress,
            remaining: msg.data.remaining,
            durationMs: msg.data.durationMs,
          });
          refresh();
          return;
        case 'unsub:paused':
          setUnsubState({
            kind: 'paused',
            progress: msg.data.progress,
            remaining: msg.data.remaining,
          });
          return;
        case 'unsub:error':
          setUnsubState({ kind: 'error', message: msg.data.message });
          return;
      }
    };
    window.addEventListener('focus', onFocus);
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      window.removeEventListener('focus', onFocus);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [refresh, refreshEnrichStatus]);

  const filtered = useMemo(() => applyFilter(channels, filter), [channels, filter]);
  const sorted = useMemo(() => applySort(filtered, sort), [filtered, sort]);

  const staleThreshold = filter.stalenessDays > 0 ? filter.stalenessDays : 365;
  const staleLabel = STALE_SHORT_LABEL(staleThreshold);
  const activeChannels = useMemo(() => channels.filter((c) => !c.unsubscribedAt), [channels]);

  const staleCount = useMemo(
    () => activeChannels.filter((c) => isStale(c, staleThreshold)).length,
    [activeChannels, staleThreshold],
  );

  const enrichedCount = useMemo(
    () => activeChannels.filter((c) => c.enrichedAt !== undefined).length,
    [activeChannels],
  );

  const selectedCount = useMemo(
    () => channels.reduce((n, c) => (c.pendingUnsub ? n + 1 : n), 0),
    [channels],
  );

  const filteredAlreadySelected = useMemo(
    () => sorted.reduce((n, c) => (c.pendingUnsub ? n + 1 : n), 0),
    [sorted],
  );

  const applyPendingUpdate = useCallback(async (ids: string[], pendingUnsub: boolean) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setChannels((prev) => prev.map((c) => (idSet.has(c.channelId) ? { ...c, pendingUnsub } : c)));
    const rows = await db().channels.bulkGet(ids);
    const updates = rows
      .filter((r): r is Channel => Boolean(r))
      .map((r) => ({ ...r, pendingUnsub }));
    await db().channels.bulkPut(updates);
  }, []);

  const handleToggleSelect = useCallback(
    (channelId: string): void => {
      const current = channels.find((c) => c.channelId === channelId);
      if (!current) return;
      void applyPendingUpdate([channelId], !current.pendingUnsub);
    },
    [channels, applyPendingUpdate],
  );

  const handleSelectAllFiltered = useCallback((): void => {
    const idsToSelect = sorted.filter((c) => !c.pendingUnsub).map((c) => c.channelId);
    if (idsToSelect.length === 0) return;
    if (
      idsToSelect.length > BULK_CONFIRM_THRESHOLD &&
      !window.confirm(
        `Select all ${idsToSelect.length.toLocaleString()} channels? You can untick any before unsubscribing.`,
      )
    ) {
      return;
    }
    void applyPendingUpdate(idsToSelect, true);
  }, [sorted, applyPendingUpdate]);

  const handleClearSelection = useCallback((): void => {
    const idsToClear = channels.filter((c) => c.pendingUnsub).map((c) => c.channelId);
    if (idsToClear.length === 0) return;
    void applyPendingUpdate(idsToClear, false);
  }, [channels, applyPendingUpdate]);

  const selectedChannels = useMemo(() => channels.filter((c) => c.pendingUnsub), [channels]);

  const handleUnsubscribe = useCallback((): void => {
    if (selectedChannels.length === 0) return;
    setConfirmOpen(true);
  }, [selectedChannels.length]);

  const handleOpenTab = useCallback(async () => {
    await openSubscriptionsTab();
    setTimeout(() => {
      checkSubscriptionsTab()
        .then(setTabAvailable)
        .catch(() => {});
    }, 1500);
  }, []);

  const handleConfirmUnsub = useCallback(async () => {
    const found = await checkSubscriptionsTab();
    setTabAvailable(found);
    if (!found) {
      setConfirmOpen(false);
      return;
    }
    setConfirmOpen(false);
    setUnsubErrors([]);
    const ids = selectedChannels.map((c) => c.channelId);
    setUnsubState({
      kind: 'running',
      progress: {
        processed: 0,
        total: Math.min(ids.length, 200),
        ok: 0,
        alreadyUnsubbed: 0,
        unreachable: 0,
        error: 0,
        halted: 0,
      },
    });
    const reply = (await sendMessage({
      action: 'unsub:start',
      data: { channelIds: ids },
    })) as { ok: true } | { ok: false; error: string } | undefined;
    if (reply && reply.ok === false) {
      setUnsubState({ kind: 'error', message: reply.error });
    }
  }, [selectedChannels]);

  const handleCancelUnsub = useCallback(() => {
    if (unsubState.kind === 'paused') {
      setUnsubState({ kind: 'idle' });
      setUnsubErrors([]);
      return;
    }
    void sendMessage({ action: 'unsub:cancel' });
  }, [unsubState.kind]);

  const handleResumeUnsub = useCallback(async () => {
    if (unsubState.kind !== 'paused') return;
    const found = await checkSubscriptionsTab();
    setTabAvailable(found);
    if (!found) return;
    const ids = unsubState.remaining;
    if (ids.length === 0) {
      setUnsubState({ kind: 'idle' });
      return;
    }
    setUnsubErrors([]);
    setUnsubState({
      kind: 'running',
      progress: {
        processed: 0,
        total: Math.min(ids.length, 200),
        ok: 0,
        alreadyUnsubbed: 0,
        unreachable: 0,
        error: 0,
        halted: 0,
      },
    });
    const reply = (await sendMessage({
      action: 'unsub:start',
      data: { channelIds: ids },
    })) as { ok: true } | { ok: false; error: string } | undefined;
    if (reply && reply.ok === false) {
      setUnsubState({ kind: 'error', message: reply.error });
    }
  }, [unsubState]);

  const handleDismissUnsubSummary = useCallback(() => {
    setUnsubState({ kind: 'idle' });
    setUnsubErrors([]);
  }, []);

  const handleStartEnrich = useCallback(async () => {
    const found = await checkSubscriptionsTab();
    setTabAvailable(found);
    if (!found) return;
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
  }, []);

  const handleCancelEnrich = useCallback(() => {
    void sendMessage({ action: 'enrich:cancel' });
  }, []);

  const handleDismissEnrichSummary = useCallback(() => {
    setEnrichState({ kind: 'idle' });
  }, []);

  const onSortChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const [key, dir] = event.target.value.split(':') as [SortKey, 'asc' | 'desc'];
    setSort({ key, dir });
  };

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-row">
          <h1>YouTube Sub Manager</h1>
          <ThemeToggle />
          <span className="stats">
            <strong>{activeChannels.length.toLocaleString()}</strong> channels ·{' '}
            <strong>{enrichedCount.toLocaleString()}</strong> with upload dates ·{' '}
            <strong>{staleCount.toLocaleString()}</strong> inactive ({staleLabel})
          </span>
        </div>
        <div className="toolbar-row">
          <input
            type="search"
            placeholder="Search name or description…"
            value={filter.search}
            onChange={(e) => setFilter({ ...filter, search: e.target.value })}
          />
          <label className="sort-label">
            <span>Sort by:</span>
            <span className="select-wrap">
              <select value={`${sort.key}:${sort.dir}`} onChange={onSortChange}>
                {enrichedCount === 0 ? (
                  <>
                    <optgroup label="Needs activity check">
                      {SORT_OPTIONS.filter((o) => o.value.startsWith('lastUpload:')).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                    {SORT_OPTIONS.filter((o) => !o.value.startsWith('lastUpload:')).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </>
                ) : (
                  SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))
                )}
              </select>
            </span>
          </label>
          <span className="stats">
            Showing <strong>{sorted.length.toLocaleString()}</strong>
          </span>
        </div>
        <div className="toolbar-row">
          <div
            className="stale-control"
            role="group"
            aria-label="Staleness filter"
            aria-disabled={enrichedCount === 0}
            title={enrichedCount === 0 ? 'Run Check for activity to enable this filter' : undefined}
          >
            <span className="stale-prefix">Inactive for ≥</span>
            <div className="stale-presets">
              {STALE_PRESETS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  className={`stale-chip${filter.stalenessDays === p.days ? ' active' : ''}`}
                  onClick={() => setFilter({ ...filter, stalenessDays: p.days })}
                  aria-pressed={filter.stalenessDays === p.days}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <label className="stale-custom">
              <span>Custom:</span>
              <input
                type="number"
                min={0}
                max={36500}
                step={1}
                value={filter.stalenessDays || ''}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setFilter({ ...filter, stalenessDays: Number.isFinite(v) && v >= 0 ? v : 0 });
                }}
                placeholder="days"
                aria-label="Custom inactivity threshold in days"
              />
              <span>days</span>
            </label>
          </div>
          <label
            className="inline"
            aria-disabled={enrichedCount === 0}
            title={enrichedCount === 0 ? 'Run Check for activity to enable this filter' : undefined}
          >
            <input
              type="checkbox"
              checked={filter.onlyEnriched}
              disabled={enrichedCount === 0}
              onChange={(e) => setFilter({ ...filter, onlyEnriched: e.target.checked })}
            />
            Only show channels with upload dates
          </label>
        </div>
      </div>

      <SelectionBar
        selectedCount={selectedCount}
        filteredCount={sorted.length}
        filteredAlreadySelected={filteredAlreadySelected}
        onSelectAllFiltered={handleSelectAllFiltered}
        onClear={handleClearSelection}
        onUnsubscribe={handleUnsubscribe}
      />

      {!tabAvailable && (
        <div className="tab-warning" role="alert">
          <div className="message">
            <div className="headline">YouTube subscriptions page needed</div>
            <div className="body">
              Open your YouTube subscriptions page so the extension can scan and manage your
              channels.
            </div>
          </div>
          <button className="primary" onClick={handleOpenTab}>
            Open YouTube subscriptions
          </button>
        </div>
      )}

      {enrichState.kind === 'enriching' && (
        <div className="enrich-bar running" role="status" aria-live="polite">
          <span className="count">
            Checking activity… <strong>{enrichState.progress.processed.toLocaleString()}</strong> of{' '}
            <strong>{enrichState.progress.total.toLocaleString()}</strong> ·{' '}
            {enrichState.progress.ok} active · {enrichState.progress.noUploads} no videos ·{' '}
            {enrichState.progress.unreachable} couldn&apos;t reach
          </span>
          {enrichState.progress.total > 0 && (
            <div className="enrich-bar-progress">
              <div
                style={{
                  width: `${Math.min(100, (enrichState.progress.processed / enrichState.progress.total) * 100)}%`,
                }}
              />
            </div>
          )}
          <button onClick={handleCancelEnrich}>Stop</button>
        </div>
      )}

      {enrichState.kind === 'complete' && (
        <div className="enrich-bar complete">
          <span className="count">
            Activity check done in {Math.max(1, Math.round(enrichState.durationMs / 1000))}s ·{' '}
            <strong>{enrichState.progress.ok}</strong> active ·{' '}
            <strong>{enrichState.progress.noUploads}</strong> no videos ·{' '}
            <strong>{enrichState.progress.unreachable}</strong> couldn&apos;t reach
          </span>
          <button onClick={handleDismissEnrichSummary}>Dismiss</button>
        </div>
      )}

      {enrichState.kind === 'error' && (
        <div className="enrich-bar error">
          <span className="count">Activity check failed: {enrichState.message}</span>
          <button onClick={handleDismissEnrichSummary}>Dismiss</button>
        </div>
      )}

      {enrichState.kind === 'idle' && channels.length > 0 && enrichedCount === 0 && (
        <div className="enrich-bar cta" role="region" aria-label="Activity check">
          <div className="message">
            <div className="headline">See which channels have gone inactive.</div>
            <div className="body">Unlocks upload dates, staleness filters, and date sorting.</div>
          </div>
          <button className="primary" onClick={handleStartEnrich}>
            Check for activity
          </button>
        </div>
      )}

      {enrichState.kind === 'idle' && enrichedCount > 0 && pendingCount > 0 && (
        <div className="enrich-bar hint">
          <span className="count">
            <strong>{pendingCount.toLocaleString()}</strong> channels unchecked.
          </span>
          <button onClick={handleStartEnrich}>Continue checking</button>
        </div>
      )}

      {unsubState.kind === 'running' && (
        <div className="unsub-bar running" role="status" aria-live="polite">
          <span className="count">
            Unsubscribing… <strong>{unsubState.progress.processed.toLocaleString()}</strong> of{' '}
            <strong>{unsubState.progress.total.toLocaleString()}</strong> · {unsubState.progress.ok}{' '}
            done · {unsubState.progress.alreadyUnsubbed} already unsubscribed ·{' '}
            {unsubState.progress.unreachable} couldn&apos;t reach · {unsubState.progress.error}{' '}
            errors
          </span>
          {unsubState.progress.total > 0 && (
            <div className="unsub-bar-progress">
              <div
                style={{
                  width: `${Math.min(100, (unsubState.progress.processed / unsubState.progress.total) * 100)}%`,
                }}
              />
            </div>
          )}
          <button onClick={handleCancelUnsub}>Stop</button>
        </div>
      )}

      {unsubState.kind === 'paused' && (
        <div className="unsub-bar paused" role="alert">
          <div className="unsub-bar-content">
            <span className="count">
              Unsubscribe paused — YouTube tab was closed.{' '}
              <strong>{unsubState.progress.ok}</strong> unsubscribed so far ·{' '}
              <strong>{unsubState.remaining.length}</strong> remaining. Open the YouTube
              subscriptions tab and resume to continue.
            </span>
          </div>
          <button className="primary" onClick={handleResumeUnsub}>
            Resume
          </button>
          <button onClick={handleCancelUnsub}>Dismiss</button>
        </div>
      )}

      {unsubState.kind === 'complete' && (
        <div className="unsub-bar complete">
          <div className="unsub-bar-content">
            <span className="count">
              Done in {Math.max(1, Math.round(unsubState.durationMs / 1000))}s ·{' '}
              <strong>{unsubState.progress.ok}</strong> unsubscribed ·{' '}
              <strong>{unsubState.progress.alreadyUnsubbed}</strong> were already unsubscribed ·{' '}
              <strong>{unsubState.progress.unreachable}</strong> couldn&apos;t reach ·{' '}
              <strong>{unsubState.progress.error + unsubState.progress.halted}</strong> errors
              {unsubState.remaining.length > 0 && (
                <>
                  {' '}
                  · <strong>{unsubState.remaining.length}</strong> still left — run again to finish
                  them
                </>
              )}
            </span>
            {unsubErrors.length > 0 && (
              <details className="unsub-errors">
                <summary>{unsubErrors.length} failed — click for details</summary>
                <ul>
                  {unsubErrors.map((e, i) => (
                    <li key={i}>
                      <strong>{e.channelName}</strong>: {e.detail}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <button onClick={handleDismissUnsubSummary}>Dismiss</button>
        </div>
      )}

      {unsubState.kind === 'error' && (
        <div className="unsub-bar error">
          <span className="count">Unsubscribe failed: {unsubState.message}</span>
          <button onClick={handleDismissUnsubSummary}>Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="empty">
          <h2>Loading…</h2>
        </div>
      ) : activeChannels.length === 0 ? (
        <div className="empty">
          <h2>No channels yet.</h2>
          <p>Tap “Scan my subscriptions” in the extension popup.</p>
        </div>
      ) : (
        <ChannelTable
          rows={sorted}
          staleAtDays={Math.max(365, filter.stalenessDays)}
          onToggleSelect={handleToggleSelect}
          filter={filter}
          stalenessAmountLabel={STALENESS_LABEL(filter.stalenessDays)}
          enrichmentEmpty={enrichedCount === 0}
          onStartEnrich={handleStartEnrich}
        />
      )}

      <BackupSection />

      <ConfirmDialog
        open={confirmOpen}
        selectedChannels={selectedChannels}
        onConfirm={handleConfirmUnsub}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
