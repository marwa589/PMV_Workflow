import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getNotificationsForUser, getUnreadNotificationCount, markNotificationsAsRead } from "@/lib/notifications";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const notifications = await getNotificationsForUser(session.userId);
  const unreadCount = await getUnreadNotificationCount(session.userId);

  return NextResponse.json({ notifications, unreadCount });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (body?.action === "mark-read") {
    await markNotificationsAsRead(session.userId);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ message: "Bad request" }, { status: 400 });
}
