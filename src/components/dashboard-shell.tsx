
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Building2,
  UserCheck,
  Workflow,
  Bell,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  FilePlus2,
  FileText,
  FolderCog,
  GitBranch,
  LayoutDashboard,
  Mail,
  Menu,
  Network,
  Search,
  Settings,
  ShieldCheck,
  UserCircle2,
  Users,
  X,
} from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";
import type { UserTypeCode } from "@/lib/auth/roles";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: { kind: "all" } | { kind: "pending" } | { kind: "tasks" } | { kind: "type"; documentTypeId: string };
};

type AppRole = UserTypeCode;

type DashboardShellProps = {
  role: AppRole;
  userName: string;
  title: string;
  subtitle: string;
  children: ReactNode;
};

type GlobalSearchHit = {
  id: string;
  documentNumber: string;
  title: string;
  statusLabel: string;
  typeName: string;
  subtypeName: string | null;
  projectLabel: string | null;
};

type SidebarCounts = {
  pendingDocuments: number;
  pendingApprovals: number;
  tasks: { uploads: number; reviews: number };
  pendingByType: Array<{ documentTypeId: string; code: string; name: string; count: number }>;
  canUpload: boolean;
  canViewProcesses?: boolean;
  documentTypes: Array<{ id: string; code: string; name: string }>;
  manage: Partial<Record<
    "flows" | "types" | "processes" | "users" | "assignments" | "delegations" | "projects" | "deletionReview",
    boolean
  >>;
};

const emptySidebarCounts: SidebarCounts = {
  pendingDocuments: 0,
  pendingApprovals: 0,
  tasks: { uploads: 0, reviews: 0 },
  pendingByType: [],
  canUpload: false,
  documentTypes: [],
  manage: {},
};

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  documentId?: string | null;
};

const HOME_BY_USER_TYPE: Record<
  AppRole,
  { dashboard: string; list: string; settings: string }
> = {
  clerk: {
    dashboard: "/clerk",
    list: "/clerk/my-documents",
    settings: "/clerk/settings",
  },
  eng: {
    dashboard: "/approver",
    list: "/approver/my-documents",
    settings: "/approver/settings",
  },
  manager: {
    dashboard: "/approver",
    list: "/approver/my-documents",
    settings: "/approver/settings",
  },
  admin: {
    dashboard: "/admin",
    list: "/admin/all-documents",
    settings: "/admin/settings",
  },
};

// "Work" is what needs doing now; "Documents" is where the documents live.
function getVisibleNavItems(role: AppRole, counts: SidebarCounts): { workItems: NavItem[]; documentItems: NavItem[] } {
  const home = HOME_BY_USER_TYPE[role];
  const isApprover = role === "eng" || role === "manager" || role === "admin";
  const base = role === "admin" ? "/admin" : "/approver";

  const workItems: NavItem[] = [
    { label: "Dashboard", href: home.dashboard, icon: LayoutDashboard },
    // Everything waiting for this person: documents to upload (next step of a process) and documents to review.
    { label: "My Tasks", href: "/tasks", icon: ClipboardList, badge: { kind: "tasks" } },
  ];

  if (counts.canUpload) {
    workItems.push({ label: "New Document", href: "/new-document", icon: FilePlus2 });
  }

  if (counts.canViewProcesses) {
    workItems.push({ label: "Process Runs", href: "/processes", icon: Workflow });
  }

  const documentItems: NavItem[] = [
    {
      label: role === "admin" ? "All Documents" : "My Documents",
      href: home.list,
      icon: FileText,
      badge: { kind: "all" },
    },
  ];

  if (isApprover) {
    documentItems.push({ label: "Approved", href: `${base}/approved-documents`, icon: CheckCircle2 });
    documentItems.push({ label: "Rejected", href: `${base}/rejected-documents`, icon: FileCheck2 });
    documentItems.push({ label: "Archive", href: `${base}/archive`, icon: Archive });
  } else {
    documentItems.push({ label: "Rejected", href: `${home.list}?status=CANCELLED`, icon: FileCheck2 });
  }

  return { workItems, documentItems };
}

function Sidebar({
  role,
  closeMenu,
  counts,
}: {
  role: AppRole;
  closeMenu?: () => void;
  counts: SidebarCounts;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [documentTypesOpen, setDocumentTypesOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const home = HOME_BY_USER_TYPE[role];
  const { workItems, documentItems } = getVisibleNavItems(role, counts);
  const manage = counts.manage;

  // Setup is grouped by what the person is configuring, so related screens sit together.
  const setupGroups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: "People & access",
      items: [
        ...(manage.users ? [{ label: "Users", href: "/admin/users", icon: Users }] : []),
        ...(manage.assignments ? [{ label: "Roles & Access", href: "/admin/roles", icon: ShieldCheck }] : []),
        ...(manage.assignments ? [{ label: "Mailing List", href: "/admin/mailing-list", icon: Mail }] : []),
        ...(manage.delegations ? [{ label: "Delegations", href: "/admin/delegations", icon: UserCheck }] : []),
      ],
    },
    {
      label: "Documents & workflow",
      items: [
        ...(manage.types ? [{ label: "Document Types", href: "/admin/document-types", icon: FileText }] : []),
        ...(manage.flows ? [{ label: "Approval Flows", href: "/admin/flows", icon: GitBranch }] : []),
        ...(manage.flows ? [{ label: "Flow Assignments", href: "/admin/flow-assignments", icon: ClipboardCheck }] : []),
        ...(manage.processes ? [{ label: "Process Setup", href: "/admin/processes", icon: Network }] : []),
      ],
    },
    {
      label: "Organization",
      items: [...(manage.projects ? [{ label: "Projects & Locations", href: "/admin/projects", icon: Building2 }] : [])],
    },
    {
      label: "System",
      items: [...(role === "admin" ? [{ label: "System Settings", href: "/admin/settings", icon: Settings }] : [])],
    },
  ].filter((group) => group.items.length > 0);
  const setupItems = setupGroups.flatMap((group) => group.items);

  const currentDocumentType = searchParams.get("documentType") ?? "";
  const currentStatus = searchParams.get("status") ?? "";

  const typeMenuActive = counts.documentTypes.some(
    (type) =>
      pathname === home.list && currentDocumentType === type.code,
  );

  const setupMenuActive = setupItems.some(
    (item) => pathname === item.href,
  );

  const accountSettingsBase =
    role === "admin" ? "/approver/settings" : home.settings;

  const accountMenuActive = pathname.startsWith(accountSettingsBase);

  useEffect(() => {
    if (typeMenuActive) setDocumentTypesOpen(true);
  }, [typeMenuActive]);

  useEffect(() => {
    if (setupMenuActive) setSetupOpen(true);
  }, [setupMenuActive]);

  useEffect(() => {
    if (accountMenuActive) setAccountOpen(true);
  }, [accountMenuActive]);

  
const badgeCount = (item: NavItem): number => {
  // 1. Extract to a local constant
  const badge = item.badge;
  
  // 2. Now TypeScript knows 'badge' is definitely defined after this check
  if (!badge) return 0;

  switch (badge.kind) {
    case "all":
      return counts.pendingDocuments;

    case "pending":
      return counts.pendingApprovals;

    case "tasks":
      return counts.tasks.uploads + counts.tasks.reviews;

    case "type":
      return (
        counts.pendingByType.find(
          // 3. Use the local 'badge' variable here
          (row) => row.documentTypeId === badge.documentTypeId,
        )?.count ?? 0
      );

    default:
      return 0;
  }
};


  const isActive = (item: NavItem) => {
    const itemUrl = new URL(item.href, "http://localhost");
    const itemDocumentType = itemUrl.searchParams.get("documentType");
    const itemStatus = itemUrl.searchParams.get("status");

    return (
      pathname === itemUrl.pathname &&
      (itemDocumentType
        ? currentDocumentType === itemDocumentType
        : itemStatus
          ? currentStatus === itemStatus
          : !currentDocumentType && !currentStatus)
    );
  };

  const renderNavItem = (item: NavItem, nested = false) => {
    const Icon = item.icon;
    const active = isActive(item);
    const count = badgeCount(item);

    return (
      <button
        key={item.label}
        type="button"
        onClick={() => {
          closeMenu?.();
          router.push(item.href);
        }}
        className={`${
          nested ? "pl-9" : "px-3"
        } flex w-full items-center justify-between rounded-xl py-2.5 text-left text-sm font-medium transition ${
          active
            ? "bg-slate-900 text-white shadow-sm"
            : "text-slate-700 hover:bg-slate-100"
        }`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </span>

        <span className="flex items-center gap-2">
          {count > 0 && (
            <span
              className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold ${
                active
                  ? "bg-white/20 text-white"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {count}
            </span>
          )}

          <ChevronRight
            className={`h-4 w-4 ${
              active ? "text-white/70" : "text-slate-400"
            }`}
          />
        </span>
      </button>
    );
  };

  const renderSectionLabel = (label: string) => (
    <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
  );

  const renderGroupButton = (
    label: string,
    Icon: LucideIcon,
    open: boolean,
    setOpen: (value: boolean) => void,
    active: boolean,
  ) => (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
        active
          ? "bg-slate-100 text-slate-900"
          : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </span>

      <ChevronDown
        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
          open ? "rotate-180" : ""
        }`}
      />
    </button>
  );

  return (
    <aside className="sticky top-0 flex h-screen w-72 flex-col border-r border-slate-200 bg-white/90 backdrop-blur-sm">
      <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
          <FileCheck2 className="h-5 w-5" />
        </div>

        <div>
          <p className="text-sm font-semibold text-slate-900">
            DocuFlow 365
          </p>
          <p className="text-xs text-slate-500">
            Enterprise Workspace
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {renderSectionLabel("Work")}
        {workItems.map((item) => renderNavItem(item))}

        {renderSectionLabel("Documents")}
        {documentItems.map((item) => renderNavItem(item))}

        {counts.documentTypes.length > 0 && (
          <div className="space-y-1">
            {renderGroupButton(
              "Documents by Type",
              FileText,
              documentTypesOpen,
              setDocumentTypesOpen,
              typeMenuActive,
            )}

            {documentTypesOpen && (
              <div className="ml-5 space-y-1 border-l border-slate-200">
                {counts.documentTypes.map((type) =>
                  renderNavItem(
                    {
                      label: type.name,
                      href: `${home.list}?documentType=${encodeURIComponent(type.code)}`,
                      icon: FileText,
                      badge: {
                        kind: "type",
                        documentTypeId: type.id,
                      },
                    },
                    true,
                  ),
                )}
              </div>
            )}
          </div>
        )}

        {setupItems.length > 0 && renderSectionLabel("Administration")}

        {setupItems.length > 0 && (
          <div className="space-y-1">
            {renderGroupButton(
              "Setup & Configuration",
              FolderCog,
              setupOpen,
              setSetupOpen,
              setupMenuActive,
            )}

            {setupOpen && (
              <div className="ml-5 space-y-1 border-l border-slate-200">
                {setupGroups.map((group) => (
                  <div key={group.label} className="space-y-1">
                    <p className="pb-0.5 pl-9 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</p>
                    {group.items.map((item) => renderNavItem(item, true))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {renderSectionLabel("Account")}

        <div className="space-y-1">
          {renderGroupButton(
            "Account Settings",
            Settings,
            accountOpen,
            setAccountOpen,
            accountMenuActive,
          )}

          {accountOpen && (
            <div className="ml-5 space-y-1 border-l border-slate-200">
              <button
                type="button"
                onClick={() => {
                  closeMenu?.();
                  router.push("/approver/settings/change-password");
                }}
                className="w-full rounded-xl py-2.5 pl-9 pr-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Change Password
              </button>

              {role !== "clerk" && (
                <button
                  type="button"
                  onClick={() => {
                    closeMenu?.();
                    router.push("/approver/settings/signature");
                  }}
                  className="w-full rounded-xl py-2.5 pl-9 pr-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  Signature
                </button>
              )}
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
}

export default function DashboardShell({
  role,
  userName,
  title,
  subtitle,
  children,
}: DashboardShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [searchHits, setSearchHits] = useState<GlobalSearchHit[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sidebarCounts, setSidebarCounts] =
    useState<SidebarCounts>(emptySidebarCounts);

  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Top-bar search: looks through every document the person may open (not just the page that is showing).
  useEffect(() => {
    const term = searchValue.trim();
    if (term.length < 2) {
      setSearchHits([]);
      setSearchTotal(0);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    setSearchLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}&limit=8`, { signal: controller.signal });
        if (!response.ok) {
          setSearchLoading(false);
          return;
        }
        const data = (await response.json()) as { hits: GlobalSearchHit[]; total: number };
        setSearchHits(data.hits);
        setSearchTotal(data.total);
        setSearchLoading(false);
      } catch {
        // Ignored: a newer search replaced this one.
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [searchValue]);

  useEffect(() => {
    function handleSearchPointerDown(event: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", handleSearchPointerDown);
    return () => document.removeEventListener("mousedown", handleSearchPointerDown);
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setProfileMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  async function loadNotifications() {
    try {
      const response = await fetch("/api/notifications", {
        cache: "no-store",
      });

      if (!response.ok) return;

      const data = (await response.json()) as {
        notifications?: NotificationItem[];
      };

      const nextNotifications = data.notifications ?? [];

      setNotifications(nextNotifications);
      setUnreadCount(
        nextNotifications.filter((item) => !item.isRead).length,
      );
    } catch {
      // Keep the shell functional if notifications cannot be loaded.
    }
  }

  async function markNotificationsAsRead() {
    if (unreadCount === 0) return;

    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCsrfTokenFromBrowser(),
        },
        body: JSON.stringify({ action: "mark-read" }),
      });

      if (!response.ok) return;

      setNotifications((current) =>
        current.map((item) => ({ ...item, isRead: true })),
      );

      setUnreadCount(0);
    } catch {
      // Keep the shell functional if marking notifications fails.
    }
  }

  useEffect(() => {
    void loadNotifications();
  }, [pathname]);

  useEffect(() => {
    let active = true;

    const loadSidebarCounts = () => {
      void fetch("/api/sidebar-counts", { cache: "no-store" })
        .then((response) =>
          response.ok
            ? (response.json() as Promise<SidebarCounts>)
            : null,
        )
        .then((counts) => {
          if (!active || !counts) return;
          setSidebarCounts(counts);
        })
        .catch(() => undefined);
    };

    loadSidebarCounts();

    const intervalId = window.setInterval(loadSidebarCounts, 30000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [pathname, searchParams]);

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "x-csrf-token": getCsrfTokenFromBrowser(),
        },
      });

      router.replace("/login");
    } finally {
      setIsSigningOut(false);
      setProfileMenuOpen(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-slate-100 text-slate-900"
      style={{
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-80 bg-gradient-to-br from-slate-200 via-slate-100 to-cyan-100" />

      <div className="relative z-10 flex min-h-screen">
        <div className="hidden lg:block">
          <Sidebar role={role} counts={sidebarCounts} />
        </div>

        {menuOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div className="h-full shadow-2xl">
              <Sidebar
                role={role}
                counts={sidebarCounts}
                closeMenu={() => setMenuOpen(false)}
              />
            </div>

            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="flex-1 bg-slate-900/40"
            />
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur-lg sm:px-6 lg:px-8">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMenuOpen(true)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 lg:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </button>

                <div>
                  <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">
                    {title}
                  </h1>
                  <p className="text-xs text-slate-500 sm:text-sm">
                    {subtitle}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                <div ref={searchBoxRef} className="relative hidden sm:block">
                  <form
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-500"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const term = searchValue.trim();
                      if (!term) return;
                      setSearchOpen(false);
                      router.push(`/search?q=${encodeURIComponent(term)}`);
                    }}
                  >
                    <Search className="h-4 w-4" />

                    <input
                      value={searchValue}
                      onChange={(event) => {
                        setSearchValue(event.target.value);
                        setSearchOpen(true);
                      }}
                      onFocus={() => setSearchOpen(true)}
                      placeholder="Search all documents"
                      aria-label="Search all documents"
                      className="w-48 border-none bg-transparent text-sm text-slate-700 outline-none"
                    />
                  </form>

                  {searchOpen && searchValue.trim().length >= 2 ? (
                    <div className="absolute right-0 z-50 mt-2 w-96 max-w-[90vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                      {searchLoading && searchHits.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-slate-500">Searching...</p>
                      ) : searchHits.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-slate-500">No documents you can access match &quot;{searchValue.trim()}&quot;.</p>
                      ) : (
                        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                          {searchHits.map((hit) => (
                            <li key={hit.id}>
                              <Link
                                href={`/documents/${hit.id}`}
                                onClick={() => setSearchOpen(false)}
                                className="block px-4 py-2.5 hover:bg-slate-50"
                              >
                                <span className="block text-sm font-medium text-slate-900">{hit.documentNumber}</span>
                                <span className="block truncate text-xs text-slate-600">{hit.title}</span>
                                <span className="block truncate text-xs text-slate-500">
                                  {hit.typeName}{hit.subtypeName ? ` - ${hit.subtypeName}` : ""}{hit.projectLabel ? ` · ${hit.projectLabel}` : ""} · {hit.statusLabel}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                      {searchHits.length > 0 ? (
                        <Link
                          href={`/search?q=${encodeURIComponent(searchValue.trim())}`}
                          onClick={() => setSearchOpen(false)}
                          className="block border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-center text-sm font-medium text-cyan-700 hover:bg-slate-100"
                        >
                          See all {searchTotal} result{searchTotal === 1 ? "" : "s"}
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!notificationsOpen) {
                        setNotificationsOpen(true);
                        setNotificationsLoading(true);

                        await loadNotifications();

                        setNotificationsLoading(false);

                        if (unreadCount > 0) {
                          await markNotificationsAsRead();
                        }
                      } else {
                        setNotificationsOpen(false);
                      }
                    }}
                    className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600"
                  >
                    <Bell className="h-5 w-5" />

                    {unreadCount > 0 && (
                      <span className="absolute right-2 top-2 min-h-5 min-w-5 rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>

                  {notificationsOpen && (
                    <div className="absolute right-0 top-12 z-40 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                      <div className="flex items-center justify-between border-b border-slate-100 px-2 py-2">
                        <p className="text-sm font-semibold text-slate-900">
                          Notifications
                        </p>

                        <button
                          type="button"
                          onClick={() => setNotificationsOpen(false)}
                          className="text-xs font-medium text-slate-500 hover:text-slate-700"
                        >
                          Close
                        </button>
                      </div>

                      {notificationsLoading ? (
                        <div className="px-3 py-4 text-sm text-slate-500">
                          Loading notifications...
                        </div>
                      ) : notifications.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-slate-500">
                          No notifications yet.
                        </div>
                      ) : (
                        <div className="max-h-80 space-y-1 overflow-y-auto py-1">
                          {notifications.map((item) => (
                            <div
                              key={item.id}
                              className={`rounded-lg px-3 py-2 ${
                                item.isRead ? "bg-white" : "bg-slate-50"
                              }`}
                            >
                              {item.documentId ? (
                                <Link
                                  href={`/documents/${item.documentId}`}
                                  onClick={() => setNotificationsOpen(false)}
                                  className="block"
                                >
                                  <p className="text-sm font-semibold text-slate-900">
                                    {item.title}
                                  </p>
                                  <p className="mt-1 text-sm text-slate-600">
                                    {item.message}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-400">
                                    {new Intl.DateTimeFormat("en-US", {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    }).format(new Date(item.createdAt))}
                                  </p>
                                </Link>
                              ) : (
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">
                                    {item.title}
                                  </p>
                                  <p className="mt-1 text-sm text-slate-600">
                                    {item.message}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-400">
                                    {new Intl.DateTimeFormat("en-US", {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    }).format(new Date(item.createdAt))}
                                  </p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div
                  ref={profileMenuRef}
                  className="relative"
                  onMouseEnter={() => setProfileMenuOpen(true)}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setProfileMenuOpen((previous) => !previous)
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    <UserCircle2 className="h-5 w-5 text-slate-600" />

                    <span className="hidden text-sm font-medium text-slate-700 sm:inline">
                      {userName}
                    </span>
                  </button>

                  {profileMenuOpen && (
                    <div className="absolute right-0 top-12 z-40 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                      <button
                        type="button"
                        onClick={handleSignOut}
                        disabled={isSigningOut}
                        className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSigningOut ? "Signing out..." : "Sign out"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>

          <section className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </section>
        </main>
      </div>

      <button
        type="button"
        onClick={() => setMenuOpen(false)}
        className={`fixed bottom-5 right-5 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white shadow-xl transition lg:hidden ${
          menuOpen
            ? "opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        aria-label="Close mobile sidebar"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
