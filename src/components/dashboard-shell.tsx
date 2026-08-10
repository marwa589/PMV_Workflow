"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Bell,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  FilePlus2,
  FileText,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  UserCircle2,
  Users,
  X,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

type AppRole = "CLERK" | "APPROVER_1" | "APPROVER_2" | "APPROVER_3" | "ADMIN";

type DashboardShellProps = {
  role: AppRole;
  userName: string;
  title: string;
  subtitle: string;
  children: ReactNode;
};

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  documentId?: string | null;
};

const navItemsByRole: Record<AppRole, NavItem[]> = {
  CLERK: [
    { label: "New Document", href: "/new-document", icon: FilePlus2 },
    { label: "My Documents", href: "/clerk/my-documents", icon: FileText },
    { label: "MRs", href: "/clerk/my-documents?documentType=MATERIAL_REQUISITION", icon: FileText },
    { label: "Comparison Sheets", href: "/clerk/my-documents?documentType=COMPARISON", icon: FileText },
    { label: "MRs + Comparisons", href: "/procurement-packages", icon: FileText },
  ],
  APPROVER_1: [
    { label: "Dashboard", href: "/approver", icon: LayoutDashboard },
    { label: "My Documents", href: "/approver/my-documents", icon: FileText },
    { label: "MRs", href: "/approver/my-documents?documentType=MATERIAL_REQUISITION", icon: FileText },
    { label: "Comparison Sheets", href: "/approver/my-documents?documentType=COMPARISON", icon: FileText },
    { label: "MRs + Comparisons", href: "/procurement-packages", icon: FileText },
    { label: "Pending Approvals", href: "/approver/pending-approvals", icon: ClipboardCheck },
    { label: "Approved Documents", href: "/approver/approved-documents", icon: CheckCircle2 },
    { label: "Rejected Documents", href: "/approver/rejected-documents", icon: FileCheck2 },
    { label: "Archive", href: "/approver/archive", icon: Archive },
  ],
  APPROVER_2: [
    { label: "Dashboard", href: "/approver", icon: LayoutDashboard },
    { label: "My Documents", href: "/approver/my-documents", icon: FileText },
    { label: "MRs", href: "/approver/my-documents?documentType=MATERIAL_REQUISITION", icon: FileText },
    { label: "Comparison Sheets", href: "/approver/my-documents?documentType=COMPARISON", icon: FileText },
    { label: "MRs + Comparisons", href: "/procurement-packages", icon: FileText },
    { label: "Pending Approvals", href: "/approver/pending-approvals", icon: ClipboardCheck },
    { label: "Approved Documents", href: "/approver/approved-documents", icon: CheckCircle2 },
    { label: "Rejected Documents", href: "/approver/rejected-documents", icon: FileCheck2 },
    { label: "Archive", href: "/approver/archive", icon: Archive },
  ],
  APPROVER_3: [
    { label: "Dashboard", href: "/approver", icon: LayoutDashboard },
    { label: "My Documents", href: "/approver/my-documents", icon: FileText },
    { label: "MRs", href: "/approver/my-documents?documentType=MATERIAL_REQUISITION", icon: FileText },
    { label: "Comparison Sheets", href: "/approver/my-documents?documentType=COMPARISON", icon: FileText },
    { label: "MRs + Comparisons", href: "/procurement-packages", icon: FileText },
    { label: "Pending Approvals", href: "/approver/pending-approvals", icon: ClipboardCheck },
    { label: "Approved Documents", href: "/approver/approved-documents", icon: CheckCircle2 },
    { label: "Rejected Documents", href: "/approver/rejected-documents", icon: FileCheck2 },
    { label: "Archive", href: "/approver/archive", icon: Archive },
  ],
  ADMIN: [
    { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
    { label: "New Document", href: "/new-document", icon: FilePlus2 },
    { label: "All Documents", href: "/admin/all-documents", icon: FileText },
    { label: "MRs", href: "/admin/all-documents?documentType=MATERIAL_REQUISITION", icon: FileText },
    { label: "Comparison Sheets", href: "/admin/all-documents?documentType=COMPARISON", icon: FileText },
    { label: "MRs + Comparisons", href: "/procurement-packages", icon: FileText },
    { label: "Pending Approvals", href: "/admin/pending-approvals", icon: ClipboardCheck },
    { label: "Approved Documents", href: "/admin/approved-documents", icon: CheckCircle2 },
    { label: "Rejected Documents", href: "/admin/rejected-documents", icon: FileCheck2 },
    { label: "Archive", href: "/admin/archive", icon: Archive },
    { label: "Users", href: "/admin/users", icon: Users },
    { label: "Settings", href: "/admin/settings", icon: Settings },
  ],
};

function Sidebar({
  role,
  closeMenu,
}: {
  role: AppRole;
  closeMenu?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navItems = navItemsByRole[role];

  return (
    <aside className="flex h-full w-72 flex-col border-r border-slate-200 bg-white/90 backdrop-blur-sm">
      <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
          <FileCheck2 className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">DocuFlow 365</p>
          <p className="text-xs text-slate-500">Enterprise Workspace</p>
        </div>
      </div>

      <nav className="flex-1 space-y-2 px-3 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const itemUrl = new URL(item.href, "http://localhost");
          const itemDocumentType = itemUrl.searchParams.get("documentType");
          const currentDocumentType = searchParams.get("documentType") ?? "";
          const active =
            item.href !== "#" &&
            pathname === itemUrl.pathname &&
            (itemDocumentType ? currentDocumentType === itemDocumentType : !currentDocumentType);

          return (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                closeMenu?.();
                if (item.href !== "#") {
                  router.push(item.href);
                }
              }}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                active ? "bg-slate-900 text-white shadow-sm" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4" />
                {item.label}
              </span>
              <ChevronRight className={`h-4 w-4 ${active ? "text-white/70" : "text-slate-400"}`} />
            </button>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 px-4 py-4">
        <div className="rounded-xl bg-slate-100 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Workflow Chain</p>
          <p className="mt-1 text-sm text-slate-800">
            Clerk {"->"} Approver 1 {"->"} Approver 2 {"->"} Approver 3 {"->"} Approved
          </p>
        </div>
      </div>
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
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    setSearchValue(searchParams?.get("search") ?? "");
  }, [searchParams]);

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
        headers: { "Content-Type": "application/json" },
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

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
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
          <Sidebar role={role} />
        </div>

        {menuOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="flex-1 bg-slate-900/40"
            />
            <div className="h-full shadow-2xl">
              <Sidebar role={role} closeMenu={() => setMenuOpen(false)} />
            </div>
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

                    if (nextSearch) {
                      params.set("search", nextSearch);
                    } else {
                      params.delete("search");
                    }

                    const queryString = params.toString();
                    const targetUrl = queryString ? `${pathname}?${queryString}` : pathname;
                    router.push(targetUrl, { scroll: false });
                    router.refresh();
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
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setProfileMenuOpen((prev) => !prev)}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    <UserCircle2 className="h-5 w-5 text-slate-600" />
                    <span className="hidden text-sm font-medium text-slate-700 sm:inline">{userName}</span>
                  </button>

                  {profileMenuOpen && (
                    <div className="absolute right-0 top-12 z-40 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                      <button
                        type="button"
                        onClick={handleSignOut}
                        disabled={isSigningOut}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
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
