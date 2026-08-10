import { redirect } from "next/navigation";
import { getDefaultRouteForRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";

export default async function RootPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  redirect(getDefaultRouteForRole(session.role));
}
