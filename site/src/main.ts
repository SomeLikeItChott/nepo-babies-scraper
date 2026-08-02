import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from "chart.js";
import type { FilmStats, ParentStats } from "./types";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const POSTER_SIZE = "w342";
const GREATEST_PERCENT_COUNT = 5;
const ZERO_NEPO_COUNT = 5;
const TOP_FILM_COUNT = 1000;
const HISTOGRAM_BUCKET_SIZE = 5;

function posterUrl(posterPath: string | null): string | null {
  return posterPath ? `https://image.tmdb.org/t/p/${POSTER_SIZE}${posterPath}` : null;
}

function formatPercent(count: number, total: number): string {
  return total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "—";
}

function personLink(name: string, wikipediaUrl?: string): string {
  return wikipediaUrl ? `<a href="${wikipediaUrl}" target="_blank" rel="noopener">${name}</a>` : name;
}

function isReleased(film: FilmStats): boolean {
  return !film.releaseDate || new Date(film.releaseDate) <= new Date();
}

async function loadData(): Promise<{ films: FilmStats[]; parents: ParentStats[] }> {
  const [filmsRes, parentsRes] = await Promise.all([fetch("./films.json"), fetch("./parents.json")]);
  const [films, parents] = await Promise.all([filmsRes.json(), parentsRes.json()]);
  return { films, parents };
}

function selectDisplayFilms(films: FilmStats[]): FilmStats[] {
  return films
    .filter(isReleased)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, TOP_FILM_COUNT);
}

function renderHistogram(films: FilmStats[]): void {
  // counts[0] is a dedicated "0%" bucket; counts[1..] are 5%-wide buckets
  // for the (0, 100] range, so a film with zero nepo babies doesn't get
  // lumped in with films that have a small but nonzero percentage.
  const nonZeroBucketCount = 100 / HISTOGRAM_BUCKET_SIZE;
  const counts = new Array(nonZeroBucketCount + 1).fill(0);
  for (const film of films) {
    if (film.castSize === 0) continue;
    const percent = (film.nepoBabyCount / film.castSize) * 100;
    if (percent === 0) {
      counts[0]++;
      continue;
    }
    const bucket = Math.min(Math.floor(percent / HISTOGRAM_BUCKET_SIZE), nonZeroBucketCount - 1);
    counts[bucket + 1]++;
  }

  // Only extend the x-axis as far as there's actual data.
  let lastNonEmpty = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0) lastNonEmpty = i;
  }
  const trimmedCounts = counts.slice(0, lastNonEmpty + 1);

  const labels = trimmedCounts.map((_, i) => {
    if (i === 0) return "0%";
    const lo = (i - 1) * HISTOGRAM_BUCKET_SIZE;
    const hi = i * HISTOGRAM_BUCKET_SIZE;
    return i === 1 ? `>${lo}-${hi}%` : `${lo}-${hi}%`;
  });

  const muted = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
  const gridColor = "rgba(128, 128, 128, 0.15)";

  const canvas = document.getElementById("histogram") as HTMLCanvasElement;
  new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Films", data: trimmedCounts, backgroundColor: "#7c5cff", borderRadius: 4, borderSkipped: false }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          title: { display: true, text: "% of nepo babies in cast", color: muted },
          ticks: { color: muted },
          grid: { display: false },
        },
        y: {
          title: { display: true, text: "# of films", color: muted },
          ticks: { color: muted },
          grid: { color: gridColor },
          beginAtZero: true,
        },
      },
    },
  });
}

interface NepoBaby {
  name: string;
  wikipediaUrl?: string;
}

interface FilmCardOptions {
  caption: string;
  nepoBabies?: NepoBaby[];
}

function filmCard(film: FilmStats, { caption, nepoBabies }: FilmCardOptions): string {
  const poster = posterUrl(film.posterPath);
  const posterHtml = poster
    ? `<img src="${poster}" alt="${film.title} poster" loading="lazy" />`
    : `<div class="poster-placeholder">No poster</div>`;
  const namesHtml =
    nepoBabies && nepoBabies.length > 0
      ? `<div class="film-nepo-list">${nepoBabies.map((c) => personLink(c.name, c.wikipediaUrl)).join(", ")}</div>`
      : "";
  const tmdbUrl = `https://www.themoviedb.org/movie/${film.tmdbId}`;
  return `
    <div class="film-card">
      ${posterHtml}
      <div class="film-title">
        <a href="${tmdbUrl}" target="_blank" rel="noopener">${film.title}</a>${film.releaseYear ? ` (${film.releaseYear})` : ""}
      </div>
      <div class="film-subtitle">${caption}</div>
      ${namesHtml}
    </div>
  `;
}

function buildNepoBabyMap(parents: ParentStats[]): Map<number, NepoBaby> {
  const babies = new Map<number, NepoBaby>();
  for (const parent of parents) {
    for (const child of parent.children) {
      babies.set(child.tmdbId, { name: child.name, wikipediaUrl: child.wikipediaUrl });
    }
  }
  return babies;
}

function renderGreatestPercent(films: FilmStats[], nepoBabies: Map<number, NepoBaby>): void {
  const ranked = films
    .filter((f) => f.castSize > 0)
    .map((f) => ({ film: f, percent: f.nepoBabyCount / f.castSize }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, GREATEST_PERCENT_COUNT);

  const container = document.getElementById("greatest-percent")!;
  container.innerHTML = ranked
    .map(({ film }) => {
      const babies = film.nepoBabyTmdbIds.map((id) => nepoBabies.get(id) ?? { name: "Unknown" });
      return filmCard(film, {
        caption: `<strong>${formatPercent(film.nepoBabyCount, film.castSize)}</strong> nepo babies (${film.nepoBabyCount}/${film.castSize})`,
        nepoBabies: babies,
      });
    })
    .join("");
}

function renderZeroNepoFilms(films: FilmStats[]): void {
  const top = films
    .filter((f) => f.nepoBabyCount === 0)
    .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0) || b.popularity - a.popularity)
    .slice(0, ZERO_NEPO_COUNT);

  const container = document.getElementById("zero-nepo-films")!;
  container.innerHTML =
    top.length > 0
      ? top.map((film) => filmCard(film, { caption: `(0/${film.castSize}) nepo babies` })).join("")
      : "<p>No qualifying films found.</p>";
}

const TOP_PARENT_COUNT = 5;

function sumChildrenPopularity(parent: ParentStats): number {
  return parent.children.reduce((sum, c) => sum + c.popularity, 0);
}

function parentCard(parent: ParentStats): string {
  const childrenList = parent.children.map((c) => personLink(c.name, c.wikipediaUrl)).join(", ");
  return `
    <div class="parent-card">
      <div class="parent-name"><a href="${parent.wikipediaUrl}" target="_blank" rel="noopener">${parent.name}</a></div>
      <div class="parent-count">
        <span class="parent-count-number">${parent.children.length}</span>
        <span class="parent-count-label">nepo babies in this dataset</span>
      </div>
      <div class="parent-children">${childrenList}</div>
    </div>
  `;
}

// Parents are tracked independently per QID (a nepo baby with both a
// notable father and a notable mother contributes to each parent's own sum
// separately, see computeParentStats in parents.ts), so co-parents each get
// their own card here rather than being merged onto one.
function renderTopParents(parents: ParentStats[]): void {
  const top = [...parents]
    .sort((a, b) => sumChildrenPopularity(b) - sumChildrenPopularity(a))
    .slice(0, TOP_PARENT_COUNT);

  const container = document.getElementById("top-parent")!;
  container.innerHTML =
    top.length > 0 ? top.map((family) => parentCard(family)).join("") : "<p>No parent data found.</p>";
}

async function main() {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <header>
      <div class="hero-title-band">
        <div class="hero-inner">
          <h1>Nepo Baby Actor Tracker</h1>
        </div>
      </div>
      <div class="hero-intro-band">
        <div class="hero-inner">
          <p>Data is updated weekly from TMDB and Wikidata by 
            <a href="https://github.com/SomeLikeItChott/nepo-babies-scraper" target="_blank" rel="noopener">nepo-baby-scraper</a>.
          </p>
          <p class="header-note">
            A nepo baby is defined here as any actor with a parent important enough to have their own Wikipedia page. Stats on this page are drawn from the 1000 most popular films, as ranked by TMDB.
          </p>
          
        </div>
      </div>
    </header>
    <main>
      <section>
        <h2>Films with highest nepo-baby percentage</h2>
        <div id="greatest-percent" class="film-grid"></div>
      </section>
      <section>
        <h2>Most popular recent films with zero nepo babies</h2>
        <div id="zero-nepo-films" class="film-grid"></div>
      </section>
      <section class="section-hero">
        <h2>Nepo parents with the most popular children</h2>
        <p class="section-note">
          The parents whose nepo-baby children have the highest combined popularity, as ranked by TMDB.
        </p>
        <div id="top-parent"></div>
      </section>
      <section>
        <h2>Nepo babies per film</h2>
        <canvas id="histogram"></canvas>
      </section>
    </main>
    <footer>
      <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </footer>
  `;

  const { films, parents } = await loadData();
  const displayFilms = selectDisplayFilms(films);
  renderHistogram(displayFilms);
  renderGreatestPercent(displayFilms, buildNepoBabyMap(parents));
  renderZeroNepoFilms(displayFilms);
  renderTopParents(parents);
}

main().catch((err) => {
  console.error(err);
  const app = document.getElementById("app")!;
  app.innerHTML = `<p>Failed to load stats: ${String(err)}</p>`;
});
