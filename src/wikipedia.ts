const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "nepo-babies-scraper/0.1 (personal project; contact samchott@gmail.com)";
const BATCH_SIZE = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function titleFromWikipediaUrl(url: string): string {
  return decodeURIComponent(url.split("/wiki/")[1]).replace(/_/g, " ");
}

interface RedirectQueryResponse {
  query?: {
    redirects?: { from: string }[];
  };
}

/**
 * Checks which of the given Wikipedia article URLs are actually redirects
 * rather than standalone articles. A parent's Wikidata item can have a
 * sitelink to an enwiki page that Wikipedia later merged/redirected
 * elsewhere — often into a more famous relative's article — without
 * Wikidata's sitelink metadata catching up, so passing the SPARQL query's
 * schema:about check doesn't guarantee an independent article actually
 * exists. Confirmed live: Rudy Giuliani's mother and LeBron James's
 * mother both have sitelinks pointing to pages that redirect straight to
 * their son's own article.
 */
export async function findRedirectUrls(urls: string[]): Promise<Set<string>> {
  const urlByTitle = new Map(urls.map((url) => [titleFromWikipediaUrl(url), url]));
  const titles = [...urlByTitle.keys()];
  const redirectUrls = new Set<string>();

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(400);

    const batch = titles.slice(i, i + BATCH_SIZE);
    const apiUrl = new URL(WIKIPEDIA_API);
    apiUrl.searchParams.set("action", "query");
    apiUrl.searchParams.set("titles", batch.join("|"));
    apiUrl.searchParams.set("redirects", "1");
    apiUrl.searchParams.set("format", "json");

    const res = await fetch(apiUrl, { headers: { "User-Agent": USER_AGENT } });
    const data = (await res.json()) as RedirectQueryResponse;

    for (const redirect of data.query?.redirects ?? []) {
      const url = urlByTitle.get(redirect.from);
      if (url) redirectUrls.add(url);
    }
  }

  return redirectUrls;
}
