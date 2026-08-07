import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchAliasesByQid, fetchNepoCandidates } from "./wikidata.js";
import { resolveLetterboxdSlug } from "./letterboxd.js";
import { searchTmdbPersonId } from "./tmdb.js";
import { computeFilmStats } from "./films.js";
import { computeParentStats } from "./parents.js";
import type { CandidateRelation, NepoDataset, ResolvedRelation, UnresolvedCandidate } from "./types.js";

const OUTPUT_DIR = path.join(process.cwd(), "output");

// Below this, assume something's actually broken (most likely Letterboxd
// changing their actor page markup) rather than normal fluctuation in how
// many candidates happen to be matchable this run — historically this has
// been well above 90%.
const MIN_RESOLUTION_RATE = 0.5;

async function main() {
  // Local dev convenience only — in CI, TMDB_API_KEY is already set as a
  // real env var (see .github/workflows/update-dataset.yml), and there's
  // no .env file to load at all.
  try {
    process.loadEnvFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  console.log("Fetching popular actors from TMDB and checking Wikidata for notable parents...");
  const { candidates, filmCasts } = await fetchNepoCandidates();
  console.log(`Found ${candidates.length} candidates. Resolving Letterboxd slugs...`);

  const dataset: NepoDataset = {};
  const unresolved: UnresolvedCandidate[] = [];

  interface RelationWork {
    relation: CandidateRelation;
    parentTmdbId: number | undefined;
    letterboxdSlug: string | undefined;
  }

  interface CandidateWork {
    slug: string | null;
    relations: RelationWork[];
  }

  const work: CandidateWork[] = [];

  for (const [i, candidate] of candidates.entries()) {
    const slug = await resolveLetterboxdSlug(candidate.name, candidate.tmdbId);

    // Also try to resolve each parent's own Letterboxd page. Wikidata's
    // wdt:P4985 is the primary source of their TMDb id, but that property is
    // much less consistently populated for behind-the-camera people
    // (directors, producers, screenwriters) than for actors — confirmed
    // live against real parents in this dataset who had genuine Letterboxd
    // pages despite no P4985 at all. When Wikidata doesn't have one, fall
    // back to searching TMDB directly by name, cross-checked against the
    // parent's Wikidata birth date where available (searchTmdbPersonId's
    // doc comment covers why a name match alone isn't sufficient). Some
    // notable parents (politicians, musicians with no film/TV career) still
    // won't resolve either way, and that's expected — they fall back to
    // wikipediaUrl. Repeated names across candidates (e.g. a parent who's
    // also a popular actor elsewhere in this run, or shared by sibling
    // actors) hit letterboxd.ts's on-disk cache and resolve near-instantly.
    const relations: RelationWork[] = [];
    for (const relation of candidate.relations) {
      const parentTmdbId =
        relation.tmdbId ??
        (await searchTmdbPersonId(relation.name, relation.birthDate)) ??
        undefined;
      const letterboxdSlug = parentTmdbId
        ? (await resolveLetterboxdSlug(relation.name, parentTmdbId)) ?? undefined
        : undefined;
      relations.push({ relation, parentTmdbId, letterboxdSlug });
    }

    work.push({ slug, relations });
    console.log(`[${i + 1}/${candidates.length}] ${candidate.name}: ${slug ? `matched -> ${slug}` : "unresolved"}`);
  }

  // A person's Wikidata label isn't always what Letterboxd actually credits
  // them under (confirmed live: Weston Cage's label is "Weston Cage", but
  // his Letterboxd slug is "weston-cage-coppola", matching his Wikidata
  // alias "Weston Cage Coppola" instead) — retry with their alt-label
  // aliases, but only for whoever's still unresolved after the primary-name
  // attempt above, so this doesn't add meaningful runtime to the common
  // case where the primary label already worked.
  interface RetryTarget {
    qid: string;
    tmdbId: number;
    resolve: (slug: string) => void;
  }

  const retryTargets: RetryTarget[] = [];
  for (const [i, item] of work.entries()) {
    if (item.slug === null) {
      retryTargets.push({
        qid: candidates[i].qid,
        tmdbId: candidates[i].tmdbId,
        resolve: (slug) => {
          item.slug = slug;
        },
      });
    }
    for (const rel of item.relations) {
      if (rel.parentTmdbId && !rel.letterboxdSlug) {
        retryTargets.push({
          qid: rel.relation.qid,
          tmdbId: rel.parentTmdbId,
          resolve: (slug) => {
            rel.letterboxdSlug = slug;
          },
        });
      }
    }
  }

  if (retryTargets.length > 0) {
    console.log(
      `\n${retryTargets.length} unresolved — retrying via Wikidata name aliases...`,
    );
    const aliasesByQid = await fetchAliasesByQid([...new Set(retryTargets.map((t) => t.qid))]);

    for (const target of retryTargets) {
      for (const alias of aliasesByQid.get(target.qid) ?? []) {
        const slug = await resolveLetterboxdSlug(alias, target.tmdbId);
        if (slug) {
          console.log(`  resolved via alias "${alias}" -> ${slug}`);
          target.resolve(slug);
          break;
        }
      }
    }
  }

  for (const [i, item] of work.entries()) {
    const candidate = candidates[i];
    const relations: ResolvedRelation[] = item.relations.map((rel) => ({
      type: rel.relation.type,
      name: rel.relation.name,
      occupations: rel.relation.occupations,
      letterboxdSlug: rel.letterboxdSlug,
      wikipediaUrl: rel.relation.wikipediaUrl,
    }));

    if (item.slug) {
      dataset[item.slug] = { name: candidate.name, tmdbId: candidate.tmdbId, relations };
    } else {
      unresolved.push({ ...candidate, reason: "no matching Letterboxd slug found" });
    }
  }

  // Film/parent stats are TMDB/Wikidata-native concepts for the stats site,
  // independent of Letterboxd resolution — computed from the full candidate
  // list (not just the Letterboxd-resolved subset in `dataset`), so a film
  // or parent's count isn't undercounted just because a child's Letterboxd
  // slug guess failed.
  const nepoBabyTmdbIds = new Set(candidates.map((c) => c.tmdbId));
  const filmStats = computeFilmStats(filmCasts, nepoBabyTmdbIds);
  const parentStats = computeParentStats(candidates);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, "nepo-babies.json"), JSON.stringify(dataset));
  await writeFile(
    path.join(OUTPUT_DIR, "unresolved.json"),
    JSON.stringify(unresolved, null, 2),
  );
  await writeFile(path.join(OUTPUT_DIR, "films.json"), JSON.stringify(filmStats));
  await writeFile(path.join(OUTPUT_DIR, "parents.json"), JSON.stringify(parentStats));

  console.log(
    `\nDone. Resolved ${Object.keys(dataset).length}/${candidates.length} ` +
      `(${unresolved.length} unresolved). Output written to ${OUTPUT_DIR}/`,
  );

  // Checked after writing output, not before, so a degraded run's data is
  // still on disk for post-mortem inspection even though this fails the
  // step (and, in CI, triggers GitHub's existing workflow-failure
  // notification instead of silently publishing degraded data).
  const resolutionRate = candidates.length > 0 ? Object.keys(dataset).length / candidates.length : 1;
  if (resolutionRate < MIN_RESOLUTION_RATE) {
    throw new Error(
      `Only resolved ${(resolutionRate * 100).toFixed(1)}% of candidates to a Letterboxd page ` +
        `(expected well above 90%) — Letterboxd may have changed something. Check output/unresolved.json.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
