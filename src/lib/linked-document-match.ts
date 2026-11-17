// src/lib/linked-document-match.ts
//
// Name matching for "Has a linked document". When someone uploads a file whose name contains the name or number of
// the document it follows, that document is linked automatically:
//
//   MR (already in the system):  "MR 214497"
//   PO being uploaded:           "LPO-783050-MR-214497.pdf"   ->  linked to "MR 214497"
//
// Names are compared as TOKENS, not as raw text, so spacing and punctuation do not matter ("MR 214497", "MR-214497"
// and "MR214497" are the same name) and a number is never found inside a longer one ("MR 21449" does not match
// "LPO-783050-MR-214497"). Pure functions only: this file is used by the browser form.

/** Upper-cased words and numbers of a name; letters and digits are split ("MR214497" -> MR, 214497). */
export function tokenizeName(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** A file name without its extension. */
export function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let all = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/**
 * Whether `name` is mentioned inside `text`. A name must contain at least one number and be at least 4 characters
 * long to count: a generic title such as "Quotation" would otherwise match half of the files.
 * Returns a score (longer names score higher), or 0 for no match.
 */
export function mentionScore(text: string, name: string): number {
  return scoreTokens(tokenizeName(text), name);
}

// Same as mentionScore for a text that was already split into tokens (a file name is compared with many documents).
function scoreTokens(textTokens: string[], name: string): number {
  const needle = tokenizeName(name);
  if (needle.length === 0) return 0;
  if (!needle.some((token) => /\p{N}/u.test(token))) return 0;
  if (needle.join("").length < 4) return 0;
  return containsSequence(textTokens, needle) ? needle.join("").length : 0;
}

export type MatchableEntry = {
  key: string;
  previousDocument: { documentNumber: string; title: string } | null;
};

/** Every entry whose linked document is mentioned in `text`, best match first. */
export function rankEntries<T extends MatchableEntry>(text: string, entries: T[]): Array<{ entry: T; score: number }> {
  const ranked: Array<{ entry: T; score: number }> = [];
  const textTokens = tokenizeName(text);
  for (const entry of entries) {
    if (!entry.previousDocument) continue;
    const score = Math.max(scoreTokens(textTokens, entry.previousDocument.title), scoreTokens(textTokens, entry.previousDocument.documentNumber));
    if (score > 0) ranked.push({ entry, score });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

/**
 * The one entry to link automatically, or null. `texts` are tried in order (file name first, then the title the
 * uploader typed). A text only counts when it has a single best match: when two different documents fit equally
 * well, nothing is linked and the uploader chooses, because a wrong link is worse than a missing one.
 */
export function findAutoMatch<T extends MatchableEntry>(texts: string[], entries: T[]): T | null {
  for (const text of texts) {
    if (!text.trim()) continue;
    const ranked = rankEntries(text, entries);
    if (ranked.length === 0) continue;
    const best = ranked.filter((item) => item.score === ranked[0].score);
    if (best.length === 1) return best[0].entry;
  }
  return null;
}

/** Lower-cased text without spaces or punctuation, for the search box ("mr214497" finds "MR 214497"). */
export function squash(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
