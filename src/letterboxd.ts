import * as cheerio from "cheerio";
import { fetchWithCache } from "./cache.js";
import { normalizeToSlug } from "./slugify.js";

const MAX_DISAMBIGUATION_SUFFIX = 5;

function extractTmdbId(html: string): number | null {
  const $ = cheerio.load(html);
  const href = $('a[href*="themoviedb.org/person/"]').first().attr("href");
  if (!href) return null;

  const match = href.match(/themoviedb\.org\/person\/(\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * Resolves a display name to a Letterboxd actor slug by guessing the slug
 * and its numbered disambiguation variants (Letterboxd's real pattern for
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
  const baseSlug = normalizeToSlug(name);

  for (let suffix = 0; suffix <= MAX_DISAMBIGUATION_SUFFIX; suffix++) {
    const slug = suffix === 0 ? baseSlug : `${baseSlug}-${suffix}`;
    const url = `https://letterboxd.com/actor/${slug}/`;

    const { status, body } = await fetchWithCache(url);
    if (status === 404) {
      // Only keep trying suffixes if the base page existed at all; a 404 on
      // suffix 0 doesn't guarantee -1 exists, but it's cheap enough to check
      // since Letterboxd only allocates suffixes for actual collisions.
      continue;
    }
    if (status !== 200) continue;

    const tmdbId = extractTmdbId(body);
    if (tmdbId === expectedTmdbId) {
      return slug;
    }
  }

  return null;
}
