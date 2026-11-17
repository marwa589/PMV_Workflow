// Read-only export of the system's setup, used to build test checklists: projects, users and their roles, approval
// flows and which documents use them, processes, delegations. Nothing is changed in the database. Passwords, OTP codes,
// sessions and documents themselves are NOT exported.
//
//   node scripts/export-test-setup.mjs              writes test-setup-export.json in the project folder
//   node scripts/export-test-setup.mjs out.json     writes to another file

import { writeFileSync } from "fs";
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

const name = (row) => (row ? row.name : null);
const projectLabel = (row) => (row ? `${row.code} - ${row.name}` : null);

function approverLabel(entry) {
  if (entry.approverType === "USER") return { kind: "user", user: entry.user ? `${entry.user.name} <${entry.user.email}>` : entry.userId };
  if (entry.approverType === "USER_TYPE") return { kind: "userType", userType: name(entry.userType) ?? entry.userTypeId };
  if (entry.approverType === "PROJECT_DIRECTOR") return { kind: "projectDirector" };
  if (entry.approverType === "PROJECT_MANAGER") return { kind: "projectManager" };
  return { kind: entry.approverType };
}

async function main() {
  const out = process.argv[2] || "test-setup-export.json";

  const [locations, companies, projects, userTypes, users, roles, assignments, delegations, documentTypes, templates, flowAssignments, processes, documentCounts] = await Promise.all([
    prisma.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.company.findMany({ select: { id: true, name: true, isActive: true, location: { select: { name: true } } }, orderBy: { name: "asc" } }),
    prisma.project.findMany({
      select: {
        id: true, code: true, name: true, isActive: true,
        location: { select: { name: true } },
        company: { select: { name: true } },
        director: { select: { name: true, email: true, isActive: true } },
        manager: { select: { name: true, email: true, isActive: true } },
      },
      orderBy: { code: "asc" },
    }),
    prisma.userType.findMany({ select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({
      select: { id: true, name: true, email: true, isActive: true, canBulkApprove: true, emailNotificationsDisabled: true, userType: { select: { code: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.role.findMany({
      select: { id: true, name: true, description: true, permissions: { select: { permission: { select: { code: true, name: true } } } } },
      orderBy: { name: "asc" },
    }),
    prisma.userAssignment.findMany({
      select: {
        id: true,
        user: { select: { name: true, email: true } },
        role: { select: { name: true } },
        company: { select: { name: true } },
        location: { select: { name: true } },
        project: { select: { code: true, name: true } },
        documentType: { select: { code: true, name: true } },
        documentSubtype: { select: { code: true, name: true } },
        projectScopes: { select: { project: { select: { code: true, name: true } } } },
        documentTypeScopes: {
          select: {
            allSubtypes: true,
            documentType: { select: { code: true, name: true } },
            subtypes: { select: { documentSubtype: { select: { code: true, name: true } } } },
          },
        },
      },
    }),
    prisma.approvalDelegation.findMany({
      select: { delegator: { select: { name: true, email: true } }, delegate: { select: { name: true, email: true } }, reason: true, expiresAt: true, createdAt: true },
    }),
    prisma.documentType.findMany({
      select: {
        id: true, code: true, name: true, isActive: true, supportsLineItems: true,
        subtypes: { select: { id: true, code: true, name: true, isActive: true }, orderBy: { name: "asc" } },
        fieldDefinitions: { where: { isActive: true }, select: { label: true, dataType: true, isRequired: true, fieldGroup: true, documentSubtypeId: true } },
      },
      orderBy: { code: "asc" },
    }),
    prisma.documentWorkflowTemplate.findMany({
      select: {
        id: true, code: true, name: true, isActive: true,
        steps: {
          orderBy: { stepNumber: "asc" },
          select: {
            stepNumber: true, name: true, signatureRequired: true,
            approvers: { select: { approverType: true, userId: true, userTypeId: true, user: { select: { name: true, email: true } }, userType: { select: { name: true } } } },
            tracks: { orderBy: { sortOrder: "asc" }, select: { name: true, returnLevel: true, signatureRequired: true, receiver: { select: { name: true, email: true } } } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.documentWorkflowAssignment.findMany({
      select: {
        documentType: { select: { code: true, name: true } },
        documentSubtype: { select: { code: true, name: true } },
        project: { select: { code: true, name: true } },
        template: { select: { code: true, name: true } },
      },
    }),
    prisma.processDefinition.findMany({
      select: { id: true, name: true, isActive: true, currentVersion: true },
      orderBy: { name: "asc" },
    }),
    prisma.document.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  // Process trees (current version only), as nested steps.
  const processTrees = [];
  for (const process of processes) {
    const steps = await prisma.processStep.findMany({
      where: { processDefinitionId: process.id, versionNumber: process.currentVersion },
      select: {
        id: true, stepNumber: true, name: true, parentStepId: true, delayHours: true, allowMultipleUploads: true,
        documentType: { select: { code: true, name: true } },
        documentSubtype: { select: { code: true, name: true } },
        referenceDocumentType: { select: { code: true, name: true } },
        referenceDocumentSubtype: { select: { code: true, name: true } },
      },
      orderBy: { stepNumber: "asc" },
    });
    const build = (parentId) =>
      steps
        .filter((step) => step.parentStepId === parentId)
        .map((step) => ({
          step: step.stepNumber,
          name: step.name,
          document: `${step.documentType.code}${step.documentSubtype ? ` / ${step.documentSubtype.code} (${step.documentSubtype.name})` : ""}`,
          reference: step.referenceDocumentType ? `${step.referenceDocumentType.code}${step.referenceDocumentSubtype ? ` / ${step.referenceDocumentSubtype.code}` : ""}` : null,
          delayHours: step.delayHours,
          allowMultipleUploads: step.allowMultipleUploads,
          next: build(step.id),
        }));
    processTrees.push({ name: process.name, isActive: process.isActive, version: process.currentVersion, tree: build(null) });
  }

  const data = {
    exportedAt: new Date().toISOString(),
    counts: {
      projects: projects.length, users: users.length, roles: roles.length, assignments: assignments.length,
      flows: templates.length, flowAssignments: flowAssignments.length, processes: processes.length,
      documentsByStatus: Object.fromEntries(documentCounts.map((row) => [row.status, row._count._all])),
    },
    locations,
    companies: companies.map((company) => ({ name: company.name, isActive: company.isActive, location: name(company.location) })),
    projects: projects.map((project) => ({
      code: project.code, name: project.name, isActive: project.isActive,
      location: name(project.location), company: name(project.company),
      director: project.director ? `${project.director.name} <${project.director.email}>${project.director.isActive ? "" : " (inactive)"}` : null,
      manager: project.manager ? `${project.manager.name} <${project.manager.email}>${project.manager.isActive ? "" : " (inactive)"}` : null,
    })),
    userTypes,
    users: users.map((user) => ({
      name: user.name, email: user.email, userType: user.userType.name, isAdmin: user.userType.code === "admin",
      isActive: user.isActive, canReviewSeveral: user.canBulkApprove, emailsOff: user.emailNotificationsDisabled,
    })),
    roles: roles.map((role) => ({ name: role.name, description: role.description, permissions: role.permissions.map((entry) => entry.permission.code).sort() })),
    assignments: assignments.map((assignment) => ({
      user: `${assignment.user.name} <${assignment.user.email}>`,
      role: assignment.role.name,
      scope: {
        company: name(assignment.company),
        location: name(assignment.location),
        projects: [...(assignment.project ? [projectLabel(assignment.project)] : []), ...assignment.projectScopes.map((scope) => projectLabel(scope.project))],
        documentTypes: [
          ...(assignment.documentType ? [`${assignment.documentType.code}${assignment.documentSubtype ? ` / ${assignment.documentSubtype.code}` : ""}`] : []),
          ...assignment.documentTypeScopes.map((scope) => scope.allSubtypes || scope.subtypes.length === 0
            ? `${scope.documentType.code} (all sub types)`
            : `${scope.documentType.code} / ${scope.subtypes.map((entry) => entry.documentSubtype.code).join(", ")}`),
        ],
      },
    })),
    delegations: delegations.map((delegation) => ({
      from: `${delegation.delegator.name} <${delegation.delegator.email}>`,
      to: `${delegation.delegate.name} <${delegation.delegate.email}>`,
      reason: delegation.reason, expiresAt: delegation.expiresAt, active: !delegation.expiresAt || delegation.expiresAt > new Date(),
    })),
    documentTypes: documentTypes.map((type) => ({
      code: type.code, name: type.name, isActive: type.isActive, supportsLineItems: type.supportsLineItems,
      subtypes: type.subtypes.map((subtype) => ({ code: subtype.code, name: subtype.name, isActive: subtype.isActive })),
      requiredFields: type.fieldDefinitions.filter((field) => field.isRequired).map((field) => `${field.label} (${field.dataType}${field.fieldGroup === "LINE_ITEM" ? ", line" : ""}${field.documentSubtypeId ? ", one sub type" : ""})`),
    })),
    flows: templates.map((template) => ({
      code: template.code, name: template.name, isActive: template.isActive,
      levels: template.steps.map((step) => ({
        level: step.stepNumber, name: step.name, signatureRequired: step.signatureRequired,
        approvers: step.approvers.map(approverLabel),
        uniqueTracks: step.tracks.map((track) => ({ name: track.name, receiver: `${track.receiver.name} <${track.receiver.email}>`, returnLevel: track.returnLevel, signatureRequired: track.signatureRequired })),
      })),
    })),
    // Which flow applies: by type / sub type / project (a missing sub type or project = "any"); no template = auto-approved.
    flowAssignments: flowAssignments.map((row) => ({
      documentType: row.documentType.code,
      subtype: row.documentSubtype ? `${row.documentSubtype.code} (${row.documentSubtype.name})` : "any",
      project: row.project ? projectLabel(row.project) : "any",
      flow: row.template ? `${row.template.code} - ${row.template.name}` : "AUTO-APPROVE (no flow)",
    })),
    processes: processTrees,
  };

  writeFileSync(out, JSON.stringify(data, null, 2));
  console.log(`Wrote ${out}`);
  console.log(JSON.stringify(data.counts));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
