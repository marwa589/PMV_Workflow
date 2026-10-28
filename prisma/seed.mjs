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
  ["documents.view", "View documents", "See documents (and open them) that fall inside the scope of the assignment: its project, location, company, document type or sub type. Without it a person only sees documents they uploaded or are asked to review."],
  ["documents.view_reference", "View reference documents", "See reference documents attached to process steps, inside the assignment scope. Without it reference documents are hidden everywhere, even from approvers. Also needs View documents for normal documents."],
  ["documents.upload", "Upload documents", "Upload documents of the types, sub types and projects covered by the assignment. Works on top of the approval flow's Uploader level, which still lets the people it names upload."],
  ["documents.download", "Download documents", "Download documents inside the assignment scope, one by one or in bulk (ZIP, process package)."],
  ["documents.print", "Print documents", "Print documents inside the assignment scope, one by one or in bulk."],
  ["documents.archive", "Archive documents", "Archive approved documents inside the scope and restore them from the archive."],
  ["documents.confirm_receipt", "Confirm receipt", "Mark an approved document (for example a purchase order) as received. Shows the Confirm receipt button on the document page."],
  ["documents.delete_request", "Request deletion", "Ask for a document inside the scope to be deleted. The request goes to the people who can review deletions."],
  ["documents.delete_review", "Review deletion", "Approve or reject deletion requests for documents inside the scope. Approving deletes the document. Adds the Deletion Requests page."],
  ["processes.manage", "Manage processes", "Create and edit process definitions: steps, document types per step, reference documents and waiting periods. Adds Process Setup to the menu."],
  ["flows.manage", "Manage flows", "Create and edit approval flows (levels, approvers, signature required) and assign them to document types, sub types and projects. Adds Flows and Flow Assignments."],
  ["types.manage", "Manage document types", "Create and edit document types, sub types, custom fields and numbering codes."],
  ["users.manage", "Manage users", "Create and edit users: name, email, user type, active state and password resets."],
  ["assignments.manage", "Manage assignments", "Give roles to users with a scope (project, location, company, type, sub type) and edit roles and the mailing list."],
  ["delegations.manage", "Manage delegations", "Create and remove approval delegations, so one person can approve on behalf of another for a period."],
  ["projects.manage", "Manage projects", "Create and edit locations, companies and projects."],
  ["mail.receive_approved", "Receive mail: approved", "Get an email when a document inside the scope is fully approved."],
  ["mail.receive_rejected", "Receive mail: rejected", "Get an email when a document inside the scope is rejected."],
  ["mail.receive_revision", "Receive mail: revision requested", "Get an email when a document inside the scope is sent back for revision."],
];

// The Approver role has no permissions on purpose: it only sees what a flow names it for.
const ROLES = [
  { name: "Approver", description: "Acts where a flow names the user or their type. No permissions.", permissions: [] },
  { name: "Viewer", description: "Read-only access to documents in scope.", permissions: ["documents.view", "documents.download"] },
  { name: "Reference Viewer", description: "May see reference documents attached to process steps, in scope (also needs documents.view for normal documents).", permissions: ["documents.view_reference", "documents.view"] },
  { name: "Uploader", description: "May upload documents in scope.", permissions: ["documents.upload", "documents.view"] },
  { name: "Receiving Clerk", description: "Confirms receipt of approved documents in scope.", permissions: ["documents.view", "documents.confirm_receipt"] },
  { name: "Archivist", description: "Archive and print.", permissions: ["documents.archive", "documents.print", "documents.view"] },
  { name: "Deletion Reviewer", description: "Request and review deletions.", permissions: ["documents.delete_request", "documents.delete_review", "documents.view"] },
  { name: "Flow Admin", description: "Builds flows, document types and processes.", permissions: ["flows.manage", "types.manage", "processes.manage"] },
  { name: "Mailing List (all events)", description: "Emailed when documents in scope are approved, rejected or sent back for revision. Includes view so the link in the email opens.", permissions: ["mail.receive_approved", "mail.receive_rejected", "mail.receive_revision", "documents.view"] },
  { name: "Mailing List (approved only)", description: "Emailed when documents in scope are fully approved.", permissions: ["mail.receive_approved", "documents.view"] },
  { name: "User Admin", description: "Users, assignments, delegations, projects.", permissions: ["users.manage", "assignments.manage", "delegations.manage", "projects.manage"] },
];

// Proposed list (editable later in the admin UI). Custody is not in the PDF, so it is not seeded.
const DOCUMENT_TYPES = [
  { code: "COMP", numberingCode: "COM", name: "Comp Sheet", subtypes: [["SPARE_PARTS", "Spare Parts", "SP"], ["OTHER", "Other", "OT"]] },
  { code: "MR", numberingCode: "MR", name: "Material Req", subtypes: [["CASH", "Cash", "CH"], ["CREDIT", "Credit", "CR"], ["PETTY_CASH", "Petty Cash", "PC"], ["ADVANCE_PAYMENT", "Advance Payment", "AP"]] },
  { code: "ERR", numberingCode: "ERR", name: "Eq Rental Req", subtypes: [["RENTAL_ACTC", "Rental ACTC", "ACTC"], ["RENTAL_EXTERNAL", "Rental External", "EXT"], ["RENEWAL", "Renewal", "REN"], ["PURCHASE", "Purchase", "PUR"]] },
  { code: "PR", name: "Payment Req", subtypes: [] },
  { code: "RV", numberingCode: "RV", name: "Receiving Voucher", subtypes: [["RELEASE", "Release", "REL"], ["RECEIPT", "Receipt", "REC"]] },
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
    const numberingCode = type.numberingCode ?? type.code;
    const saved = await prisma.documentType.upsert({
      where: { code: type.code },
      update: { name: type.name, numberingCode },
      create: { code: type.code, numberingCode, name: type.name },
    });
    for (const [code, name, subtypeNumberingCode] of type.subtypes) {
      const numberingCode = subtypeNumberingCode ?? code;
      await prisma.documentSubtype.upsert({
        where: { documentTypeId_code: { documentTypeId: saved.id, code } },
        update: { name, numberingCode },
        create: { documentTypeId: saved.id, code, numberingCode, name },
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
