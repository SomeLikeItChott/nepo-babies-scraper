/**
 * Best-effort guess at a Letterboxd person slug from a display name.
 * Confirmed against live Letterboxd pages during planning:
 *   "Timothee Chalamet" -> "timothee-chalamet" (diacritics stripped)
 *   "Chris O'Dowd"      -> "chris-odowd"       (apostrophes stripped, not hyphenated)
 * Not guaranteed correct for every name — callers should verify via TMDb id
 * and fall back to numbered suffixes (-1, -2, ...) on mismatch.
 */
export function normalizeToSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (combining marks left by NFD)
    .replace(/[‘’']/g, "") // strip apostrophes entirely, don't hyphenate
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
