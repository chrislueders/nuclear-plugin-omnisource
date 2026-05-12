import type { FetchFunction, StreamCandidate } from '@nuclearplayer/plugin-sdk';

import { encodeCandidateId } from '../streaming/candidate-id';

const BANDCAMP_SEARCH_API_URL =
  'https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic';
const BANDCAMP_IMAGE_BASE = 'https://f4.bcbits.com/img';
const LARGE_IMAGE_SUFFIX = '_10.jpg';
const THUMB_IMAGE_SUFFIX = '_2.jpg';

const replaceImageSuffix = (url: string, suffix: string) =>
  url.replace(/_\d+\.jpg$/, suffix);

// base64url encode/decode (matching existing bandcamp plugin convention)
export const encodeUrl = (url: string): string =>
  btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const decodeUrl = (encoded: string): string => {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
};

type BcApiResult = {
  type: 'b' | 'a' | 't';
  id: number;
  name: string;
  item_url_root: string;
  item_url_path?: string;
  img?: string;
  art_id?: number | null;
  band_name?: string;
  album_name?: string;
};

type BcApiResponse = { auto: { results: BcApiResult[] } };

// Module-level stream URL cache (same pattern as bandcamp plugin)
const trackUrlCache = new Map<string, string>();   // 'artist:title' → page URL
const streamUrlCache = new Map<string, string>();  // encodedUrl candidateId → mp3-128 URL

const makeKey = (artist: string, title: string) =>
  `${artist.toLowerCase()}:${title.toLowerCase()}`;

export const cacheTrackUrl = (artist: string, title: string, url: string): void => {
  trackUrlCache.set(makeKey(artist, title), url);
};

export const getCachedTrackUrl = (artist: string, title: string): string | undefined =>
  trackUrlCache.get(makeKey(artist, title));

export const cacheStreamUrl = (encodedUrl: string, streamUrl: string): void => {
  streamUrlCache.set(encodedUrl, streamUrl);
};

export const getCachedStreamUrl = (encodedUrl: string): string | undefined =>
  streamUrlCache.get(encodedUrl);

const resolveImageUrl = (result: BcApiResult): string | undefined => {
  if (result.art_id) {
    const paddedId = String(result.art_id).padStart(10, '0');
    return `${BANDCAMP_IMAGE_BASE}/a${paddedId}_2.jpg`;
  }
  return result.img;
};

const resolveItemUrl = (result: BcApiResult): string =>
  result.item_url_path ?? result.item_url_root;

export const searchBandcampStream = async (
  fetchFn: FetchFunction,
  artist: string,
  title: string,
  limit: number,
): Promise<StreamCandidate[]> => {
  const cachedUrl = getCachedTrackUrl(artist, title);
  if (cachedUrl) {
    const encodedUrl = encodeUrl(cachedUrl);
    const id = encodeCandidateId('bc', encodedUrl);
    return [{ id, title, failed: false, source: { provider: 'unified-stream', id } }];
  }

  const query = `${artist} ${title}`;
  const res = await fetchFn(BANDCAMP_SEARCH_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ search_text: query, search_filter: 't', full_page: false, fan_id: null }),
  });
  if (!res.ok) throw new Error(`Bandcamp search API error: ${res.status}`);

  const data = (await res.json()) as BcApiResponse;
  return data.auto.results.slice(0, limit).map((result) => {
    const itemUrl = resolveItemUrl(result);
    const encodedUrl = encodeUrl(itemUrl);
    const id = encodeCandidateId('bc', encodedUrl);
    const imageUrl = resolveImageUrl(result);
    return {
      id,
      title: result.name,
      thumbnail: imageUrl ? replaceImageSuffix(imageUrl, THUMB_IMAGE_SUFFIX) : undefined,
      failed: false,
      source: { provider: 'unified-stream', id },
    };
  });
};

type DataTralbumTrack = {
  title: string;
  track_num: number;
  duration: number;
  title_link?: string;
  file?: { 'mp3-128'?: string };
};

type DataTralbum = { trackinfo?: DataTralbumTrack[] };

const fetchHtml = async (fetchFn: FetchFunction, url: string): Promise<Document> => {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Bandcamp returned ${res.status} for ${url}`);
  const html = await res.text();
  return new DOMParser().parseFromString(html, 'text/html');
};

const extractDataTralbum = (doc: Document): DataTralbum | undefined => {
  const script = doc.querySelector('script[data-tralbum]');
  const raw = script?.getAttribute('data-tralbum');
  if (!raw) return undefined;
  return JSON.parse(raw) as DataTralbum;
};

export const resolveBandcampStream = async (
  fetchFn: FetchFunction,
  encodedUrl: string,
): Promise<{ url: string; durationMs?: number }> => {
  const cached = getCachedStreamUrl(encodedUrl);
  if (cached) return { url: cached };

  const trackUrl = decodeUrl(encodedUrl);
  const doc = await fetchHtml(fetchFn, trackUrl);
  const tralbum = extractDataTralbum(doc);
  if (!tralbum) throw new Error(`No data-tralbum on page: ${trackUrl}`);

  const track = tralbum.trackinfo?.[0];
  if (!track) throw new Error(`No track info on page: ${trackUrl}`);

  const mp3Url = track.file?.['mp3-128'];
  if (!mp3Url) throw new Error(`No mp3-128 stream on page: ${trackUrl}`);

  cacheStreamUrl(encodedUrl, mp3Url);
  return { url: mp3Url, durationMs: track.duration ? track.duration * 1000 : undefined };
};
