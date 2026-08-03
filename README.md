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

## Stats site

[`site/`](site/) is a small Vite + TypeScript static site showing
aggregate stats over the dataset.

<!-- TODO: screenshot of the site -->

```sh
cd site
npm install
npm run dev
```

The dev server fetches `films.json`/`parents.json` from `site/public/`,
which isn't committed — generate them locally by running
`fetchPopularMovieCast()` through `computeFilmStats`/`computeParentStats`
(`src/films.ts`, `src/parents.ts`) for a small movie count, or just work
against the real deployed site. Delete any local copies before
committing.

`npm run build` outputs to `site/dist/`, published by the workflow below.

## Automated weekly publish

`.github/workflows/update-dataset.yml` runs the scrape and site build on
a weekly cron and publishes everything — `nepo-babies.json.gz`,
`films.json`, `parents.json`, and the site itself — to this repo's
GitHub Pages. Needs a `TMDB_API_KEY` repo secret and Pages enabled on the
`gh-pages` branch.
