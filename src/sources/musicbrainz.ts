import type { FetchFunction } from '@nuclearplayer/plugin-sdk';

const MUSICBRAINZ_API_BASE = 'https://musicbrainz.org/ws/2';
const WIKIPEDIA_API_BASE = 'https://en.wikipedia.org/api/rest_v1';
const WIKIDATA_API_BASE = 'https://www.wikidata.org/wiki/Special:EntityData';
const COVER_ART_ARCHIVE_BASE = 'https://coverartarchive.org';
const RATE_LIMIT_INTERVAL_MS = 1_100;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export { COVER_ART_ARCHIVE_BASE };

export type MbArtistCredit = {
  name: string;
  joinphrase: string;
  artist: { id: string; name: string; 'sort-name': string; disambiguation?: string };
};

export type MbRecording = {
  id: string;
  title: string;
  length: number | null;
  disambiguation: string;
  'artist-credit'?: MbArtistCredit[];
  releases?: MbRelease[];
};

export type MbRelease = {
  id: string;
  title: string;
  status?: string;
  date?: string;
  'cover-art-archive'?: { artwork: boolean; front: boolean };
  'artist-credit'?: MbArtistCredit[];
  media?: MbMedia[];
};

export type MbMedia = {
  format: string | null;
  position: number;
  'track-count': number;
  tracks?: MbTrack[];
};

export type MbTrack = {
  id: string;
  number: string;
  title: string;
  position: number;
  length: number | null;
  'artist-credit'?: MbArtistCredit[];
  recording: MbRecording;
};

export type MbArtist = {
  id: string;
  name: string;
  'sort-name': string;
  type: string | null;
  disambiguation: string;
  country?: string;
  aliases?: { name: string }[];
  tags?: { name: string; count: number }[];
  genres?: { id: string; name: string; count: number }[];
  relations?: MbRelation[];
};

export type MbRelation = {
  type: string;
  direction: string;
  url: { id: string; resource: string };
  attributes: string[];
};

export type MbReleaseGroup = {
  id: string;
  title: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
  'first-release-date'?: string;
  disambiguation: string;
  'artist-credit'?: MbArtistCredit[];
  releases?: MbRelease[];
  genres?: { id: string; name: string; count: number }[];
};

export type MbArtistSearchResult = MbArtist & { score: number };
export type MbReleaseGroupSearchResult = MbReleaseGroup & { score: number };
export type MbRecordingSearchResult = MbRecording & { score: number };

export type WikipediaSummary = {
  title: string;
  extract: string;
  thumbnail?: { source: string; width: number; height: number };
  originalimage?: { source: string; width: number; height: number };
};

export class MusicBrainzClient {
  readonly #fetch: FetchFunction;
  #lastRequestTime = 0;
  #queue: Array<{ resolve: () => void; reject: (r: unknown) => void }> = [];
  #processing = false;

  constructor(fetchFn: FetchFunction) {
    this.#fetch = fetchFn;
  }

  async #waitForRateLimit(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#queue.push({ resolve, reject });
      if (!this.#processing) this.#processQueue();
    });
  }

  async #processQueue(): Promise<void> {
    this.#processing = true;
    while (this.#queue.length > 0) {
      const elapsed = Date.now() - this.#lastRequestTime;
      if (elapsed < RATE_LIMIT_INTERVAL_MS) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT_INTERVAL_MS - elapsed));
      }
      this.#lastRequestTime = Date.now();
      this.#queue.shift()?.resolve();
    }
    this.#processing = false;
  }

  async #get<T>(path: string): Promise<T> {
    await this.#waitForRateLimit();
    const sep = path.includes('?') ? '&' : '?';
    const url = `${MUSICBRAINZ_API_BASE}${path}${sep}fmt=json`;
    const res = await this.#fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`MusicBrainz error: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async searchArtists(query: string, limit = 25) {
    return this.#get<{ artists: MbArtistSearchResult[] }>(
      `/artist?query=${encodeURIComponent(query)}&limit=${limit}&dismax=true`,
    );
  }

  async searchReleaseGroups(query: string, limit = 25) {
    return this.#get<{ 'release-groups': MbReleaseGroupSearchResult[] }>(
      `/release-group?query=${encodeURIComponent(query)}&limit=${limit}&dismax=true`,
    );
  }

  async searchRecordings(query: string, limit = 25) {
    return this.#get<{ recordings: MbRecordingSearchResult[] }>(
      `/recording?query=${encodeURIComponent(query)}&limit=${limit}&dismax=true`,
    );
  }

  async getArtist(mbid: string) {
    return this.#get<MbArtist>(`/artist/${mbid}?inc=aliases+tags+genres+ratings+url-rels`);
  }

  async getReleaseGroup(mbid: string) {
    return this.#get<MbReleaseGroup>(`/release-group/${mbid}?inc=artist-credits+tags+genres`);
  }

  async browseArtistReleaseGroups(artistMbid: string, limit = 100, offset = 0) {
    return this.#get<{ 'release-group-count': number; 'release-groups': MbReleaseGroup[] }>(
      `/release-group?artist=${artistMbid}&type=album|ep&limit=${limit}&offset=${offset}&inc=artist-credits`,
    );
  }

  async browseReleaseGroupReleases(releaseGroupMbid: string) {
    return this.#get<{ 'release-count': number; releases: MbRelease[] }>(
      `/release?release-group=${releaseGroupMbid}&status=official&limit=1&inc=recordings+artist-credits+media`,
    );
  }

  async fetchWikipediaData(relations: MbRelation[]): Promise<WikipediaSummary | null> {
    try {
      const wikidataRel = relations.find((r) => r.type === 'wikidata');
      if (!wikidataRel) return null;
      const wikidataId = wikidataRel.url.resource.match(/wikidata\.org\/wiki\/(Q\d+)/)?.[1];
      if (!wikidataId) return null;

      const wikidataRes = await this.#fetch(`${WIKIDATA_API_BASE}/${wikidataId}.json`);
      if (!wikidataRes.ok) return null;
      const wikidataData: { entities: Record<string, { sitelinks?: Record<string, { title: string }> }> } =
        await wikidataRes.json();
      const articleTitle = wikidataData.entities[wikidataId]?.sitelinks?.enwiki?.title;
      if (!articleTitle) return null;

      const encodedTitle = encodeURIComponent(articleTitle.replace(/ /g, '_'));
      const wpRes = await this.#fetch(`${WIKIPEDIA_API_BASE}/page/summary/${encodedTitle}`);
      if (!wpRes.ok) return null;
      return wpRes.json();
    } catch {
      return null;
    }
  }
}

export const mbCoverArtUrl = (mbid: string, size: 250 | 500 = 500) =>
  `${COVER_ART_ARCHIVE_BASE}/release-group/${mbid}/front-${size}`;
