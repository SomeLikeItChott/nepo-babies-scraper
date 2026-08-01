import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Dev-convenience cache only — no TTL/invalidation. Delete .cache/ to force
// re-fetching. Keeps reruns fast and avoids repeatedly hitting Letterboxd
// for pages already seen.
const REQUEST_DELAY_MS = 750;

// A transient network error (ECONNRESET) crashed a real multi-hour scraper
// run partway through — this isn't hypothetical. Retry real fetches before
// giving up, same defensive pattern already used for Wikidata's endpoint.
const FETCH_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function cacheKeyFor(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

async function readCache(url: string): Promise<string | null> {
  try {
    return await readFile(path.join(CACHE_DIR, cacheKeyFor(url)), "utf8");
  } catch {
    return null;
  }
}

async function writeCache(url: string, body: string): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, cacheKeyFor(url)), body, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchResult {
  status: number;
  body: string;
  fromCache: boolean;
}

/**
 * Fetches a URL with a browser-like User-Agent (plain fetch works fine for
 * letterboxd.com/actor/ and /film/ pages — the /search/ endpoint is behind a
 * Cloudflare JS challenge and is intentionally not used by this scraper).
 * Caches responses to disk and rate-limits real network requests.
 */
export async function fetchWithCache(url: string): Promise<FetchResult> {
  const cached = await readCache(url);
  if (cached !== null) {
    return { status: 200, body: cached, fromCache: true };
  }

  await sleep(REQUEST_DELAY_MS);

  let lastError: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      const body = await res.text();

      if (res.status === 200) {
        await writeCache(url, body);
      }

      return { status: res.status, body, fromCache: false };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}
