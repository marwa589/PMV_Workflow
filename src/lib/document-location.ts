import type { Prisma, UserLocation } from "@prisma/client";

/**
 * A document's location is the one stored on the document when it was uploaded (uploaderLocation),
 * falling back to the uploader's account location for documents that never stored one.
 * This matters for Erro (dispatcher.pmv, an AVR account), who can also upload AVK MRs and comparisons:
 * those documents are stored with uploaderLocation = AVK and must count as AVK everywhere.
 */
export function effectiveDocumentLocation(document: {
  uploaderLocation?: string | null;
  createdBy?: { location?: string | null } | null;
}): string | null {
  return document.uploaderLocation ?? document.createdBy?.location ?? null;
}

/** Prisma filter: documents whose effective location (see above) is `location`. */
export function documentLocationWhere(location: UserLocation): Prisma.DocumentWhereInput {
  return {
    OR: [
      { uploaderLocation: location },
      { AND: [{ uploaderLocation: null }, { createdBy: { location } }] },
    ],
  };
}
