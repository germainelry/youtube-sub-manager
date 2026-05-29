import { describe, expect, it } from 'vitest';
import {
  applyFilter,
  applySort,
  daysSinceUpload,
  formatUploadLabel,
  isStale,
} from '../src/dashboard/filter';
import type { Channel } from '../src/shared/types';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    channelId: 'UC_dummy_____________ZZ',
    name: 'Dummy',
    url: 'https://www.youtube.com/channel/UC_dummy_____________ZZ',
    extractedAt: NOW,
    ...overrides,
  };
}

describe('daysSinceUpload', () => {
  it('returns undefined when lastUploadAt is missing', () => {
    expect(daysSinceUpload(undefined, NOW)).toBeUndefined();
  });

  it('returns the floor of (now - lastUpload) in days', () => {
    expect(daysSinceUpload(NOW - 10 * DAY, NOW)).toBe(10);
    expect(daysSinceUpload(NOW - 0.5 * DAY, NOW)).toBe(0);
  });
});

describe('isStale', () => {
  it('returns true for thresholdDays <= 0 (no filter)', () => {
    const c = makeChannel({ lastUploadAt: NOW });
    expect(isStale(c, 0, NOW)).toBe(true);
  });

  it('returns false when never enriched', () => {
    expect(isStale(makeChannel({ lastUploadAt: undefined }), 30, NOW)).toBe(false);
  });

  it('returns true past the threshold', () => {
    expect(isStale(makeChannel({ lastUploadAt: NOW - 45 * DAY }), 30, NOW)).toBe(true);
  });

  it('returns false before the threshold', () => {
    expect(isStale(makeChannel({ lastUploadAt: NOW - 10 * DAY }), 30, NOW)).toBe(false);
  });
});

describe('applyFilter', () => {
  const channels: Channel[] = [
    makeChannel({ channelId: 'a', name: 'Cooking with Alice', description: 'recipes' }),
    makeChannel({
      channelId: 'b',
      name: 'Dead Channel',
      lastUploadAt: NOW - 800 * DAY,
      enrichedAt: NOW - DAY,
    }),
    makeChannel({
      channelId: 'c',
      name: 'Fresh Channel',
      lastUploadAt: NOW - 5 * DAY,
      enrichedAt: NOW - DAY,
    }),
    makeChannel({ channelId: 'd', name: 'Never Enriched' }),
  ];

  it('matches search against name and description', () => {
    const out = applyFilter(channels, {
      search: 'recipes',
      stalenessDays: 0,
      onlyEnriched: false,
    });
    expect(out.map((c) => c.channelId)).toEqual(['a']);
  });

  it('filters by staleness threshold', () => {
    const out = applyFilter(
      channels,
      { search: '', stalenessDays: 180, onlyEnriched: false },
      NOW,
    );
    expect(out.map((c) => c.channelId)).toEqual(['b']);
  });

  it('hides un-enriched rows when onlyEnriched is true', () => {
    const out = applyFilter(channels, {
      search: '',
      stalenessDays: 0,
      onlyEnriched: true,
    });
    expect(out.map((c) => c.channelId).sort()).toEqual(['b', 'c']);
  });

  it('hides channels with unsubscribedAt set regardless of other filters', () => {
    const rows: Channel[] = [
      ...channels,
      makeChannel({ channelId: 'e', name: 'Already Unsubbed', unsubscribedAt: NOW - DAY }),
    ];
    const out = applyFilter(rows, { search: '', stalenessDays: 0, onlyEnriched: false }, NOW);
    expect(out.map((c) => c.channelId)).not.toContain('e');
  });
});

describe('applySort', () => {
  const channels: Channel[] = [
    makeChannel({ channelId: 'a', name: 'Beta', subscriberCountRaw: 5000, lastUploadAt: NOW - 100 * DAY }),
    makeChannel({ channelId: 'b', name: 'Alpha', subscriberCountRaw: 1000, lastUploadAt: NOW - 10 * DAY }),
    makeChannel({ channelId: 'c', name: 'Gamma', subscriberCountRaw: 9000 }),
  ];

  it('sorts by lastUpload ascending with undefined at the end', () => {
    const out = applySort(channels, { key: 'lastUpload', dir: 'asc' });
    expect(out.map((c) => c.channelId)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by lastUpload descending with undefined at the end', () => {
    const out = applySort(channels, { key: 'lastUpload', dir: 'desc' });
    expect(out.map((c) => c.channelId)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by name', () => {
    const out = applySort(channels, { key: 'name', dir: 'asc' });
    expect(out.map((c) => c.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('sorts by subscriberCount descending', () => {
    const out = applySort(channels, { key: 'subscriberCount', dir: 'desc' });
    expect(out.map((c) => c.channelId)).toEqual(['c', 'a', 'b']);
  });

  it('uses thenBy to break ties on primary key', () => {
    const tied: Channel[] = [
      makeChannel({ channelId: 'x', name: 'X', subscriberCountRaw: 500, lastUploadAt: NOW - 90 * DAY }),
      makeChannel({ channelId: 'y', name: 'Y', subscriberCountRaw: 100, lastUploadAt: NOW - 90 * DAY }),
      makeChannel({ channelId: 'z', name: 'Z', subscriberCountRaw: 300, lastUploadAt: NOW - 90 * DAY }),
    ];
    const out = applySort(tied, {
      key: 'lastUpload',
      dir: 'asc',
      thenBy: { key: 'subscriberCount', dir: 'asc' },
    });
    expect(out.map((c) => c.channelId)).toEqual(['y', 'z', 'x']);
  });

  it('ignores thenBy when primary key resolves order', () => {
    const out = applySort(channels, {
      key: 'lastUpload',
      dir: 'asc',
      thenBy: { key: 'subscriberCount', dir: 'asc' },
    });
    expect(out.map((c) => c.channelId)).toEqual(['a', 'b', 'c']);
  });

  it('sub-sorts undefined lastUpload channels by thenBy key', () => {
    const mixed: Channel[] = [
      makeChannel({ channelId: 'p', name: 'P', subscriberCountRaw: 800 }),
      makeChannel({ channelId: 'q', name: 'Q', subscriberCountRaw: 200 }),
      makeChannel({ channelId: 'r', name: 'R', subscriberCountRaw: 5000, lastUploadAt: NOW - 30 * DAY }),
    ];
    const out = applySort(mixed, {
      key: 'lastUpload',
      dir: 'asc',
      thenBy: { key: 'subscriberCount', dir: 'asc' },
    });
    expect(out.map((c) => c.channelId)).toEqual(['r', 'q', 'p']);
  });
});

describe('formatUploadLabel', () => {
  it('renders relative time with stale variant past the threshold', () => {
    const c = makeChannel({ lastUploadAt: NOW - 400 * DAY });
    const out = formatUploadLabel(c, 365, NOW);
    expect(out.variant).toBe('stale');
    expect(out.label).toMatch(/y ago/);
  });

  it('renders normal variant inside the fresh window', () => {
    const c = makeChannel({ lastUploadAt: NOW - 3 * DAY });
    const out = formatUploadLabel(c, 365, NOW);
    expect(out.variant).toBe('normal');
  });

  it('renders "no videos posted" for that status', () => {
    expect(formatUploadLabel(makeChannel({ enrichmentStatus: 'no-uploads' })).label).toBe(
      'no videos posted',
    );
  });

  it('renders "couldn\'t check" for that status', () => {
    expect(formatUploadLabel(makeChannel({ enrichmentStatus: 'unreachable' })).label).toBe(
      "couldn't check",
    );
  });

  it('renders "not checked yet" when status is missing', () => {
    expect(formatUploadLabel(makeChannel()).label).toBe('not checked yet');
  });
});
