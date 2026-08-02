import type { FilmCast } from "./tmdb.js";

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

/**
 * Cross-references each popular movie's full cast against the set of TMDb
 * ids identified as nepo babies (see wikidata.ts's fetchNepoCandidates) —
 * independent of Letterboxd resolution, since film-level stats are a
 * TMDB/Wikidata-native concept the extension's Letterboxd matching has no
 * bearing on.
 */
export function computeFilmStats(filmCasts: FilmCast[], nepoBabyTmdbIds: Set<number>): FilmStats[] {
  return filmCasts.map((film) => {
    const matches = film.cast
      .filter((member) => nepoBabyTmdbIds.has(member.tmdbId))
      .map((member) => member.tmdbId);

    return {
      tmdbId: film.tmdbId,
      title: film.title,
      posterPath: film.posterPath,
      releaseYear: film.releaseYear,
      popularity: film.popularity,
      castSize: film.cast.length,
      nepoBabyCount: matches.length,
      nepoBabyTmdbIds: matches,
    };
  });
}
