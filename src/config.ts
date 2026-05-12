export const STREAMING_PROVIDER_ID = 'omnisource-stream';
export const METADATA_PROVIDER_ID = 'omnisource-meta';


export const SOURCE_TIMEOUT_MS = 8_000;

export const SOURCE_WEIGHTS = {
  yt: 3,
  sc: 2,
  bc: 1,
} as const;

export type SourcePrefix = keyof typeof SOURCE_WEIGHTS;

export const DURATION_TOLERANCE = 0.05;
export const DURATION_BONUS = 20;

export const SEARCH_LIMITS = {
  yt: 5,
  sc: 5,
  bc: 5,
  mb: 10,
  sc_meta: 10,
  bc_meta: 10,
  yt_playlists: 10,
} as const;
