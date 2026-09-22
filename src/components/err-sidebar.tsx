"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ChevronRight,
  FileText,
} from "lucide-react";

type SidebarData = {
  counts: {
    all: number;
    pending: number;
    onHold: number;
    approved: number;
    rejected: number;
    revisionRequired: number;
  };
  canUpload: boolean;
  personal: boolean;
};

type Props = {
  closeMenu?: () => void;
  combinedLayout?: boolean;
};

export default function ErrSidebar({ closeMenu, combinedLayout = false }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  const [data, setData] = useState<SidebarData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setFailed(false);
      setData(null);

      try {
        const response = await fetch("/api/errs/sidebar", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 403) {
          throw new Error("ERR navigation is unavailable. Please sign in again.");
        }

        if (!response.ok) {
          throw new Error("Unable to load ERR navigation.");
        }

        const result = (await response.json()) as SidebarData;

        if (!controller.signal.aborted) {
          setData(result);
        }
      } catch {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [pathname, query, attempt]);

  if (failed) {
    return (
      <button
        type="button"
        onClick={() => setAttempt((value) => value + 1)}
        className="px-3 py-2 text-sm text-slate-600 hover:underline"
      >
        Retry loading ERR menu
      </button>
    );
  }

  if (!data) {
    return null;
  }

  const active = pathname === "/errs" && !searchParams.get("view");

  return (
    <Link
      href="/errs"
      onClick={closeMenu}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      <span className="flex items-center gap-3">
        <FileText className="h-4 w-4 shrink-0" />
        ERRs
      </span>
    </Link>
  );
}