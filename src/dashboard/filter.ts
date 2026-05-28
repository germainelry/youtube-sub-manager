import type { Channel } from '../shared/types';

const DAY_MS = 86_400_000;

export interface FilterState {
  search: string;
  stalenessDays: number;
  onlyEnriched: boolean;
}

export type SortKey = 'lastUpload' | 'name' | 'subscriberCount';
export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export function daysSinceUpload(
  lastUploadAt: number | undefined,
  now = Date.now(),
): number | undefined {
  if (!lastUploadAt) return undefined;
  return Math.floor((now - lastUploadAt) / DAY_MS);
}

export function isStale(channel: Channel, thresholdDays: number, now = Date.now()): boolean {
  if (thresholdDays <= 0) return true;
  const days = daysSinceUpload(channel.lastUploadAt, now);
  if (days === undefined) return false;
  return days >= thresholdDays;
}

export function applyFilter(
  channels: Channel[],
  filter: FilterState,
  now: number = Date.now(),
): Channel[] {
  const needle = filter.search.trim().toLowerCase();
  return channels.filter((c) => {
    if (c.unsubscribedAt) return false;
    if (filter.onlyEnriched && !c.enrichedAt) return false;
    if (filter.stalenessDays > 0 && !isStale(c, filter.stalenessDays, now)) return false;
    if (needle) {
      const haystack = `${c.name} ${c.description ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function applySort(channels: Channel[], sort: SortState): Channel[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const sorted = [...channels];
  switch (sort.key) {
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name) * dir);
      break;
    case 'subscriberCount':
      sorted.sort((a, b) => {
        const av = a.subscriberCountRaw ?? -1;
        const bv = b.subscriberCountRaw ?? -1;
        return (av - bv) * dir;
      });
      break;
    case 'lastUpload':
    default:
      sorted.sort((a, b) => {
        const av = a.lastUploadAt;
        const bv = b.lastUploadAt;
        if (av === undefined && bv === undefined) return 0;
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        return (av - bv) * dir;
      });
      break;
  }
  return sorted;
}

export interface UploadLabel {
  label: string;
  variant: 'normal' | 'stale' | 'muted';
}

export function formatUploadLabel(
  channel: Channel,
  staleAtDays = 365,
  now: number = Date.now(),
): UploadLabel {
  const days = daysSinceUpload(channel.lastUploadAt, now);
  if (days !== undefined) {
    const text = formatRelativeDays(days);
    return { label: text, variant: days >= staleAtDays ? 'stale' : 'normal' };
  }
  switch (channel.enrichmentStatus) {
    case 'no-uploads':
      return { label: 'no videos posted', variant: 'muted' };
    case 'unreachable':
      return { label: "couldn't check", variant: 'muted' };
    case 'pending':
      return { label: 'checking…', variant: 'muted' };
    default:
      return { label: 'not checked yet', variant: 'muted' };
  }
}

function formatRelativeDays(days: number): string {
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  const years = days / 365;
  return years < 2 ? `${years.toFixed(1)}y ago` : `${Math.floor(years)}y ago`;
}
