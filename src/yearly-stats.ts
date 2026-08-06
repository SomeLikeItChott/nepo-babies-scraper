import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { discoverMoviesByYear, fetchMovieCredits, type PopularPerson } from "./tmdb.js";
import { fetchNotableParents, fetchWikipediaUrlsByQid, resolveWikidataQids } from "./wikidata.js";
import { findRedirectUrls } from "./wikipedia.js";
import { loadNepoBabyCache, saveNepoBabyCache } from "./nepo-baby-cache.js";

const OUTPUT_DIR = path.join(process.cwd(), "output");

// See the README for how this number was picked — TMDB's `vote_count` is a
// proxy for "did real humans engage with this on the site at all", not
// quality or fame, and 50 is roughly the point past which discover results
// stop being data-entry-only entries and start being movies someone
// noticed. Deliberately using `primary_release_year` rather than
// `release_date.gte/lte` here (see discoverMoviesByYear's doc comment in
// tmdb.ts) so each movie lands in exactly one year, not once per
// region/re-release date it happens to have on file.
const MIN_VOTE_COUNT = 50;

// TMDB's soft rate limit is ~40 req/s per IP with no daily cap (see
// README/commit history for the source) — this stays comfortably under that
// while still being a large improvement over the weekly scraper's
// sequential-with-sleep approach, which would make a full-catalog run take
// far too long.
const CREDITS_CONCURRENCY = 10;

const TOP_NEPO_BABY_COUNT = 5;

interface LeastVotedFilm {
  tmdbId: number;
  title: string;
  voteCount: number;
}

interface BestFilmAppearance {
  tmdbId: number;
  title: string;
  voteCount: number;
  order: number;
}

/**
 * Ranks a specific credit by how much it should count as "a big year" for
 * that actor — the movie's vote count, discounted by how far down the
 * billing they were (order 0 = lead, full credit; order 30 = deep in an
 * ensemble, ~3% credit). A live person-popularity snapshot (the previous
 * approach) doesn't vary by year at all — the same actor with the same
 * qualifying credit shows up as "top" in every year they have one,
 * regardless of how substantial that particular role or movie was that
 * year (confirmed live: Truman Hanks ranked top-5 in four separate years
 * purely because his current popularity beat the era's other nepo babies
 * each time — see git history/commit discussion). This ties the ranking to
 * that specific year's actual film instead.
 */
function filmScore(film: BestFilmAppearance): number {
  return film.voteCount / (film.order + 1);
}

interface TopNepoBaby {
  tmdbId: number;
  name: string;
  popularity: number;
  wikipediaUrl?: string;
  bestFilm: BestFilmAppearance;
}

interface YearStats {
  year: number;
  filmCount: number;
  castSize: number;
  nepoBabyCount: number;
  leastVotedFilm: LeastVotedFilm | null;
  topNepoBabies: TopNepoBaby[];
}

interface ActorTally {
  name: string;
  popularity: number;
  appearances: number;
  bestFilm: BestFilmAppearance;
}

interface YearAccumulator {
  filmCount: number;
  leastVotedFilm: LeastVotedFilm | null;
  actors: Map<number, ActorTally>;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/**
 * Loads whatever was written by a previous run, keyed by year, so a normal
 * (current-year-only) run can merge its fresh result into the existing
 * historical data instead of needing to recompute the whole catalog every
 * time this runs. Starts empty on the very first run, or the first run after
 * a fresh checkout in CI (see the workflow's "seed from gh-pages" step,
 * which restores the last published copy before this runs).
 */
async function loadExistingStats(): Promise<Map<number, YearStats>> {
  try {
    const raw = await readFile(path.join(OUTPUT_DIR, "yearly-stats.json"), "utf8");
    const parsed = JSON.parse(raw) as YearStats[];
    return new Map(parsed.map((entry) => [entry.year, entry]));
  } catch {
    return new Map();
  }
}

async function collectYear(year: number): Promise<YearAccumulator> {
  const movies = await discoverMoviesByYear(year, MIN_VOTE_COUNT);
  console.log(`[${year}] ${movies.length} movies with >=${MIN_VOTE_COUNT} votes`);

  const castLists = await mapWithConcurrency(movies, CREDITS_CONCURRENCY, async (movie) => {
    try {
      return await fetchMovieCredits(movie.tmdbId);
    } catch (err) {
      console.warn(`  [${year}] failed to fetch credits for "${movie.title}" (${movie.tmdbId}): ${String(err)}`);
      return null;
    }
  });

  const accumulator: YearAccumulator = { filmCount: 0, leastVotedFilm: null, actors: new Map() };

  for (const [i, movie] of movies.entries()) {
    const cast = castLists[i];
    if (cast === null) continue;

    accumulator.filmCount++;
    if (!accumulator.leastVotedFilm || movie.voteCount < accumulator.leastVotedFilm.voteCount) {
      accumulator.leastVotedFilm = { tmdbId: movie.tmdbId, title: movie.title, voteCount: movie.voteCount };
    }

    for (const member of cast) {
      const thisFilm: BestFilmAppearance = {
        tmdbId: movie.tmdbId,
        title: movie.title,
        voteCount: movie.voteCount,
        order: member.order,
      };

      const tally = accumulator.actors.get(member.tmdbId);
      if (tally) {
        tally.appearances++;
        if (filmScore(thisFilm) > filmScore(tally.bestFilm)) tally.bestFilm = thisFilm;
      } else {
        accumulator.actors.set(member.tmdbId, {
          name: member.name,
          popularity: member.popularity,
          appearances: 1,
          bestFilm: thisFilm,
        });
      }
    }
  }

  return accumulator;
}

async function main() {
  // Local dev convenience only — see index.ts for why this is safe in CI too.
  try {
    process.loadEnvFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // Defaults to *only* the current year — cheap enough to rerun every week
  // so this year's percentage keeps catching up as new releases pick up
  // votes, without rescanning the whole catalog each time. A one-off full
  // historical backfill (or a backfill of any specific range) is a manual
  // invocation with an explicit override, e.g.
  // `YEARLY_STATS_START_YEAR=1900 npm run scrape:yearly`.
  //
  // Exception: during the first week of January, also redo last year —
  // some of its movies are still gaining votes shortly after year-end (a
  // late awards-season bump, catching up on a limited release, etc.), so
  // one final pass catches those before that year is otherwise never
  // touched again.
  const now = new Date();
  const currentYear = now.getFullYear();
  const isFirstRunOfYear = now.getMonth() === 0 && now.getDate() <= 7;
  const defaultStartYear = isFirstRunOfYear ? currentYear - 1 : currentYear;

  const startYear = Number(process.env.YEARLY_STATS_START_YEAR) || defaultStartYear;
  const endYear = Number(process.env.YEARLY_STATS_END_YEAR) || currentYear;

  console.log(`Scanning ${startYear}-${endYear} for movies with at least ${MIN_VOTE_COUNT} votes...`);

  const yearAccumulators = new Map<number, YearAccumulator>();
  const globalActors = new Map<number, PopularPerson>();

  for (let year = startYear; year <= endYear; year++) {
    const accumulator = await collectYear(year);
    for (const [tmdbId, tally] of accumulator.actors) {
      if (!globalActors.has(tmdbId)) {
        globalActors.set(tmdbId, { tmdbId, name: tally.name, popularity: tally.popularity });
      }
    }
    yearAccumulators.set(year, accumulator);
  }

  // A person's Wikidata-notable-parent status is essentially permanent, and
  // the default current-year-only run mostly re-sees the same actors week
  // over week — so skip Wikidata entirely for anyone already checked in a
  // previous run (see nepo-baby-cache.ts) and only query it for genuinely
  // new actors.
  const nepoBabyCache = await loadNepoBabyCache();
  const uncachedActors = [...globalActors.values()].filter((a) => !nepoBabyCache.has(a.tmdbId));
  console.log(
    `\n${globalActors.size - uncachedActors.length}/${globalActors.size} actors already checked in a ` +
      `previous run; querying Wikidata for the other ${uncachedActors.length}...`,
  );

  if (uncachedActors.length > 0) {
    const resolvedActors = await resolveWikidataQids(uncachedActors);
    const qidByTmdbId = new Map(resolvedActors.map((a) => [a.tmdbId, a.qid]));

    const nepoBabyCandidates = await fetchNotableParents(resolvedActors);
    const nepoBabyQidByTmdbId = new Map(nepoBabyCandidates.map((c) => [c.tmdbId, c.qid]));

    console.log(`Found ${nepoBabyQidByTmdbId.size} new nepo babies. Fetching their Wikipedia links...`);
    const wikipediaUrlByQid = await fetchWikipediaUrlsByQid([...nepoBabyQidByTmdbId.values()]);
    const redirectUrls = await findRedirectUrls([...wikipediaUrlByQid.values()]);

    for (const actor of uncachedActors) {
      const qid = qidByTmdbId.get(actor.tmdbId);
      if (!qid) {
        nepoBabyCache.set(actor.tmdbId, { hasNotableParent: false });
        continue;
      }
      if (!nepoBabyQidByTmdbId.has(actor.tmdbId)) {
        nepoBabyCache.set(actor.tmdbId, { qid, hasNotableParent: false });
        continue;
      }
      const url = wikipediaUrlByQid.get(qid);
      nepoBabyCache.set(actor.tmdbId, {
        qid,
        hasNotableParent: true,
        wikipediaUrl: url && !redirectUrls.has(url) ? url : undefined,
      });
    }

    await saveNepoBabyCache(nepoBabyCache);
  }

  const freshStats: YearStats[] = [...yearAccumulators.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, accumulator]) => {
      let castSize = 0;
      let nepoBabyCount = 0;
      const nepoBabies: TopNepoBaby[] = [];

      for (const [tmdbId, tally] of accumulator.actors) {
        castSize += tally.appearances;
        const entry = nepoBabyCache.get(tmdbId);
        if (entry?.hasNotableParent) {
          nepoBabyCount += tally.appearances;
          nepoBabies.push({
            tmdbId,
            name: tally.name,
            popularity: tally.popularity,
            wikipediaUrl: entry.wikipediaUrl,
            bestFilm: tally.bestFilm,
          });
        }
      }

      nepoBabies.sort((a, b) => filmScore(b.bestFilm) - filmScore(a.bestFilm));

      return {
        year,
        filmCount: accumulator.filmCount,
        castSize,
        nepoBabyCount,
        leastVotedFilm: accumulator.leastVotedFilm,
        topNepoBabies: nepoBabies.slice(0, TOP_NEPO_BABY_COUNT),
      };
    });

  // Merge rather than overwrite, so a default (current-year-only) run
  // doesn't clobber history computed by an earlier, wider run.
  const merged = await loadExistingStats();
  for (const stat of freshStats) merged.set(stat.year, stat);
  const yearlyStats = [...merged.values()].sort((a, b) => a.year - b.year);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, "yearly-stats.json"), JSON.stringify(yearlyStats));

  console.log(
    `\nDone. Refreshed ${freshStats.length} year(s), ${yearlyStats.length} total in ` +
      `${OUTPUT_DIR}/yearly-stats.json`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
