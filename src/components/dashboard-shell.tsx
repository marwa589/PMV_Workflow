"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  FilePlus2,
  FileText,
  GitBranch,
  LayoutDashboard,
  Menu,
  Network,
  Search,
  Settings,
  ShieldCheck,
  UserCircle2,
  Users,
  X,
  RotateCcw,
} from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";
import type { UserTypeCode } from "@/lib/auth/roles";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  // Which sidebar counter to show next to the label.
  badge?: { kind: "pending" } | { kind: "type"; documentTypeId: string };
};

// The prop is still called `role`, but it carries the user's fixed type (clerk, eng, manager, admin).
type AppRole = UserTypeCode;

type DashboardShellProps = {
  role: AppRole;
  userName: string;
  title: string;
  subtitle: string;
  children: ReactNode;
};

type SidebarCounts = {
  pendingApprovals: number;
  pendingByType: Array<{ documentTypeId: string; code: string; name: string; count: number }>;
  canUpload: boolean;
  // One sidebar entry per active document type; nothing here is hard-coded any more.
  documentTypes: Array<{ id: string; code: string; name: string }>;
  // Which administration screens this person may open.
  manage: Partial<Record<"flows" | "types" | "processes" | "users" | "assignments" | "delegations" | "projects" | "deletionReview", boolean>>;
};

const emptySidebarCounts: SidebarCounts = {
  pendingApprovals: 0,
  pendingByType: [],
  canUpload: false,
  documentTypes: [],
  manage: {},
};
let lastSidebarCounts: { key: string; counts: SidebarCounts } | null = null;

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  documentId?: string | null;
};

const HOME_BY_USER_TYPE: Record<AppRole, { dashboard: string; list: string; settings: string }> = {
  clerk: { dashboard: "/clerk", list: "/clerk/my-documents", settings: "/clerk/settings" },
  eng: { dashboard: "/approver", list: "/approver/my-documents", settings: "/approver/settings" },
  manager: { dashboard: "/approver", list: "/approver/my-documents", settings: "/approver/settings" },
  admin: { dashboard: "/admin", list: "/admin/all-documents", settings: "/admin/settings" },
};

/**
 * The sidebar is built from data: the user's area, one entry per active document type, processes, and the
 * administration screens they are allowed to use.
 */
function getVisibleNavItems(role: AppRole, counts: SidebarCounts): NavItem[] {
  const home = HOME_BY_USER_TYPE[role];
  const isApprover = role === "eng" || role === "manager" || role === "admin";
  const manage = counts.manage;

  const items: NavItem[] = [{ label: "Dashboard", href: home.dashboard, icon: LayoutDashboard }];

  if (counts.canUpload) items.push({ label: "New Document", href: "/new-document", icon: FilePlus2 });

  items.push({ label: role === "admin" ? "All Documents" : "My Documents", href: home.list, icon: FileText });

  for (const type of counts.documentTypes) {
    items.push({
      label: type.name,
      href: `${home.list}?documentType=${encodeURIComponent(type.code)}`,
      icon: FileText,
      badge: { kind: "type", documentTypeId: type.id },
    });
  }

  items.push({ label: "Processes", href: "/processes", icon: Network });

  if (isApprover) {
    const base = role === "admin" ? "/admin" : "/approver";
    items.push({ label: "Pending Approvals", href: `${base}/pending-approvals`, icon: ClipboardCheck, badge: { kind: "pending" } });
  }

  items.push({ label: "Revision Required", href: `${home.list}?status=REVISION_REQUIRED`, icon: RotateCcw });

  if (isApprover) {
    const base = role === "admin" ? "/admin" : "/approver";
    items.push({ label: "Approved Documents", href: `${base}/approved-documents`, icon: CheckCircle2 });
    items.push({ label: "Rejected Documents", href: `${base}/rejected-documents`, icon: FileCheck2 });
  } else {
    items.push({ label: "Rejected Documents", href: `${home.list}?status=CANCELLED`, icon: FileCheck2 });
  }

  // Administration: shown by permission, so a Flow Admin who is not an Admin user type sees only their screens.
  if (manage.users) items.push({ label: "Users", href: "/admin/users", icon: Users });
  if (manage.assignments) items.push({ label: "Roles & Access", href: "/admin/roles", icon: ShieldCheck });
  if (manage.delegations) items.push({ label: "Delegations", href: "/admin/delegations", icon: Users });
  if (manage.types) items.push({ label: "Document Types", href: "/admin/document-types", icon: FileText });
  if (manage.flows) {
    items.push({ label: "Approval Flows", href: "/admin/flows", icon: GitBranch });
    items.push({ label: "Flow Assignments", href: "/admin/flow-assignments", icon: ClipboardCheck });
  }
  if (manage.processes) items.push({ label: "Process Setup", href: "/admin/processes", icon: Network });
  if (manage.projects) items.push({ label: "Projects & Locations", href: "/admin/projects", icon: Network });

  items.push({ label: "Account Settings", href: home.settings, icon: Settings });

  return items;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navItems = getVisibleNavItems(role, counts);
  const settingsItem = navItems.find((item) => item.href.endsWith("/settings"));
  const primaryNavItems = navItems.filter((item) => item !== settingsItem);

  const badgeCount = (item: NavItem): number => {
    if (!item.badge) return 0;
    if (item.badge.kind === "pending") return counts.pendingApprovals;
    const typeId = item.badge.documentTypeId;
    return counts.pendingByType.find((row) => row.documentTypeId === typeId)?.count ?? 0;
  };

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const itemUrl = new URL(item.href, "http://localhost");
    const itemDocumentType = itemUrl.searchParams.get("documentType");
    const itemStatus = itemUrl.searchParams.get("status");
    const currentDocumentType = searchParams.get("documentType") ?? "";
    const currentStatus = searchParams.get("status") ?? "";

    const active =
      pathname === itemUrl.pathname &&
      (itemDocumentType
        ? currentDocumentType === itemDocumentType
        : itemStatus
          ? currentStatus === itemStatus
          : !currentDocumentType && !currentStatus);

    const count = badgeCount(item);

    return (
      <button
        key={item.label}
        type="button"
        onClick={() => {
          closeMenu?.();
          router.push(item.href);
        }}
        className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
          active ? "bg-slate-900 text-white shadow-sm" : "text-slate-700 hover:bg-slate-100"
        }`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Icon className="h-4 w-4" />
          <span className="truncate">{item.label}</span>
        </span>
        <span className="flex items-center gap-2">
          {count > 0 ? (
            <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"}`}>
              {count}
            </span>
          ) : null}
          <ChevronRight className={`h-4 w-4 ${active ? "text-white/70" : "text-slate-400"}`} />
        </span>
      </button>
    );
  };

  return (
    <aside className="sticky top-0 flex h-screen w-72 flex-col border-r border-slate-200 bg-white/90 backdrop-blur-sm">
      <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
          <FileCheck2 className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">DocuFlow 365</p>
          <p className="text-xs text-slate-500">Enterprise Workspace</p>
        </div>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {primaryNavItems.map((item) => renderNavItem(item))}
        {settingsItem && (
          <div
            className="relative"
            onMouseEnter={() => setSettingsOpen(true)}
            onMouseLeave={() => setSettingsOpen(false)}
          >
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                settingsOpen ? "bg-slate-900 text-white shadow-sm" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span className="flex items-center gap-3">
                <Settings className="h-4 w-4" />
                Account Settings
              </span>
              <ChevronRight className={`h-4 w-4 ${settingsOpen ? "text-white/70" : "text-slate-400"}`} />
            </button>

            {settingsOpen ? (
              <div className="mt-1 space-y-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                <Link
                  href="/approver/settings/change-password"
                  onClick={() => {
                    closeMenu?.();
                    setSettingsOpen(false);
                  }}
                  className="block rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  Change Password
                </Link>
                {role !== "clerk" ? (
                  <Link
                    href="/approver/settings/signature"
                    onClick={() => {
                      closeMenu?.();
                      setSettingsOpen(false);
                    }}
                    className="block rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                  >
                    Signature
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const sidebarCountsKey = `${role}:${userName.trim().toLowerCase()}`;
  const [sidebarCounts, setSidebarCounts] = useState<SidebarCounts>(
    lastSidebarCounts?.key === sidebarCountsKey ? lastSidebarCounts.counts : emptySidebarCounts,
  );
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    setSearchValue(searchParams?.get("search") ?? "");
  }, [searchParams]);

  useEffect(() => {
    const currentSearch = searchParams?.get("search") ?? "";
    const nextSearch = searchValue.trim();
    if (nextSearch === currentSearch.trim()) return;

    const timeoutId = window.setTimeout(() => {
      const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
      if (nextSearch) {
        params.set("search", nextSearch);
      } else {
        params.delete("search");
      }
      params.delete("page");

      const queryString = params.toString();
      const targetUrl = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(targetUrl, { scroll: false });
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [pathname, router, searchParams, searchValue]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  async function loadNotifications() {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { notifications?: NotificationItem[] };
      const nextNotifications = data.notifications ?? [];
      setNotifications(nextNotifications);
      setUnreadCount(nextNotifications.filter((item) => !item.isRead).length);
    } catch {
      // Ignore notification fetch errors and keep the shell functional.
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

      setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
    } catch {
      // Ignore notification mark-as-read errors.
    }
  }

  useEffect(() => {
    void loadNotifications();
  }, [pathname]);

  useEffect(() => {
    let active = true;

    const loadSidebarCounts = () => {
      void fetch("/api/sidebar-counts", { cache: "no-store" })
        .then((response) => response.ok ? response.json() as Promise<SidebarCounts> : null)
        .then((counts) => {
          if (!active || !counts) return;
          lastSidebarCounts = { key: sidebarCountsKey, counts };
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
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
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
      style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-80 bg-gradient-to-br from-slate-200 via-slate-100 to-cyan-100" />
      <div className="relative z-10 flex min-h-screen">
        <div className="hidden lg:block">
              <Sidebar role={role} counts={sidebarCounts} />
        </div>

        {menuOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div className="h-full shadow-2xl">
              <Sidebar role={role} counts={sidebarCounts} closeMenu={() => setMenuOpen(false)} />
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
                  <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">{title}</h1>
                  <p className="text-xs text-slate-500 sm:text-sm">{subtitle}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                <form
                  className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-500 sm:flex"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
                    const nextSearch = searchValue.trim();
                    if (nextSearch) params.set("search", nextSearch);
                    else params.delete("search");
                    params.delete("page");
                    const queryString = params.toString();
                    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
                  }}
                >
                  <Search className="h-4 w-4" />
                  <input
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="Search documents"
                    className="w-40 border-none bg-transparent text-sm text-slate-700 outline-none"
                  />
                </form>
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
                    {unreadCount > 0 ? (
                      <span className="absolute right-2 top-2 min-h-5 min-w-5 rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    ) : null}
                  </button>

                  {notificationsOpen ? (
                    <div className="absolute right-0 top-12 z-40 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                      <div className="flex items-center justify-between border-b border-slate-100 px-2 py-2">
                        <p className="text-sm font-semibold text-slate-900">Notifications</p>
                        <button type="button" onClick={() => setNotificationsOpen(false)} className="text-xs font-medium text-slate-500 hover:text-slate-700">
                          Close
                        </button>
                      </div>

                      {notificationsLoading ? (
                        <div className="px-3 py-4 text-sm text-slate-500">Loading notifications...</div>
                      ) : notifications.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-slate-500">No notifications yet.</div>
                      ) : (
                        <div className="max-h-80 space-y-1 overflow-y-auto py-1">
                          {notifications.map((item) => (
                            <div key={item.id} className={`rounded-lg px-3 py-2 ${item.isRead ? "bg-white" : "bg-slate-50"}`}>
                              {item.documentId ? (
                                <Link href={`/documents/${item.documentId}`} onClick={() => setNotificationsOpen(false)} className="block">
                                  <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                                  <p className="mt-1 text-sm text-slate-600">{item.message}</p>
                                  <p className="mt-1 text-xs text-slate-400">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</p>
                                </Link>
                              ) : (
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                                  <p className="mt-1 text-sm text-slate-600">{item.message}</p>
                                  <p className="mt-1 text-xs text-slate-400">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
                <div
                  ref={profileMenuRef}
                  className="relative"
                  onMouseEnter={() => setProfileMenuOpen(true)}
                >
                  <button
                    type="button"
                    onClick={() => setProfileMenuOpen((prev) => !prev)}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    <UserCircle2 className="h-5 w-5 text-slate-600" />
                    <span className="hidden text-sm font-medium text-slate-700 sm:inline">{userName}</span>
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

          <section className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">{children}</section>
        </main>
      </div>

      <button
        type="button"
        onClick={() => setMenuOpen(false)}
        className={`fixed bottom-5 right-5 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white shadow-xl transition lg:hidden ${
          menuOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-label="Close mobile sidebar"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
