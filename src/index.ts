import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchNepoCandidates } from "./wikidata.js";
import { resolveLetterboxdSlug } from "./letterboxd.js";
import { searchTmdbPersonId } from "./tmdb.js";
import type { NepoDataset, ResolvedRelation, UnresolvedCandidate } from "./types.js";

const OUTPUT_DIR = path.join(process.cwd(), "output");

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
  const candidates = await fetchNepoCandidates();
  console.log(`Found ${candidates.length} candidates. Resolving Letterboxd slugs...`);

  const dataset: NepoDataset = {};
  const unresolved: UnresolvedCandidate[] = [];

  for (const [i, candidate] of candidates.entries()) {
    const slug = await resolveLetterboxdSlug(candidate.name, candidate.tmdbId);

    // Also try to resolve each parent's own Letterboxd page. Wikidata's
    // wdt:P4985 is the primary source of their TMDb id, but that property is
    // much less consistently populated for behind-the-camera people
    // (directors, producers, screenwriters) than for actors — confirmed
    // live against real parents in this dataset who had genuine Letterboxd
    // pages despite no P4985 at all. When Wikidata doesn't have one, fall
    // back to searching TMDB directly by name (searchTmdbPersonId only
    // accepts an exact name match, to avoid confidently linking the wrong
    // same-ish-named person). Some notable parents (politicians, musicians
    // with no film/TV career) still won't resolve either way, and that's
    // expected — they fall back to wikipediaUrl. Repeated names across
    // candidates (e.g. a parent who's also a popular actor elsewhere in
    // this run, or shared by sibling actors) hit letterboxd.ts's on-disk
    // cache and resolve near-instantly.
    const relations: ResolvedRelation[] = [];
    for (const relation of candidate.relations) {
      const parentTmdbId = relation.tmdbId ?? (await searchTmdbPersonId(relation.name)) ?? undefined;
      const letterboxdSlug = parentTmdbId
        ? (await resolveLetterboxdSlug(relation.name, parentTmdbId)) ?? undefined
        : undefined;
      relations.push({
        type: relation.type,
        name: relation.name,
        occupations: relation.occupations,
        letterboxdSlug,
        wikipediaUrl: relation.wikipediaUrl,
      });
    }

    if (slug) {
      dataset[slug] = { name: candidate.name, tmdbId: candidate.tmdbId, relations };
      console.log(`[${i + 1}/${candidates.length}] matched: ${candidate.name} -> ${slug}`);
    } else {
      unresolved.push({ ...candidate, reason: "no matching Letterboxd slug found" });
      console.log(`[${i + 1}/${candidates.length}] unresolved: ${candidate.name}`);
    }
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, "nepo-babies.json"), JSON.stringify(dataset));
  await writeFile(
    path.join(OUTPUT_DIR, "unresolved.json"),
    JSON.stringify(unresolved, null, 2),
  );

  console.log(
    `\nDone. Resolved ${Object.keys(dataset).length}/${candidates.length} ` +
      `(${unresolved.length} unresolved). Output written to ${OUTPUT_DIR}/`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
