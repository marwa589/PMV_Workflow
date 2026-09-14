import "server-only";

import { ErrAccessRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireErrAccess } from "@/lib/err/permissions";
import { isErrUploaderAccount } from "@/lib/err/uploader-access";

export async function getErrProjectDirectors() {
  const access = await requireErrAccess();

  if (!access.isUploader && !isErrUploaderAccount(access.name, access.role) && !access.isAdmin) {
    throw new Error(
      "You do not have permission to load the ERR upload options.",
    );
  }

  const projectScope =
    !access.isAdmin && !access.isGlobalUploader && access.uploaderProjectIds.length > 0
      ? { id: { in: access.uploaderProjectIds } }
      : {};

  const projects = await prisma.errProject.findMany({
    where: {
      isActive: true,
      ...projectScope,
      OR: [
        {
          userAccess: {
            some: {
              role: ErrAccessRole.PROJECT_DIRECTOR,
              isActive: true,
            },
          },
        },
        {
          director: {
            is: {
              errAccess: {
                some: {
                  role: ErrAccessRole.PROJECT_DIRECTOR,
                  isActive: true,
                },
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      country: true,
      director: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      userAccess: {
        where: {
          role: ErrAccessRole.PROJECT_DIRECTOR,
          isActive: true,
        },
        select: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: [
      { name: "asc" },
    ],
  });

  const result: Array<{
    projectId: string;
    directorId: string;
    name: string;
    email: string;
    projectName: string;
    country: string;
  }> = [];

  for (const project of projects) {
    const directorsMap = new Map<string, { id: string; name: string; email: string }>();
    if (project.director) {
      directorsMap.set(project.director.id, project.director);
    }
    const accessEntries = (project as { userAccess?: Array<{ user?: { id: string; name: string; email: string } | null }> }).userAccess || [];
    for (const accessEntry of accessEntries) {
      if (accessEntry.user) {
        directorsMap.set(accessEntry.user.id, accessEntry.user);
      }
    }

    for (const director of directorsMap.values()) {
      result.push({
        projectId: project.id,
        directorId: director.id,
        name: director.name,
        email: director.email,
        projectName: project.name,
        country: project.country,
      });
    }
  }

  return result;
}