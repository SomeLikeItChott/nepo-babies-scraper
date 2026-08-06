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
  popularity: number;
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
  popularity: number;
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
        actors.push({ tmdbId: person.id, name: person.name, popularity: person.popularity });
      }
    }

    page++;
    await sleep(REQUEST_DELAY_MS);
  }

  return actors.slice(0, targetCount);
}

interface TmdbMovie {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  popularity: number;
}

interface TmdbPopularMoviesResponse {
  results: TmdbMovie[];
}

interface TmdbCastMember {
  id: number;
  name: string;
  popularity: number;
  order: number;
}

interface TmdbCreditsResponse {
  cast: TmdbCastMember[];
}

export interface FilmCast {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  releaseDate: string | null;
  popularity: number;
  cast: PopularPerson[];
}

/**
 * A cast member plus their billing position in that specific movie's
 * credits (0 = top-billed). Separate from PopularPerson (which
 * fetchPopularActors also returns) since billing order is a property of a
 * *credit*, not of the person themselves — the same person has a different
 * order in every movie they're in.
 */
export interface CastCredit extends PopularPerson {
  order: number;
}

/**
 * Fetches one movie's full cast via `/movie/{id}/credits` — no billing-order
 * cutoff (see fetchPopularMovieCast's doc comment for why), just the whole
 * list TMDB returns. Falls back to a large order for the rare credit
 * missing one (observed as `null` for some archival/uncredited entries)
 * rather than letting it sort as if top-billed.
 */
export async function fetchMovieCredits(movieId: number): Promise<CastCredit[]> {
  const credits = await tmdbFetch<TmdbCreditsResponse>(`/movie/${movieId}/credits`, {
    language: "en-US",
  });
  return credits.cast.map((member) => ({
    tmdbId: member.id,
    name: member.name,
    popularity: member.popularity,
    order: member.order ?? 9999,
  }));
}

/**
 * Fetches the full cast of the top `movieCount` popular movies
 * (`/movie/popular`, 20/page, then one `/movie/{id}/credits` call per
 * movie), keeping each movie's cast grouped under it (title/poster/
 * popularity come from the same `/movie/popular` response, already fetched
 * for the pagination — no extra requests). Unlike fetchPopularActors, this
 * takes the *entire* cast list per movie with no billing-order cutoff —
 * Letterboxd's own cast lists routinely include named bit-part roles well
 * past the top 20 (confirmed live on Dune: Part Two's page, e.g. "Young
 * Fremen Patrol"), so trimming here would just mean missing real matches
 * later. This means a single popular movie can contribute 60+ candidates,
 * so the resulting pool is intentionally much larger than
 * fetchPopularActors' output.
 */
export async function fetchPopularMovieCast(movieCount: number): Promise<FilmCast[]> {
  const films: FilmCast[] = [];
  const seenMovieIds = new Set<number>();
  let page = 1;

  while (films.length < movieCount && page <= MAX_TMDB_PAGE) {
    const data = await tmdbFetch<TmdbPopularMoviesResponse>("/movie/popular", {
      language: "en-US",
      page: String(page),
    });

    for (const movie of data.results) {
      if (films.length >= movieCount) break;

      // TMDB's popularity ranking is live and shifts while a scrape is in
      // progress (this can take well over an hour), so the same movie can
      // land on two different pages fetched at different times — skip
      // repeats rather than double-counting them and wasting a credits
      // fetch on a duplicate.
      if (seenMovieIds.has(movie.id)) continue;
      seenMovieIds.add(movie.id);

      const cast = await fetchMovieCredits(movie.id);
      films.push({
        tmdbId: movie.id,
        title: movie.title,
        posterPath: movie.poster_path,
        releaseYear: movie.release_date ? Number(movie.release_date.slice(0, 4)) : null,
        releaseDate: movie.release_date || null,
        popularity: movie.popularity,
        cast,
      });

      await sleep(REQUEST_DELAY_MS);
    }

    page++;
  }

  return films;
}

export interface DiscoveredMovie {
  tmdbId: number;
  title: string;
  voteCount: number;
}

interface TmdbDiscoverMovie {
  id: number;
  title: string;
  vote_count: number;
}

interface TmdbDiscoverResponse {
  results: TmdbDiscoverMovie[];
  total_pages: number;
}

/**
 * Fetches every movie TMDB has for a given calendar year at or above a
 * minimum vote count, via `/discover/movie` filtered by `primary_release_year`
 * (TMDB's single canonical release year per movie) rather than `release_date`
 * (which matches against *any* regional/re-release date a movie has and would
 * double-count the same movie across multiple years). Querying one year at a
 * time also sidesteps the same 500-page/10,000-result cap noted on
 * fetchPopularActors above — each year gets its own budget.
 */
export async function discoverMoviesByYear(
  year: number,
  minVoteCount: number,
): Promise<DiscoveredMovie[]> {
  const movies: DiscoveredMovie[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await tmdbFetch<TmdbDiscoverResponse>("/discover/movie", {
      primary_release_year: String(year),
      "vote_count.gte": String(minVoteCount),
      sort_by: "vote_count.desc",
      language: "en-US",
      page: String(page),
    });

    for (const movie of data.results) {
      movies.push({ tmdbId: movie.id, title: movie.title, voteCount: movie.vote_count });
    }

    totalPages = Math.min(data.total_pages, MAX_TMDB_PAGE);
    page++;
    if (page <= totalPages) await sleep(REQUEST_DELAY_MS);
  } while (page <= totalPages);

  return movies;
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

interface TmdbPersonDetail {
  id: number;
  birthday: string | null;
}

async function fetchTmdbPersonBirthday(id: number): Promise<string | null> {
  const data = await tmdbFetch<TmdbPersonDetail>(`/person/${id}`, { language: "en-US" });
  return data.birthday;
}

/**
 * Finds a TMDb id for a person by name via /search/person, for the case
 * where Wikidata has no wdt:P4985 for them at all — a real, common gap for
 * behind-the-camera people (directors, producers, screenwriters), since
 * that property is far less consistently populated for them on Wikidata
 * than it is for actors (confirmed live: several real director/producer
 * parents in this dataset had no P4985 despite clearly having TMDB pages).
 *
 * Only accepts an exact (case-insensitive) name match — but an exact name
 * match alone isn't enough to guarantee the same real person, since two
 * different people can share an exact name, not just a similar one
 * (confirmed live: Woody Harrelson's father Charles Harrelson — not a
 * film-industry person, so no P4985 — has an exact TMDB namesake who is a
 * different, unrelated actor). When Wikidata has a birth date (P569) for
 * this person, expectedBirthDate cross-checks it against each exact-name
 * candidate's TMDB `birthday` and only returns a match if exactly one
 * candidate's birthday agrees. Without a birth date to check against,
 * falls back to requiring the name match to be unique among the results —
 * multiple same-named candidates with nothing to disambiguate them means
 * no confident match, same as no match at all, not a worse outcome.
 */
export async function searchTmdbPersonId(
  name: string,
  expectedBirthDate?: string,
): Promise<number | null> {
  const data = await tmdbFetch<TmdbPersonSearchResponse>("/search/person", {
    query: name,
    language: "en-US",
  });

  const exactMatches = data.results.filter((r) => normalizeName(r.name) === normalizeName(name));

  if (!expectedBirthDate) {
    return exactMatches.length === 1 ? exactMatches[0].id : null;
  }

  const birthdayMatches: TmdbPersonSearchResult[] = [];
  for (const [i, candidate] of exactMatches.entries()) {
    if (i > 0) await sleep(REQUEST_DELAY_MS);
    const birthday = await fetchTmdbPersonBirthday(candidate.id);
    if (birthday === expectedBirthDate) birthdayMatches.push(candidate);
  }

  return birthdayMatches.length === 1 ? birthdayMatches[0].id : null;
}
