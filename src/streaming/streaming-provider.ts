import type {
  NuclearPluginAPI,
  Stream,
  StreamCandidate,
  StreamingProvider,
  Track,
} from '@nuclearplayer/plugin-sdk';

import { SEARCH_LIMITS, SOURCE_TIMEOUT_MS, STREAMING_PROVIDER_ID } from '../config';
import { resolveBandcampStream, searchBandcampStream } from '../sources/bandcamp-stream';
import { resolveScStream, searchSoundcloudStream } from '../sources/soundcloud-stream';
import { searchYoutube } from '../sources/youtube';
import { withTimeout } from '../util/timeout';
import { parseCandidateId } from './candidate-id';
import { ScoredCandidate, scoreCandidate, sortCandidates } from './scorer';

const fromSettled = <T>(result: PromiseSettledResult<T[]>): T[] =>
  result.status === 'fulfilled' ? result.value : [];

const scoreCandidates = (
  candidates: StreamCandidate[],
  source: 'yt' | 'sc' | 'bc',
  artist: string,
  title: string,
  durationMs: number | undefined,
): ScoredCandidate[] =>
  candidates.map((c) => scoreCandidate(c, source, artist, title, durationMs));

export const createStreamingProvider = (api: NuclearPluginAPI): StreamingProvider => ({
  id: STREAMING_PROVIDER_ID,
  kind: 'streaming',
  name: 'OmniSource',

  searchForTrack: async (artist: string, title: string): Promise<StreamCandidate[]> => {
    const [ytRes, scRes, bcRes] = await Promise.allSettled([
      withTimeout(SOURCE_TIMEOUT_MS, searchYoutube(api, artist, title, SEARCH_LIMITS.yt)),
      withTimeout(SOURCE_TIMEOUT_MS, searchSoundcloudStream(api.Http.fetch, artist, title, SEARCH_LIMITS.sc)),
      withTimeout(SOURCE_TIMEOUT_MS, searchBandcampStream(api.Http.fetch, artist, title, SEARCH_LIMITS.bc)),
    ]);

    api.Logger.debug(
      `OmniSource stream search "${artist} - ${title}": yt=${ytRes.status}, sc=${scRes.status}, bc=${bcRes.status}`,
    );

    if (ytRes.status === 'rejected') api.Logger.warn(`YouTube search failed: ${ytRes.reason}`);
    if (scRes.status === 'rejected') api.Logger.warn(`SoundCloud search failed: ${scRes.reason}`);
    if (bcRes.status === 'rejected') api.Logger.warn(`Bandcamp search failed: ${bcRes.reason}`);

    const scored: ScoredCandidate[] = [
      ...scoreCandidates(fromSettled(ytRes), 'yt', artist, title, undefined),
      ...scoreCandidates(fromSettled(scRes), 'sc', artist, title, undefined),
      ...scoreCandidates(fromSettled(bcRes), 'bc', artist, title, undefined),
    ];

    return sortCandidates(scored);
  },

  searchForTrackV2: async (track: Track): Promise<StreamCandidate[]> => {
    const artist = track.artists[0]?.name ?? '';
    const title = track.title;
    const durationMs = track.durationMs;

    // Direct shortcuts when unified-meta already has the streaming source id
    const sourceId = track.source?.id;
    if (sourceId?.startsWith('yt:')) {
      const videoId = sourceId.slice(3);
      const id = `yt:${videoId}`;
      api.Logger.debug(`Unified stream: direct YouTube shortcut for "${title}" (${videoId})`);
      return [{ id, title, failed: false, source: { provider: STREAMING_PROVIDER_ID, id } }];
    }
    if (sourceId?.startsWith('bc:')) {
      api.Logger.debug(`Unified stream: direct Bandcamp source shortcut for "${title}"`);
      const encodedUrl = sourceId.slice(3);
      const id = `bc:${encodedUrl}`;
      return [{ id, title, failed: false, source: { provider: STREAMING_PROVIDER_ID, id } }];
    }

    const [ytRes, scRes, bcRes] = await Promise.allSettled([
      withTimeout(SOURCE_TIMEOUT_MS, searchYoutube(api, artist, title, SEARCH_LIMITS.yt)),
      withTimeout(SOURCE_TIMEOUT_MS, searchSoundcloudStream(api.Http.fetch, artist, title, SEARCH_LIMITS.sc)),
      withTimeout(SOURCE_TIMEOUT_MS, searchBandcampStream(api.Http.fetch, artist, title, SEARCH_LIMITS.bc)),
    ]);

    api.Logger.debug(
      `OmniSource stream searchV2 "${artist} - ${title}": yt=${ytRes.status}, sc=${scRes.status}, bc=${bcRes.status}`,
    );

    if (ytRes.status === 'rejected') api.Logger.warn(`YouTube search failed: ${ytRes.reason}`);
    if (scRes.status === 'rejected') api.Logger.warn(`SoundCloud search failed: ${scRes.reason}`);
    if (bcRes.status === 'rejected') api.Logger.warn(`Bandcamp search failed: ${bcRes.reason}`);

    const scored: ScoredCandidate[] = [
      ...scoreCandidates(fromSettled(ytRes), 'yt', artist, title, durationMs),
      ...scoreCandidates(fromSettled(scRes), 'sc', artist, title, durationMs),
      ...scoreCandidates(fromSettled(bcRes), 'bc', artist, title, durationMs),
    ];

    return sortCandidates(scored);
  },

  getStreamUrl: async (candidateId: string): Promise<Stream> => {
    const parsed = parseCandidateId(candidateId);

    switch (parsed.source) {
      case 'yt': {
        const info = await api.Ytdlp.getStream(parsed.id);
        return {
          url: info.stream_url,
          protocol: 'https',
          durationMs: info.duration ? info.duration * 1000 : undefined,
          container: info.container ?? undefined,
          codec: info.codec ?? undefined,
          source: { provider: STREAMING_PROVIDER_ID, id: candidateId },
        };
      }

      case 'sc': {
        const stream = await resolveScStream(api.Http.fetch, parsed.id);
        return {
          url: stream.url,
          protocol: 'hls',
          mimeType: stream.mimeType,
          bitrateKbps: stream.bitrateKbps,
          durationMs: stream.durationMs,
          source: { provider: STREAMING_PROVIDER_ID, id: candidateId, url: stream.permalinkUrl },
        };
      }

      case 'bc': {
        const { url, durationMs } = await resolveBandcampStream(api.Http.fetch, parsed.encodedUrl);
        return {
          url,
          protocol: 'https',
          mimeType: 'audio/mpeg',
          bitrateKbps: 128,
          durationMs,
          source: { provider: STREAMING_PROVIDER_ID, id: candidateId },
        };
      }
    }
  },
});
