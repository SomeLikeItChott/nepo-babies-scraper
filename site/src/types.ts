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
  releaseDate: string | null;
  popularity: number;
  castSize: number;
  nepoBabyCount: number;
  nepoBabyTmdbIds: number[];
}

export interface ParentStats {
  /** One entry for a solo parent, two for a couple — see computeParentStats in ../../src/parents.ts. */
  parents: { wikidataQid: string; name: string; wikipediaUrl: string; occupations: string[] }[];
  children: { name: string; tmdbId: number; popularity: number; wikipediaUrl?: string }[];
}

// Mirrors YearStats in ../../src/yearly-stats.ts.
export interface YearStats {
  year: number;
  filmCount: number;
  castSize: number;
  nepoBabyCount: number;
  leastVotedFilm: { tmdbId: number; title: string; voteCount: number } | null;
  topNepoBabies: {
    tmdbId: number;
    name: string;
    popularity: number;
    wikipediaUrl?: string;
    bestFilm: { tmdbId: number; title: string; voteCount: number; order: number };
  }[];
}
