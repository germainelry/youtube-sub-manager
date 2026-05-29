import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import type { Channel } from '../shared/types';
import { formatUploadLabel, type FilterState } from './filter';

const ROW_HEIGHT = 56;

interface Props {
  rows: Channel[];
  staleAtDays: number;
  onToggleSelect: (channelId: string) => void;
  filter: FilterState;
  stalenessAmountLabel: string;
  enrichmentEmpty: boolean;
  onStartEnrich: () => void;
}

export function ChannelTable({
  rows,
  staleAtDays,
  onToggleSelect,
  filter,
  stalenessAmountLabel,
  enrichmentEmpty,
  onStartEnrich,
}: Props): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  if (rows.length === 0) {
    const activeFilters: string[] = [];
    if (filter.search.trim()) activeFilters.push(`Search: “${filter.search.trim()}”`);
    if (filter.stalenessDays > 0) activeFilters.push(`Inactive for ≥ ${stalenessAmountLabel}`);
    if (filter.onlyEnriched) activeFilters.push('Only with upload dates');

    const uploadFilterActive = filter.stalenessDays > 0 || filter.onlyEnriched;
    const blockedByEnrichment = enrichmentEmpty && uploadFilterActive;

    return (
      <div className="table-scroll">
        <div className="empty">
          {activeFilters.length > 0 ? (
            <>
              <h2>No channels match these filters:</h2>
              <ul className="empty-filters">
                {activeFilters.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {blockedByEnrichment ? (
                <>
                  <p>These filters need upload-date information.</p>
                  <button type="button" className="empty-cta" onClick={onStartEnrich}>
                    Check for activity
                  </button>
                </>
              ) : (
                <p>Try adjusting or clearing filters.</p>
              )}
            </>
          ) : (
            <>
              <h2>No channels match your filter.</h2>
              <p>Adjust filters or clear search.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="table-scroll" ref={parentRef}>
      <div className="table-header">
        <span></span>
        <span></span>
        <span>Channel</span>
        <span>Subscribers</span>
        <span>
          Last upload
          {enrichmentEmpty && <span className="header-hint">{'→'} Requires activity check</span>}
        </span>
        <span></span>
      </div>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const channel = rows[vi.index];
          if (!channel) return null;
          const upload = formatUploadLabel(channel, staleAtDays);
          const selected = Boolean(channel.pendingUnsub);
          return (
            <div
              key={channel.channelId}
              className={`row${selected ? ' selected' : ''}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: `${vi.size}px`,
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(channel.channelId)}
                aria-label={`Mark ${channel.name} for unsubscribe`}
              />
              {channel.avatarUrl ? (
                <img className="avatar" src={channel.avatarUrl} alt="" loading="lazy" />
              ) : (
                <div className="avatar" />
              )}
              <div className="name-col">
                <div className="name">{channel.name}</div>
                {channel.description && <div className="description">{channel.description}</div>}
              </div>
              <div className="subs">
                {channel.subscriberCountText ?? channel.subscriberCountRaw?.toLocaleString() ?? '—'}
              </div>
              <div className={`upload ${upload.variant === 'normal' ? '' : upload.variant}`}>
                {upload.label}
              </div>
              <a className="open" href={channel.url} target="_blank" rel="noreferrer">
                Open ↗
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
