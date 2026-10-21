import { DocumentStatus, DocumentType, UserLocation, UserRole, type Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canAccessMrModule } from "@/lib/auth/resource-access";
import { getModuleVisibility } from "@/lib/auth/module-visibility";
import { getErrAccess } from "@/lib/err/permissions";
import { getErrCounts } from "@/lib/err/queries";
import { canViewPurchaseOrdersSidebar } from "@/lib/po-access";
import { canViewReadyMixKhobarMrs } from "@/lib/ready-mix-mr-access";
import { canViewInvoices } from "@/lib/invoice-access";
import { isKsaViewer, KSA_USER_LOCATIONS } from "@/lib/ksa-viewer";
import { READY_MIX_KHOBAR_PROJECT_NAME } from "@/lib/ready-mix-mr-access";
import { isAvkMrViewer } from "@/lib/avk-access";
import { isRamziDocumentApprover } from "@/lib/mohamed-document-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type MrLocationCounts = Record<UserLocation, number> & { READY_MIX_KHOBAR: number };

async function countMaterialRequisitionsByLocation(
  baseWhere: Prisma.DocumentWhereInput,
  status?: Prisma.DocumentWhereInput["status"],
): Promise<MrLocationCounts> {
  const base = {
    ...baseWhere,
    documentType: DocumentType.MATERIAL_REQUISITION,
    ...(status ? { status } : {}),
  };
  const locationWhere = (location: UserLocation): Prisma.DocumentWhereInput => ({
    OR: [
      { uploaderLocation: location },
      { AND: [{ uploaderLocation: null }, { createdBy: { location } }] },
    ],
  });
  const [kuwait, avr, avk, readyMixKhobar] = await Promise.all([
    prisma.document.count({ where: { ...base, ...locationWhere(UserLocation.KUWAIT) } }),
    prisma.document.count({ where: { ...base, ...locationWhere(UserLocation.AVR), NOT: { projectName: READY_MIX_KHOBAR_PROJECT_NAME } } }),
    prisma.document.count({ where: { ...base, ...locationWhere(UserLocation.AVK) } }),
    prisma.document.count({ where: { ...base, projectName: READY_MIX_KHOBAR_PROJECT_NAME } }),
  ]);
  return { KUWAIT: kuwait, AVR: avr, AVK: avk, READY_MIX_KHOBAR: readyMixKhobar };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ materialRequisitions: 0, materialRequisitionsByLocation: { KUWAIT: 0, AVR: 0, AVK: 0, READY_MIX_KHOBAR: 0 }, comparisons: 0, pendingApprovals: 0, errs: 0, isErrUploader: false, isAvkDataViewer: false, userLocation: null, canViewPurchaseOrders: false, canViewReadyMixMrs: false, canViewInvoices: false, canViewMrApprovals: false }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true, role: true, location: true } });
  const isAvkDataViewer = isAvkMrViewer({ email: session.email, location: user?.location, role: session.role });

  const visibility = getModuleVisibility(session.name, session.role);
  const canViewMrApprovals = session.role === UserRole.ERR_USER && isRamziDocumentApprover(session.email);
  if (isKsaViewer(session)) {
    const [materialRequisitionsByLocation, comparisons, errAccess] = await Promise.all([
      countMaterialRequisitionsByLocation({ createdBy: { location: { in: [...KSA_USER_LOCATIONS] } } }),
      prisma.document.count({ where: { documentType: "COMPARISON", createdBy: { location: { in: [...KSA_USER_LOCATIONS] } } } }),
      getErrAccess(),
    ]);
    const materialRequisitions = Object.values(materialRequisitionsByLocation).reduce((sum, count) => sum + count, 0);
    const errs = errAccess?.canAccessErrModule ? (await getErrCounts(errAccess)).all : 0;
    return NextResponse.json({
      materialRequisitions,
      materialRequisitionsByLocation,
      comparisons,
      pendingApprovals: 0,
      errs,
      isErrUploader: false,
      isAvkDataViewer,
      userLocation: user?.location ?? null,
      canViewPurchaseOrders: true,
      canViewReadyMixMrs: false,
      canViewInvoices: false,
      canViewMrApprovals: false,
    });
  }
  const canQueryDocuments = canAccessMrModule(session.role) && visibility !== "ERR_ONLY";
  const errAccess = await getErrAccess();
  const canQueryErrs = Boolean(errAccess?.canAccessErrModule);

  let materialRequisitions = 0;
  let materialRequisitionsByLocation: MrLocationCounts = { KUWAIT: 0, AVR: 0, AVK: 0, READY_MIX_KHOBAR: 0 };
  let comparisons = 0;
  let documentPendingApprovals = 0;
  let errPendingApprovals = 0;

  if (canQueryDocuments) {
  const baseWhere: Prisma.DocumentWhereInput = session.role === UserRole.ADMIN
    ? {}
    : { currentApproverId: session.userId };

  const pendingStatuses = {
    in: [
      DocumentStatus.PENDING_APPROVER_1,
      DocumentStatus.PENDING_APPROVER_2,
      DocumentStatus.PENDING_APPROVER_3,
    ],
  };

    [materialRequisitionsByLocation, comparisons, documentPendingApprovals] = await Promise.all([
      countMaterialRequisitionsByLocation(baseWhere, pendingStatuses),
      prisma.document.count({ where: { ...baseWhere, documentType: "COMPARISON", status: pendingStatuses } }),
      prisma.document.count({ where: { ...baseWhere, status: pendingStatuses } }),
    ]);
    materialRequisitions = Object.values(materialRequisitionsByLocation).reduce((sum, count) => sum + count, 0);
  }

  if (canQueryErrs) {
    if (errAccess?.canAccessErrModule) {
      errPendingApprovals = (await getErrCounts(errAccess)).pending;
    }
  }

  return NextResponse.json({
    materialRequisitions,
    materialRequisitionsByLocation,
    comparisons,
    pendingApprovals: documentPendingApprovals + errPendingApprovals,
    errs: errPendingApprovals,
    isErrUploader: Boolean(errAccess?.isUploader && errAccess.canAccessErrModule),
    isAvkDataViewer,
    userLocation: user?.location ?? null,
    canViewPurchaseOrders: canViewPurchaseOrdersSidebar(session),
    canViewReadyMixMrs: canViewReadyMixKhobarMrs(session),
    canViewInvoices: canViewInvoices(session),
    canViewMrApprovals,
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
