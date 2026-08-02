# nepo-babies scraper

Offline batch job that builds a static dataset of Letterboxd actors who have a
notable parent (a "nepo baby"). Not part of the browser extension itself —
this is a scraper you run manually to produce `output/nepo-babies.json`,
which the extension will eventually bundle.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## How it works

Combines three sources: **TMDB** for popularity-ranked actor candidates
(`/person/popular`, plus the full cast lists of the top ~3,000 popular
movies), **Wikidata** (SPARQL) for father/mother relations who have their
own English Wikipedia article, and **Letterboxd** to resolve both the actor
and their parent to a Letterboxd profile page. Writes
`output/nepo-babies.json` (resolved) and `output/unresolved.json`
(candidates that couldn't be matched), plus `output/films.json` and
`output/parents.json` — film- and parent-level aggregate stats for
[`site/`](site/), independent of Letterboxd resolution since those stats
are TMDB/Wikidata-native.

Two limits worth knowing about the resulting data:

- **Candidate pool is capped at the top ~3,000 popular movies' full casts**
  (plus TMDB's own popularity-ranked actor list) — not a full sweep of every
  actor with a notable parent. See `TARGET_MOVIE_COUNT`/`TARGET_ACTOR_COUNT`
  in `src/wikidata.ts`.
- **Letterboxd slug matching is imperfect.** It's a guess-and-verify
  heuristic (normalize the name to a slug, confirm via TMDb id), not an
  authoritative lookup, so some real matches don't resolve and land in
  `unresolved.json` instead.

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
cron (Mondays), gzips the output (`npm run gzip-output`), builds
[`site/`](site/), and publishes everything to this repo's `gh-pages`
branch: `nepo-babies.json.gz` (fetched at runtime by
[nepo-babies-extension](https://github.com/SomeLikeItChott/nepo-babies-extension) — see
its README), `films.json` / `parents.json`, and the stats site itself, all
served side by side from the same Pages URL. Requires a `TMDB_API_KEY` repo
secret and GitHub Pages enabled (serving the `gh-pages` branch).

## Stats site

[`site/`](site/) is a small Vite + TypeScript static site that reads
`films.json`/`parents.json` at runtime and shows aggregate stats: a
histogram of nepo babies per film, the highest nepo-baby-percentage films
(with posters), the most popular recent film with zero nepo babies, and the
parent with the most nepo babies in the dataset. See [`site/README.md`](site/README.md)
for local development.
