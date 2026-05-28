export function friendlyError(raw: string, actionLabel: 'Scan' | 'Check' = 'Scan'): string {
  if (/subscriptions.*tab|subscriptions.*not open/i.test(raw)) {
    return 'Open your YouTube subscriptions page and try again.';
  }
  if (/navigated away|YouTube page navigated/i.test(raw)) {
    return `Page changed — return to subscriptions and ${actionLabel} again.`;
  }
  if (/tab was closed/i.test(raw)) {
    return `YouTube tab was closed. ${actionLabel} again to retry.`;
  }
  if (/network|fetch|connection/i.test(raw)) {
    return 'Connection lost. Check your internet and try again.';
  }
  return raw;
}
