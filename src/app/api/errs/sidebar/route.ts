import { NextResponse } from "next/server";
import { getErrAccess } from "@/lib/err/permissions";
import { getErrCounts } from "@/lib/err/queries";
import { isErrUploaderAccount } from "@/lib/err/uploader-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getErrAccess();

  if (!access) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!access.canAccessErrModule) {
    return NextResponse.json(
      { message: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const counts = await getErrCounts(access);

  return NextResponse.json(
    {
      counts,
      canUpload: access.isUploader || isErrUploaderAccount(access.name, access.role) || access.isAdmin,
      personal:
        !access.isAdmin && !access.isUploader && !access.isViewer,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}