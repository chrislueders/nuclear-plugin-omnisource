import type { ArtistRef, ArtworkSet, FetchFunction, Track } from '@nuclearplayer/plugin-sdk';

import { METADATA_PROVIDER_ID } from '../config';
import { encodeMetadataId } from '../metadata/metadata-id';

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

  const res = await fetchFn(SOUNDCLOUD_URL);
  if (!res.ok) throw new Error(`SoundCloud homepage error: ${res.status}`);
  const html = await res.text();
  const scriptUrls = html.match(SNDCDN_SCRIPT_URL_REGEX);
  if (!scriptUrls) throw new Error('No sndcdn script URLs found');

  for (const scriptUrl of [...scriptUrls].reverse()) {
    const scriptRes = await fetchFn(scriptUrl);
    if (!scriptRes.ok) continue;
    const body = await scriptRes.text();
    const match = body.match(CLIENT_ID_REGEX);
    if (match?.[1]) {
      cachedClientId = match[1];
      return match[1];
    }
  }
  throw new Error('Could not extract SoundCloud client_id');
};

type ScUser = {
  id: number;
  username: string;
  avatar_url: string;
  followers_count: number;
  followings_count: number;
  track_count: number;
  playlist_count: number;
  city: string | null;
  country_code: string | null;
  permalink_url: string;
};

type ScTrack = {
  id: number;
  title: string;
  full_duration: number;
  artwork_url: string | null;
  permalink_url: string;
  user: ScUser;
  tag_list: string;
  publisher_metadata?: { artist?: string; album_title?: string };
};

type ScSearchResult<T> = { collection: T[] };

const apiRequest = async <T>(
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

const ARTWORK_LARGE = '-t500x500';
const ARTWORK_THUMB = '-t200x200';

const makeArtwork = (url: string | null): ArtworkSet | undefined => {
  if (!url) return undefined;
  const resize = (suffix: string) => url.replace(/-large(?=\.\w+$)/, suffix);
  return {
    items: [
      { url: resize(ARTWORK_LARGE), width: 500, height: 500, purpose: 'cover' },
      { url: resize(ARTWORK_THUMB), width: 200, height: 200, purpose: 'thumbnail' },
    ],
  };
};

const scSource = (id: number, permalinkUrl: string) => ({
  provider: METADATA_PROVIDER_ID,
  id: encodeMetadataId('sc', String(id)),
  url: permalinkUrl,
});

export const searchScTracks = async (
  baseFetch: FetchFunction,
  query: string,
  limit: number,
): Promise<Track[]> => {
  const fetchFn = createScFetch(baseFetch);
  const result = await apiRequest<ScSearchResult<ScTrack>>(fetchFn, 'search/tracks', {
    q: query,
    limit: String(limit),
  });

  return result.collection.map((track) => {
    const artistName = track.publisher_metadata?.artist ?? track.user.username;
    const artwork = makeArtwork(track.artwork_url ?? track.user.avatar_url);
    return {
      title: track.title,
      artists: [{ name: artistName, roles: [], source: scSource(track.user.id, track.user.permalink_url) }],
      album: track.publisher_metadata?.album_title
        ? { title: track.publisher_metadata.album_title, source: scSource(track.id, track.permalink_url) }
        : undefined,
      durationMs: track.full_duration,
      artwork,
      source: scSource(track.id, track.permalink_url),
    };
  });
};

export const searchScArtists = async (
  baseFetch: FetchFunction,
  query: string,
  limit: number,
): Promise<ArtistRef[]> => {
  const fetchFn = createScFetch(baseFetch);
  const result = await apiRequest<ScSearchResult<ScUser>>(fetchFn, 'search/users', {
    q: query,
    limit: String(limit),
  });

  const AVATAR_LARGE = '-t500x500';
  return result.collection.map((user) => ({
    name: user.username,
    artwork: makeArtwork(user.avatar_url),
    source: {
      provider: METADATA_PROVIDER_ID,
      id: encodeMetadataId('sc', String(user.id)),
      url: user.permalink_url,
    },
  }));
};
