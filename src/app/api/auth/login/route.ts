import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { getDefaultRouteForRole } from "@/lib/auth/roles";
import { attachSessionCookie, rotateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      return NextResponse.json(
        { message: "Email and password are required." },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json({ message: "Invalid credentials." }, { status: 401 });
    }

    const isValidPassword = await compare(password, user.passwordHash);
    if (!isValidPassword) {
      return NextResponse.json({ message: "Invalid credentials." }, { status: 401 });
    }

    const rotatedVersion = await rotateSession(user.id);
    const redirectTo = getDefaultRouteForRole(user.role);
    const response = NextResponse.json({
      message: "Login successful.",
      role: user.role,
      redirectTo,
    });

    attachSessionCookie(response, {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    }, rotatedVersion);

    return response;
  } catch {
    return NextResponse.json({ message: "Unable to login." }, { status: 500 });
  }
}
