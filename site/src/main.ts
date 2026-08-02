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

interface FilmCardOptions {
  caption: string;
  nepoBabyNames?: string[];
}

function filmCard(film: FilmStats, { caption, nepoBabyNames }: FilmCardOptions): string {
  const poster = posterUrl(film.posterPath);
  const posterHtml = poster
    ? `<img src="${poster}" alt="${film.title} poster" loading="lazy" />`
    : `<div class="poster-placeholder">No poster</div>`;
  const namesHtml =
    nepoBabyNames && nepoBabyNames.length > 0
      ? `<div class="film-nepo-list">${nepoBabyNames.join(", ")}</div>`
      : "";
  return `
    <div class="film-card">
      ${posterHtml}
      <div class="film-title">${film.title}${film.releaseYear ? ` (${film.releaseYear})` : ""}</div>
      <div class="film-subtitle">${caption}</div>
      ${namesHtml}
    </div>
  `;
}

function buildNepoBabyNameMap(parents: ParentStats[]): Map<number, string> {
  const names = new Map<number, string>();
  for (const parent of parents) {
    for (const child of parent.children) {
      names.set(child.tmdbId, child.name);
    }
  }
  return names;
}

function renderGreatestPercent(films: FilmStats[], nepoBabyNames: Map<number, string>): void {
  const ranked = films
    .filter((f) => f.castSize > 0)
    .map((f) => ({ film: f, percent: f.nepoBabyCount / f.castSize }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, GREATEST_PERCENT_COUNT);

  const container = document.getElementById("greatest-percent")!;
  container.innerHTML = ranked
    .map(({ film }) => {
      const names = film.nepoBabyTmdbIds.map((id) => nepoBabyNames.get(id) ?? "Unknown");
      return filmCard(film, {
        caption: `<strong>${formatPercent(film.nepoBabyCount, film.castSize)}</strong> nepo babies (${film.nepoBabyCount}/${film.castSize})`,
        nepoBabyNames: names,
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
      ? top.map((film) => filmCard(film, { caption: "Zero nepo babies in the cast" })).join("")
      : "<p>No qualifying films found.</p>";
}

function sumChildrenPopularity(parent: ParentStats): number {
  return parent.children.reduce((sum, c) => sum + c.popularity, 0);
}

function renderTopParent(parents: ParentStats[]): void {
  const [top] = [...parents].sort((a, b) => sumChildrenPopularity(b) - sumChildrenPopularity(a));
  const container = document.getElementById("top-parent")!;

  if (!top) {
    container.innerHTML = "<p>No parent data found.</p>";
    return;
  }

  const childrenList = top.children.map((c) => c.name).join(", ");
  container.innerHTML = `
    <div class="parent-card">
      <div class="parent-name"><a href="${top.wikipediaUrl}" target="_blank" rel="noopener">${top.name}</a></div>
      <div class="parent-count">
        <span class="parent-count-number">${top.children.length}</span>
        <span class="parent-count-label">nepo babies in this dataset</span>
      </div>
      <div class="parent-children">${childrenList}</div>
    </div>
  `;
}

async function main() {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <header>
      <h1>Nepo Babies Stats</h1>
      <p>Aggregate stats over the actors/films tracked by
        <a href="https://github.com/SomeLikeItChott/nepo-babies-scraper" target="_blank" rel="noopener">nepo-baby-scraper</a>.
      </p>
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
        <h2>Nepo parent with the most popular children</h2>
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
  renderGreatestPercent(displayFilms, buildNepoBabyNameMap(parents));
  renderZeroNepoFilms(displayFilms);
  renderTopParent(parents);
}

main().catch((err) => {
  console.error(err);
  const app = document.getElementById("app")!;
  app.innerHTML = `<p>Failed to load stats: ${String(err)}</p>`;
});
