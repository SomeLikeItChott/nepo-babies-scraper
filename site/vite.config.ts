import { defineConfig } from "vite";

// Served from GitHub Pages at a project subpath
// (somelikeitchott.github.io/nepo-babies-scraper/), not the domain root, so
// asset URLs must be relative or the browser requests them from "/assets/..."
// and gets a 404/503.
export default defineConfig({
  base: "./",
});
