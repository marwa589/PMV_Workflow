import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { ErrAccessRole, ErrProjectCountry, UserLocation, UserRole } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { validateCsrf } from "@/lib/csrf";

export const runtime = "nodejs";

const roles = Object.values(UserRole);
const errRoles = Object.values(ErrAccessRole);
const userLocations = Object.values(UserLocation);
const countries = Object.values(ErrProjectCountry);

function isValidRole(value: unknown): value is UserRole {
  return typeof value === "string" && roles.includes(value as UserRole);
}

function isValidLocation(value: unknown): value is UserLocation {
  return typeof value === "string" && userLocations.includes(value as UserLocation);
}

function isValidCountry(value: unknown): value is ErrProjectCountry {
  return typeof value === "string" && countries.includes(value as ErrProjectCountry);
}

type ErrAccessGrant = {
  role: ErrAccessRole;
  projectId: string | null;
  newProjectName?: string | null;
  country?: ErrProjectCountry | null;
};

async function parseAndValidateErrAccess(
  body: Record<string, unknown> | null,
): Promise<{ grants: ErrAccessGrant[]; error?: string }> {
  const rawList: Array<{ role: unknown; projectId?: unknown; newProjectName?: unknown; country?: unknown }> = [];

  if (Array.isArray(body?.errAccess)) {
    for (const item of body.errAccess) {
      if (item && typeof item === "object") {
        rawList.push(item as { role: unknown; projectId?: unknown; newProjectName?: unknown; country?: unknown });
      }
    }
  } else if (Array.isArray(body?.errAccessRoles)) {
    for (const r of body.errAccessRoles) {
      rawList.push({ role: r, projectId: null });
    }
  }

  const grants: ErrAccessGrant[] = [];
  const seen = new Set<string>();

  for (const item of rawList) {
    if (typeof item.role !== "string" || !errRoles.includes(item.role as ErrAccessRole)) {
      return { grants: [], error: `Invalid ERR role: ${String(item.role)}` };
    }
    const role = item.role as ErrAccessRole;
    let projectId: string | null = null;
    let newProjectName: string | null = null;
    let country: ErrProjectCountry | null = null;

    // Validate country
    if (typeof item.country === "string" && item.country.trim()) {
      if (!isValidCountry(item.country.trim())) {
        return { grants: [], error: `Invalid country: ${item.country}. Must be KSA or KUWAIT.` };
      }
      country = item.country.trim() as ErrProjectCountry;
    }

    if (typeof item.newProjectName === "string" && item.newProjectName.trim()) {
      newProjectName = item.newProjectName.trim();
      if (newProjectName.length > 100) {
        return { grants: [], error: "New project name must be 100 characters or fewer." };
      }
      // Country is required when creating a new project
      if (!country) {
        return { grants: [], error: "Country is required when creating a new project." };
      }
    } else if (typeof item.projectId === "string" && item.projectId.trim()) {
      const trimmed = item.projectId.trim();
      if (trimmed === "__NEW__") {
        return { grants: [], error: "Please enter a name for the new project." };
      }
      projectId = trimmed;
    }

    const key = `${role}:${projectId ? `ID_${projectId}` : newProjectName ? `NAME_${newProjectName.toLowerCase()}` : "GLOBAL"}`;
    if (seen.has(key)) {
      return {
        grants: [],
        error: `Duplicate access grant: User cannot have role ${role} for ${projectId ? `project ${projectId}` : newProjectName ? `project '${newProjectName}'` : "Global"} multiple times.`,
      };
    }
    seen.add(key);

    if (projectId) {
      const project = await prisma.errProject.findUnique({
        where: { id: projectId },
        select: { id: true, name: true, country: true, isActive: true },
      });
      if (!project || !project.isActive) {
        return {
          grants: [],
          error: "Selected project does not exist or is inactive.",
        };
      }
      // Use the country from the existing project
      country = project.country;
    }

    grants.push({ role, projectId, newProjectName, country });
  }

  return { grants };
}

function serializeUser(user: {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  location?: UserLocation | null;
  projectName?: string | null;
  createdAt: Date;
  errAccess: Array<{
    id?: string;
    role: ErrAccessRole;
    projectId?: string | null;
    project?: { id: string; name: string; country?: ErrProjectCountry } | null;
  }>;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    location: user.location ?? UserLocation.KUWAIT,
    projectName: user.projectName ?? null,
    errAccessRoles: [...new Set(user.errAccess.map((entry) => entry.role))],
    errAccess: user.errAccess.map((entry) => ({
      id: entry.id,
      role: entry.role,
      projectId: entry.projectId ?? null,
      country: entry.project?.country ?? null,
      projectName: entry.project?.name ?? null,
    })),
    createdAt: user.createdAt.toISOString(),
  };
}

async function requireAdmin(request: Request) {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };
  if (session.role !== UserRole.ADMIN) {
    return { response: NextResponse.json({ message: "Only admins can manage users." }, { status: 403 }) };
  }
  if (!validateCsrf(request)) {
    return { response: NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 }) };
  }
  return { session };
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (session.role !== UserRole.ADMIN) return NextResponse.json({ message: "Forbidden" }, { status: 403 });

  const [users, projects] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        location: true,
        projectName: true,
        createdAt: true,
        errAccess: {
          where: { isActive: true },
          select: {
            id: true,
            role: true,
            projectId: true,
            project: { select: { id: true, name: true, country: true } },
          },
        },
      },
      orderBy: [{ name: "asc" }, { createdAt: "desc" }],
    }),
    prisma.errProject.findMany({
      where: { isActive: true },
      select: { id: true, name: true, country: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({ users: users.map(serializeUser), projects });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role;
  const location = body?.location;
  const projectName = typeof body?.projectName === "string" ? body.projectName.trim() : "";

  if (!name || !email || !password || !isValidRole(role) || !isValidLocation(location)) {
    return NextResponse.json({ message: "Name, email, password, location, and a valid role are required." }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ message: "Enter a valid email address." }, { status: 400 });
  if (password.length < 12 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
    return NextResponse.json({ message: "Password must be at least 12 characters and include a letter, number, and special character." }, { status: 400 });
  }

  let errAccessGrants: ErrAccessGrant[] = [];
  if (role === UserRole.ERR_USER) {
    const validated = await parseAndValidateErrAccess(body);
    if (validated.error) {
      return NextResponse.json({ message: validated.error }, { status: 400 });
    }
    errAccessGrants = validated.grants;
  }

  try {
    const { user, projects } = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name,
          email,
          role,
          location: location as UserLocation,
          projectName: projectName || null,
          passwordHash: await hash(password, 12),
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          location: true,
          projectName: true,
          createdAt: true,
        },
      });

      if (errAccessGrants.length > 0) {
        for (const grant of errAccessGrants) {
          let targetProjectId = grant.projectId;
          if (grant.newProjectName) {
            let project = await tx.errProject.findFirst({
              where: {
                name: { equals: grant.newProjectName, mode: "insensitive" },
              },
            });
            if (!project) {
              project = await tx.errProject.create({
                data: {
                  name: grant.newProjectName,
                  country: grant.country as ErrProjectCountry,
                  isActive: true,
                  directorId: grant.role === ErrAccessRole.PROJECT_DIRECTOR ? created.id : null,
                },
              });
            }
            targetProjectId = project.id;
          }

          await tx.errUserAccess.create({
            data: {
              userId: created.id,
              role: grant.role,
              projectId: targetProjectId,
              isActive: true,
            },
          });
        }
      }

      const freshAccess = await tx.errUserAccess.findMany({
        where: { userId: created.id, isActive: true },
        select: {
          id: true,
          role: true,
          projectId: true,
          project: { select: { id: true, name: true, country: true } },
        },
      });

      const allActiveProjects = await tx.errProject.findMany({
        where: { isActive: true },
        select: { id: true, name: true, country: true },
        orderBy: { name: "asc" },
      });

      return {
        user: { ...created, errAccess: freshAccess },
        projects: allActiveProjects,
      };
    });

    return NextResponse.json({ user: serializeUser(user), projects }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "P2002") {
        return NextResponse.json({ message: "Duplicate record: Email or user project access already exists." }, { status: 409 });
      }
      if (error.code === "P2003") {
        return NextResponse.json({ message: "Selected project does not exist or is inactive." }, { status: 400 });
      }
    }
    return NextResponse.json({ message: "Unable to create the user." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role;
  const location = body?.location;
  const projectName = typeof body?.projectName === "string" ? body.projectName.trim() : "";

  if (!id || !name || !email || !isValidRole(role) || !isValidLocation(location)) {
    return NextResponse.json({ message: "User id, name, email, location, and a valid role are required." }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ message: "Enter a valid email address." }, { status: 400 });
  if (password && (password.length < 12 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9\s]/.test(password))) {
    return NextResponse.json({ message: "Password must be at least 12 characters and include a letter, number, and special character." }, { status: 400 });
  }

  let errAccessGrants: ErrAccessGrant[] = [];
  if (role === UserRole.ERR_USER) {
    const validated = await parseAndValidateErrAccess(body);
    if (validated.error) {
      return NextResponse.json({ message: validated.error }, { status: 400 });
    }
    errAccessGrants = validated.grants;
  }

  try {
    const { user, projects } = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          name,
          email,
          role,
          location: location as UserLocation,
          projectName: projectName || null,
          ...(password
            ? {
                passwordHash: await hash(password, 12),
                sessionVersion: { increment: 1 },
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          location: true,
          projectName: true,
          createdAt: true,
        },
      });

      await tx.errUserAccess.deleteMany({ where: { userId: id } });

      if (errAccessGrants.length > 0) {
        for (const grant of errAccessGrants) {
          let targetProjectId = grant.projectId;
          if (grant.newProjectName) {
            let project = await tx.errProject.findFirst({
              where: {
                name: { equals: grant.newProjectName, mode: "insensitive" },
              },
            });
            if (!project) {
              project = await tx.errProject.create({
                data: {
                  name: grant.newProjectName,
                  country: grant.country as ErrProjectCountry,
                  isActive: true,
                  directorId: grant.role === ErrAccessRole.PROJECT_DIRECTOR ? id : null,
                },
              });
            }
            targetProjectId = project.id;
          }

          await tx.errUserAccess.create({
            data: {
              userId: id,
              role: grant.role,
              projectId: targetProjectId,
              isActive: true,
            },
          });
        }
      }

      const freshAccess = await tx.errUserAccess.findMany({
        where: { userId: id, isActive: true },
        select: {
          id: true,
          role: true,
          projectId: true,
          project: { select: { id: true, name: true, country: true } },
        },
      });

      const allActiveProjects = await tx.errProject.findMany({
        where: { isActive: true },
        select: { id: true, name: true, country: true },
        orderBy: { name: "asc" },
      });

      return {
        user: { ...updated, errAccess: freshAccess },
        projects: allActiveProjects,
      };
    });

    return NextResponse.json({ user: serializeUser(user), projects });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "P2002") {
        return NextResponse.json({ message: "Duplicate record: Email or user project access already exists." }, { status: 409 });
      }
      if (error.code === "P2003") {
        return NextResponse.json({ message: "Selected project does not exist or is inactive." }, { status: 400 });
      }
    }
    return NextResponse.json({ message: "Unable to update the user." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ message: "User id is required." }, { status: 400 });
  if (id === auth.session?.userId) return NextResponse.json({ message: "You cannot delete your own admin account." }, { status: 400 });

  try {
    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ message: "User deleted." });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2003") {
      return NextResponse.json({ message: "This user has related workflow records and cannot be deleted." }, { status: 409 });
    }
    return NextResponse.json({ message: "Unable to delete the user." }, { status: 500 });
  }
}
