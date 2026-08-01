const TMDB_BASE = "https://api.themoviedb.org/3";
const REQUEST_DELAY_MS = 150;
const REQUEST_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PopularPerson {
  tmdbId: number;
  name: string;
}

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    throw new Error("TMDB_API_KEY is not set — add it to scraper/.env");
  }

  const url = new URL(`${TMDB_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let lastError: unknown;
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`TMDB request failed: ${res.status} ${res.statusText} (${path})`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// TMDB hard-caps pagination at page 500 regardless of the `total_pages`
// figure it reports (confirmed live: page 500 succeeds, page 501 returns a
// 400 "Pages start at 1 and max at 500"). At 20 results/page that's 10,000
// raw entries max per paginated endpoint.
const MAX_TMDB_PAGE = 500;

interface TmdbPerson {
  id: number;
  name: string;
  known_for_department: string;
}

interface TmdbPopularPeopleResponse {
  results: TmdbPerson[];
}

/**
 * Fetches popular people from TMDB's /person/popular (20 results/page,
 * ranked by TMDB's own popularity score) and filters to the "Acting"
 * department — the endpoint's "popular people" list also includes
 * directors, producers, etc. Since only ~60-70% of results are "Acting",
 * the real ceiling this can return is roughly 6,000-7,000 actors, not
 * whatever `targetCount` asks for — it stops at TMDB's page cap rather
 * than erroring.
 */
export async function fetchPopularActors(targetCount: number): Promise<PopularPerson[]> {
  const actors: PopularPerson[] = [];
  let page = 1;

  while (actors.length < targetCount && page <= MAX_TMDB_PAGE) {
    const data = await tmdbFetch<TmdbPopularPeopleResponse>("/person/popular", {
      language: "en-US",
      page: String(page),
    });

    for (const person of data.results) {
      if (person.known_for_department === "Acting") {
        actors.push({ tmdbId: person.id, name: person.name });
      }
    }

    page++;
    await sleep(REQUEST_DELAY_MS);
  }

  return actors.slice(0, targetCount);
}

interface TmdbMovie {
  id: number;
}

interface TmdbPopularMoviesResponse {
  results: TmdbMovie[];
}

interface TmdbCastMember {
  id: number;
  name: string;
}

interface TmdbCreditsResponse {
  cast: TmdbCastMember[];
}

/**
 * Fetches the full cast of the top `movieCount` popular movies
 * (`/movie/popular`, 20/page, then one `/movie/{id}/credits` call per
 * movie). Unlike fetchPopularActors, this takes the *entire* cast list per
 * movie with no billing-order cutoff — Letterboxd's own cast lists
 * routinely include named bit-part roles well past the top 20 (confirmed
 * live on Dune: Part Two's page, e.g. "Young Fremen Patrol"), so trimming
 * here would just mean missing real matches later. This means a single
 * popular movie can contribute 60+ candidates, so the resulting pool is
 * intentionally much larger than fetchPopularActors' output.
 */
export async function fetchPopularMovieCast(movieCount: number): Promise<PopularPerson[]> {
  const actors: PopularPerson[] = [];
  let page = 1;
  let moviesSeen = 0;

  while (moviesSeen < movieCount && page <= MAX_TMDB_PAGE) {
    const data = await tmdbFetch<TmdbPopularMoviesResponse>("/movie/popular", {
      language: "en-US",
      page: String(page),
    });

    for (const movie of data.results) {
      if (moviesSeen >= movieCount) break;
      moviesSeen++;

      const credits = await tmdbFetch<TmdbCreditsResponse>(`/movie/${movie.id}/credits`, {
        language: "en-US",
      });
      for (const member of credits.cast) {
        actors.push({ tmdbId: member.id, name: member.name });
      }

      await sleep(REQUEST_DELAY_MS);
    }

    page++;
  }

  return actors;
}

interface TmdbPersonSearchResult {
  id: number;
  name: string;
}

interface TmdbPersonSearchResponse {
  results: TmdbPersonSearchResult[];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Finds a TMDb id for a person by name via /search/person, for the case
 * where Wikidata has no wdt:P4985 for them at all — a real, common gap for
 * behind-the-camera people (directors, producers, screenwriters), since
 * that property is far less consistently populated for them on Wikidata
 * than it is for actors (confirmed live: several real director/producer
 * parents in this dataset had no P4985 despite clearly having TMDB pages).
 * Only accepts an exact (case-insensitive) name match against a result to
 * avoid confidently linking to the wrong same-ish-named person — TMDB's
 * search can return close-but-different matches (e.g. "Ram Mukherjee" vs
 * "Ram Kamal Mukherjee"). A missed match here just means no link is added,
 * which is the same as today's behavior, not a worse outcome.
 */
export async function searchTmdbPersonId(name: string): Promise<number | null> {
  const data = await tmdbFetch<TmdbPersonSearchResponse>("/search/person", {
    query: name,
    language: "en-US",
  });

  const match = data.results.find((r) => normalizeName(r.name) === normalizeName(name));
  return match ? match.id : null;
}
