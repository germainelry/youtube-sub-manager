import type { Message } from '../shared/messages';

export async function sendMessage(msg: Message): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (/Could not establish connection|message port closed/i.test(reason)) {
      await new Promise((r) => setTimeout(r, 400));
      return chrome.runtime.sendMessage(msg);
    }
    throw err;
  }
}

export async function sendToTab(tabId: number, msg: Message): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, msg);
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export function isYouTubeUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith('youtube.com');
  } catch {
    return false;
  }
}

export function isSubscriptionsUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.hostname.endsWith('youtube.com') && u.pathname === '/feed/channels';
  } catch {
    return false;
  }
}

export async function checkSubscriptionsTab(): Promise<boolean> {
  const reply = await sendMessage({ action: 'tab:check' });
  return (reply as { data?: { found?: boolean } } | undefined)?.data?.found ?? false;
}

export async function openSubscriptionsTab(): Promise<void> {
  await sendMessage({ action: 'tab:open-subscriptions' });
}

export type TabContext = 'subscriptions' | 'youtube-other' | 'off-youtube';

export function classifyTab(url: string | undefined): TabContext {
  if (isSubscriptionsUrl(url)) return 'subscriptions';
  if (isYouTubeUrl(url)) return 'youtube-other';
  return 'off-youtube';
}
