import { useEffect, useState } from 'react';
import { listBackups } from '../shared/backup';
import { triggerDownload } from '../shared/export';
import type { BackupRow } from '../shared/types';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function fileTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function handleDownload(backup: BackupRow): Promise<void> {
  const data = {
    backupId: backup.id,
    createdAt: new Date(backup.createdAt).toISOString(),
    channelCount: backup.channelCount,
    plannedUnsubIds: backup.plannedUnsubIds,
    channels: backup.payload,
  };
  const json = JSON.stringify(data, null, 2);
  await triggerDownload(
    json,
    `yt-backup-${fileTimestamp(backup.createdAt)}.json`,
    'application/json',
  );
}

export function BackupSection(): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [backups, setBackups] = useState<BackupRow[] | null>(null);

  useEffect(() => {
    if (expanded && backups === null) {
      listBackups()
        .then(setBackups)
        .catch(() => setBackups([]));
    }
  }, [expanded, backups]);

  useEffect(() => {
    const onMessage = (raw: unknown): void => {
      const msg = raw as { action?: string };
      if (msg.action === 'backup:created') {
        listBackups()
          .then(setBackups)
          .catch(() => setBackups([]));
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  return (
    <div className="backup-section">
      <button
        className="backup-toggle"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="backup-toggle-icon">{expanded ? '▾' : '▸'}</span>
        Backups
        {backups !== null && <span className="backup-count">({backups.length})</span>}
      </button>

      {expanded &&
        (backups === null ? (
          <div className="backup-empty">Loading backups…</div>
        ) : backups.length === 0 ? (
          <div className="backup-empty">
            No backups yet &mdash; backups are created automatically before unsubscribing.
          </div>
        ) : (
          <ul className="backup-list">
            {backups.map((b) => (
              <li key={b.id} className="backup-row">
                <span className="backup-date">{dateFmt.format(b.createdAt)}</span>
                <span className="backup-meta">
                  {b.channelCount.toLocaleString()} channels &middot;{' '}
                  {b.plannedUnsubIds.length.toLocaleString()} marked for unsub
                </span>
                <button className="backup-download" onClick={() => void handleDownload(b)}>
                  Download
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
