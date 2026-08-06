# nepo-babies-scraper

Builds a dataset of Letterboxd actors with a notable parent (a "nepo
baby") — "notable" meaning they have their own Wikipedia page. Powers the
[nepo-babies-extension](https://github.com/SomeLikeItChott/nepo-babies-extension)
and the stats site below.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## Usage

```sh
npm install
echo "TMDB_API_KEY=<your TMDB Read Access Token>" > .env
npm run scrape
```

Takes 45–75 minutes. Writes `output/nepo-babies.json` (resolved),
`output/unresolved.json` (couldn't be matched), `output/films.json`, and
`output/parents.json` — all gitignored, generated fresh each run.

## How it works

Combines TMDB (popularity-ranked actors and movie casts), Wikidata
(father/mother relations with an English Wikipedia article), and
Letterboxd (matching actors and parents to their profile pages).

- Candidate pool is capped at TMDB's popularity rankings and the top
  ~3,000 movies' casts — not a full sweep of every actor with a notable
  parent.
- Letterboxd matching is a best-effort heuristic, not authoritative —
  some real matches land in `unresolved.json` instead.

## Yearly stats (percentage by year)

`npm run scrape:yearly` is a separate, much cheaper pipeline that powers
the "nepo baby percentage by year" chart on the stats site — it doesn't
feed the extension at all. Unlike the main scrape, it isn't capped to a
popularity-ranked subset: it walks TMDB's `/discover/movie` one calendar
year at a time (movies with at least 50 votes — see `src/yearly-stats.ts`
for why that number and why one year at a time), which covers the real
historical catalog instead of just what's currently trending. It also
skips Letterboxd matching entirely, since none of this is extension-facing.

By default it only recomputes the **current** year (and, during the
first week of January, last year too — some of its movies are still
gaining votes shortly after year-end) and merges that into whatever's
already in `output/yearly-stats.json`, leaving other years untouched —
cheap enough to rerun every week so this year's percentage keeps
catching up as new releases accumulate votes. To (re)compute a wider
range — including a full historical backfill — override the start year
explicitly:

```sh
YEARLY_STATS_START_YEAR=1900 npm run scrape:yearly
```

This is a multi-hour run once you go back that far — dominated by the
one-time Wikidata pass over every actor in TMDB's history, not by TMDB
itself.
It can be triggered from GitHub Actions too (`update-yearly-stats.yml`'s
`workflow_dispatch` takes a `start_year` input), but a single run that
long has no checkpointing — output is only written once, at the very
end — so a failure partway through loses the whole run. Prefer breaking
a full backfill into smaller chunks (e.g. a handful of `workflow_dispatch`
runs, each covering a decade or two via `YEARLY_STATS_START_YEAR`/
`YEARLY_STATS_END_YEAR`) so progress actually lands in `yearly-stats.json`
incrementally. `YEARLY_STATS_END_YEAR` bounds the other end of the range.

Every run also caches each actor's Wikidata result (do they have a
notable parent?) by TMDB id in `.cache/nepo-baby-checks.json` — see
`src/nepo-baby-cache.ts`. Since the current-year default mostly re-sees
the same actors week to week, this turns most weekly runs into a lookup
instead of a repeat Wikidata batch pass. In CI, `update-yearly-stats.yml`
persists this file between runs via `actions/cache` (GitHub Actions
checkouts are otherwise fresh every time, with nothing on disk to reuse).

## Stats site

[`site/`](site/) is a small Vite + TypeScript static site showing
aggregate stats over the dataset. Hosted at https://somelikeitchott.github.io/nepo-babies-scraper/.

<!-- TODO: screenshot of the site -->

```sh
cd site
npm install
npm run dev
```

The dev server fetches `films.json`/`parents.json`/`yearly-stats.json`
from `site/public/`, none of which are committed. Rather than waiting on
a full 45–75 minute `npm run scrape` to get fresh copies, run:

```sh
npm run sync-site-data
```

from the `scraper/` root to copy whatever's already in `output/` (from
any previous scrape) into `site/public/`. Delete any local copies before
committing.

`npm run build` outputs to `site/dist/`, published by the workflow below.

## Automated weekly publish

`.github/workflows/update-dataset.yml` runs the scrape and site build on
a weekly cron and publishes everything — `nepo-babies.json.gz`,
`films.json`, `parents.json`, and the site itself — to this repo's
GitHub Pages. Needs a `TMDB_API_KEY` repo secret and Pages enabled on the
`gh-pages` branch.

`.github/workflows/update-yearly-stats.yml` separately runs the
current-year-only refresh described above on the same weekly cadence
(an hour offset, to avoid both jobs publishing at once) and publishes
`yearly-stats.json` to the same `gh-pages` branch. It can also be
triggered manually from the Actions tab with `start_year`/`end_year`
inputs for a backfill — see above for why that's best done as several
smaller runs rather than one long one.
