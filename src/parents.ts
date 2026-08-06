import type { CandidateRelation, NepoCandidate } from "./types.js";

export interface ParentInfo {
  wikidataQid: string;
  name: string;
  wikipediaUrl: string;
  occupations: string[];
}

export interface ParentStats {
  /** One entry for a solo parent, two for a couple (see computeParentStats). */
  parents: ParentInfo[];
  children: { name: string; tmdbId: number; popularity: number; wikipediaUrl?: string }[];
}

function toParentInfo(relation: CandidateRelation): ParentInfo {
  return {
    wikidataQid: relation.qid,
    name: relation.name,
    wikipediaUrl: relation.wikipediaUrl,
    occupations: relation.occupations,
  };
}

function groupKey(qids: string[]): string {
  return [...qids].sort().join("|");
}

/**
 * Groups every candidate's relations by parent — not name, which risks
 * merging two different same-named people (the same collision risk the
 * searchTmdbPersonId birthdate cross-check guards against elsewhere, see
 * tmdb.ts). Computed from the full candidate list before Letterboxd
 * resolution, so a parent's count isn't undercounted just because some of
 * their children failed the unrelated Letterboxd-slug heuristic.
 *
 * A candidate with both a notable father and a notable mother (relations
 * of length 2) means those two people co-parented this child together —
 * grouped as a couple (keyed by the *pair* of QIDs, not either QID alone),
 * so Tom Hanks and Rita Wilson's shared children land on one combined
 * card. Any other children either of them has *without* that same partner
 * (e.g. Tom Hanks and Colin Hanks, from a marriage before Rita Wilson)
 * still group under a separate solo entry for just that one parent, since
 * they only ever have one relation for that particular child. The same
 * parent can end up on multiple couple cards if they've co-parented nepo
 * babies with more than one other notable partner — each pairing is its
 * own group.
 */
export function computeParentStats(candidates: NepoCandidate[]): ParentStats[] {
  const groups = new Map<string, ParentStats>();

  for (const candidate of candidates) {
    const relationGroups: CandidateRelation[][] =
      candidate.relations.length === 2 ? [candidate.relations] : candidate.relations.map((r) => [r]);

    for (const relations of relationGroups) {
      const key = groupKey(relations.map((r) => r.qid));
      let group = groups.get(key);
      if (!group) {
        group = { parents: relations.map(toParentInfo), children: [] };
        groups.set(key, group);
      }
      group.children.push({
        name: candidate.name,
        tmdbId: candidate.tmdbId,
        popularity: candidate.popularity,
        wikipediaUrl: candidate.wikipediaUrl,
      });
    }
  }

  return [...groups.values()];
}
