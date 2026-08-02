// A handful of Latin Extended letters aren't decomposable via NFD into a
// base letter + combining accent (unlike e.g. "é" -> "e" + combining
// acute) — they're distinct base letterforms, so NFD plus stripping
// combining marks doesn't touch them at all, and they'd otherwise fall
// through to the final non-alphanumeric-to-dash pass and get mangled.
// Letterboxd's own slugs transliterate them to their nearest ASCII letter
// instead of dropping them — confirmed live: "Bente Børsum" ->
// "bente-borsum" (ø -> o). The rest of this list (đ, ł, æ, œ, ð, þ, ß)
// follows the same standard transliteration convention but wasn't each
// individually confirmed live.
const NON_DECOMPOSABLE_LETTERS: [RegExp, string][] = [
  [/[øØ]/g, "o"],
  [/[đĐ]/g, "d"],
  [/[łŁ]/g, "l"],
  [/[æÆ]/g, "ae"],
  [/[œŒ]/g, "oe"],
  [/[ðÐ]/g, "d"],
  [/[þÞ]/g, "th"],
  [/ß/g, "ss"],
];

/**
 * Best-effort guess at a Letterboxd person slug from a display name.
 * Confirmed against live Letterboxd pages during planning:
 *   "Timothee Chalamet"  -> "timothee-chalamet"  (diacritics stripped)
 *   "Chris O'Dowd"       -> "chris-odowd"        (apostrophes stripped, not hyphenated)
 *   "J.J. Abrams"        -> "jj-abrams"          (periods stripped, not hyphenated)
 *   "Catherine Lagaʻaia" -> "catherine-lagaaia"  (ʻokina stripped, not hyphenated)
 *   "Bente Børsum"       -> "bente-borsum"       (ø transliterated to o, not stripped)
 * Not guaranteed correct for every name — callers should verify via TMDb id
 * and fall back to numbered suffixes (-1, -2, ...) on mismatch.
 */
export function normalizeToSlug(name: string): string {
  let transliterated = name;
  for (const [pattern, replacement] of NON_DECOMPOSABLE_LETTERS) {
    transliterated = transliterated.replace(pattern, replacement);
  }

  return transliterated
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (combining marks left by NFD)
    // Stripped entirely, not hyphenated: apostrophes (incl. curly variants),
    // periods (initials like "J.J." -> "jj"), and the Polynesian ʻokina and
    // similar modifier-letter apostrophes (not covered by NFD since they're
    // standalone characters, not combining marks).
    .replace(/[‘’'.ʻʼ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
