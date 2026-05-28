import { SELECTORS } from './selectors';

const SCROLL_DELAY_MS = 800;
const STABLE_MS = 2000;
const STABLE_WITH_SPINNER_MS = 5000;
const MAX_NO_PROGRESS_MS = 15_000;
const BOTTOM_THRESHOLD_PX = 300;
const MAX_SCROLL_ITERATIONS = 1200;
const NUDGE_AFTER_STALLS = 3;
const SPINNER_SELECTOR =
  'ytd-continuation-item-renderer, tp-yt-paper-spinner, tp-yt-paper-spinner-lite';

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function pageScrollTop(): number {
  return window.scrollY ?? document.documentElement.scrollTop ?? 0;
}

export function pageHeight(): number {
  return Math.max(document.documentElement.scrollHeight ?? 0, document.body?.scrollHeight ?? 0);
}

export function atBottom(thresholdPx = BOTTOM_THRESHOLD_PX): boolean {
  return window.scrollY + window.innerHeight >= pageHeight() - thresholdPx;
}

export function spinnerVisible(): boolean {
  const elements = document.querySelectorAll(SPINNER_SELECTOR);
  for (const el of elements) {
    const html = el as HTMLElement;
    if (html.offsetParent === null) continue;
    const rect = html.getBoundingClientRect();
    if (rect.height > 0 && rect.width > 0) return true;
  }
  return false;
}

export function getKnownTotal(): number | undefined {
  const m = document.title.match(/^\((\d+)\)/);
  if (m && m[1]) {
    const n = parseInt(m[1], 10);
    if (isFinite(n) && n > 0) return n;
  }
  return undefined;
}

export interface ScrollTickInfo {
  count: number;
  total?: number;
  isLoading: boolean;
}

export async function autoScrollSubscriptionsFeed(
  onTick: (info: ScrollTickInfo) => void,
  signal?: AbortSignal,
): Promise<void> {
  const target = getKnownTotal();
  let lastCardCount = -1;
  let lastNewChannelAt = Date.now();
  let nudgeCount = 0;

  window.scrollTo(0, pageHeight());
  await abortableSleep(SCROLL_DELAY_MS, signal);

  for (let i = 0; i < MAX_SCROLL_ITERATIONS; i++) {
    if (signal?.aborted) return;

    const cardsNow = document.querySelectorAll(SELECTORS.channelCard).length;
    const isLoading = spinnerVisible();
    onTick({ count: cardsNow, total: target, isLoading });

    if (target && cardsNow >= target) return;

    if (cardsNow > lastCardCount) {
      lastNewChannelAt = Date.now();
      nudgeCount = 0;
      lastCardCount = cardsNow;
    } else {
      const elapsed = Date.now() - lastNewChannelAt;
      const isAtBottom = atBottom();

      if (isAtBottom && !isLoading && elapsed >= STABLE_MS) return;
      if (isAtBottom && isLoading && elapsed >= STABLE_WITH_SPINNER_MS) return;
      if (elapsed >= MAX_NO_PROGRESS_MS) return;

      nudgeCount++;
      if (nudgeCount > 0 && nudgeCount % NUDGE_AFTER_STALLS === 0) {
        const h = pageHeight();
        const offset = nudgeCount >= NUDGE_AFTER_STALLS * 2 ? 1600 : 600;
        window.scrollTo(0, Math.max(0, h - offset));
        await abortableSleep(400, signal);
      }
    }

    window.scrollTo(0, pageHeight());
    await abortableSleep(SCROLL_DELAY_MS, signal);
  }
}
