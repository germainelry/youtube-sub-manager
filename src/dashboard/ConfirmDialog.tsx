import { useEffect, useState } from 'react';
import type { Channel } from '../shared/types';

const PER_CHANNEL_ESTIMATE_S = 5.5;
const BATCH_CAP = 200;

interface Props {
  open: boolean;
  selectedChannels: Channel[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  selectedChannels,
  onConfirm,
  onCancel,
}: Props): JSX.Element | null {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  if (!open) return null;

  const total = selectedChannels.length;
  const sample = selectedChannels.slice(0, 5);
  const overflow = total - sample.length;
  const willProcess = Math.min(total, BATCH_CAP);
  const willDefer = total - willProcess;
  const estSecs = Math.round(willProcess * PER_CHANNEL_ESTIMATE_S);
  const estMin = Math.max(1, Math.round(estSecs / 60));
  const canConfirm = typed.trim().toUpperCase() === 'UNSUB';

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsub-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal">
        <h2 id="unsub-dialog-title">
          Unsubscribe {total.toLocaleString()} channel{total === 1 ? '' : 's'}?
        </h2>
        <p className="modal-summary">
          {willDefer > 0 ? (
            <>
              Processing <strong>{willProcess}</strong> now; <strong>{willDefer}</strong> queued for
              next batch. ~{estMin} min.
            </>
          ) : (
            <>
              ~{estMin} min{estMin === 1 ? '' : 's'}. Subscriptions are backed up first.
            </>
          )}
        </p>
        <ul className="modal-samples">
          {sample.map((c) => (
            <li key={c.channelId}>
              {c.avatarUrl ? (
                <img src={c.avatarUrl} alt="" />
              ) : (
                <span className="avatar-placeholder" aria-hidden="true" />
              )}
              <span className="name">{c.name}</span>
            </li>
          ))}
          {overflow > 0 && <li className="overflow">… and {overflow.toLocaleString()} more</li>}
        </ul>
        <label className="confirm-input">
          <span>
            Type <strong>UNSUB</strong> to confirm:
          </span>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            placeholder="UNSUB"
          />
        </label>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm} disabled={!canConfirm}>
            Start unsubscribe
          </button>
        </div>
      </div>
    </div>
  );
}
