import type { AlbumRef, FetchFunction, PlaylistRef, TrackRef } from '@nuclearplayer/plugin-sdk';

import { METADATA_PROVIDER_ID } from '../config';
import { encodeMetadataId } from '../metadata/metadata-id';

type PlaylistVideoRenderer = {
  videoId: string;
  title?: { runs?: { text: string }[] };
  lengthSeconds?: string;
  shortBylineText?: { runs?: { text: string }[] };
};

type PlaylistDetails = {
  title: string;
  tracks: TrackRef[];
};

const findPlaylistVideos = (obj: unknown): PlaylistVideoRenderer[] => {
  if (!obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) return obj.flatMap(findPlaylistVideos);
  const record = obj as Record<string, unknown>;
  if ('playlistVideoRenderer' in record) {
    return [record.playlistVideoRenderer as PlaylistVideoRenderer];
  }
  return Object.values(record).flatMap(findPlaylistVideos);
};

const extractPlaylistTitle = (data: unknown): string => {
  try {
    const d = data as Record<string, unknown>;
    const sidebar = d.sidebar as Record<string, unknown>;
    const psr = sidebar.playlistSidebarRenderer as Record<string, unknown>;
    const items = psr.items as Record<string, unknown>[];
    const primary = items[0].playlistSidebarPrimaryInfoRenderer as Record<string, unknown>;
    const title = primary.title as Record<string, unknown>;
    const runs = title.runs as { text: string }[];
    return runs[0]?.text ?? '';
  } catch {
    return '';
  }
};

export const fetchYoutubePlaylistDetails = async (
  fetchFn: FetchFunction,
  playlistId: string,
): Promise<PlaylistDetails> => {
  const url = `https://www.youtube.com/playlist?list=${playlistId}`;
  const res = await fetchFn(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`YouTube playlist page returned HTTP ${res.status}`);
  const html = await res.text();
  const data = extractYtInitialData(html);
  const videos = findPlaylistVideos(data);
  const title = extractPlaylistTitle(data);

  const tracks: TrackRef[] = videos.map((v) => {
    const channelName = v.shortBylineText?.runs?.[0]?.text;
    return {
      title: v.title?.runs?.[0]?.text ?? '',
      artists: channelName
        ? [{ name: channelName, source: { provider: METADATA_PROVIDER_ID, id: `yt:${v.videoId}` } }]
        : [{ name: 'Unknown', source: { provider: METADATA_PROVIDER_ID, id: `yt:${v.videoId}` } }],
      source: {
        provider: METADATA_PROVIDER_ID,
        id: `yt:${v.videoId}`,
      },
    };
  });

  return { title, tracks };
};

const YT_SEARCH_BASE = 'https://www.youtube.com/results';
const YT_PLAYLIST_SP = 'EgIQAw==';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type ImageSource = { url: string; width?: number; height?: number };

type LockupViewModel = {
  contentImage?: {
    collectionThumbnailViewModel?: {
      primaryThumbnail?: {
        thumbnailViewModel?: {
          image?: { sources?: ImageSource[] };
        };
      };
    };
  };
  metadata?: {
    lockupMetadataViewModel?: {
      title?: { content?: string };
    };
  };
  rendererContext?: {
    commandContext?: {
      onTap?: {
        innertubeCommand?: {
          watchEndpoint?: { playlistId?: string };
        };
      };
    };
  };
};

const normalizeUrl = (url: string): string =>
  url.startsWith('//') ? `https:${url}` : url;

const findLockupViewModels = (obj: unknown): LockupViewModel[] => {
  if (!obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) return obj.flatMap(findLockupViewModels);
  const record = obj as Record<string, unknown>;
  if ('lockupViewModel' in record) {
    return [record.lockupViewModel as LockupViewModel];
  }
  return Object.values(record).flatMap(findLockupViewModels);
};

const extractYtInitialData = (html: string): unknown => {
  const marker = 'ytInitialData';
  const keyIdx = html.indexOf(marker);
  if (keyIdx === -1) throw new Error('ytInitialData not found in YouTube response');
  const start = html.indexOf('{', keyIdx);
  if (start === -1) throw new Error('ytInitialData JSON start not found');

  let depth = 0;
  for (let i = start; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) {
      return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error('ytInitialData JSON end not found');
};

const toAlbumRef = (vm: LockupViewModel): AlbumRef | null => {
  const playlistId =
    vm.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.playlistId;
  if (!playlistId) return null;

  const title = vm.metadata?.lockupMetadataViewModel?.title?.content ?? '';
  const sources =
    vm.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources ?? [];

  return {
    title: `▶ ${title}`,
    artists: [{ name: 'YouTube Playlist', source: { provider: METADATA_PROVIDER_ID, id: encodeMetadataId('ytpl', playlistId) } }],
    artwork:
      sources.length > 0
        ? {
            items: sources.map((s) => ({
              url: normalizeUrl(s.url),
              width: s.width,
              height: s.height,
              purpose: (s.height ?? 0) >= 200 ? ('cover' as const) : ('thumbnail' as const),
            })),
          }
        : undefined,
    source: {
      provider: METADATA_PROVIDER_ID,
      id: encodeMetadataId('ytpl', playlistId),
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
    },
  };
};

const toPlaylistRef = (vm: LockupViewModel): PlaylistRef | null => {
  const playlistId =
    vm.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.playlistId;
  if (!playlistId) return null;

  const title = vm.metadata?.lockupMetadataViewModel?.title?.content ?? '';
  const sources =
    vm.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources ?? [];

  return {
    id: `yt-playlist:${playlistId}`,
    name: title,
    artwork:
      sources.length > 0
        ? {
            items: sources.map((s) => ({
              url: normalizeUrl(s.url),
              width: s.width,
              height: s.height,
              purpose: (s.height ?? 0) >= 200 ? ('cover' as const) : ('thumbnail' as const),
            })),
          }
        : undefined,
    source: {
      provider: METADATA_PROVIDER_ID,
      id: `yt-playlist:${playlistId}`,
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
    },
  };
};

const fetchViewModels = async (
  fetchFn: FetchFunction,
  query: string,
): Promise<LockupViewModel[]> => {
  const params = new URLSearchParams({ search_query: query, sp: YT_PLAYLIST_SP });
  const res = await fetchFn(`${YT_SEARCH_BASE}?${params}`, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`YouTube search returned HTTP ${res.status}`);
  const html = await res.text();
  return findLockupViewModels(extractYtInitialData(html));
};

export const searchYoutubePlaylistsAsAlbums = async (
  fetchFn: FetchFunction,
  query: string,
  limit: number,
): Promise<AlbumRef[]> => {
  const viewModels = await fetchViewModels(fetchFn, query);
  return viewModels
    .map(toAlbumRef)
    .filter((r): r is AlbumRef => r !== null)
    .slice(0, limit);
};

export const searchYoutubePlaylist = async (
  fetchFn: FetchFunction,
  query: string,
  limit: number,
): Promise<PlaylistRef[]> => {
  const viewModels = await fetchViewModels(fetchFn, query);
  return viewModels
    .map(toPlaylistRef)
    .filter((r): r is PlaylistRef => r !== null)
    .slice(0, limit);
};
