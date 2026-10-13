// Seeds the reference data the dynamic workflow needs. Safe to run repeatedly (upserts).
//   npm run db:seed
// Optional first admin: set SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (and SEED_ADMIN_NAME).
import nextEnv from "@next/env";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

const USER_TYPES = [
  { code: "clerk", name: "Clerk" },
  { code: "eng", name: "Engineer" },
  { code: "manager", name: "Manager" },
  { code: "admin", name: "Admin" },
];

const PERMISSIONS = [
  ["documents.view", "View documents", "View documents in scope"],
  ["documents.create", "Create documents", "Upload documents in scope"],
  ["documents.edit", "Edit documents", "Edit documents in scope"],
  ["documents.download", "Download documents", "Download and bulk download"],
  ["documents.print", "Print documents", "Print and bulk print"],
  ["documents.archive", "Archive documents", "Archive and restore documents"],
  ["documents.approve_without_signature", "Approve without signature", "Approve a document without placing a signature on it"],
  ["documents.confirm_receipt", "Confirm receipt", "Mark an approved document (for example a purchase order) as received"],
  ["documents.delete_request", "Request deletion", "Request deletion of a document"],
  ["documents.delete_review", "Review deletion", "Approve or reject deletion requests"],
  ["processes.view", "View processes", "See process runs in scope"],
  ["processes.start", "Start processes", "Start a run of a process in scope"],
  ["processes.manage", "Manage processes", "Create and edit process definitions"],
  ["flows.manage", "Manage flows", "Create approval flows and flow assignments"],
  ["types.manage", "Manage document types", "Document types, sub types, custom fields, numbering"],
  ["analytics.view", "View analytics", "Dashboards and pipeline charts"],
  ["users.manage", "Manage users", "Create and edit users"],
  ["assignments.manage", "Manage assignments", "Role assignments and scopes"],
  ["delegations.manage", "Manage delegations", "Approval delegations"],
  ["projects.manage", "Manage projects", "Locations, companies and projects"],
];

// The Approver role has no permissions on purpose: it only sees what a flow names it for.
const ROLES = [
  { name: "Approver", description: "Acts where a flow names the user or their type. No permissions.", permissions: [] },
  { name: "Viewer", description: "Read-only access to documents in scope.", permissions: ["documents.view", "documents.download"] },
  { name: "Editor", description: "Viewer plus create and edit.", permissions: ["documents.view", "documents.download", "documents.create", "documents.edit"] },
  { name: "Receiving Clerk", description: "Confirms receipt of approved documents in scope.", permissions: ["documents.view", "documents.confirm_receipt"] },
  { name: "Unsigned Approver", description: "May approve without placing a signature. Scope it to a document type or location to limit it.", permissions: ["documents.approve_without_signature"] },
  { name: "Process Starter", description: "Start and follow process runs in scope.", permissions: ["processes.view", "processes.start"] },
  { name: "Analyst", description: "Dashboards and read access.", permissions: ["analytics.view", "documents.view"] },
  { name: "Archivist", description: "Archive and print.", permissions: ["documents.archive", "documents.print", "documents.view"] },
  { name: "Deletion Reviewer", description: "Request and review deletions.", permissions: ["documents.delete_request", "documents.delete_review", "documents.view"] },
  { name: "Flow Admin", description: "Builds flows, document types and processes.", permissions: ["flows.manage", "types.manage", "processes.manage"] },
  { name: "User Admin", description: "Users, assignments, delegations, projects.", permissions: ["users.manage", "assignments.manage", "delegations.manage", "projects.manage"] },
];

// Proposed list (editable later in the admin UI). Custody is not in the PDF, so it is not seeded.
const DOCUMENT_TYPES = [
  { code: "COMP", name: "Comp Sheet", subtypes: [["SPARE_PARTS", "Spare Parts"], ["OTHER", "Other"]] },
  { code: "MR", name: "Material Req", subtypes: [["CASH", "Cash"], ["CREDIT", "Credit"], ["PETTY_CASH", "Petty Cash"], ["ADVANCE_PAYMENT", "Advance Payment"]] },
  { code: "ERR", name: "Eq Rental Req", subtypes: [["RENTAL_ACTC", "Rental ACTC"], ["RENTAL_EXTERNAL", "Rental External"], ["RENEWAL", "Renewal"], ["PURCHASE", "Purchase"]] },
  { code: "PR", name: "Payment Req", subtypes: [] },
  { code: "RV", name: "Receiving Voucher", subtypes: [["RELEASE", "Release"], ["RECEIPT", "Receipt"]] },
  { code: "QT", name: "Quotation", subtypes: [] },
  { code: "INV", name: "Invoice", subtypes: [] },
  { code: "DN", name: "Delivery Note", subtypes: [] },
  { code: "PL", name: "Payment Letter", subtypes: [] },
  { code: "PO", name: "Purchase Order", subtypes: [] },
];

async function main() {
  for (const type of USER_TYPES) {
    await prisma.userType.upsert({ where: { code: type.code }, update: { name: type.name }, create: type });
  }

  for (const [code, name, description] of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code }, update: { name, description }, create: { code, name, description } });
  }

  for (const role of ROLES) {
    const saved = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: { name: role.name, description: role.description },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: saved.id } });
    for (const code of role.permissions) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: saved.id, permissionId: permission.id } });
    }
  }

  for (const type of DOCUMENT_TYPES) {
    const saved = await prisma.documentType.upsert({
      where: { code: type.code },
      update: { name: type.name },
      create: { code: type.code, name: type.name },
    });
    for (const [code, name] of type.subtypes) {
      await prisma.documentSubtype.upsert({
        where: { documentTypeId_code: { documentTypeId: saved.id, code } },
        update: { name },
        create: { documentTypeId: saved.id, code, name },
      });
    }
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const adminType = await prisma.userType.findUniqueOrThrow({ where: { code: "admin" } });
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        name: process.env.SEED_ADMIN_NAME?.trim() || "Administrator",
        passwordHash: await hash(adminPassword, 12),
        userTypeId: adminType.id,
      },
    });
    console.log(`Admin user ready: ${adminEmail}`);
  }

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
