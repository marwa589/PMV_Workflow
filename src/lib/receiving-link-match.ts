// src/lib/receiving-link-match.ts
//
// File-name matching for invoice, GRV and Cash Receiving Voucher uploads (same rule as the new system's
// "linked document" matching). The file names follow these patterns:
//
//   Invoice:                  "INV - 123456 LPO 783050.pdf"   -> the PO whose file is "LPO-783050 ..."
//   GRV:                      "GRV 12345 LPO 783050.pdf"      -> the invoice of PO LPO 783050
//   Cash Receiving Voucher:   "CRV 123456 MR 21449700.pdf"    -> the Cash MR with MR number 21449700
//
// Names are compared as TOKENS: spacing and punctuation do not matter ("LPO-783050", "LPO 783050", "LPO783050"),
// "LPO" and "PO" are the same, leading zeros are ignored, and a number is never found inside a longer one
// ("MR 21449" does not match "MR 214497"). When two choices match equally well nothing is picked, because a
// wrong link is worse than a missing one. Pure functions only: this file is used by the browser form.

/** Upper-cased words and numbers of a name; letters and digits are split ("LPO783050" -> PO, 783050). */
export function tokenizeName(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((token) => (token === "LPO" ? "PO" : /^\d+$/.test(token) ? token.replace(/^0+(?=\d)/, "") : token));
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

// A name counts only when it has a number and is at least 4 characters long (longer names score higher).
function scoreTokens(textTokens: string[], name: string): number {
  const needle = tokenizeName(name);
  if (needle.length === 0) return 0;
  if (!needle.some((token) => /\p{N}/u.test(token))) return 0;
  if (needle.join("").length < 4) return 0;
  return containsSequence(textTokens, needle) ? needle.join("").length : 0;
}

/** "<PREFIX> <number>" references found in a text, e.g. ("LPO-783050-MR-214497", ["PO"]) -> ["PO 783050"]. */
export function referenceNames(text: string, prefixes: string[]): string[] {
  const tokens = tokenizeName(text);
  const wanted = new Set(prefixes.map((prefix) => tokenizeName(prefix)[0]).filter(Boolean));
  const names: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (wanted.has(tokens[index]) && /^\d+$/.test(tokens[index + 1])) names.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return [...new Set(names)];
}

/** Names of a PO: the LPO/PO number(s) in its file name, and its system number (PO-000123). */
export function purchaseOrderMatchNames(purchaseOrder: { poNumber: string; originalName?: string | null }): string[] {
  return [...new Set([...referenceNames(purchaseOrder.originalName ?? "", ["PO"]), purchaseOrder.poNumber])];
}

/** Names of an MR: "MR <n>" for every number in its MR number (one MR document may hold several), and its DOC number. */
export function mrMatchNames(mr: { documentNumber: string; mrNumber?: string | null }): string[] {
  const numbers = (mr.mrNumber ?? "").match(/\d+/g) ?? [];
  return [...new Set([...numbers.map((value) => `MR ${value.replace(/^0+(?=\d)/, "")}`), mr.documentNumber])];
}

export type LinkTarget = { id: string; label: string; matchNames: string[] };

/** Targets whose names appear in `fileName`, best match first. */
export function rankTargets<T extends LinkTarget>(fileName: string, targets: T[]): Array<{ target: T; score: number }> {
  const textTokens = tokenizeName(stripExtension(fileName));
  const ranked: Array<{ target: T; score: number }> = [];
  for (const target of targets) {
    const score = Math.max(0, ...target.matchNames.map((name) => scoreTokens(textTokens, name)));
    if (score > 0) ranked.push({ target, score });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

/** The one target to link automatically for `fileName`, or null when none or several match equally well. */
export function findAutoTarget<T extends LinkTarget>(fileName: string, targets: T[]): T | null {
  const ranked = rankTargets(fileName, targets);
  if (ranked.length === 0) return null;
  const best = ranked.filter((item) => item.score === ranked[0].score);
  return best.length === 1 ? best[0].target : null;
}

/** Lower-cased text without spaces or punctuation, for the search box ("lpo783050" finds "LPO-783050"). */
export function squash(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
