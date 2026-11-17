/**
 * KSA projects whose MRs and comparisons have their own approval chain (client-safe: no Prisma import).
 *
 * Chain for a project document:
 *  - project director set for that document type -> director (Pending Approver 1) -> PMV Manager (Marc) -> Approved.
 *    The director can only Approve or Reject (same as Ready Mix Khobar always worked).
 *  - no director for that document type -> Workshop Manager (George, Pending Approver 2) -> PMV Manager (Marc) -> Approved.
 */
export type KsaProjectKey = "READY_MIX_KHOBAR" | "WP03" | "TACHALIH_KSA";

export type KsaProject = {
  key: KsaProjectKey;
  /** Stored in Document.projectName. */
  name: string;
  navLabel: string;
  pagePath: string;
  storageFolder: string;
  mrDirectorEmail: string | null;
  comparisonDirectorEmail: string | null;
  /** Besides Admins and the PMV Manager, who can open the project's MR page and documents. */
  viewerEmails: string[];
};

export const ERRO_UPLOADER_EMAIL = "dispatcher.pmv@ahmadiah.com";
export const BERNABIE_UPLOADER_EMAIL = "bernabie.rocha@ahmadiah.com";
const OMAR_EMAIL = "omar.merzek@ahmadiah.com";
const ELIE_AZZAM_EMAIL = "elie.azzam@ahmadiah.com";
const ELIAS_NASSAR_EMAIL = "elias.nassar@ahmadiah.com";

export const KSA_PROJECTS: KsaProject[] = [
  {
    key: "READY_MIX_KHOBAR",
    name: "Ready Mix Khobar",
    navLabel: "MRs - Ready Mix Khobar",
    pagePath: "/ready-mix-khobar-mrs",
    storageFolder: "MRs/KSA/Ready Mix Khobar",
    mrDirectorEmail: ELIE_AZZAM_EMAIL,
    comparisonDirectorEmail: ELIE_AZZAM_EMAIL,
    viewerEmails: [ERRO_UPLOADER_EMAIL, BERNABIE_UPLOADER_EMAIL, ELIE_AZZAM_EMAIL, OMAR_EMAIL],
  },
  {
    key: "WP03",
    name: "WP03",
    navLabel: "MRs - WP03",
    pagePath: "/ksa-project-mrs/WP03",
    storageFolder: "MRs/KSA/WP03",
    mrDirectorEmail: ELIAS_NASSAR_EMAIL,
    comparisonDirectorEmail: null,
    viewerEmails: [ERRO_UPLOADER_EMAIL, BERNABIE_UPLOADER_EMAIL, ELIAS_NASSAR_EMAIL, OMAR_EMAIL],
  },
  {
    key: "TACHALIH_KSA",
    name: "Tachalih KSA",
    navLabel: "MRs - Tachalih KSA",
    pagePath: "/ksa-project-mrs/TACHALIH_KSA",
    storageFolder: "MRs/KSA/Tachalih KSA",
    mrDirectorEmail: null,
    comparisonDirectorEmail: null,
    viewerEmails: [ERRO_UPLOADER_EMAIL, BERNABIE_UPLOADER_EMAIL, OMAR_EMAIL],
  },
];

export const KSA_PROJECT_NAMES = KSA_PROJECTS.map((project) => project.name);

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() || "";
}

export function getKsaProjectByKey(key: string | null | undefined): KsaProject | null {
  return KSA_PROJECTS.find((project) => project.key === key) ?? null;
}

export function getKsaProjectByName(name: string | null | undefined): KsaProject | null {
  return KSA_PROJECTS.find((project) => project.name === name) ?? null;
}

export function ksaProjectDirectorEmail(project: KsaProject, documentType: string): string | null {
  if (documentType === "MATERIAL_REQUISITION") return project.mrDirectorEmail;
  if (documentType === "COMPARISON") return project.comparisonDirectorEmail;
  return null;
}

/** Projects where this user is the project director for at least one document type. */
export function ksaProjectsDirectedBy(email: string | null | undefined): KsaProject[] {
  const normalized = normalize(email);
  if (!normalized) return [];
  return KSA_PROJECTS.filter((project) => project.mrDirectorEmail === normalized || project.comparisonDirectorEmail === normalized);
}

export function isKsaProjectDirector(email: string | null | undefined): boolean {
  return ksaProjectsDirectedBy(email).length > 0;
}

/** True when this user is the project director of this document's project for its type. */
export function isKsaProjectDirectorForDocument(
  email: string | null | undefined,
  document: { documentType: string; projectName?: string | null },
): boolean {
  const project = getKsaProjectByName(document.projectName);
  const director = project ? ksaProjectDirectorEmail(project, document.documentType) : null;
  return Boolean(director && director === normalize(email));
}

export function canViewKsaProject(user: { role: string; email?: string | null }, project: KsaProject): boolean {
  return user.role === "ADMIN" || user.role === "APPROVER_3" || project.viewerEmails.includes(normalize(user.email));
}

export function isKsaProjectWorkflowDocument(document: { documentType: string; projectName?: string | null }): boolean {
  return (document.documentType === "MATERIAL_REQUISITION" || document.documentType === "COMPARISON")
    && Boolean(getKsaProjectByName(document.projectName));
}

export type WorkflowRouteOption = { value: string; label: string };

/**
 * Upload routes ("location / project") offered to the KSA project uploaders.
 * Erro keeps AVR as his own route and can also upload AVK (same chain as Bernabie's AVK uploads);
 * Bernabie keeps AVK. Both can upload to every KSA project.
 */
export function workflowRouteOptionsForUploader(user: { email?: string | null; location?: string | null }): WorkflowRouteOption[] {
  const email = normalize(user.email);
  const projectOptions = KSA_PROJECTS.map((project) => ({ value: project.key, label: project.name }));
  if (email === ERRO_UPLOADER_EMAIL && user.location === "AVR") return [{ value: "AVR", label: "AVR" }, { value: "AVK", label: "AVK" }, ...projectOptions];
  if (email === BERNABIE_UPLOADER_EMAIL && user.location === "AVK") return [{ value: "AVK", label: "AVK" }, ...projectOptions];
  return [];
}
