export const SELECTORS = {
  channelCard: 'ytd-channel-renderer',
  channelName: '#text-container yt-formatted-string#text, #info-section yt-formatted-string#text',
  channelLink: 'a#main-link',
  channelAvatar: 'img#img',
  subscriberCount: '#subscribers',
  description: '#description',
  notificationButton: 'ytd-subscription-notification-toggle-button-renderer-next button',
  subscribeButton: 'ytd-subscribe-button-renderer button, tp-yt-paper-button#subscribe-button',
  unsubscribeConfirmButton:
    'tp-yt-paper-button#confirm-button, yt-button-renderer#confirm-button button',
} as const;

export const URLS = {
  subscriptionsFeed: 'https://www.youtube.com/feed/channels',
} as const;
