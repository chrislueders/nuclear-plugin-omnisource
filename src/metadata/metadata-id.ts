export const encodeMetadataId = (
  prefix: 'mb' | 'bc' | 'sc' | 'ytpl',
  rawId: string,
): string => `${prefix}:${rawId}`;

export type ParsedMetadataId =
  | { source: 'mb'; id: string }
  | { source: 'bc'; encodedUrl: string }
  | { source: 'sc'; id: string }
  | { source: 'ytpl'; playlistId: string };

export const parseMetadataId = (metadataId: string): ParsedMetadataId => {
  const colonIndex = metadataId.indexOf(':');
  if (colonIndex === -1) {
    throw new Error(`Invalid unified metadataId (no prefix): ${metadataId}`);
  }
  const prefix = metadataId.slice(0, colonIndex);
  const rest = metadataId.slice(colonIndex + 1);
  switch (prefix) {
    case 'mb': return { source: 'mb', id: rest };
    case 'bc': return { source: 'bc', encodedUrl: rest };
    case 'sc': return { source: 'sc', id: rest };
    case 'ytpl': return { source: 'ytpl', playlistId: rest };
    default: throw new Error(`Unknown metadata prefix: ${prefix}`);
  }
};
