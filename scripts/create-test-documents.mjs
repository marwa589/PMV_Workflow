// Creates one test document for every sub type of a document type (MR by default) in every active project, through the
// real upload API, so approval flows, project directors / managers and process runs behave exactly as for a real
// upload. Each document is a blank one-page PDF. Run it against a TEST database: approvers get notified (and emailed,
// when email delivery is on) as usual.
//
//   node scripts/create-test-documents.mjs                      create MR test documents as the first active Admin
//   node scripts/create-test-documents.mjs --dry-run            only list what would be created
//   node scripts/create-test-documents.mjs --as clerk@x.com     upload as that user (their upload rights apply)
//   node scripts/create-test-documents.mjs --type PO            another document type, by its short code
//   node scripts/create-test-documents.mjs --projects P1,P2     only these projects (codes)
//   node scripts/create-test-documents.mjs --subtypes CASH,CR   only these sub types (codes)
//   node scripts/create-test-documents.mjs --count 2            two documents per project and sub type
//   node scripts/create-test-documents.mjs --url http://localhost:3000
//   node scripts/create-test-documents.mjs --cleanup            permanently delete every document this script created
//
// The app must be running (npm run dev or npm start) with the same .env as this script: the script signs a session
// with the app's AUTH_SECRET, so no password or OTP is needed.

import { createHmac, randomBytes, randomUUID } from "crypto";
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PDFDocument } from "pdf-lib";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

// Every document this script creates carries this in its description, so --cleanup finds exactly those.
const MARKER = "[TEST-SCRIPT]";
const SESSION_COOKIE = "docflow_session";
const CSRF_COOKIE = "docflow_csrf";

// ---------------------------------------------------------------------------------------------------------------------
// Options

function readOptions(argv) {
  const options = { type: "MR", as: null, url: "http://localhost:3000", projects: null, subtypes: null, count: 1, dryRun: false, cleanup: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value.`);
      index += 1;
      return value;
    };
    const list = (value) => value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
    if (arg === "--type") options.type = next().toUpperCase();
    else if (arg === "--as") options.as = next().toLowerCase();
    else if (arg === "--url") options.url = next().replace(/\/+$/, "");
    else if (arg === "--projects") options.projects = list(next());
    else if (arg === "--subtypes") options.subtypes = list(next());
    else if (arg === "--count") options.count = Math.max(1, Math.min(20, Number.parseInt(next(), 10) || 1));
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--cleanup") options.cleanup = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option ${arg}. Use --help to see the options.`);
  }
  return options;
}

// ---------------------------------------------------------------------------------------------------------------------
// Signing in: the same signed token the app's login sets (src/lib/auth/session.ts)

function authSecret() {
  const value = process.env.AUTH_SECRET;
  if (value && value.trim() !== "") return value;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is not set.");
  return "dev-auth-secret-change-me";
}

function sessionToken(user) {
  const payload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    userType: user.userType.code,
    sessionVersion: user.sessionVersion,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", authSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function apiClient(baseUrl, user) {
  const csrf = randomBytes(24).toString("hex");
  const cookie = `${SESSION_COOKIE}=${sessionToken(user)}; ${CSRF_COOKIE}=${csrf}`;
  return async (path, init = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { cookie, "x-csrf-token": csrf, ...(init.headers ?? {}) },
      redirect: "manual",
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, ok: response.ok, body };
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Test content

let blankPdf = null;
async function blankPdfBytes() {
  if (!blankPdf) {
    const pdf = await PDFDocument.create();
    pdf.addPage([595.28, 841.89]); // A4, left white
    blankPdf = await pdf.save();
  }
  return blankPdf;
}

/** A value that passes the field's rules (src/lib/document-fields.ts). */
function sampleValue(definition) {
  const today = new Date().toISOString().slice(0, 10);
  const options = Array.isArray(definition.options)
    ? definition.options.map((option) => (typeof option === "string" ? option : option && typeof option === "object" && "value" in option ? String(option.value) : null)).filter(Boolean)
    : [];
  switch (definition.dataType) {
    case "TEXT": return "Test";
    case "LONG_TEXT": return "Test document created by scripts/create-test-documents.mjs";
    case "NUMBER": return "1";
    case "DATE": return today;
    case "BOOLEAN": return true;
    case "SELECT": return options[0] ?? null;
    case "MULTI_SELECT": return options.length ? [options[0]] : null;
    default: return null;
  }
}

/** Header values for the required fields, and one line item when the type has an item table with required columns. */
async function fieldPayload(type, subtypeId) {
  const definitions = await prisma.fieldDefinition.findMany({
    where: { documentTypeId: type.id, isActive: true, OR: [{ documentSubtypeId: null }, { documentSubtypeId: subtypeId }] },
    select: { fieldGroup: true, fieldKey: true, label: true, dataType: true, isRequired: true, options: true },
  });
  const header = {};
  const line = {};
  const problems = [];
  for (const definition of definitions) {
    if (!definition.isRequired) continue;
    const value = sampleValue(definition);
    if (value === null) {
      problems.push(`required field "${definition.label}" has no choices to pick from`);
      continue;
    }
    if (definition.fieldGroup === "LINE_ITEM") line[definition.fieldKey] = value;
    else header[definition.fieldKey] = value;
  }
  const lineItems = type.supportsLineItems && Object.keys(line).length > 0 ? [line] : [];
  return { header, lineItems, problems };
}

// ---------------------------------------------------------------------------------------------------------------------

async function pickUser(email) {
  const select = { id: true, email: true, name: true, isActive: true, sessionVersion: true, userType: { select: { code: true } } };
  const user = email
    ? await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select })
    : await prisma.user.findFirst({ where: { isActive: true, userType: { code: "admin" } }, select, orderBy: { createdAt: "asc" } });
  if (!user) throw new Error(email ? `No user with the email ${email}.` : "No active Admin user found. Use --as <email>.");
  if (!user.isActive) throw new Error(`${user.email} is deactivated.`);
  return user;
}

async function cleanup(options) {
  const admin = await pickUser(options.as);
  if (admin.userType.code !== "admin") throw new Error("--cleanup must run as an Admin user (only Admin users can delete documents).");
  const documents = await prisma.document.findMany({ where: { description: { startsWith: MARKER } }, select: { id: true, documentNumber: true } });
  if (documents.length === 0) {
    console.log("No test documents to delete.");
    return;
  }
  console.log(`Deleting ${documents.length} test document(s) as ${admin.email}...`);
  const api = apiClient(options.url, admin);
  for (let start = 0; start < documents.length; start += 50) {
    const ids = documents.slice(start, start + 50).map((document) => document.id);
    const result = await api("/api/documents/bulk-delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) });
    if (!result.ok) throw new Error(`Delete failed (${result.status}): ${result.body?.message ?? "no message"}`);
    console.log(`  ${result.body?.message ?? `${ids.length} deleted`}`);
  }
  console.log("Done. Process runs started by those documents were cancelled with them.");
}

async function create(options) {
  const type = await prisma.documentType.findFirst({
    where: { code: { equals: options.type, mode: "insensitive" } },
    select: { id: true, code: true, name: true, isActive: true, supportsLineItems: true, subtypes: { where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } } },
  });
  if (!type) throw new Error(`No document type with the code ${options.type}.`);
  if (!type.isActive) throw new Error(`${type.name} is inactive.`);

  const subtypes = (type.subtypes.length ? type.subtypes : [{ id: null, code: "", name: "(no sub type)" }])
    .filter((subtype) => !options.subtypes || options.subtypes.includes(subtype.code.toUpperCase()));
  const projects = (await prisma.project.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }))
    .filter((project) => !options.projects || options.projects.includes(project.code.toUpperCase()));
  if (subtypes.length === 0) throw new Error("No matching active sub types.");
  if (projects.length === 0) throw new Error("No matching active projects.");

  const user = await pickUser(options.as);
  const total = subtypes.length * projects.length * options.count;
  console.log(`${type.name} (${type.code}): ${subtypes.length} sub type(s) x ${projects.length} project(s) x ${options.count} = ${total} document(s)`);
  console.log(`Uploading as ${user.name} <${user.email}> (${user.userType.code}) to ${options.url}`);
  if (options.dryRun) {
    for (const project of projects) for (const subtype of subtypes) console.log(`  would create: ${project.code} - ${project.name} / ${subtype.name}`);
    return;
  }
  console.log("Approvers are notified as for real uploads (and emailed when email delivery is on).\n");

  const api = apiClient(options.url, user);
  const ping = await api("/api/sidebar-counts");
  if (ping.status === 401) throw new Error("The app did not accept the session. Is it running with the same AUTH_SECRET as this script?");
  if (!ping.ok && ping.status !== 404) throw new Error(`Cannot reach the app at ${options.url} (status ${ping.status}).`);

  const pdf = await blankPdfBytes();
  const results = [];
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);

  for (const project of projects) {
    for (const subtype of subtypes) {
      for (let copy = 1; copy <= options.count; copy += 1) {
        const label = `${project.code} / ${subtype.name}${options.count > 1 ? ` #${copy}` : ""}`;
        const fields = await fieldPayload(type, subtype.id);
        if (fields.problems.length) {
          results.push({ label, ok: false, message: fields.problems.join("; ") });
          console.log(`  SKIP  ${label}: ${fields.problems.join("; ")}`);
          continue;
        }
        const title = `TEST ${type.code} ${subtype.code || ""} ${project.code}${options.count > 1 ? ` #${copy}` : ""}`.replace(/\s+/g, " ").trim();
        const form = new FormData();
        form.set("documentTypeId", type.id);
        if (subtype.id) form.set("documentSubtypeId", subtype.id);
        form.set("projectId", project.id);
        form.set("description", `${MARKER} ${stamp} ${label}`);
        form.set("submissionKey", randomUUID());
        form.set("fieldValues", JSON.stringify(fields.header));
        if (fields.lineItems.length) form.set("lineItems", JSON.stringify(fields.lineItems));
        form.append("fileTitles", title);
        form.append("files", new Blob([pdf], { type: "application/pdf" }), `${title.replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`);

        const result = await api("/api/documents", { method: "POST", body: form });
        if (result.ok) {
          const created = result.body?.documents ?? [];
          const summary = created.map((document) => `${document.documentNumber} (${document.status})`).join(", ") || "created";
          const run = result.body?.processRunId ? `, process run started` : "";
          results.push({ label, ok: true, message: `${summary}${run}` });
          console.log(`  OK    ${label}: ${summary}${run}`);
        } else {
          const message = result.body?.message ?? `HTTP ${result.status}`;
          results.push({ label, ok: false, message });
          console.log(`  FAIL  ${label}: ${message}`);
        }
      }
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length} created, ${failed.length} failed or skipped.`);
  if (failed.length) {
    // Grouped, so a missing director or flow shows up once per reason instead of once per document.
    const byReason = new Map();
    for (const result of failed) byReason.set(result.message, [...(byReason.get(result.message) ?? []), result.label]);
    console.log("\nWhy:");
    for (const [message, labels] of byReason) console.log(`  ${message}\n    ${labels.join(", ")}`);
  }
  console.log(`\nRemove them all later with: node scripts/create-test-documents.mjs --cleanup`);
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  if (options.help) {
    console.log("See the comment at the top of scripts/create-test-documents.mjs for the options.");
    return;
  }
  if (options.cleanup) await cleanup(options);
  else await create(options);
}

main()
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
