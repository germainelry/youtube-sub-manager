export interface Channel {
  channelId: string;
  name: string;
  url: string;
  avatarUrl?: string;
  subscriberCountText?: string;
  subscriberCountRaw?: number;
  description?: string;
  extractedAt: number;

  resolvedUcid?: string;
  lastUploadAt?: number;
  videoCount?: number;
  enrichedAt?: number;
  enrichmentStatus?: EnrichmentStatus;

  pendingUnsub?: boolean;
  unsubscribedAt?: number;
}

export type EnrichmentStatus = 'pending' | 'ok' | 'no-uploads' | 'unreachable';

export interface ExtractionRun {
  id?: number;
  startedAt: number;
  completedAt?: number;
  channelCount: number;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  errorMessage?: string;
}

export interface ExtractionProgress {
  loaded: number;
  total?: number;
  current?: string;
  phase?: 'scrolling' | 'parsing' | 'setup';
}

export interface EnrichmentProgress {
  processed: number;
  total: number;
  ok: number;
  noUploads: number;
  unreachable: number;
  current?: string;
}

export interface EnrichmentTarget {
  channelId: string;
  resolvedUcid?: string;
}

export interface EnrichmentResult {
  channelId: string;
  resolvedUcid?: string;
  lastUploadAt?: number;
  videoCount?: number;
  enrichmentStatus: EnrichmentStatus;
}

export interface BackupRow {
  id?: number;
  createdAt: number;
  channelCount: number;
  plannedUnsubIds: string[];
  payload: Channel[];
}

export type UnsubOutcome = 'ok' | 'already-unsubbed' | 'unreachable' | 'error' | 'halted';

export interface UnsubResult {
  channelId: string;
  outcome: UnsubOutcome;
  detail?: string;
  attemptedAt: number;
}

export interface UnsubTarget {
  channelId: string;
  name: string;
}

export interface UnsubProgress {
  processed: number;
  total: number;
  ok: number;
  alreadyUnsubbed: number;
  unreachable: number;
  error: number;
  halted: number;
  current?: string;
}

export interface UnsubLogRow {
  id?: number;
  batchId: string;
  channelId: string;
  channelName?: string;
  outcome: UnsubOutcome;
  detail?: string;
  attemptedAt: number;
}
