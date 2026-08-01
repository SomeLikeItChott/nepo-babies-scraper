# nepo-babies scraper

Offline batch job that builds a static dataset of Letterboxd actors who have a
notable parent (a "nepo baby"). Not part of the browser extension itself —
this is a scraper you run manually to produce `output/nepo-babies.json`,
which the extension will eventually bundle.

## How it works

1. **TMDB** (`src/tmdb.ts`), two combined candidate sources:
   - `fetchPopularActors()`: paginates `/person/popular` (20 results/page,
     ranked by TMDB's own popularity score) up to `TARGET_ACTOR_COUNT`,
     filtered to the `"Acting"` department — the endpoint's "popular people"
     list also includes directors, producers, etc. TMDB hard-caps pagination
     at page 500 regardless of the `total_pages` figure it reports (confirmed
     live: page 500 succeeds, page 501 returns a 400), so the real ceiling on
     its own is 10,000 raw entries, roughly 6,000-7,000 after the Acting
     filter — see `MAX_TMDB_PAGE`.
   - `fetchPopularMovieCast()`: paginates `/movie/popular` up to
     `TARGET_MOVIE_COUNT`, and for each movie fetches its *entire* cast via
     `/movie/{id}/credits` — no billing-order cutoff, since Letterboxd's own
     cast lists routinely include named bit-part roles well past the top 20
     (confirmed live, e.g. Dune: Part Two's "Young Fremen Patrol" entries).
     A single popular movie can contribute 60+ candidates this way, which is
     what lets the total pool grow well past the person-popularity endpoint's
     ceiling on its own.

   `wikidata.ts`'s `fetchNepoCandidates()` runs both concurrently and merges
   them deduped by TMDb id before continuing. Requires a `TMDB_API_KEY` (a
   TMDB "Read Access Token", sent as a Bearer token) in `.env`, gitignored.
2. **Wikidata** (`src/wikidata.ts`), a three-phase pipeline over that
   combined TMDB list:
   - `resolveWikidataQids()`: batched `VALUES` lookup (chunked at
     `VALUES_BATCH_SIZE`) matching each actor's TMDb id against `wdt:P4985`
     to find their Wikidata QID, if any (~89% hit rate observed).
   - `fetchNotableParents()`: batches those QIDs and keeps only the actors
     with a father (`P22`) and/or mother (`P25`) who themselves have an
     English Wikipedia article.
   - `fetchOccupationsByQid()`: batch-fetches each qualifying parent's raw
     occupation labels (`wdt:P106`).
   - `fetchTmdbIdsByQid()`: batch-fetches each parent's own TMDb id
     (`wdt:P4985`), if Wikidata has one, so `index.ts` can try to resolve
     *their* Letterboxd page too (see step 3) — not just the actor's.
     `fetchNotableParents()`'s query also captures `?fatherArticle` /
     `?motherArticle` (the enwiki article URL Wikidata was already resolving
     internally to confirm the parent has one at all) directly into the
     output as `wikipediaUrl` — a free field, no extra query needed.

   Sourcing the popularity ranking from TMDB rather than Wikidata itself is
   what makes this reliable: `ORDER BY DESC(?sitelinks)` (sorting Wikidata's
   whole actor population by a fame proxy) times out even at `LIMIT 15` — no
   efficient top-k sort on that pseudo-property — and even a plain
   `OPTIONAL`/`FILTER` scan over that population stops being reliable past
   roughly `LIMIT 450-600`. Every Wikidata query here is instead scoped to a
   known, bounded list via `VALUES`, which stays fast and reliable regardless
   of how large the *total* Wikidata actor population is. `runQuery()` still
   retries (`QUERY_RETRIES`) on failure, since Wikidata's endpoint has been
   observed to return a `200` with a truncated, invalid JSON body under load
   even for these bounded queries — a real failure mode, not hypothetical.
3. **Letterboxd** (`src/letterboxd.ts`): for each candidate, guesses their
   Letterboxd person slug from their name (`src/slugify.ts`) and confirms the
   match by checking the TMDb id linked on that Letterboxd page against the
   TMDb id from Wikidata. If the base slug doesn't match, it tries
   Letterboxd's numbered disambiguation suffixes (`-1`, `-2`, ...) — this is
   how Letterboxd actually handles name collisions (confirmed against live
   pages, e.g. `chris-evans`, `chris-evans-1`, `chris-evans-2` are three
   different people).
4. Writes `output/nepo-babies.json` (resolved, keyed by Letterboxd slug) and
   `output/unresolved.json` (candidates that couldn't be matched, for manual
   follow-up).

Letterboxd's `/search/actors/...` endpoint is behind a Cloudflare JS
challenge and can't be queried directly with a plain HTTP request — that's
why slug resolution works by guessing + verifying instead of searching.
`index.ts` runs this same resolution for each candidate's parents too, so
parents can link to their own Letterboxd page — falling back to
`wikipediaUrl` when no Letterboxd page is found (genuinely common for
parents with no film/TV career at all, e.g. politicians or musicians).

Getting a parent's TMDb id to verify against isn't always as simple as
reading Wikidata's `wdt:P4985` (`fetchTmdbIdsByQid` in `wikidata.ts`) —
that property is confirmed live to be much less consistently populated for
behind-the-camera people (directors, producers, screenwriters) than for
actors; several real director/producer parents in this dataset had no
P4985 at all despite clearly having both TMDB and Letterboxd pages. When
Wikidata comes up empty, `searchTmdbPersonId()` (`src/tmdb.ts`) falls back
to TMDB's own `/search/person` by name, requiring an exact
(case-insensitive) name match to avoid confidently linking the wrong
same-ish-named person (e.g. "Ram Mukherjee" vs. "Ram Kamal Mukherjee") — a
missed match here just means no link, same as today, not a worse outcome.

Requests to Letterboxd are cached on disk (`.cache/`) and rate-limited
(750ms between real requests), so reruns during development don't re-hit
Letterboxd for pages already fetched. Delete `.cache/` to force a refresh.
`fetchWithCache()` (`src/cache.ts`) retries real fetches on failure — a
transient `ECONNRESET` actually killed a multi-hour run mid-way through
before this was added, so it's a real, not hypothetical, failure mode.

## Usage

Create `.env` (gitignored) with a TMDB Read Access Token:

```
TMDB_API_KEY=<your TMDB Read Access Token>
```

Then:

```sh
npm install
npm run scrape
```

Output lands in `output/nepo-babies.json` and `output/unresolved.json`
(both gitignored — generated artifacts). Expect the full run to take on the
order of 45-75 minutes: `fetchPopularMovieCast` alone adds ~3,000 TMDB
requests (one per movie's credits), and the Letterboxd resolution step
(750ms/candidate, one request per actor with a notable parent) scales with
however many more candidates the wider pool surfaces — it's still the
single biggest chunk of the runtime.

## Automated weekly publish

`.github/workflows/update-dataset.yml` runs this same scrape on a weekly
cron (Mondays), gzips the output (`npm run gzip-output`), and publishes it
to this repo's `gh-pages` branch. That's the file the
[nepo-babies-extension](https://github.com/SomeLikeItChott/nepo-babies-extension)
fetches at runtime — see its README. Requires a `TMDB_API_KEY` repo secret
and GitHub Pages enabled (serving the `gh-pages` branch).

## Known MVP Limitations

- **Candidate set is bounded by TMDB's own popularity rankings and page
  cap**, not a full sweep of every actor with a notable parent. See
  `TARGET_ACTOR_COUNT` and `TARGET_MOVIE_COUNT` in `src/wikidata.ts`, and
  `MAX_TMDB_PAGE` in `src/tmdb.ts`.
- **Father/mother only.** Sibling (`P3373`), family (`P53`), and other
  relative (`P1038`) relations from Wikidata are not pulled yet. Adding them
  is a straightforward extension of the same SPARQL query.
- **Occupations are raw and unfiltered.** Each relation's `occupations`
  array is exactly what Wikidata returns for that parent — unordered, and
  sometimes containing near-duplicates at different specificities (e.g. both
  `"director"` and `"film director"`). Prioritizing/deduping/capping this
  list for display is handled downstream in the extension, not here, so this
  dataset stays maximally complete.
- **Slug resolution is a heuristic**, not guaranteed complete or correct.
  It's a guess-and-verify approach (normalize name -> try slug -> try
  numbered suffixes -> confirm via TMDb id), not an authoritative lookup, so
  some real matches will land in `unresolved.json` and need manual review.
