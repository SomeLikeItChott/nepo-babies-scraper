export type RelationType = "father" | "mother";

export interface CandidateRelation {
  type: RelationType;
  name: string;
  /** Raw Wikidata occupation labels (P106) for this parent, unfiltered and unordered. */
  occupations: string[];
  /** This parent's own TMDb id (P4985), if Wikidata has one — used to resolve their Letterboxd slug. */
  tmdbId?: number;
  /** This parent's date of birth (P569), as "YYYY-MM-DD", if Wikidata has one — used to disambiguate same-named TMDB people when tmdbId is missing (see searchTmdbPersonId). */
  birthDate?: string;
  /** English Wikipedia article URL for this parent — always present, since having one is the inclusion criterion. */
  wikipediaUrl: string;
}

export interface ResolvedRelation {
  type: RelationType;
  name: string;
  occupations: string[];
  /** This parent's own Letterboxd person slug, if their page could be found. */
  letterboxdSlug?: string;
  /** English Wikipedia article URL for this parent — a fallback link when no Letterboxd page was found. */
  wikipediaUrl: string;
}

export interface NepoCandidate {
  name: string;
  tmdbId: number;
  relations: CandidateRelation[];
}

export interface ResolvedEntry {
  name: string;
  tmdbId: number;
  relations: ResolvedRelation[];
}

export type NepoDataset = Record<string, ResolvedEntry>;

export interface UnresolvedCandidate extends NepoCandidate {
  reason: string;
}
