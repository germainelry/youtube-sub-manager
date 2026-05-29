import type {
  Channel,
  EnrichmentProgress,
  EnrichmentResult,
  EnrichmentTarget,
  ExtractionProgress,
  UnsubProgress,
  UnsubResult,
  UnsubTarget,
} from './types';

export type Message =
  | { action: 'extract:start' }
  | { action: 'extract:progress'; data: { channels: Channel[]; progress: ExtractionProgress } }
  | {
      action: 'extract:complete';
      data: { total: number; runId?: number; durationMs: number };
    }
  | { action: 'extract:error'; data: { message: string } }
  | { action: 'extract:cancel' }
  | { action: 'extract:status' }
  | {
      action: 'extract:status:reply';
      data: { running: boolean; progress?: ExtractionProgress };
    }
  | { action: 'enrich:start' }
  | { action: 'enrich:run'; data: { targets: EnrichmentTarget[] } }
  | {
      action: 'enrich:progress';
      data: { results: EnrichmentResult[]; progress: EnrichmentProgress };
    }
  | { action: 'enrich:complete'; data: { progress: EnrichmentProgress; durationMs: number } }
  | { action: 'enrich:error'; data: { message: string } }
  | { action: 'enrich:cancel' }
  | { action: 'enrich:status' }
  | {
      action: 'enrich:status:reply';
      data: { running: boolean; progress?: EnrichmentProgress; pendingCount: number };
    }
  | { action: 'unsub:start'; data: { channelIds: string[] } }
  | { action: 'unsub:batch'; data: { batchId: string; targets: UnsubTarget[] } }
  | {
      action: 'unsub:progress';
      data: { result?: UnsubResult; progress: UnsubProgress };
    }
  | {
      action: 'unsub:complete';
      data: { progress: UnsubProgress; durationMs: number; remaining: string[] };
    }
  | { action: 'unsub:error'; data: { message: string } }
  | { action: 'unsub:paused'; data: { progress: UnsubProgress; remaining: string[] } }
  | { action: 'unsub:cancel' }
  | { action: 'unsub:status' }
  | {
      action: 'unsub:status:reply';
      data: { running: boolean; progress?: UnsubProgress };
    }
  | { action: 'dashboard:open' }
  | { action: 'export:csv' }
  | { action: 'export:json' }
  | { action: 'ping' }
  | { action: 'tab:check' }
  | { action: 'tab:check:reply'; data: { found: boolean } }
  | { action: 'tab:open-subscriptions' }
  | { action: 'clear:data' };

export type MessageAction = Message['action'];

export type MessageOf<A extends MessageAction> = Extract<Message, { action: A }>;

export const KEEPALIVE_PORT = 'yt-cleanup-keepalive';
