import type {
  Album,
  AlbumRef,
  ArtistBio,
  ArtistRef,
  ArtworkSet,
  FetchFunction,
  Track,
} from '@nuclearplayer/plugin-sdk';

import { METADATA_PROVIDER_ID } from '../config';
import { encodeMetadataId } from '../metadata/metadata-id';
import { cacheTrackUrl } from './bandcamp-stream';

const BANDCAMP_SEARCH_API_URL =
  'https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic';
const BANDCAMP_IMAGE_BASE = 'https://f4.bcbits.com/img';

const LARGE_IMAGE_SUFFIX = '_10.jpg';
const THUMB_IMAGE_SUFFIX = '_2.jpg';

const replaceImageSuffix = (url: string, suffix: string) =>
  url.replace(/_\d+\.jpg$/, suffix);

// base64url encode (shared with streaming side)
const encodeUrl = (url: string): string =>
  btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const decodeUrl = (encoded: string): string => {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
};

const makeArtwork = (imageUrl?: string): ArtworkSet | undefined => {
  if (!imageUrl) return undefined;
  return {
    items: [
      { url: replaceImageSuffix(imageUrl, LARGE_IMAGE_SUFFIX), width: 1200, height: 1200, purpose: 'cover' },
      { url: replaceImageSuffix(imageUrl, THUMB_IMAGE_SUFFIX), width: 350, height: 350, purpose: 'thumbnail' },
    ],
  };
};

const bcSource = (url: string) => ({
  provider: METADATA_PROVIDER_ID,
  id: encodeMetadataId('bc', encodeUrl(url)),
  url,
});

const fetchHtml = async (fetchFn: FetchFunction, url: string): Promise<Document> => {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Bandcamp returned ${res.status} for ${url}`);
  const html = await res.text();
  return new DOMParser().parseFromString(html, 'text/html');
};

const extractJsonLd = <T>(doc: Document): T | undefined => {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  const script = Array.from(scripts).find((s) => s.textContent);
  if (!script?.textContent) return undefined;
  return JSON.parse(script.textContent) as T;
};

const extractDataTralbum = (doc: Document) => {
  const script = doc.querySelector('script[data-tralbum]');
  const raw = script?.getAttribute('data-tralbum');
  if (!raw) return undefined;
  return JSON.parse(raw) as {
    trackinfo?: {
      title: string;
      track_num: number;
      duration: number;
      title_link?: string;
      file?: { 'mp3-128'?: string };
    }[];
  };
};

const parseIsoDuration = (iso: string): number | undefined => {
  const match = iso.match(/P(?:(\d+)H)?(\d+)M(\d+)S/);
  if (!match) return undefined;
  const [, hours, mins, secs] = match;
  return (Number(hours ?? 0) * 3600 + Number(mins) * 60 + Number(secs)) * 1000;
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
  tag_names?: string[] | null;
  genre_name?: string;
};

type BcApiResponse = { auto: { results: BcApiResult[] } };

const searchBandcamp = async (
  fetchFn: FetchFunction,
  query: string,
  filter: 'b' | 'a' | 't',
  limit: number,
): Promise<BcApiResult[]> => {
  const res = await fetchFn(BANDCAMP_SEARCH_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ search_text: query, search_filter: filter, full_page: false, fan_id: null }),
  });
  if (!res.ok) throw new Error(`Bandcamp search error: ${res.status}`);
  const data = (await res.json()) as BcApiResponse;
  return data.auto.results.slice(0, limit);
};

const resolveImageUrl = (result: BcApiResult): string | undefined => {
  if (result.art_id) {
    return `${BANDCAMP_IMAGE_BASE}/a${String(result.art_id).padStart(10, '0')}_2.jpg`;
  }
  return result.img;
};

const resolveItemUrl = (result: BcApiResult): string =>
  result.item_url_path ?? result.item_url_root;

const parseArtistFromSubhead = (subhead?: string): string | undefined => {
  if (!subhead) return undefined;
  return subhead.match(/by\s+(.+)/)?.[1]?.trim();
};

const parseAlbumAndArtist = (subhead?: string) => {
  if (!subhead) return {};
  const fromByMatch = subhead.match(/from\s+(.+?)\s+by\s+(.+)/);
  if (fromByMatch) return { album: fromByMatch[1]?.trim(), artist: fromByMatch[2]?.trim() };
  const byMatch = subhead.match(/by\s+(.+)/);
  if (byMatch) return { artist: byMatch[1]?.trim() };
  return {};
};

export const searchBandcampTracks = async (
  fetchFn: FetchFunction,
  query: string,
  limit: number,
): Promise<Track[]> => {
  const results = await searchBandcamp(fetchFn, query, 't', limit);
  return results.map((result) => {
    const itemUrl = resolveItemUrl(result);
    const { album, artist } = parseAlbumAndArtist(result.band_name
      ? (result.album_name
        ? `from ${result.album_name} by ${result.band_name}`
        : `by ${result.band_name}`)
      : undefined);
    const artistUrl = new URL(itemUrl).origin;
    const tags = [
      ...(result.genre_name ? [result.genre_name] : []),
      ...(result.tag_names ?? []),
    ];
    return {
      title: result.name,
      artists: artist || result.band_name
        ? [{ name: artist ?? result.band_name!, roles: [], source: bcSource(artistUrl) }]
        : [],
      album: album || result.album_name
        ? { title: album ?? result.album_name!, source: bcSource(artistUrl) }
        : undefined,
      tags: tags.length > 0 ? tags : undefined,
      artwork: makeArtwork(resolveImageUrl(result)),
      source: bcSource(itemUrl),
    };
  });
};

export const searchBandcampArtists = async (
  fetchFn: FetchFunction,
  query: string,
  limit: number,
): Promise<ArtistRef[]> => {
  const results = await searchBandcamp(fetchFn, query, 'b', limit);
  return results.map((result) => ({
    name: result.name,
    artwork: makeArtwork(resolveImageUrl(result)),
    source: bcSource(resolveItemUrl(result)),
  }));
};

export const searchBandcampAlbums = async (
  fetchFn: FetchFunction,
  query: string,
  limit: number,
): Promise<AlbumRef[]> => {
  const results = await searchBandcamp(fetchFn, query, 'a', limit);
  return results.map((result) => {
    const itemUrl = resolveItemUrl(result);
    const artistName = parseArtistFromSubhead(result.band_name ? `by ${result.band_name}` : undefined);
    const artistUrl = new URL(itemUrl).origin;
    return {
      title: result.name,
      artists: artistName ? [{ name: artistName, source: bcSource(artistUrl) }] : undefined,
      artwork: makeArtwork(resolveImageUrl(result)),
      source: bcSource(itemUrl),
    };
  });
};

type JsonLdMusicAlbum = {
  '@type': string;
  name: string;
  byArtist?: { name: string; url?: string };
  datePublished?: string;
  image?: string;
  keywords?: string[];
  track?: {
    itemListElement: {
      position: number;
      item: { name: string; url?: string; duration?: string };
    }[];
  };
};

export const getBandcampAlbumDetails = async (
  fetchFn: FetchFunction,
  encodedUrl: string,
): Promise<Album> => {
  const albumUrl = decodeUrl(encodedUrl);
  const doc = await fetchHtml(fetchFn, albumUrl);
  const jsonLd = extractJsonLd<JsonLdMusicAlbum>(doc);
  const tralbum = extractDataTralbum(doc);

  const albumName = jsonLd?.name ?? '';
  const artistName = jsonLd?.byArtist?.name ?? '';
  const artistUrl = jsonLd?.byArtist?.url ?? new URL(albumUrl).origin;

  const jsonLdTracks = jsonLd?.track?.itemListElement ?? [];
  const tralbumTracks = tralbum?.trackinfo ?? [];

  const tracks = jsonLdTracks.map((entry) => {
    const matching = tralbumTracks.find((t) => t.track_num === entry.position);
    const durationMs = matching
      ? matching.duration * 1000
      : parseIsoDuration(entry.item.duration ?? '');
    const trackUrl = entry.item.url ??
      (matching?.title_link ? new URL(matching.title_link, albumUrl).href : undefined);

    // Cache stream URLs discovered here so streaming provider can skip scraping
    if (matching?.file?.['mp3-128'] && trackUrl && artistName) {
      cacheTrackUrl(artistName, entry.item.name, trackUrl);
    }

    return {
      title: entry.item.name,
      artists: [{ name: artistName, roles: [], source: bcSource(artistUrl) }],
      artwork: makeArtwork(jsonLd?.image),
      source: bcSource(trackUrl ?? albumUrl),
      durationMs,
    };
  });

  const releaseDate = jsonLd?.datePublished
    ? (() => {
        const d = new Date(jsonLd.datePublished);
        if (isNaN(d.getTime())) return undefined;
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return { precision: 'day' as const, dateIso: `${y}-${m}-${day}` };
      })()
    : undefined;

  return {
    title: albumName,
    artists: [{ name: artistName, roles: [], source: bcSource(artistUrl) }],
    tracks,
    releaseDate,
    genres: jsonLd?.keywords,
    artwork: makeArtwork(jsonLd?.image),
    source: bcSource(albumUrl),
  };
};

const ARTIST_CACHE_TTL_MS = 30_000;
const artistCache = new Map<string, { data: ArtistBio; timestamp: number }>();

export const getBandcampArtistBio = async (
  fetchFn: FetchFunction,
  encodedUrl: string,
): Promise<ArtistBio> => {
  const cached = artistCache.get(encodedUrl);
  if (cached && Date.now() - cached.timestamp < ARTIST_CACHE_TTL_MS) return cached.data;

  const artistUrl = decodeUrl(encodedUrl);
  const doc = await fetchHtml(fetchFn, artistUrl);

  const dataBandScript = doc.querySelector('script[data-band]');
  const dataBand = dataBandScript?.getAttribute('data-band')
    ? (JSON.parse(dataBandScript.getAttribute('data-band')!) as { name: string; image_id?: number })
    : undefined;

  const BANDCAMP_IMAGE_BASE_ID = 'https://f4.bcbits.com/img';
  const imageUrl = dataBand?.image_id
    ? `${BANDCAMP_IMAGE_BASE_ID}/${String(dataBand.image_id).padStart(10, '0')}_10.jpg`
    : (doc.querySelector('img.band-photo')?.getAttribute('src') ?? undefined);

  const name = dataBand?.name
    ?? doc.querySelector('#band-name-location .title')?.textContent?.trim()
    ?? '';

  const bioEl =
    doc.querySelector('div.signed-out-artists-bio-text p#bio-text') ??
    doc.querySelector('div.signed-out-artists-bio-text');
  const bio = bioEl?.textContent?.trim() ?? undefined;

  const result: ArtistBio = {
    name,
    bio,
    artwork: makeArtwork(imageUrl),
    source: bcSource(artistUrl),
  };

  artistCache.set(encodedUrl, { data: result, timestamp: Date.now() });
  return result;
};

export const getBandcampArtistAlbums = async (
  fetchFn: FetchFunction,
  encodedUrl: string,
): Promise<AlbumRef[]> => {
  const artistUrl = decodeUrl(encodedUrl);
  const musicUrl = artistUrl.endsWith('/') ? `${artistUrl}music` : `${artistUrl}/music`;
  const doc = await fetchHtml(fetchFn, musicUrl);

  const gridItems = doc.querySelectorAll('li.music-grid-item');
  return Array.from(gridItems).reduce<AlbumRef[]>((acc, item) => {
    const link = item.querySelector('a');
    const img = item.querySelector('img');
    const titleEl = item.querySelector('p.title');

    const href = link?.getAttribute('href');
    if (!href) return acc;

    const fullUrl = new URL(href, artistUrl).href;
    const title = titleEl?.textContent?.trim() ?? '';
    const imageUrl = img?.getAttribute('src') ?? undefined;

    acc.push({
      title,
      artwork: makeArtwork(imageUrl),
      source: bcSource(fullUrl),
    });
    return acc;
  }, []);
};
