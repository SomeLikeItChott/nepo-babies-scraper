import * as cheerio from "cheerio";
import { fetchWithCache } from "./cache.js";
import { normalizeToSlug } from "./slugify.js";

const MAX_DISAMBIGUATION_SUFFIX = 5;

// Matches a trailing generational suffix as its own word, so it doesn't
// get treated as part of a surname by nameVariants() below.
const GENERATIONAL_SUFFIX = /\s+(jr\.?|sr\.?|ii|iii|iv)$/i;

function extractTmdbId(html: string): number | null {
  const $ = cheerio.load(html);
  const href = $('a[href*="themoviedb.org/person/"]').first().attr("href");
  if (!href) return null;

  const match = href.match(/themoviedb\.org\/person\/(\d+)/);
  return match ? Number(match[1]) : null;
}

// Any consistently well-known, definitely-real Letterboxd actor page works
// here — this only checks that a TMDb link is still findable on it at all,
// not who it belongs to.
const CANARY_SLUG = "timothee-chalamet";

/**
 * Confirms Letterboxd's actor page markup still has what extractTmdbId()
 * depends on, before spending 45-75 minutes on a real scrape that would
 * otherwise silently produce a collapsed resolution rate instead of
 * failing loudly. Throws on failure — callers should let that crash the
 * run so CI's existing failure notification catches it, rather than
 * catching it here.
 */
export async function verifyLetterboxdPageStructure(): Promise<void> {
  const { status, body } = await fetchWithCache(`https://letterboxd.com/actor/${CANARY_SLUG}/`);

  if (status !== 200) {
    throw new Error(`Letterboxd canary check failed: /actor/${CANARY_SLUG}/ returned ${status}`);
  }
  if (extractTmdbId(body) === null) {
    throw new Error(
      `Letterboxd canary check failed: no TMDb link found on /actor/${CANARY_SLUG}/ — ` +
        "Letterboxd may have changed their actor page markup.",
    );
  }
}

/**
 * Generates alternate full-name phrasings to try slugifying, broadest/most
 * literal first. Both confirmed live against real cases in unresolved.json:
 * "Frank Stallone Jr." is actually credited on Letterboxd as "Frank
 * Stallone" — Wikidata/TMDB's disambiguating generational suffix isn't
 * necessarily reflected there — and "Saleka Night Shyamalan" drops her
 * middle name to "Saleka Shyamalan", which Letterboxd redirects to her
 * mononym page. Safe to try unconditionally: every guess this produces
 * still gets verified against expectedTmdbId in resolveLetterboxdSlug
 * before being accepted, so extra guesses can only add correct matches,
 * never introduce wrong ones.
 */
function nameVariants(name: string): string[] {
  const variants = new Set<string>([name]);

  // Strip the generational suffix first so the middle-name-dropping check
  // below doesn't mistake it for a surname (e.g. "Frank Stallone Jr." ->
  // "Frank Jr." would be nonsense).
  const withoutSuffix = name.replace(GENERATIONAL_SUFFIX, "").trim();
  if (withoutSuffix !== name) variants.add(withoutSuffix);

  const words = withoutSuffix.split(/\s+/);
  if (words.length > 2) variants.add(`${words[0]} ${words[words.length - 1]}`);

  return [...variants];
}

/**
 * Resolves a display name to a Letterboxd actor slug by guessing the slug
 * (trying a few alternate name phrasings, see nameVariants) and each
 * guess's numbered disambiguation variants (Letterboxd's real pattern for
 * name collisions, e.g. chris-evans, chris-evans-1, chris-evans-2), then
 * confirming the match via the TMDb id already known from Wikidata.
 *
 * Letterboxd's own search endpoint is behind a Cloudflare JS challenge and
 * can't be hit with a plain HTTP request, which is why this guess-and-verify
 * approach is used instead of querying search directly.
 */
export async function resolveLetterboxdSlug(
  name: string,
  expectedTmdbId: number,
): Promise<string | null> {
  for (const variant of nameVariants(name)) {
    const baseSlug = normalizeToSlug(variant);

    for (let suffix = 0; suffix <= MAX_DISAMBIGUATION_SUFFIX; suffix++) {
      const slug = suffix === 0 ? baseSlug : `${baseSlug}-${suffix}`;
      const url = `https://letterboxd.com/actor/${slug}/`;

      const { status, body } = await fetchWithCache(url);
      if (status === 404) {
        // Only keep trying suffixes if the base page existed at all; a 404
        // on suffix 0 doesn't guarantee -1 exists, but it's cheap enough to
        // check since Letterboxd only allocates suffixes for actual
        // collisions.
        continue;
      }
      if (status !== 200) continue;

      const tmdbId = extractTmdbId(body);
      if (tmdbId === expectedTmdbId) {
        return slug;
      }
    }
  }

  return null;
}
