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
(candidates that couldn't be matched).

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
cron (Mondays), gzips the output (`npm run gzip-output`), and publishes it
to this repo's `gh-pages` branch. That's the file the
[nepo-babies-extension](https://github.com/SomeLikeItChott/nepo-babies-extension)
fetches at runtime — see its README. Requires a `TMDB_API_KEY` repo secret
and GitHub Pages enabled (serving the `gh-pages` branch).
