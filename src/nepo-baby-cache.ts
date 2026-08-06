import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CACHE_PATH = path.join(process.cwd(), ".cache", "nepo-baby-checks.json");

export interface NepoBabyCacheEntry {
  /** This actor's own Wikidata QID, if Wikidata has one at all — absent means the P4985 lookup found nothing. */
  qid?: string;
  hasNotableParent: boolean;
  /** Only meaningful when hasNotableParent is true. */
  wikipediaUrl?: string;
}

/**
 * Whether a TMDB actor has a Wikidata-notable parent is about as static a
 * fact as this scraper deals with — it essentially never changes between
 * runs, unlike vote counts or cast lists. yearly-stats.ts's default
 * current-year-only refresh reuses most of the same actor pool week over
 * week (returning cast members, recurring collaborators), so caching this
 * result by TMDB id turns what would otherwise be a repeat multi-minute
 * Wikidata batch pass into a lookup for everyone already checked in a
 * previous run — only genuinely new actors hit Wikidata at all.
 *
 * No TTL/invalidation, matching cache.ts's Letterboxd cache — delete
 * .cache/nepo-baby-checks.json to force a full recheck (e.g. if Wikidata
 * coverage for parents has meaningfully improved since).
 */
export async function loadNepoBabyCache(): Promise<Map<number, NepoBabyCacheEntry>> {
  try {
    const raw = await readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, NepoBabyCacheEntry>;
    return new Map(Object.entries(parsed).map(([tmdbId, entry]) => [Number(tmdbId), entry]));
  } catch {
    return new Map();
  }
}

export async function saveNepoBabyCache(cache: Map<number, NepoBabyCacheEntry>): Promise<void> {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  const asObject = Object.fromEntries([...cache].map(([tmdbId, entry]) => [String(tmdbId), entry]));
  await writeFile(CACHE_PATH, JSON.stringify(asObject));
}
