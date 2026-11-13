import QRCode from "qrcode";
import { getEnv } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import type { AuthorizedTenantContext } from "@/server/auth";
import { withBranchDb, type DbClient } from "@/server/db";
import { generateOpaqueToken } from "@/server/security/tokens";
import { resolveEffectiveBranchSettings } from "./token-service";

export interface BranchQrPayload {
  branchId: string;
  branchName: string;
  branchSlug: string;
  branchCity: string | null;
  salonName: string;
  salonSlug: string;
  requireValidQrToken: boolean;
  qrToken: string;
  publicPath: string;
  scanUrl: string;
  svgMarkup: string;
  dataUrl: string;
}

interface ResolvedQrMetadata {
  branchId: string;
  branchName: string;
  branchSlug: string;
  branchCity: string | null;
  salonName: string;
  salonSlug: string;
  qrToken: string;
  requireValidQrToken: boolean;
  publicPath: string;
  scanUrl: string;
}

function buildPublicScanUrls(params: {
  salonSlug: string;
  branchSlug: string;
  qrToken: string;
  requireValidQrToken: boolean;
  appOrigin?: string;
}): { publicPath: string; scanUrl: string } {
  const basePath = `/salon/${params.salonSlug}/${params.branchSlug}`;
  const publicPath = params.requireValidQrToken
    ? `${basePath}?t=${encodeURIComponent(params.qrToken)}`
    : basePath;
  const origin = (params.appOrigin ?? getEnv().NEXT_PUBLIC_APP_URL).replace(/\/+$/, "");

  return {
    publicPath,
    scanUrl: `${origin}${publicPath}`,
  };
}

async function resolveBranchQrMetadata(
  ctx: AuthorizedTenantContext,
  branchId: string,
  appOrigin?: string,
  client?: DbClient,
): Promise<ResolvedQrMetadata> {
  return withBranchDb(
    ctx.organizationId,
    branchId,
    async (tx) => {
      const branch = await tx.branch.findFirst({
        where: { id: branchId, organizationId: ctx.organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          city: true,
          qrToken: true,
          organization: {
            select: { name: true, slug: true },
          },
        },
      });

      if (!branch) {
        throw new NotFoundError("Branch was not found.");
      }

      const settings = await resolveEffectiveBranchSettings(
        tx,
        ctx.organizationId,
        branchId,
      );

      const { publicPath, scanUrl } = buildPublicScanUrls({
        salonSlug: branch.organization.slug,
        branchSlug: branch.slug,
        qrToken: branch.qrToken,
        requireValidQrToken: settings.requireValidQrToken,
        appOrigin,
      });

      return {
        branchId: branch.id,
        branchName: branch.name,
        branchSlug: branch.slug,
        branchCity: branch.city,
        salonName: branch.organization.name,
        salonSlug: branch.organization.slug,
        qrToken: branch.qrToken,
        requireValidQrToken: settings.requireValidQrToken,
        publicPath,
        scanUrl,
      };
    },
    client,
  );
}

async function buildQrFormats(meta: ResolvedQrMetadata): Promise<BranchQrPayload> {
  const [svgMarkup, dataUrl] = await Promise.all([
    QRCode.toString(meta.scanUrl, {
      type: "svg",
      width: 320,
      margin: 2,
      color: { dark: "#18181b", light: "#ffffff" },
    }),
    QRCode.toDataURL(meta.scanUrl, {
      width: 512,
      margin: 2,
      color: { dark: "#18181b", light: "#ffffff" },
    }),
  ]);

  return {
    ...meta,
    svgMarkup,
    dataUrl,
  };
}

export async function getBranchQrPayload(
  ctx: AuthorizedTenantContext,
  branchId: string,
  options: { appOrigin?: string; client?: DbClient } = {},
): Promise<BranchQrPayload> {
  const meta = await resolveBranchQrMetadata(
    ctx,
    branchId,
    options.appOrigin,
    options.client,
  );
  return buildQrFormats(meta);
}

export async function getBranchQrPngBuffer(
  ctx: AuthorizedTenantContext,
  branchId: string,
  options: { appOrigin?: string; client?: DbClient } = {},
): Promise<{ filename: string; buffer: Buffer }> {
  const meta = await resolveBranchQrMetadata(
    ctx,
    branchId,
    options.appOrigin,
    options.client,
  );
  const buffer = await QRCode.toBuffer(meta.scanUrl, {
    type: "png",
    width: 640,
    margin: 2,
    color: { dark: "#18181b", light: "#ffffff" },
  });

  return {
    filename: `salonflow-qr-${meta.salonSlug}-${meta.branchSlug}.png`,
    buffer,
  };
}

export async function getBranchQrSvgMarkup(
  ctx: AuthorizedTenantContext,
  branchId: string,
  options: { appOrigin?: string; client?: DbClient } = {},
): Promise<{ filename: string; svg: string }> {
  const meta = await resolveBranchQrMetadata(
    ctx,
    branchId,
    options.appOrigin,
    options.client,
  );
  const svg = await QRCode.toString(meta.scanUrl, {
    type: "svg",
    width: 512,
    margin: 2,
    color: { dark: "#18181b", light: "#ffffff" },
  });

  return {
    filename: `salonflow-qr-${meta.salonSlug}-${meta.branchSlug}.svg`,
    svg,
  };
}

export async function regenerateBranchQrToken(
  ctx: AuthorizedTenantContext,
  branchId: string,
  meta: {
    appOrigin?: string;
    ipAddressHash?: string;
    userAgent?: string;
    client?: DbClient;
  } = {},
): Promise<BranchQrPayload> {
  const updatedMeta = await withBranchDb(
    ctx.organizationId,
    branchId,
    async (tx) => {
      const existing = await tx.branch.findFirst({
        where: { id: branchId, organizationId: ctx.organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          city: true,
          organization: { select: { name: true, slug: true } },
        },
      });

      if (!existing) {
        throw new NotFoundError("Branch was not found.");
      }

      const newQrToken = generateOpaqueToken(16);
      await tx.branch.update({
        where: { id: branchId },
        data: { qrToken: newQrToken },
      });

      const settings = await resolveEffectiveBranchSettings(
        tx,
        ctx.organizationId,
        branchId,
      );

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          branchId,
          actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
          actorId: ctx.userId,
          action: "BRANCH_QR_ROTATED",
          entityType: "Branch",
          entityId: branchId,
          ipAddressHash: meta.ipAddressHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
          metadata: { requireValidQrToken: settings.requireValidQrToken },
        },
      });

      const { publicPath, scanUrl } = buildPublicScanUrls({
        salonSlug: existing.organization.slug,
        branchSlug: existing.slug,
        qrToken: newQrToken,
        requireValidQrToken: settings.requireValidQrToken,
        appOrigin: meta.appOrigin,
      });

      return {
        branchId: existing.id,
        branchName: existing.name,
        branchSlug: existing.slug,
        branchCity: existing.city,
        salonName: existing.organization.name,
        salonSlug: existing.organization.slug,
        qrToken: newQrToken,
        requireValidQrToken: settings.requireValidQrToken,
        publicPath,
        scanUrl,
      };
    },
    meta.client,
  );

  return buildQrFormats(updatedMeta);
}
