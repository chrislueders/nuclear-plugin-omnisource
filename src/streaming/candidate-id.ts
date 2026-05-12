import type { SourcePrefix } from '../config';

export const encodeCandidateId = (prefix: SourcePrefix, rawId: string): string =>
  `${prefix}:${rawId}`;

export type ParsedCandidateId =
  | { source: 'yt'; id: string }
  | { source: 'sc'; id: string }
  | { source: 'bc'; encodedUrl: string };

export const parseCandidateId = (candidateId: string): ParsedCandidateId => {
  const colonIndex = candidateId.indexOf(':');
  if (colonIndex === -1) {
    throw new Error(`Invalid unified candidateId (no prefix): ${candidateId}`);
  }
  const prefix = candidateId.slice(0, colonIndex);
  const rest = candidateId.slice(colonIndex + 1);
  switch (prefix) {
    case 'yt': return { source: 'yt', id: rest };
    case 'sc': return { source: 'sc', id: rest };
    case 'bc': return { source: 'bc', encodedUrl: rest };
    default: throw new Error(`Unknown source prefix: ${prefix}`);
  }
};
