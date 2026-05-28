import type { UnsubOutcome, UnsubProgress, UnsubResult, UnsubTarget } from '../shared/types';
import {
  removeOverlay,
  setOverlayComplete,
  setOverlayError,
  showOverlay,
  updateOverlay,
} from './progress-overlay';
import { autoScrollSubscriptionsFeed } from './scroll';
import { SELECTORS } from './selectors';

const SUBSCRIPTIONS_PATH = '/feed/channels';

const BASE_DELAY_MS = 1500;
const JITTER_MS = 500;
const LONG_BREAK_EVERY = 50;
const LONG_BREAK_MIN_MS = 5000;
const LONG_BREAK_MAX_MS = 10000;
const CONSECUTIVE_ERROR_HALT = 2;

const MENU_TIMEOUT_MS = 3000;
const DIALOG_TIMEOUT_MS = 3000;
const STATE_REVERT_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 150;

const CAPTCHA_HINTS = [
  "verify that you're not a robot",
  "verify it's you",
  'unusual traffic',
  'unusual activity',
  'recaptcha',
];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isVisible(el: Element | null | undefined): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.offsetParent === null) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

async function waitFor<T>(fn: () => T | null | undefined, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

function detectCaptcha(): boolean {
  const text = document.body?.textContent?.toLowerCase() ?? '';
  return CAPTCHA_HINTS.some((hint) => text.includes(hint));
}

type SubscribeState = 'subscribed' | 'subscribe';

function matchesState(el: HTMLElement, state: SubscribeState): boolean {
  const label = (el.getAttribute('aria-label') ?? '').toLowerCase();
  const text = (el.textContent ?? '').trim().toLowerCase();
  if (state === 'subscribed') {
    return (
      label.startsWith('unsubscribe from') ||
      label.startsWith('subscribed to') ||
      /\bsubscribed\b/.test(text)
    );
  }
  return (
    (label.startsWith('subscribe to') && !label.includes('unsubscribe')) || text === 'subscribe'
  );
}

function findButtonInCard(card: Element, state: SubscribeState): HTMLElement | null {
  const selectors = [
    'ytd-subscribe-button-renderer button',
    'tp-yt-paper-button#subscribe-button',
    'yt-subscribe-button-view-model button',
    '#subscribe-button button',
    'button[aria-label*="ubscrib" i]',
  ];
  for (const sel of selectors) {
    const candidates = card.querySelectorAll<HTMLElement>(sel);
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      if (matchesState(el, state)) return el;
    }
  }
  return null;
}

function findUnsubscribeMenuItem(): HTMLElement | null {
  const selectors = [
    'tp-yt-paper-item',
    'ytd-menu-service-item-renderer',
    'yt-list-item-view-model',
    'a[role="menuitem"]',
    'button[role="menuitem"]',
    'yt-formatted-string',
    'span',
  ];
  for (const sel of selectors) {
    const items = document.querySelectorAll<HTMLElement>(sel);
    for (const item of items) {
      if (!isVisible(item)) continue;
      const text = (item.textContent ?? '').trim().toLowerCase();
      if (text === 'unsubscribe' || text.startsWith('unsubscribe ')) {
        return item;
      }
    }
  }
  return null;
}

function findConfirmButton(): HTMLElement | null {
  const dialogSelectors = [
    'tp-yt-paper-dialog',
    'ytd-confirm-dialog-renderer',
    'yt-confirm-dialog-renderer',
    '[role="dialog"]',
  ];
  for (const dialogSel of dialogSelectors) {
    const dialogs = document.querySelectorAll<HTMLElement>(dialogSel);
    for (const dialog of dialogs) {
      if (!isVisible(dialog)) continue;
      const idMatch = dialog.querySelector<HTMLElement>(
        'tp-yt-paper-button#confirm-button, yt-button-renderer#confirm-button button, #confirm-button button',
      );
      if (idMatch && isVisible(idMatch)) return idMatch;
      const buttons = dialog.querySelectorAll<HTMLElement>('button, tp-yt-paper-button');
      for (const btn of buttons) {
        if (!isVisible(btn)) continue;
        const text = (btn.textContent ?? '').trim().toLowerCase();
        if (text === 'unsubscribe' || text === 'confirm' || text === 'ok') {
          return btn;
        }
      }
    }
  }
  return null;
}

function findCardForChannelId(channelId: string): HTMLElement | null {
  const cards = document.querySelectorAll<HTMLElement>(SELECTORS.channelCard);
  const lower = channelId.toLowerCase();
  for (const card of cards) {
    const link = card.querySelector<HTMLAnchorElement>(SELECTORS.channelLink);
    if (!link) continue;
    const href = (link.getAttribute('href') ?? '').toLowerCase();
    if (
      href.endsWith(`/${lower}`) ||
      href.endsWith(`/channel/${lower}`) ||
      href.includes(`/${lower}?`) ||
      href === `/${lower}` ||
      href.endsWith(lower)
    ) {
      return card;
    }
  }
  return null;
}

interface UnsubAttempt {
  outcome: UnsubOutcome;
  detail?: string;
}

async function unsubCard(card: HTMLElement): Promise<UnsubAttempt> {
  const subscribed = findButtonInCard(card, 'subscribed');
  if (!subscribed) {
    if (findButtonInCard(card, 'subscribe')) {
      return { outcome: 'already-unsubbed' };
    }
    return { outcome: 'unreachable', detail: 'No subscribe button found on card.' };
  }

  subscribed.click();

  const menuItem = await waitFor(findUnsubscribeMenuItem, MENU_TIMEOUT_MS);
  if (!menuItem) {
    return {
      outcome: 'error',
      detail: "Unsubscribe option didn't appear after clicking Subscribed.",
    };
  }
  menuItem.click();

  const confirmBtn = await waitFor(findConfirmButton, DIALOG_TIMEOUT_MS);
  if (!confirmBtn) {
    return { outcome: 'error', detail: 'Confirmation dialog did not appear.' };
  }

  if (detectCaptcha()) {
    return { outcome: 'halted', detail: 'Captcha appeared after menu click.' };
  }

  confirmBtn.click();

  const flipped = await waitFor(() => {
    if (!document.contains(card)) return 'detached';
    if (findButtonInCard(card, 'subscribe')) return 'flipped';
    return null;
  }, STATE_REVERT_TIMEOUT_MS);

  if (!flipped) {
    return {
      outcome: 'ok',
      detail: "Confirmed, but button state didn't update.",
    };
  }
  return { outcome: 'ok' };
}

export interface UnsubBatchOptions {
  batchId: string;
  targets: UnsubTarget[];
  onResult: (result: UnsubResult, progress: UnsubProgress) => void | Promise<void>;
  shouldCancel: () => boolean;
}

export interface UnsubBatchOutcome {
  progress: UnsubProgress;
  remaining: string[];
}

export async function unsubBatchOnPage(options: UnsubBatchOptions): Promise<UnsubBatchOutcome> {
  if (!location.pathname.startsWith(SUBSCRIPTIONS_PATH)) {
    throw new Error(
      `unsubBatchOnPage requires ${SUBSCRIPTIONS_PATH}; current path is ${location.pathname}.`,
    );
  }

  const total = options.targets.length;
  const progress: UnsubProgress = {
    processed: 0,
    total,
    ok: 0,
    alreadyUnsubbed: 0,
    unreachable: 0,
    error: 0,
    halted: 0,
  };
  const remaining: string[] = [];

  const start = Date.now();
  await showOverlay('Unsubscribing');
  updateOverlay(total, 'Loading page…');

  try {
    const allCardsLoaded = options.targets.every((t) => findCardForChannelId(t.channelId) !== null);

    if (!allCardsLoaded) {
      await autoScrollSubscriptionsFeed((tick) => {
        updateOverlay(total, tick.isLoading ? 'Loading more…' : 'Scrolling…');
      });
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(200);

    let consecutiveErrors = 0;
    let okSinceBreak = 0;

    for (let i = 0; i < options.targets.length; i++) {
      const target = options.targets[i];
      if (!target) continue;

      if (options.shouldCancel()) {
        for (let j = i; j < options.targets.length; j++) {
          const t = options.targets[j];
          if (t) remaining.push(t.channelId);
        }
        break;
      }

      let result: UnsubResult;
      const card = findCardForChannelId(target.channelId);

      if (!card) {
        result = {
          channelId: target.channelId,
          outcome: 'unreachable',
          detail: 'Card not present in /feed/channels DOM.',
          attemptedAt: Date.now(),
        };
      } else if (detectCaptcha()) {
        result = {
          channelId: target.channelId,
          outcome: 'halted',
          detail: 'Captcha or verification prompt detected before click.',
          attemptedAt: Date.now(),
        };
      } else {
        card.scrollIntoView({ block: 'center', behavior: 'auto' });
        await sleep(150);
        const attempt = await unsubCard(card);
        result = {
          channelId: target.channelId,
          outcome: attempt.outcome,
          detail: attempt.detail,
          attemptedAt: Date.now(),
        };
      }

      progress.processed++;
      progress.current = target.name;
      switch (result.outcome) {
        case 'ok':
          progress.ok++;
          break;
        case 'already-unsubbed':
          progress.alreadyUnsubbed++;
          break;
        case 'unreachable':
          progress.unreachable++;
          break;
        case 'error':
          progress.error++;
          break;
        case 'halted':
          progress.halted++;
          break;
      }

      updateOverlay(
        progress.processed,
        `${progress.ok} ok · ${progress.alreadyUnsubbed} already · ${progress.unreachable} skip · ${progress.error + progress.halted} err`,
        total,
      );

      await options.onResult(result, { ...progress });

      if (result.outcome === 'halted') {
        for (let j = i + 1; j < options.targets.length; j++) {
          const t = options.targets[j];
          if (t) remaining.push(t.channelId);
        }
        break;
      }

      if (result.outcome === 'error') {
        consecutiveErrors++;
        if (consecutiveErrors >= CONSECUTIVE_ERROR_HALT) {
          for (let j = i + 1; j < options.targets.length; j++) {
            const t = options.targets[j];
            if (t) remaining.push(t.channelId);
          }
          break;
        }
      } else {
        consecutiveErrors = 0;
      }

      if (result.outcome === 'ok') {
        okSinceBreak++;
        if (okSinceBreak >= LONG_BREAK_EVERY) {
          okSinceBreak = 0;
          await sleep(LONG_BREAK_MIN_MS + Math.random() * (LONG_BREAK_MAX_MS - LONG_BREAK_MIN_MS));
        }
      }
      const jitter = (Math.random() * 2 - 1) * JITTER_MS;
      await sleep(BASE_DELAY_MS + jitter);
    }

    setOverlayComplete(progress.processed, Date.now() - start);
    return { progress, remaining };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setOverlayError(msg);
    throw err;
  } finally {
    setTimeout(removeOverlay, 6000);
  }
}
