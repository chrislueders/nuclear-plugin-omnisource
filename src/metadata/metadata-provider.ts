import type {
  Album,
  AlbumRef,
  ArtistBio,
  ArtistRef,
  MetadataProvider,
  NuclearPluginAPI,
  PlaylistRef,
  SearchParams,
  Track,
} from '@nuclearplayer/plugin-sdk';

import { METADATA_PROVIDER_ID, SEARCH_LIMITS, SOURCE_TIMEOUT_MS } from '../config';
import {
  getBandcampAlbumDetails,
  getBandcampArtistAlbums,
  getBandcampArtistBio,
  searchBandcampAlbums,
  searchBandcampArtists,
  searchBandcampTracks,
} from '../sources/bandcamp-meta';
import { MusicBrainzClient, mbCoverArtUrl } from '../sources/musicbrainz';
import { searchScArtists, searchScTracks } from '../sources/soundcloud-meta';
import { fetchYoutubePlaylistDetails, searchYoutubePlaylist, searchYoutubePlaylistsAsAlbums } from '../sources/youtube-playlists-search';
import { withTimeout } from '../util/timeout';
import { deduplicateAlbums, deduplicateArtists, deduplicateTracks } from './dedup';
import { encodeMetadataId, parseMetadataId } from './metadata-id';

const fromSettled = <T>(result: PromiseSettledResult<T[]>): T[] =>
  result.status === 'fulfilled' ? result.value : [];

const mbSource = (mbid: string) => ({
  provider: METADATA_PROVIDER_ID,
  id: encodeMetadataId('mb', mbid),
});

const mbArtwork = (mbid: string) => ({
  items: [
    { url: mbCoverArtUrl(mbid, 500), purpose: 'cover' as const },
    { url: mbCoverArtUrl(mbid, 250), purpose: 'thumbnail' as const },
  ],
});

export const createMetadataProvider = (
  api: NuclearPluginAPI,
  mb: MusicBrainzClient,
): MetadataProvider =>
  ({
    id: METADATA_PROVIDER_ID,
    kind: 'metadata',
    name: 'OmniSource',
    searchCapabilities: ['artists', 'albums', 'tracks', 'playlists'],
    artistMetadataCapabilities: ['artistBio', 'artistAlbums'],
    albumMetadataCapabilities: ['albumDetails'],

    async searchTracks(params: Omit<SearchParams, 'types'>): Promise<Track[]> {
      const limit = params.limit ?? 25;

      const promises: Promise<Track[]>[] = [
        withTimeout(SOURCE_TIMEOUT_MS, mb.searchRecordings(params.query, SEARCH_LIMITS.mb).then((res) =>
          res.recordings.map((rec) => {
            const firstRelease = rec.releases?.[0];
            return {
              title: rec.title,
              artists: (rec['artist-credit'] ?? []).map((c) => ({
                name: c.artist.name,
                roles: [],
                source: mbSource(c.artist.id),
              })),
              durationMs: rec.length ?? undefined,
              album: firstRelease
                ? {
                    title: firstRelease.title,
                    artwork: mbArtwork(firstRelease.id),
                    source: mbSource(firstRelease.id),
                  }
                : undefined,
              source: mbSource(rec.id),
            };
          }),
        )),
        withTimeout(SOURCE_TIMEOUT_MS, searchBandcampTracks(api.Http.fetch, params.query, SEARCH_LIMITS.bc_meta)),
        withTimeout(SOURCE_TIMEOUT_MS, searchScTracks(api.Http.fetch, params.query, SEARCH_LIMITS.sc_meta)),
      ];

      const results = await Promise.allSettled(promises);
      const [mbRes, bcRes, scRes] = results;

      if (mbRes?.status === 'rejected') api.Logger.warn(`MB track search failed: ${mbRes.reason}`);
      if (bcRes?.status === 'rejected') api.Logger.warn(`Bandcamp track search failed: ${bcRes.reason}`);
      if (scRes?.status === 'rejected') api.Logger.warn(`SoundCloud track search failed: ${scRes.reason}`);

      const all = [
        ...fromSettled(mbRes!),
        ...fromSettled(bcRes!),
        ...fromSettled(scRes!),
      ];

      return deduplicateTracks(all, limit);
    },

    async searchArtists(params: Omit<SearchParams, 'types'>): Promise<ArtistRef[]> {
      const limit = params.limit ?? 25;

      const [mbRes, bcRes, scRes] = await Promise.allSettled([
        withTimeout(SOURCE_TIMEOUT_MS, mb.searchArtists(params.query, SEARCH_LIMITS.mb).then((res) =>
          res.artists.map((artist) => ({
            name: artist.name,
            disambiguation: artist.disambiguation || undefined,
            source: mbSource(artist.id),
          })),
        )),
        withTimeout(SOURCE_TIMEOUT_MS, searchBandcampArtists(api.Http.fetch, params.query, SEARCH_LIMITS.bc_meta)),
        withTimeout(SOURCE_TIMEOUT_MS, searchScArtists(api.Http.fetch, params.query, SEARCH_LIMITS.sc_meta)),
      ]);

      if (mbRes.status === 'rejected') api.Logger.warn(`MB artist search failed: ${mbRes.reason}`);
      if (bcRes.status === 'rejected') api.Logger.warn(`Bandcamp artist search failed: ${bcRes.reason}`);
      if (scRes.status === 'rejected') api.Logger.warn(`SoundCloud artist search failed: ${scRes.reason}`);

      return deduplicateArtists([...fromSettled(mbRes), ...fromSettled(bcRes), ...fromSettled(scRes)], limit);
    },

    async searchAlbums(params: Omit<SearchParams, 'types'>): Promise<AlbumRef[]> {
      const limit = params.limit ?? 25;

      const [mbRes, bcRes, ytRes] = await Promise.allSettled([
        withTimeout(SOURCE_TIMEOUT_MS, mb.searchReleaseGroups(params.query, SEARCH_LIMITS.mb).then((res) =>
          res['release-groups'].map((rg) => ({
            title: rg.title,
            artists: (rg['artist-credit'] ?? []).map((c) => ({
              name: c.artist.name,
              source: mbSource(c.artist.id),
            })),
            artwork: mbArtwork(rg.id),
            source: mbSource(rg.id),
          })),
        )),
        withTimeout(SOURCE_TIMEOUT_MS, searchBandcampAlbums(api.Http.fetch, params.query, SEARCH_LIMITS.bc_meta)),
        withTimeout(SOURCE_TIMEOUT_MS, searchYoutubePlaylistsAsAlbums(api.Http.fetch, params.query, SEARCH_LIMITS.yt_playlists)),
      ]);

      if (mbRes.status === 'rejected') api.Logger.warn(`MB album search failed: ${mbRes.reason}`);
      if (bcRes.status === 'rejected') api.Logger.warn(`Bandcamp album search failed: ${bcRes.reason}`);
      if (ytRes.status === 'rejected') api.Logger.warn(`YouTube playlist search failed: ${ytRes.reason}`);

      return deduplicateAlbums([...fromSettled(mbRes), ...fromSettled(bcRes), ...fromSettled(ytRes)], limit);
    },

    async searchPlaylists(params: Omit<SearchParams, 'types'>): Promise<PlaylistRef[]> {
      return withTimeout(
        SOURCE_TIMEOUT_MS,
        searchYoutubePlaylist(api.Http.fetch, params.query, SEARCH_LIMITS.yt_playlists),
      ).catch((err: unknown) => {
        api.Logger.warn(`YouTube playlist search failed: ${err}`);
        return [];
      });
    },

    async fetchArtistBio(artistId: string): Promise<ArtistBio> {
      const parsed = parseMetadataId(artistId);

      switch (parsed.source) {
        case 'mb': {
          const artist = await mb.getArtist(parsed.id);
          const wikipedia = await mb.fetchWikipediaData(artist.relations ?? []);
          return {
            name: artist.name,
            disambiguation: artist.disambiguation || undefined,
            bio: wikipedia?.extract,
            artwork: wikipedia?.thumbnail
              ? {
                  items: [
                    { url: wikipedia.thumbnail.source, purpose: 'cover' },
                    ...(wikipedia.originalimage
                      ? [{ url: wikipedia.originalimage.source, purpose: 'background' as const }]
                      : []),
                  ],
                }
              : undefined,
            tags: artist.genres?.filter((g) => g.count > 0).map((g) => g.name),
            source: mbSource(parsed.id),
          };
        }
        case 'bc':
          return getBandcampArtistBio(api.Http.fetch, parsed.encodedUrl);
        case 'sc':
          throw new Error(`SoundCloud artist bio fetch not implemented for id: ${artistId}`);
        case 'ytpl':
          throw new Error(`YouTube playlists do not have artist bio for id: ${artistId}`);
      }
    },

    async fetchArtistAlbums(artistId: string): Promise<AlbumRef[]> {
      const parsed = parseMetadataId(artistId);

      switch (parsed.source) {
        case 'mb': {
          const res = await mb.browseArtistReleaseGroups(parsed.id);
          return res['release-groups'].map((rg) => ({
            title: rg.title,
            artists: (rg['artist-credit'] ?? []).map((c) => ({
              name: c.artist.name,
              source: mbSource(c.artist.id),
            })),
            artwork: mbArtwork(rg.id),
            source: mbSource(rg.id),
          }));
        }
        case 'bc':
          return getBandcampArtistAlbums(api.Http.fetch, parsed.encodedUrl);
        case 'sc':
        case 'ytpl':
          return [];
      }
    },

    async fetchAlbumDetails(albumId: string): Promise<Album> {
      const parsed = parseMetadataId(albumId);

      switch (parsed.source) {
        case 'mb': {
          const releaseGroup = await mb.getReleaseGroup(parsed.id);
          const releasesRes = await mb.browseReleaseGroupReleases(parsed.id);
          const release = releasesRes.releases[0];

          const tracks = (release?.media ?? []).flatMap((medium) =>
            (medium.tracks ?? []).map((track) => ({
              title: track.recording.title,
              artists: (track['artist-credit'] ?? track.recording['artist-credit'] ?? []).map((c) => ({
                name: c.artist.name,
                roles: [],
                source: mbSource(c.artist.id),
              })),
              source: mbSource(track.recording.id),
              durationMs: track.length ?? undefined,
            })),
          );

          const firstReleaseDateStr = releaseGroup['first-release-date'];
          const releaseDate = firstReleaseDateStr
            ? (() => {
                const parts = firstReleaseDateStr.split('-');
                const precision = parts.length === 3 ? 'day' : parts.length === 2 ? 'month' : 'year';
                return { precision: precision as 'year' | 'month' | 'day', dateIso: firstReleaseDateStr };
              })()
            : undefined;

          return {
            title: releaseGroup.title,
            artists: ((releaseGroup['artist-credit'] ?? release?.['artist-credit']) ?? []).map((c) => ({
              name: c.artist.name,
              roles: [],
              source: mbSource(c.artist.id),
            })),
            tracks,
            releaseDate,
            genres: releaseGroup.genres?.filter((g) => g.count > 0).map((g) => g.name),
            artwork: mbArtwork(parsed.id),
            source: mbSource(parsed.id),
          };
        }
        case 'bc':
          return getBandcampAlbumDetails(api.Http.fetch, parsed.encodedUrl);
        case 'sc':
          throw new Error(`SoundCloud album details not supported for id: ${albumId}`);
        case 'ytpl': {
          const playlistUrl = `https://www.youtube.com/playlist?list=${parsed.playlistId}`;
          const info = await fetchYoutubePlaylistDetails(api.Http.fetch, parsed.playlistId);
          return {
            title: info.title,
            artists: [],
            tracks: info.tracks,
            source: {
              provider: METADATA_PROVIDER_ID,
              id: encodeMetadataId('ytpl', parsed.playlistId),
              url: playlistUrl,
            },
          };
        }
      }
    },
  }) satisfies MetadataProvider;
