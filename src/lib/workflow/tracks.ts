// Pure helpers for unique tracks and "Send for approval" steps (no database access), safe to use in client components.

/** A step created by a unique track is numbered 1000 + origin level * 100 + the track's position in its level. */
export const TRACK_LEVEL_BASE = 1000;
export const MAX_TRACKS_PER_LEVEL = 20;

/** A step created by "Send for approval" is numbered 1,000,000 + a counter, so it never clashes with flow levels or tracks. */
export const SIDE_APPROVAL_LEVEL_BASE = 1_000_000;

/** The permission that adds "Send for approval" to the review decisions (Admin users always have it). */
export const SEND_FOR_APPROVAL_PERMISSION = "documents.send_for_approval";

/** The permission to take a unique track, at upload or from an approval level (Admin users always have it). */
export const UNIQUE_TRACK_PERMISSION = "documents.use_unique_track";

export function trackLevelNumber(originLevel: number, sortOrder: number): number {
  return TRACK_LEVEL_BASE + originLevel * 100 + sortOrder;
}

export function isSideApprovalLevel(levelNumber: number): boolean {
  return levelNumber >= SIDE_APPROVAL_LEVEL_BASE;
}

export function isTrackLevel(levelNumber: number): boolean {
  return levelNumber >= TRACK_LEVEL_BASE && levelNumber < SIDE_APPROVAL_LEVEL_BASE;
}

/** The level number the next "Send for approval" step of a document gets, given the level numbers it already has. */
export function nextSideApprovalLevel(existingLevels: readonly number[]): number {
  const used = existingLevels.filter(isSideApprovalLevel);
  return used.length === 0 ? SIDE_APPROVAL_LEVEL_BASE + 1 : Math.max(...used) + 1;
}

/**
 * Where a step sits on the document's path: a track step comes right after the level it was taken at, and a
 * "Send for approval" step right after the level it was sent from (originLevel), in the order they were sent.
 */
export function stepSortKey(levelNumber: number, originLevel?: number | null): number {
  if (isSideApprovalLevel(levelNumber)) {
    const origin = originLevel ?? 0;
    return stepSortKey(origin) + 0.5 + (levelNumber - SIDE_APPROVAL_LEVEL_BASE) / 100_000;
  }
  return isTrackLevel(levelNumber) ? Math.floor((levelNumber - TRACK_LEVEL_BASE) / 100) + 0.5 : levelNumber;
}

type PathStep = { levelNumber: number; status: string; actedAt?: Date | string | null; isSideApproval?: boolean; originLevel?: number | null };

/**
 * The level a revision always goes back to: the previous level on the document's path (the uploader is level 0).
 * Levels skipped by a unique track never took part and are passed over; a track step counts as the level before the
 * one it returns to, and a "Send for approval" step goes back to the level it was sent from. Nobody picks the target
 * and the order in which people happened to act does not matter.
 */
export function previousLevel<T extends PathStep>(steps: readonly T[], currentLevel: number): T | undefined {
  const current = steps.find((step) => step.levelNumber === currentLevel);
  if (!current) return undefined;
  if (current.isSideApproval) return steps.find((step) => step.levelNumber === current.originLevel);
  const key = (step: T) => stepSortKey(step.levelNumber, step.originLevel);
  const currentKey = key(current);
  return steps
    .filter((step) => !step.isSideApproval && step.levelNumber !== currentLevel && step.status === "APPROVED" && key(step) < currentKey)
    .sort((a, b) => key(b) - key(a))[0];
}

/**
 * (Older rule, no longer used for revisions.) The step that last approved before the current step (the uploader counts).
 * Levels that were skipped by a unique track never took part, and "Send for approval" steps are side trips that
 * return to their sender, so none of those are ever chosen.
 */
export function previousParticipant<T extends PathStep>(steps: readonly T[], currentLevel: number): T | undefined {
  return steps
    .filter((step) => step.levelNumber !== currentLevel && !step.isSideApproval && step.status === "APPROVED" && step.actedAt)
    .sort((a, b) => new Date(b.actedAt as Date | string).getTime() - new Date(a.actedAt as Date | string).getTime() || stepSortKey(b.levelNumber, b.originLevel) - stepSortKey(a.levelNumber, a.originLevel))[0];
}
