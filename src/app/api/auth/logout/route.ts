import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ message: "Logged out." });
  clearSessionCookie(response);
  return response;
}
