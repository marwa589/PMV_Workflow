// src/app/api/documents/tracks/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { userHasPermissionForDocument } from "@/lib/auth/access";
import { UNIQUE_TRACK_PERMISSION } from "@/lib/workflow/tracks";
import { prisma } from "@/lib/prisma";
import { resolveFlow } from "@/lib/workflow/resolve-flow";

export const runtime = "nodejs";

/**
 * The unique tracks an uploader may choose from for a document type / sub type / project:
 * the tracks set on the uploader level (level 0) of the approval flow that would apply. People without the
 * "Use unique tracks" permission for that type / sub type / project get none (Admin users always may).
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const documentTypeId = searchParams.get("documentTypeId")?.trim() || "";
  const documentSubtypeId = searchParams.get("documentSubtypeId")?.trim() || null;
  const projectId = searchParams.get("projectId")?.trim() || null;
  if (!documentTypeId) return NextResponse.json({ tracks: [] });

  const mayUseTracks = await userHasPermissionForDocument(session, UNIQUE_TRACK_PERMISSION, { projectId, documentTypeId, documentSubtypeId });
  if (!mayUseTracks) return NextResponse.json({ tracks: [] });

  const flow = await resolveFlow(prisma, { documentTypeId, documentSubtypeId, projectId });
  if (flow.kind !== "flow") return NextResponse.json({ tracks: [] });

  const uploaderLevel = flow.template.steps.find((step) => step.stepNumber === 0);
  const receivers = await prisma.user.findMany({
    where: { id: { in: (uploaderLevel?.tracks ?? []).map((track) => track.receiverUserId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(receivers.map((user) => [user.id, user.name]));

  return NextResponse.json({
    tracks: (uploaderLevel?.tracks ?? []).map((track) => ({
      sortOrder: track.sortOrder,
      name: track.name,
      receiverName: nameById.get(track.receiverUserId) ?? null,
    })),
  });
}
