import type { NepoCandidate, RelationType } from "./types.js";
import {
  fetchPopularActors as fetchPopularActorsFromTmdb,
  fetchPopularMovieCast,
  type PopularPerson,
} from "./tmdb.js";

const ENDPOINT = "https://query.wikidata.org/sparql";

// Contact info in the User-Agent per Wikidata's query service etiquette:
// https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual#Query_limits
const USER_AGENT = "nepo-babies-scraper/0.1 (personal project; contact samchott@gmail.com)";

/**
 * How many popular actors to seed from TMDB (see tmdb.ts). This used to be
 * bottlenecked by Wikidata's own popularity-ranking limitations (sorting or
 * even filtering its whole actor population by fame was unreliable at
 * scale — see git history for the sitelinks-threshold approach this
 * replaced). Sourcing the popularity ranking from TMDB directly instead and
 * only using Wikidata for bounded, VALUES-scoped lookups sidesteps that
 * entirely, so this number is now just a straightforward dataset-size knob
 * — except TMDB itself caps at 10,000 raw "popular people" (page 500 max,
 * see MAX_TMDB_PAGE in tmdb.ts), and after filtering to just the "Acting"
 * department the real ceiling is roughly 6,000-7,000 actors. Setting this
 * higher than that just means fetchPopularActorsFromTmdb naturally returns
 * everything it can rather than hitting this target exactly.
 */
const TARGET_ACTOR_COUNT = 10000;

/**
 * How many top popular movies (see tmdb.ts fetchPopularMovieCast) to pull
 * full cast lists from, as a second candidate source alongside
 * TARGET_ACTOR_COUNT. Combined with TMDB's own person-popularity ranking,
 * this widens the pool well beyond the ~6,000-7,000 ceiling of that single
 * endpoint — a single popular movie can contribute 60+ candidates since the
 * whole cast is taken (no billing-order cutoff, see fetchPopularMovieCast's
 * doc comment for why). This meaningfully increases scraper runtime (~3,000
 * extra TMDB requests, one per movie's credits).
 */
const TARGET_MOVIE_COUNT = 3000;

// Wikidata's query service times out on a single query that GROUP_CONCATs
// occupations for both parents at once (the father/mother occupation lists
// cross-multiply against each other), and similarly struggles with large
// unbounded scans. Batching VALUES-scoped lookups over a known, bounded QID
// (or TMDb id) list keeps every query small and reliable.
const VALUES_BATCH_SIZE = 150;

const QUERY_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

function buildQidLookupQuery(tmdbIds: string[]): string {
  const values = tmdbIds.map((id) => `"${id}"`).join(" ");
  return `
SELECT ?person ?personTmdb WHERE {
  VALUES ?personTmdb { ${values} }
  ?person wdt:P4985 ?personTmdb .
}
`.trim();
}

function buildNotableParentsQuery(qids: string[]): string {
  const values = qids.map((qid) => `wd:${qid}`).join(" ");
  return `
SELECT ?person ?father ?fatherLabel ?fatherArticle ?mother ?motherLabel ?motherArticle WHERE {
  VALUES ?person { ${values} }
  OPTIONAL {
    ?person wdt:P22 ?father .
    ?fatherArticle schema:about ?father ; schema:isPartOf <https://en.wikipedia.org/> .
    ?father rdfs:label ?fatherLabel . FILTER(LANG(?fatherLabel) = "en")
  }
  OPTIONAL {
    ?person wdt:P25 ?mother .
    ?motherArticle schema:about ?mother ; schema:isPartOf <https://en.wikipedia.org/> .
    ?mother rdfs:label ?motherLabel . FILTER(LANG(?motherLabel) = "en")
  }
  FILTER(BOUND(?fatherLabel) || BOUND(?motherLabel))
}
`.trim();
}

function buildOccupationQuery(qids: string[]): string {
  const values = qids.map((qid) => `wd:${qid}`).join(" ");
  return `
SELECT ?person ?occupationLabel WHERE {
  VALUES ?person { ${values} }
  ?person wdt:P106 ?occupation .
  ?occupation rdfs:label ?occupationLabel . FILTER(LANG(?occupationLabel) = "en")
}
`.trim();
}

function buildParentTmdbIdQuery(qids: string[]): string {
  const values = qids.map((qid) => `wd:${qid}`).join(" ");
  return `
SELECT ?person ?personTmdb WHERE {
  VALUES ?person { ${values} }
  ?person wdt:P4985 ?personTmdb .
}
`.trim();
}

function buildBirthDateQuery(qids: string[]): string {
  const values = qids.map((qid) => `wd:${qid}`).join(" ");
  return `
SELECT ?person ?birthDate WHERE {
  VALUES ?person { ${values} }
  ?person wdt:P569 ?birthDate .
}
`.trim();
}

interface QidLookupBinding {
  person: { value: string };
  personTmdb: { value: string };
}

interface NotableParentBinding {
  person: { value: string };
  father?: { value: string };
  fatherLabel?: { value: string };
  fatherArticle?: { value: string };
  mother?: { value: string };
  motherLabel?: { value: string };
  motherArticle?: { value: string };
}

interface OccupationBinding {
  person: { value: string };
  occupationLabel: { value: string };
}

interface ParentTmdbIdBinding {
  person: { value: string };
  personTmdb: { value: string };
}

interface BirthDateBinding {
  person: { value: string };
  birthDate: { value: string };
}

interface SparqlResponse<T> {
  results: { bindings: T[] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wikidata's public endpoint is observably flaky under load at the scale
 * this scraper operates at — sometimes returning a 200 with a truncated,
 * invalid-JSON body rather than a clean timeout. Reading the body as text
 * and parsing explicitly (instead of res.json()) means truncation surfaces
 * as a normal catchable error here, so the retry loop below covers it.
 */
async function runQuery<T>(query: string): Promise<T[]> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= QUERY_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);

    try {
      const url = new URL(ENDPOINT);
      url.searchParams.set("query", query);

      const res = await fetch(url, {
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": USER_AGENT,
        },
      });

      if (!res.ok) {
        throw new Error(`Wikidata query failed: ${res.status} ${res.statusText}`);
      }

      const text = await res.text();
      const data = JSON.parse(text) as SparqlResponse<T>;
      return data.results.bindings;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

function qidFromUri(uri: string): string {
  return uri.split("/").pop()!;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

interface PopularActor {
  qid: string;
  name: string;
  tmdbId: number;
}

/**
 * Reverse-looks-up Wikidata QIDs for a list of TMDb-sourced actors by
 * matching their TMDb id against wdt:P4985 (batched VALUES, chunked). Not
 * every popular TMDb actor has a Wikidata item with that property filled
 * in, so the result is a subset of the input.
 */
async function resolveWikidataQids(people: PopularPerson[]): Promise<PopularActor[]> {
  const byTmdbId = new Map(people.map((p) => [String(p.tmdbId), p]));
  const resolved: PopularActor[] = [];

  for (const [i, batch] of chunk([...byTmdbId.keys()], VALUES_BATCH_SIZE).entries()) {
    if (i > 0) await sleep(300);

    const bindings = await runQuery<QidLookupBinding>(buildQidLookupQuery(batch));
    for (const b of bindings) {
      const person = byTmdbId.get(b.personTmdb.value);
      if (!person) continue;
      resolved.push({ qid: qidFromUri(b.person.value), name: person.name, tmdbId: person.tmdbId });
    }
  }

  return resolved;
}

interface RawRelation {
  type: RelationType;
  name: string;
  qid: string;
  wikipediaUrl: string;
}

interface RawCandidate {
  qid: string;
  name: string;
  tmdbId: number;
  relations: RawRelation[];
}

async function fetchNotableParents(actors: PopularActor[]): Promise<RawCandidate[]> {
  const byQid = new Map(actors.map((a) => [a.qid, a]));
  const candidates: RawCandidate[] = [];

  for (const [i, batch] of chunk(actors.map((a) => a.qid), VALUES_BATCH_SIZE).entries()) {
    if (i > 0) await sleep(300);

    const bindings = await runQuery<NotableParentBinding>(buildNotableParentsQuery(batch));
    for (const b of bindings) {
      const actor = byQid.get(qidFromUri(b.person.value));
      if (!actor) continue;

      const relations: RawRelation[] = [];
      if (b.father && b.fatherLabel && b.fatherArticle) {
        relations.push({
          type: "father",
          name: b.fatherLabel.value,
          qid: qidFromUri(b.father.value),
          wikipediaUrl: b.fatherArticle.value,
        });
      }
      if (b.mother && b.motherLabel && b.motherArticle) {
        relations.push({
          type: "mother",
          name: b.motherLabel.value,
          qid: qidFromUri(b.mother.value),
          wikipediaUrl: b.motherArticle.value,
        });
      }

      candidates.push({ qid: actor.qid, name: actor.name, tmdbId: actor.tmdbId, relations });
    }
  }

  return candidates;
}

async function fetchOccupationsByQid(qids: string[]): Promise<Map<string, string[]>> {
  const occupationsByQid = new Map<string, string[]>();

  for (const [i, batch] of chunk(qids, VALUES_BATCH_SIZE).entries()) {
    if (i > 0) await sleep(300);

    const bindings = await runQuery<OccupationBinding>(buildOccupationQuery(batch));
    for (const b of bindings) {
      const qid = qidFromUri(b.person.value);
      const label = b.occupationLabel.value;
      const existing = occupationsByQid.get(qid) ?? [];
      if (!existing.includes(label)) existing.push(label);
      occupationsByQid.set(qid, existing);
    }
  }

  return occupationsByQid;
}

/**
 * Batch-fetches each parent's own TMDb id (P4985), if Wikidata has one —
 * used downstream (letterboxd.ts, via index.ts) to resolve their Letterboxd
 * slug the same way we already do for the actor being profiled. Many
 * notable parents (politicians, musicians, businesspeople) have no TMDB
 * presence at all, so this is naturally a subset of the input.
 */
async function fetchTmdbIdsByQid(qids: string[]): Promise<Map<string, number>> {
  const tmdbIdByQid = new Map<string, number>();

  for (const [i, batch] of chunk(qids, VALUES_BATCH_SIZE).entries()) {
    if (i > 0) await sleep(300);

    const bindings = await runQuery<ParentTmdbIdBinding>(buildParentTmdbIdQuery(batch));
    for (const b of bindings) {
      tmdbIdByQid.set(qidFromUri(b.person.value), Number(b.personTmdb.value));
    }
  }

  return tmdbIdByQid;
}

/**
 * Batch-fetches each parent's date of birth (P569), if Wikidata has one —
 * used as a disambiguation signal in searchTmdbPersonId()'s fallback
 * (index.ts), since an exact name match on TMDB doesn't guarantee it's the
 * same real person. Confirmed live: Woody Harrelson's father Charles
 * Harrelson — not a film-industry person, so no P4985 — has an exact
 * namesake on TMDB (a different, unrelated actor) that a name-only search
 * would confidently but wrongly link to.
 */
async function fetchBirthDatesByQid(qids: string[]): Promise<Map<string, string>> {
  const birthDateByQid = new Map<string, string>();

  for (const [i, batch] of chunk(qids, VALUES_BATCH_SIZE).entries()) {
    if (i > 0) await sleep(300);

    const bindings = await runQuery<BirthDateBinding>(buildBirthDateQuery(batch));
    for (const b of bindings) {
      // Wikidata returns a full dateTime literal (e.g. "1938-07-23T00:00:00Z");
      // only the date part is comparable against TMDB's "YYYY-MM-DD" birthday field.
      birthDateByQid.set(qidFromUri(b.person.value), b.birthDate.value.split("T")[0]);
    }
  }

  return birthDateByQid;
}

export async function fetchNepoCandidates(): Promise<NepoCandidate[]> {
  const [popularPeople, movieCastPeople] = await Promise.all([
    fetchPopularActorsFromTmdb(TARGET_ACTOR_COUNT),
    fetchPopularMovieCast(TARGET_MOVIE_COUNT),
  ]);

  const dedupedByTmdbId = new Map<number, PopularPerson>();
  for (const person of [...popularPeople, ...movieCastPeople]) {
    if (!dedupedByTmdbId.has(person.tmdbId)) dedupedByTmdbId.set(person.tmdbId, person);
  }
  const popularActors = [...dedupedByTmdbId.values()];

  const resolvedActors = await resolveWikidataQids(popularActors);
  const rawCandidates = await fetchNotableParents(resolvedActors);

  const allParentQids = [...new Set(rawCandidates.flatMap((c) => c.relations.map((r) => r.qid)))];
  const [occupationsByQid, parentTmdbIdByQid, parentBirthDateByQid] = await Promise.all([
    fetchOccupationsByQid(allParentQids),
    fetchTmdbIdsByQid(allParentQids),
    fetchBirthDatesByQid(allParentQids),
  ]);

  return rawCandidates.map((c) => ({
    name: c.name,
    tmdbId: c.tmdbId,
    relations: c.relations.map((r) => ({
      type: r.type,
      name: r.name,
      occupations: occupationsByQid.get(r.qid) ?? [],
      tmdbId: parentTmdbIdByQid.get(r.qid),
      birthDate: parentBirthDateByQid.get(r.qid),
      wikipediaUrl: r.wikipediaUrl,
    })),
  }));
}
