import type { StreamCandidate } from '@nuclearplayer/plugin-sdk';

import type { SourcePrefix } from '../config';
import { DURATION_BONUS, PENALTY_PER_WORD, PROMOTED_BONUS, SOURCE_WEIGHTS, VERBATIM_BONUS } from '../config';
import { diceCoefficient, normalizeTitle } from '../util/similarity';

const PENALTY_WORDS = ['live', 'cover', 'karaoke', 'instrumental', 'acoustic', 'remix', 'full album'];
const PROMOTED_WORDS = ['official', 'hq', 'high quality'];

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
  const candidateRaw = candidate.title.toLowerCase();
  const queryRaw = `${artist} ${title}`.toLowerCase();

  let score = 50 * diceCoefficient(candidateNorm, queryNorm);

  // Verbatim: exact title string appears in result → strong signal
  if (title && candidateRaw.includes(title.toLowerCase())) {
    score += VERBATIM_BONUS;
  }

  // Continuous duration score: full bonus at exact match, tapers to 0 at 100% deviation
  if (expectedDurationMs && candidate.durationMs) {
    const ratio = Math.abs(candidate.durationMs - expectedDurationMs) / expectedDurationMs;
    score += Math.max(0, 1 - ratio) * DURATION_BONUS;
  }

  // Promoted words on raw title
  for (const word of PROMOTED_WORDS) {
    if (candidateRaw.includes(word)) {
      score += PROMOTED_BONUS;
    }
  }

  // Penalty words on raw title (skip if word was intentional in query)
  for (const word of PENALTY_WORDS) {
    if (candidateRaw.includes(word) && !queryRaw.includes(word)) {
      score -= PENALTY_PER_WORD;
    }
  }

  score += SOURCE_WEIGHTS[source];

  return { ...candidate, _score: score, _source: source };
};

export const sortCandidates = (candidates: ScoredCandidate[]): StreamCandidate[] => {
  const sorted = [...candidates].sort((a, b) => b._score - a._score);
  return sorted.map(({ _score: _, _source: __, ...rest }) => rest);
};
