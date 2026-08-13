import { NextResponse } from "next/server";
import { clearSessionCookie, getSession, revokeUserSessions } from "@/lib/auth/session";

export async function POST() {
  const session = await getSession();

  if (session) {
    await revokeUserSessions(session.userId);
  }

  const response = NextResponse.json({ message: "Logged out." });
  clearSessionCookie(response);
  return response;
}
