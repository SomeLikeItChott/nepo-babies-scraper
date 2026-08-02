// Mirrors FilmStats/ParentStats in ../../src/films.ts and ../../src/parents.ts.
// Not imported directly across the two TS projects (separate tsconfigs/build
// targets — one Node, one browser) so kept as a small duplicated contract
// instead of a shared package, matching this repo's general scraper/site
// separation.

export interface FilmStats {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  popularity: number;
  castSize: number;
  nepoBabyCount: number;
  nepoBabyTmdbIds: number[];
}

export interface ParentStats {
  wikidataQid: string;
  name: string;
  wikipediaUrl: string;
  occupations: string[];
  children: { name: string; tmdbId: number }[];
}
