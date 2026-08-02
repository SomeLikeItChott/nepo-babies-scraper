# nepo-babies stats site

Vite + vanilla TypeScript static site showing aggregate stats over the
dataset: a histogram of nepo babies per film, the highest nepo-baby-
percentage films (with posters), the most popular recent film with zero
nepo babies, and the parent with the most nepo babies in the dataset.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## How it works

`src/main.ts` fetches `./films.json` and `./parents.json` at runtime
(relative paths — same-origin once deployed alongside them, no CORS
config needed) and computes everything client-side: bucketing films by
`nepoBabyCount` for the histogram, sorting by `nepoBabyCount / castSize`
for the percentage ranking, and sorting `parents.json` by child count for
the top-parent card. Posters are hotlinked directly from TMDB's public
image CDN (`https://image.tmdb.org/t/p/w342${posterPath}`) — no image
hosting needed.

In production these two JSON files are published by the scraper repo's own
weekly workflow (`../.github/workflows/update-dataset.yml`) to the same
GitHub Pages deployment as this site, so `fetch('./films.json')` resolves
correctly without any configuration. There's no dev-time equivalent
checked into this repo — see below for generating local sample data.

## Local development

```sh
npm install
npm run dev
```

The dev server needs `films.json`/`parents.json` to fetch — they aren't
committed (real output is a generated artifact, and stale sample data
risks accidentally getting bundled into a real deploy if left in
`public/`). Generate temporary sample files into `public/` before running
`npm run dev` — the same approach used to verify this site during
development: call `fetchPopularMovieCast()` from `../src/tmdb.ts` for a
small movie count, run the result through `computeFilmStats`/
`computeParentStats` (`../src/films.ts`, `../src/parents.ts`), and
`writeFileSync` the output into `public/films.json` / `public/parents.json`.
Delete them again before committing.

## Build

```sh
npm run build
```

Outputs to `dist/`, published by the scraper repo's workflow alongside the
data files — see the root README's "Automated weekly publish" section.
