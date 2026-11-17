// One-time move of the mailing list from roles to the Mailing List page's own settings.
//   node prisma/migrate-mailing-list.mjs            -> DRY RUN: shows what each person would get
//   node prisma/migrate-mailing-list.mjs --apply    -> writes the settings, then removes the three "Receive mail" permissions
//
// Every person who held mail.receive_approved / _rejected / _revision through an assignment gets one setting per event
// (WATCH_APPROVED / WATCH_REJECTED / WATCH_REVISION) limited to the projects and document types their assignments covered.
// A setting holds ONE list of projects and ONE list of types (a document must match both). When a person had several
// assignments, each list is the union of theirs, and a list is left empty (= everything) as soon as one assignment did not
// limit it. That can be wider than before for people with differently-scoped assignments: those are listed at the end so
// you can tighten them on the page. Process-scoped assignments cannot be represented (the page has no process filter).
// Settings that already exist are never overwritten. Safe to run again.
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

nextEnv.loadEnvConfig(process.cwd(), true);
const apply = process.argv.includes("--apply");
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

const EVENTS = [
  { permission: "mail.receive_approved", kind: "WATCH_APPROVED" },
  { permission: "mail.receive_rejected", kind: "WATCH_REJECTED" },
  { permission: "mail.receive_revision", kind: "WATCH_REVISION" },
];

const assignments = await prisma.userAssignment.findMany({
  where: { role: { permissions: { some: { permission: { code: { in: EVENTS.map((e) => e.permission) } } } } } },
  select: {
    userId: true, companyId: true, projectId: true, locationId: true, documentTypeId: true, documentSubtypeId: true,
    user: { select: { name: true, email: true } },
    role: { select: { permissions: { select: { permission: { select: { code: true } } } } } },
    projectScopes: { select: { projectId: true } },
    documentTypeScopes: { select: { documentTypeId: true, allSubtypes: true, subtypes: { select: { documentSubtypeId: true } } } },
  },
});
const locationProjects = new Map();
for (const project of await prisma.project.findMany({ select: { id: true, locationId: true } })) {
  if (!project.locationId) continue;
  locationProjects.set(project.locationId, [...(locationProjects.get(project.locationId) ?? []), project.id]);
}

// userId + kind -> { name, projects:Set|null, types:Set, subtypes:Set, typesFree:boolean, count, restrictedCount, notes:[] }
const wanted = new Map();
for (const assignment of assignments) {
  const codes = new Set(assignment.role.permissions.map((p) => p.permission.code));
  for (const event of EVENTS.filter((e) => codes.has(e.permission))) {
    const key = `${assignment.userId}|${event.kind}`;
    const entry = wanted.get(key) ?? { userId: assignment.userId, kind: event.kind, who: `${assignment.user.name} <${assignment.user.email}>`, projects: new Set(), projectsFree: false, types: new Set(), subtypes: new Set(), typesFree: false, count: 0, restricted: 0, notes: [] };
    wanted.set(key, entry);
    if (assignment.companyId) {
      entry.notes.push("a company-scoped assignment was skipped (it never matched documents)");
      continue;
    }
    entry.count += 1;

    const projectList = [...new Set([...(assignment.projectId ? [assignment.projectId] : []), ...assignment.projectScopes.map((s) => s.projectId)])];
    const inLocation = assignment.locationId ? new Set(locationProjects.get(assignment.locationId) ?? []) : null;
    const projects = inLocation ? (projectList.length ? projectList.filter((id) => inLocation.has(id)) : [...inLocation]) : projectList;
    if (projects.length === 0 && !inLocation) entry.projectsFree = true;
    projects.forEach((id) => entry.projects.add(id));

    const types = [];
    const subtypes = [];
    if (assignment.documentTypeId) (assignment.documentSubtypeId ? subtypes.push(assignment.documentSubtypeId) : types.push(assignment.documentTypeId));
    for (const scope of assignment.documentTypeScopes) {
      if (scope.allSubtypes) types.push(scope.documentTypeId);
      else scope.subtypes.forEach((s) => subtypes.push(s.documentSubtypeId));
    }
    if (types.length === 0 && subtypes.length === 0) entry.typesFree = true;
    types.forEach((id) => entry.types.add(id));
    subtypes.forEach((id) => entry.subtypes.add(id));
    if (projects.length || types.length || subtypes.length) entry.restricted += 1;
  }
}

const widened = [];
let created = 0;
let existing = 0;
console.log(`${apply ? "APPLY" : "DRY RUN"}: ${wanted.size} setting(s) to create.\n`);
for (const entry of wanted.values()) {
  if (entry.count === 0) continue;
  const projectIds = entry.projectsFree ? [] : [...entry.projects];
  const documentTypeIds = entry.typesFree ? [] : [...entry.types];
  const documentSubtypeIds = entry.typesFree ? [] : [...entry.subtypes];
  const line = `${entry.who} | ${entry.kind} | projects ${projectIds.length ? projectIds.length : "all"} | types ${documentTypeIds.length || documentSubtypeIds.length ? `${documentTypeIds.length} type(s) + ${documentSubtypeIds.length} sub type(s)` : "all"}`;
  if (entry.count > 1 && entry.restricted > 0) widened.push(`${entry.who} | ${entry.kind} (${entry.count} assignments)`);
  const notes = [...new Set(entry.notes)];
  if (!apply) {
    console.log(`WOULD ADD  ${line}${notes.length ? `  [${notes.join("; ")}]` : ""}`);
    continue;
  }
  const already = await prisma.mailSetting.findUnique({ where: { userId_kind: { userId: entry.userId, kind: entry.kind } }, select: { id: true } });
  if (already) {
    existing += 1;
    console.log(`EXISTS     ${line}`);
    continue;
  }
  await prisma.mailSetting.create({ data: { userId: entry.userId, kind: entry.kind, delivery: null, projectIds, documentTypeIds, documentSubtypeIds } });
  created += 1;
  console.log(`ADDED      ${line}${notes.length ? `  [${notes.join("; ")}]` : ""}`);
}

if (widened.length) {
  console.log(`\nPeople with several, differently scoped assignments (their list may now be wider than before; check them on the page):`);
  widened.forEach((line) => console.log(`  ${line}`));
}

if (apply) {
  const removed = await prisma.permission.deleteMany({ where: { code: { in: EVENTS.map((e) => e.permission) } } });
  console.log(`\nCreated ${created}, already there ${existing}. Removed ${removed.count} "Receive mail" permission(s) (role links go with them; roles and assignments stay).`);
} else {
  console.log("\nNothing was changed. Run again with --apply.");
}
await prisma.$disconnect();
