import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  channelIdFromUrl,
  findSubscriberText,
  parseCard,
  parseSubscriberCount,
} from '../src/content/extractor';

const fixture = readFileSync(resolve(__dirname, 'fixtures/channel-card.html'), 'utf8');

describe('parseSubscriberCount', () => {
  it('parses K suffix with subscriber word', () => {
    expect(parseSubscriberCount('12.3K subscribers')).toBe(12_300);
  });
  it('parses M suffix with subscriber word', () => {
    expect(parseSubscriberCount('1.2M subscribers')).toBe(1_200_000);
  });
  it('parses B suffix with subscriber word', () => {
    expect(parseSubscriberCount('1.5B subscribers')).toBe(1_500_000_000);
  });
  it('parses bare numbers with commas when "subscriber" is present', () => {
    expect(parseSubscriberCount('123,456 subscribers')).toBe(123_456);
  });
  it('accepts pure unit numbers like "1.2M"', () => {
    expect(parseSubscriberCount('1.2M')).toBe(1_200_000);
  });
  it('rejects "@handle" text', () => {
    expect(parseSubscriberCount('@2NE1')).toBeUndefined();
    expect(parseSubscriberCount('@9420musicbar')).toBeUndefined();
  });
  it('rejects text without digits', () => {
    expect(parseSubscriberCount('hello world')).toBeUndefined();
  });
  it('returns undefined for empty', () => {
    expect(parseSubscriberCount(undefined)).toBeUndefined();
    expect(parseSubscriberCount('')).toBeUndefined();
  });
});

describe('channelIdFromUrl', () => {
  it('extracts handle from /@Channel URLs', () => {
    expect(channelIdFromUrl('https://www.youtube.com/@SampleChannel')).toBe('@SampleChannel');
  });
  it('extracts ID from /channel/UC... URLs', () => {
    expect(channelIdFromUrl('https://www.youtube.com/channel/UC1234567890')).toBe('UC1234567890');
  });
  it('returns undefined for empty', () => {
    expect(channelIdFromUrl(undefined)).toBeUndefined();
  });
});

describe('findSubscriberText', () => {
  it('prefers text containing "subscriber"', () => {
    const card = document.createElement('ytd-channel-renderer');
    card.innerHTML = `
      <yt-formatted-string id="subscribers">@SomeHandle</yt-formatted-string>
      <yt-formatted-string id="video-count">1.2M subscribers · 340 videos</yt-formatted-string>
    `;
    const text = findSubscriberText(card);
    expect(text).toMatch(/1\.2M subscribers/);
  });

  it('returns undefined when the only candidate is a handle', () => {
    const card = document.createElement('ytd-channel-renderer');
    card.innerHTML = `<yt-formatted-string id="subscribers">@JustAHandle</yt-formatted-string>`;
    expect(findSubscriberText(card)).toBeUndefined();
  });

  it('falls back to aria-label on the card', () => {
    const card = document.createElement('ytd-channel-renderer');
    card.setAttribute('aria-label', 'Sample Channel, 2.5M subscribers');
    card.innerHTML = `<yt-formatted-string id="subscribers">@h</yt-formatted-string>`;
    expect(findSubscriberText(card)).toMatch(/2\.5M subscribers/);
  });
});

describe('parseCard', () => {
  it('parses a channel card fixture into a Channel record', () => {
    const container = document.createElement('div');
    container.innerHTML = fixture;
    const card = container.querySelector('ytd-channel-renderer');
    expect(card).not.toBeNull();

    const channel = parseCard(card!);
    expect(channel).not.toBeNull();
    expect(channel!.name).toBe('Sample Channel');
    expect(channel!.channelId).toBe('@SampleChannel');
    expect(channel!.url).toBe('https://www.youtube.com/@SampleChannel');
    expect(channel!.avatarUrl).toBe('https://yt3.ggpht.com/sample-avatar.jpg');
    expect(channel!.subscriberCountText).toBe('1.2M subscribers');
    expect(channel!.subscriberCountRaw).toBe(1_200_000);
    expect(channel!.description).toBe('A description of the channel.');
    expect(typeof channel!.extractedAt).toBe('number');
  });

  it('leaves subscriber count empty when only a handle is present', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <ytd-channel-renderer>
        <a id="main-link" href="https://www.youtube.com/@OnlyHandle"></a>
        <yt-formatted-string id="text">Only Handle</yt-formatted-string>
        <yt-formatted-string id="subscribers">@OnlyHandle</yt-formatted-string>
      </ytd-channel-renderer>
    `;
    const card = container.querySelector('ytd-channel-renderer')!;
    const channel = parseCard(card)!;
    expect(channel.subscriberCountText).toBeUndefined();
    expect(channel.subscriberCountRaw).toBeUndefined();
  });

  it('returns null when no channel link is present', () => {
    const container = document.createElement('div');
    container.innerHTML = '<ytd-channel-renderer><div>no link here</div></ytd-channel-renderer>';
    const card = container.querySelector('ytd-channel-renderer');
    expect(parseCard(card!)).toBeNull();
  });
});
