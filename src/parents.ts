import type { NepoCandidate } from "./types.js";

export interface ParentStats {
  wikidataQid: string;
  name: string;
  wikipediaUrl: string;
  occupations: string[];
  children: { name: string; tmdbId: number; popularity: number }[];
}

/**
 * Groups every candidate's relations by the parent's Wikidata QID — not
 * name, which risks merging two different same-named people (the same
 * collision risk the searchTmdbPersonId birthdate cross-check guards
 * against elsewhere, see tmdb.ts). Computed from the full candidate list
 * before Letterboxd resolution, so a parent's count isn't undercounted just
 * because some of their children failed the unrelated Letterboxd-slug
 * heuristic.
 */
export function computeParentStats(candidates: NepoCandidate[]): ParentStats[] {
  const byQid = new Map<string, ParentStats>();

  for (const candidate of candidates) {
    for (const relation of candidate.relations) {
      let parent = byQid.get(relation.qid);
      if (!parent) {
        parent = {
          wikidataQid: relation.qid,
          name: relation.name,
          wikipediaUrl: relation.wikipediaUrl,
          occupations: relation.occupations,
          children: [],
        };
        byQid.set(relation.qid, parent);
      }
      parent.children.push({ name: candidate.name, tmdbId: candidate.tmdbId, popularity: candidate.popularity });
    }
  }

  return [...byQid.values()];
}
