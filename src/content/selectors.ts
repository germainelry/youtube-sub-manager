export const SELECTORS = {
  channelCard: 'ytd-channel-renderer',
  channelName: '#text-container yt-formatted-string#text, #info-section yt-formatted-string#text',
  channelLink: 'a#main-link',
  channelAvatar: 'img#img',
  subscriberCount: '#subscribers',
  description: '#description',
  notificationButton: 'ytd-subscription-notification-toggle-button-renderer-next button',
  subscribeButton:
    'ytd-subscribe-button-renderer button, tp-yt-paper-button#subscribe-button, yt-subscribe-button-view-model button, #subscribe-button button, button[aria-label*="ubscrib" i]',
  unsubscribeConfirmButton:
    'button[aria-label="Unsubscribe" i], #confirm-button button, tp-yt-paper-button#confirm-button, yt-button-renderer#confirm-button button',
  menuContainer: 'tp-yt-iron-dropdown, ytd-menu-popup-renderer',
  dialogContainer:
    'tp-yt-paper-dialog, yt-confirm-dialog-renderer, ytd-confirm-dialog-renderer, [role="dialog"], [role="alertdialog"]',
} as const;

export const URLS = {
  subscriptionsFeed: 'https://www.youtube.com/feed/channels',
} as const;
