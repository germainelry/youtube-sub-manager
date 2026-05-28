import type { Channel } from './types';

const CSV_COLUMNS: Array<{ header: string; pick: (c: Channel) => string | number | undefined }> = [
  { header: 'Channel Name', pick: (c) => c.name },
  { header: 'URL', pick: (c) => c.url },
  { header: 'Channel ID', pick: (c) => c.channelId },
  { header: 'Resolved UCID', pick: (c) => c.resolvedUcid },
  { header: 'Subscriber Count', pick: (c) => c.subscriberCountText ?? c.subscriberCountRaw },
  { header: 'Video Count', pick: (c) => c.videoCount },
  {
    header: 'Last Upload Date',
    pick: (c) => (c.lastUploadAt ? new Date(c.lastUploadAt).toISOString() : undefined),
  },
  {
    header: 'Days Since Upload',
    pick: (c) =>
      c.lastUploadAt ? Math.floor((Date.now() - c.lastUploadAt) / 86_400_000) : undefined,
  },
  { header: 'Enrichment Status', pick: (c) => c.enrichmentStatus },
  { header: 'Description', pick: (c) => c.description?.slice(0, 200) },
];

function csvEscape(v: string | number | undefined): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const UTF8_BOM = '﻿';

export function toCSV(channels: Channel[]): string {
  const header = CSV_COLUMNS.map((c) => c.header).join(',');
  const rows = channels.map((c) => CSV_COLUMNS.map((col) => csvEscape(col.pick(c))).join(','));
  return UTF8_BOM + [header, ...rows].join('\r\n');
}

export function toJSON(channels: Channel[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), channels }, null, 2);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function triggerDownload(
  content: string,
  filename: string,
  mime: string,
): Promise<void> {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export async function downloadCSV(channels: Channel[]): Promise<string> {
  const filename = `youtube-subscriptions-${timestamp()}.csv`;
  await triggerDownload(toCSV(channels), filename, 'text/csv');
  return filename;
}

export async function downloadJSON(channels: Channel[]): Promise<string> {
  const filename = `youtube-subscriptions-${timestamp()}.json`;
  await triggerDownload(toJSON(channels), filename, 'application/json');
  return filename;
}
