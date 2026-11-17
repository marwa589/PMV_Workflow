import "server-only";

import type { Db } from "@/lib/auth/access";
import type { EligiblePerson } from "@/lib/workflow/eligible-people-types";
import { createEligiblePeopleFinder } from "@/lib/workflow/eligible-people";
import { getAwaitingUploads } from "@/lib/workflow/processes";

export type WhoCanUploadOption = {
  stepId: string;
  name: string;
  typeLabel: string;
  people: EligiblePerson[];
};

/**
 * Admin only: for each running process that is waiting for its next document, who may upload each open choice
 * (the same rules as a real upload). Runs that are not waiting have no entry. One finder serves every run.
 */
export async function getWhoCanUploadByRun(db: Db, runIds?: string[]): Promise<Map<string, WhoCanUploadOption[]>> {
  const awaiting = (await getAwaitingUploads(db, { isAdmin: true })).filter(
    (entry) => entry.mode === "continue" && (!runIds || runIds.includes(entry.runId)),
  );
  const result = new Map<string, WhoCanUploadOption[]>();
  if (awaiting.length === 0) return result;

  const finder = await createEligiblePeopleFinder(db);
  const cache = new Map<string, EligiblePerson[]>();

  for (const entry of awaiting) {
    const key = `${entry.option.documentTypeId}|${entry.option.documentSubtypeId ?? ""}|${entry.projectId ?? ""}`;
    let people = cache.get(key);
    if (!people) {
      people = await finder.uploaders({ documentTypeId: entry.option.documentTypeId, documentSubtypeId: entry.option.documentSubtypeId, projectId: entry.projectId });
      cache.set(key, people);
    }
    result.set(entry.runId, [
      ...(result.get(entry.runId) ?? []),
      { stepId: entry.option.stepId, name: entry.option.name, typeLabel: `${entry.option.typeName}${entry.option.subtypeName ? ` - ${entry.option.subtypeName}` : ""}`, people },
    ]);
  }
  return result;
}
