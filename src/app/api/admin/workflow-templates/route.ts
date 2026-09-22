import { NextResponse } from "next/server";
import { DocumentType, UserLocation, UserRole } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { validateCsrf } from "@/lib/csrf";

export const runtime = "nodejs";

const validDocumentTypes = Object.values(DocumentType);
const validLocations = Object.values(UserLocation);
const validRoles = Object.values(UserRole);

function isValidDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && validDocumentTypes.includes(value as DocumentType);
}

function isValidLocation(value: unknown): value is UserLocation {
  return typeof value === "string" && validLocations.includes(value as UserLocation);
}

function isValidRole(value: unknown): value is UserRole {
  return typeof value === "string" && validRoles.includes(value as UserRole);
}

async function requireAdmin(request: Request) {
  const session = await getSession();
  if (!session) {
    return { response: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };
  }
  if (session.role !== UserRole.ADMIN) {
    return { response: NextResponse.json({ message: "Only admins can manage workflow templates." }, { status: 403 }) };
  }
  if (!validateCsrf(request)) {
    return { response: NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== UserRole.ADMIN) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const [templates, approvers] = await Promise.all([
    prisma.documentWorkflowTemplate.findMany({
      orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
      include: {
        steps: {
          orderBy: { stepNumber: "asc" },
          include: {
            approver: { select: { id: true, name: true, email: true, role: true } },
          },
        },
      },
    }),
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        roleAssignments: { select: { role: true } },
      },
      orderBy: [{ name: "asc" }],
    }),
  ]);

  return NextResponse.json({
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      location: template.location,
      documentType: template.documentType,
      documentSubtype: template.documentSubtype,
      projectName: template.projectName,
      isActive: template.isActive,
      createdAt: template.createdAt.toISOString(),
      steps: template.steps.map((step) => ({
        id: step.id,
        templateId: template.id,
        stepNumber: step.stepNumber,
        role: step.role,
        approverUserId: step.approverUserId,
        isRequired: step.isRequired,
        approver: step.approver
          ? {
              id: step.approver.id,
              name: step.approver.name,
              email: step.approver.email,
              role: step.approver.role,
            }
          : null,
      })),
    })),
    approvers: approvers.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roleAssignments: user.roleAssignments.map((assignment) => assignment.role),
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const location = body?.location;
  const documentType = body?.documentType;
  const documentSubtype = typeof body?.documentSubtype === "string" ? body.documentSubtype.trim() : "";
  const projectName = typeof body?.projectName === "string" ? body.projectName.trim() : "";
  const isActive = body?.isActive === undefined ? true : Boolean(body.isActive);
  const rawSteps = Array.isArray(body?.steps) ? body.steps : [];

  if (!name) return NextResponse.json({ message: "Template name is required." }, { status: 400 });
  if (!isValidDocumentType(documentType)) return NextResponse.json({ message: "Valid document type is required." }, { status: 400 });
  if (location !== undefined && location !== null && !isValidLocation(location)) {
    return NextResponse.json({ message: "Valid location is required when specified." }, { status: 400 });
  }
  if (rawSteps.length === 0) return NextResponse.json({ message: "At least one approval step is required." }, { status: 400 });

  const steps = rawSteps.map((step, index) => {
    if (!step || typeof step !== "object") {
      throw new Error(`Step ${index + 1} is invalid.`);
    }
    const stepRecord = step as Record<string, unknown>;
    const stepNumber = typeof stepRecord.stepNumber === "number" ? stepRecord.stepNumber : index + 1;
    const role = stepRecord.role;
    const approverUserId = typeof stepRecord.approverUserId === "string" ? stepRecord.approverUserId.trim() : "";

    if (!isValidRole(role)) {
      throw new Error(`Step ${index + 1} has an invalid role.`);
    }
    if (!approverUserId) {
      throw new Error(`Step ${index + 1} must select an approver.`);
    }

    return { stepNumber, role: role as UserRole, approverUserId };
  });

  const duplicates = steps.some((step, index) => steps.findIndex((other) => other.stepNumber === step.stepNumber) !== index);
  if (duplicates) return NextResponse.json({ message: "Approval step numbers must be unique." }, { status: 400 });

  try {
    const created = await prisma.$transaction(async (tx) => {
      const template = await tx.documentWorkflowTemplate.create({
        data: {
          name,
          location: location ? (location as UserLocation) : null,
          documentType: documentType as DocumentType,
          documentSubtype: documentSubtype || null,
          projectName: projectName || null,
          isActive,
        },
      });

      for (const step of steps) {
        const approver = await tx.user.findFirst({
          where: {
            id: step.approverUserId,
            OR: [{ role: step.role }, { roleAssignments: { some: { role: step.role } } }],
          },
          select: { id: true },
        });

        if (!approver) {
          throw new Error(`Selected approver for step ${step.stepNumber} does not match the required role.`);
        }

        await tx.documentWorkflowStep.create({
          data: {
            templateId: template.id,
            stepNumber: step.stepNumber,
            role: step.role,
            approverUserId: approver.id,
            isRequired: true,
          },
        });
      }

      return tx.documentWorkflowTemplate.findUnique({
        where: { id: template.id },
        include: {
          steps: {
            orderBy: { stepNumber: "asc" },
            include: { approver: { select: { id: true, name: true, email: true, role: true } } },
          },
        },
      });
    });

    const payload = created ? {
      id: created.id,
      name: created.name,
      location: created.location,
      documentType: created.documentType,
      documentSubtype: created.documentSubtype,
      projectName: created.projectName,
      isActive: created.isActive,
      steps: created.steps.map((step) => ({
        id: step.id,
        stepNumber: step.stepNumber,
        role: step.role,
        approverUserId: step.approverUserId,
        approver: step.approver
          ? {
              id: step.approver.id,
              name: step.approver.name,
              email: step.approver.email,
              role: step.approver.role,
            }
          : null,
      })),
    } : null;

    return NextResponse.json({ template: payload }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create workflow template.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ message: "Workflow template id is required." }, { status: 400 });

  await prisma.documentWorkflowTemplate.delete({ where: { id } });
  return NextResponse.json({ message: "Workflow template deleted." });
}
