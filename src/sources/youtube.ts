import type { NuclearPluginAPI, StreamCandidate } from '@nuclearplayer/plugin-sdk';

import { encodeCandidateId } from '../streaming/candidate-id';

export const searchYoutube = async (
  api: NuclearPluginAPI,
  artist: string,
  title: string,
  limit: number,
): Promise<StreamCandidate[]> => {
  const query = `${artist} ${title}`;
  const results = await api.Ytdlp.search(query);
  return results.slice(0, limit).map((result) => ({
    id: encodeCandidateId('yt', result.id),
    title: result.title,
    durationMs: result.duration ? result.duration * 1000 : undefined,
    thumbnail: result.thumbnail ?? undefined,
    failed: false,
    source: { provider: 'unified-stream', id: encodeCandidateId('yt', result.id) },
  }));
};
