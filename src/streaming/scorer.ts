import type { StreamCandidate } from '@nuclearplayer/plugin-sdk';

import type { SourcePrefix } from '../config';
import { DURATION_BONUS, DURATION_TOLERANCE, SOURCE_WEIGHTS } from '../config';
import { diceCoefficient, normalizeTitle } from '../util/similarity';

const PENALTY_WORDS = ['live', 'cover', 'karaoke', 'instrumental', 'acoustic'];

export type ScoredCandidate = StreamCandidate & { _score: number; _source: SourcePrefix };

export const scoreCandidate = (
  candidate: StreamCandidate,
  source: SourcePrefix,
  artist: string,
  title: string,
  expectedDurationMs: number | undefined,
): ScoredCandidate => {
  const queryNorm = normalizeTitle(`${artist} ${title}`);
  const candidateNorm = normalizeTitle(candidate.title);

  let score = 50 * diceCoefficient(candidateNorm, queryNorm);

  if (expectedDurationMs && candidate.durationMs) {
    const ratio = Math.abs(candidate.durationMs - expectedDurationMs) / expectedDurationMs;
    if (ratio <= DURATION_TOLERANCE) score += DURATION_BONUS;
  }

  score += SOURCE_WEIGHTS[source];

  const queryLower = `${artist} ${title}`.toLowerCase();
  const titleLower = candidate.title.toLowerCase();
  for (const word of PENALTY_WORDS) {
    if (titleLower.includes(word) && !queryLower.includes(word)) {
      score -= 15;
    }
  }

  return { ...candidate, _score: score, _source: source };
};

export const sortCandidates = (candidates: ScoredCandidate[]): StreamCandidate[] => {
  const sorted = [...candidates].sort((a, b) => b._score - a._score);
  return sorted.map(({ _score: _, _source: __, ...rest }) => rest);
};
