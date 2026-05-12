import type { AlbumRef, ArtistRef, Track } from '@nuclearplayer/plugin-sdk';

import { normalizeTitle } from '../util/similarity';

const trackFingerprint = (track: Track): string => {
  const artist = track.artists[0]?.name ?? '';
  return `${normalizeTitle(track.title)}|${normalizeTitle(artist)}`;
};

export const deduplicateTracks = (tracks: Track[], limit = 25): Track[] => {
  const seen = new Set<string>();
  const result: Track[] = [];
  for (const track of tracks) {
    const fp = trackFingerprint(track);
    if (seen.has(fp)) continue;
    seen.add(fp);
    result.push(track);
    if (result.length >= limit) break;
  }
  return result;
};

export const deduplicateArtists = (artists: ArtistRef[], limit = 25): ArtistRef[] => {
  const seen = new Set<string>();
  const result: ArtistRef[] = [];
  for (const artist of artists) {
    const fp = normalizeTitle(artist.name);
    if (seen.has(fp)) continue;
    seen.add(fp);
    result.push(artist);
    if (result.length >= limit) break;
  }
  return result;
};

export const deduplicateAlbums = (albums: AlbumRef[], limit = 25): AlbumRef[] => {
  const seen = new Set<string>();
  const result: AlbumRef[] = [];
  for (const album of albums) {
    const artist = album.artists?.[0]?.name ?? '';
    const fp = `${normalizeTitle(album.title)}|${normalizeTitle(artist)}`;
    if (seen.has(fp)) continue;
    seen.add(fp);
    result.push(album);
    if (result.length >= limit) break;
  }
  return result;
};
