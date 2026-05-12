import type { FetchFunction, StreamCandidate } from '@nuclearplayer/plugin-sdk';

import { encodeCandidateId } from '../streaming/candidate-id';

const SOUNDCLOUD_URL = 'https://soundcloud.com';
const SOUNDCLOUD_API_V2 = 'https://api-v2.soundcloud.com';
const CLIENT_ID_REGEX = /[{,]client_id:"(\w+)"/;
const SNDCDN_SCRIPT_URL_REGEX = /https?:\/\/[^\s"]*sndcdn\.com[^\s"]*\.js/g;

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let cachedClientId: string | null = null;

const createScFetch =
  (baseFetch: FetchFunction): FetchFunction =>
  (input, init) =>
    baseFetch(input, {
      ...init,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Origin: SOUNDCLOUD_URL,
        Referer: `${SOUNDCLOUD_URL}/`,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        ...init?.headers,
      },
    });

const getClientId = async (
  fetchFn: FetchFunction,
  forceRefresh = false,
): Promise<string> => {
  if (cachedClientId && !forceRefresh) return cachedClientId;

  const homepageRes = await fetchFn(SOUNDCLOUD_URL);
  if (!homepageRes.ok) throw new Error(`SoundCloud homepage error: ${homepageRes.status}`);
  const html = await homepageRes.text();

  const scriptUrls = html.match(SNDCDN_SCRIPT_URL_REGEX);
  if (!scriptUrls) throw new Error('No sndcdn script URLs found');

  for (const scriptUrl of [...scriptUrls].reverse()) {
    const res = await fetchFn(scriptUrl);
    if (!res.ok) continue;
    const body = await res.text();
    const match = body.match(CLIENT_ID_REGEX);
    if (match?.[1]) {
      cachedClientId = match[1];
      return match[1];
    }
  }
  throw new Error('Could not extract SoundCloud client_id');
};

type ScTranscoding = {
  url: string;
  preset: string;
  duration: number;
  format: { protocol: string; mime_type: string };
  quality: string;
};

type ScTrack = {
  id: number;
  title: string;
  full_duration: number;
  artwork_url: string | null;
  permalink_url: string;
  user: { avatar_url: string; username: string };
  media: { transcodings: ScTranscoding[] };
};

type ScSearchResult = { collection: ScTrack[] };

const scApiRequest = async <T>(
  fetchFn: FetchFunction,
  endpoint: string,
  params: Record<string, string> = {},
): Promise<T> => {
  const clientId = await getClientId(fetchFn);
  const search = new URLSearchParams({ ...params, client_id: clientId });
  const url = `${SOUNDCLOUD_API_V2}/${endpoint}?${search}`;
  let res = await fetchFn(url);

  if (res.status === 401 || res.status === 403) {
    const refreshedId = await getClientId(fetchFn, true);
    const retrySearch = new URLSearchParams({ ...params, client_id: refreshedId });
    res = await fetchFn(`${SOUNDCLOUD_API_V2}/${endpoint}?${retrySearch}`);
  }

  if (!res.ok) throw new Error(`SoundCloud API error ${res.status} for ${endpoint}`);
  return res.json();
};

const BITRATE_BY_PRESET: Record<string, number> = {
  mp3_0_0: 128, mp3_0_1: 64, mp3_1_0: 128, opus_0_0: 64,
};

const estimateBitrate = (t: ScTranscoding): number => {
  if (t.preset in BITRATE_BY_PRESET) return BITRATE_BY_PRESET[t.preset];
  if (t.format.mime_type.includes('audio/mp4')) return t.quality === 'hq' ? 256 : 160;
  return 128;
};

const findHlsTranscoding = (ts: ScTranscoding[]): ScTranscoding | undefined =>
  ts.find((t) => t.format.protocol === 'hls' && t.format.mime_type.includes('audio/mp4')) ??
  ts.find((t) => t.format.protocol === 'hls');

const resolveHlsUrl = async (
  fetchFn: FetchFunction,
  transcodingUrl: string,
): Promise<string> => {
  const clientId = await getClientId(fetchFn);
  const parsed = new URL(transcodingUrl);
  parsed.searchParams.set('client_id', clientId);
  let res = await fetchFn(parsed.toString());

  if (res.status === 401 || res.status === 403) {
    const refreshedId = await getClientId(fetchFn, true);
    parsed.searchParams.set('client_id', refreshedId);
    res = await fetchFn(parsed.toString());
  }
  if (!res.ok) throw new Error(`Failed to resolve SC stream URL: ${res.status}`);
  const data: { url: string } = await res.json();
  return data.url;
};

export type ResolvedScStream = {
  url: string;
  durationMs: number;
  mimeType: string;
  bitrateKbps: number;
  permalinkUrl: string;
};

export const searchSoundcloudStream = async (
  baseFetch: FetchFunction,
  artist: string,
  title: string,
  limit: number,
): Promise<StreamCandidate[]> => {
  const fetchFn = createScFetch(baseFetch);
  const query = `${artist} ${title}`;
  const result = await scApiRequest<ScSearchResult>(fetchFn, 'search/tracks', {
    q: query,
    limit: String(limit),
  });

  const ARTWORK_SUFFIX = '-t200x200';
  return result.collection.map((track) => {
    const id = encodeCandidateId('sc', String(track.id));
    const artworkUrl = track.artwork_url ?? track.user.avatar_url;
    return {
      id,
      title: track.title,
      durationMs: track.full_duration,
      thumbnail: artworkUrl ? artworkUrl.replace(/-large(?=\.\w+$)/, ARTWORK_SUFFIX) : undefined,
      failed: false,
      source: { provider: 'unified-stream', id },
    };
  });
};

export const resolveScStream = async (
  baseFetch: FetchFunction,
  trackIdStr: string,
): Promise<ResolvedScStream> => {
  const fetchFn = createScFetch(baseFetch);
  const trackId = Number(trackIdStr);
  if (Number.isNaN(trackId)) throw new Error(`Invalid SC track ID: ${trackIdStr}`);

  const track = await scApiRequest<ScTrack>(fetchFn, `tracks/${trackId}`);
  const transcoding = findHlsTranscoding(track.media.transcodings);
  if (!transcoding) throw new Error(`No HLS transcoding for SC track ${trackId}`);

  const hlsUrl = await resolveHlsUrl(fetchFn, transcoding.url);
  return {
    url: hlsUrl,
    durationMs: track.full_duration,
    mimeType: transcoding.format.mime_type,
    bitrateKbps: estimateBitrate(transcoding),
    permalinkUrl: track.permalink_url,
  };
};

export const clearScClientIdCache = (): void => {
  cachedClientId = null;
};
