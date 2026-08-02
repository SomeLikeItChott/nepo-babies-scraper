import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from "chart.js";
import type { FilmStats, ParentStats } from "./types";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const POSTER_SIZE = "w342";
const GREATEST_PERCENT_COUNT = 5;
const ZERO_NEPO_COUNT = 5;

function posterUrl(posterPath: string | null): string | null {
  return posterPath ? `https://image.tmdb.org/t/p/${POSTER_SIZE}${posterPath}` : null;
}

function formatPercent(count: number, total: number): string {
  return total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "—";
}

async function loadData(): Promise<{ films: FilmStats[]; parents: ParentStats[] }> {
  const [filmsRes, parentsRes] = await Promise.all([fetch("./films.json"), fetch("./parents.json")]);
  const [films, parents] = await Promise.all([filmsRes.json(), parentsRes.json()]);
  return { films, parents };
}

function renderHistogram(films: FilmStats[]): void {
  const counts = new Map<number, number>();
  for (const film of films) {
    counts.set(film.nepoBabyCount, (counts.get(film.nepoBabyCount) ?? 0) + 1);
  }
  const maxCount = Math.max(...counts.keys());
  const labels = Array.from({ length: maxCount + 1 }, (_, i) => String(i));
  const data = Array.from({ length: maxCount + 1 }, (_, i) => counts.get(i) ?? 0);

  const canvas = document.getElementById("histogram") as HTMLCanvasElement;
  new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Films", data, backgroundColor: "#7c5cff" }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: "# of nepo babies in cast" } },
        y: { title: { display: true, text: "# of films" }, beginAtZero: true },
      },
    },
  });
}

function filmCard(film: FilmStats, subtitle: string, nepoBabyNames?: string[]): string {
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
      <div class="film-subtitle">${subtitle}</div>
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
      return filmCard(
        film,
        `${formatPercent(film.nepoBabyCount, film.castSize)} nepo babies (${film.nepoBabyCount}/${film.castSize})`,
        names,
      );
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
    top.length > 0 ? top.map((film) => filmCard(film, "Zero nepo babies in the cast")).join("") : "<p>No qualifying films found.</p>";
}

function renderTopParent(parents: ParentStats[]): void {
  const [top] = [...parents].sort((a, b) => b.children.length - a.children.length);
  const container = document.getElementById("top-parent")!;

  if (!top) {
    container.innerHTML = "<p>No parent data found.</p>";
    return;
  }

  const childrenList = top.children.map((c) => c.name).join(", ");
  container.innerHTML = `
    <div class="parent-card">
      <div class="parent-name"><a href="${top.wikipediaUrl}" target="_blank" rel="noopener">${top.name}</a></div>
      <div class="parent-count">${top.children.length} nepo babies in this dataset</div>
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
      <section>
        <h2>Parent with the most nepo babies</h2>
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
  renderHistogram(films);
  renderGreatestPercent(films, buildNepoBabyNameMap(parents));
  renderZeroNepoFilms(films);
  renderTopParent(parents);
}

main().catch((err) => {
  console.error(err);
  const app = document.getElementById("app")!;
  app.innerHTML = `<p>Failed to load stats: ${String(err)}</p>`;
});
