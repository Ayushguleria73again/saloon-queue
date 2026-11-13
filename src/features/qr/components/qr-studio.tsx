"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, ExternalLink, Printer, QrCode, RefreshCw } from "lucide-react";
import {
  BranchSwitcher,
  Button,
  ConfirmModal,
  useToast,
  type BranchOption,
} from "@/components/ui";

export interface QrStudioPayload {
  branchId: string;
  branchName: string;
  branchSlug: string;
  branchCity: string | null;
  salonName: string;
  salonSlug: string;
  requireValidQrToken: boolean;
  publicPath: string;
  scanUrl: string;
  dataUrl: string;
}

interface QrStudioProps {
  branches: BranchOption[];
  selectedBranchId: string;
  initialQr: QrStudioPayload | null;
}

export function QrStudio({ branches, selectedBranchId, initialQr }: QrStudioProps) {
  const router = useRouter();
  const { showToast } = useToast();

  const [qr, setQr] = useState<QrStudioPayload | null>(initialQr);
  const [confirmRotateOpen, setConfirmRotateOpen] = useState(false);
  const [rotating, setRotating] = useState(false);

  async function handleCopyUrl() {
    if (!qr) return;
    try {
      await navigator.clipboard.writeText(qr.scanUrl);
      showToast({
        variant: "success",
        title: "Customer intake URL copied",
        description: qr.scanUrl,
      });
    } catch {
      showToast({
        variant: "error",
        title: "Could not copy URL automatically",
      });
    }
  }

  async function handleRotateQr() {
    if (!qr) return;
    setRotating(true);
    try {
      const res = await fetch(
        `/api/owner/branches/${encodeURIComponent(qr.branchId)}/qr/regenerate`,
        { method: "POST" },
      );
      const json = (await res.json().catch(() => ({}))) as {
        qr?: QrStudioPayload;
        error?: { message?: string };
      };
      if (!res.ok || !json.qr) {
        showToast({
          variant: "error",
          title: "QR rotation failed",
          description: json.error?.message,
        });
        return;
      }

      setQr(json.qr);
      setConfirmRotateOpen(false);
      showToast({
        variant: "success",
        title: "Branch QR code rotated",
        description: "Reprint or replace your counter standee with this new code.",
      });
    } finally {
      setRotating(false);
    }
  }

  if (branches.length === 0 || !qr) {
    return (
      <div className="rounded-card border border-subtle bg-surface p-6 text-center shadow-sm">
        <h1 className="text-xl font-bold text-ink">No Branches Accessible</h1>
      </div>
    );
  }

  const pngDownloadHref = `/api/owner/branches/${encodeURIComponent(qr.branchId)}/qr?format=png`;
  const svgDownloadHref = `/api/owner/branches/${encodeURIComponent(qr.branchId)}/qr?format=svg`;

  return (
    <div className="space-y-6">
      {/* Screen Toolbar (hidden cleanly when printing poster) */}
      <div className="no-print flex flex-col gap-4 rounded-card border border-subtle bg-surface p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">QR Studio</h1>
          <p className="text-sm text-ink-secondary">
            Print your counter standee or download high-resolution QR artwork for{" "}
            <span className="font-semibold text-ink">{qr.branchName}</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {branches.length > 1 ? (
            <div className="min-w-[190px]">
              <BranchSwitcher
                branches={branches}
                selectedBranchId={selectedBranchId}
                onChange={(branchId) =>
                  router.push(`/owner/qr?branchId=${encodeURIComponent(branchId)}`)
                }
              />
            </div>
          ) : null}

          <a
            href={pngDownloadHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-subtle bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-muted"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download PNG
          </a>

          <a
            href={svgDownloadHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-subtle bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-muted"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download SVG
          </a>

          <Button type="button" variant="primary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print Standee
          </Button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Printable Counter Poster */}
        <section className="mx-auto flex w-full max-w-md flex-col items-center rounded-card border-2 border-brand-primary bg-surface p-8 text-center shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-control bg-brand-primary text-brand-foreground">
            <QrCode className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="mt-4 text-xs font-bold uppercase tracking-widest text-brand-accent">
            {qr.salonName}
          </p>
          <h2 className="mt-1 text-2xl font-bold text-ink">{qr.branchName}</h2>
          {qr.branchCity ? (
            <p className="text-xs text-ink-secondary">{qr.branchCity}</p>
          ) : null}

          <p className="mt-5 text-base font-semibold text-ink">Scan to Join the Queue</p>
          <p className="mt-1 text-xs text-ink-secondary">
            Get a live digital token on your phone in under 30 seconds.
          </p>

          <div className="mt-5 rounded-card border border-subtle bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr.dataUrl}
              alt={`Queue QR code for ${qr.salonName} ${qr.branchName}`}
              className="h-56 w-56 object-contain"
            />
          </div>

          <p className="mt-4 break-all font-mono text-[11px] text-ink-secondary">
            {qr.scanUrl}
          </p>
        </section>

        {/* Link Controls & Security Rotation (no-print) */}
        <section className="no-print space-y-5 rounded-card border border-subtle bg-surface p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-ink">Direct Intake Link</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              Share this URL on WhatsApp, Google Maps, or Instagram Bio so walk-in clients
              join {qr.branchName} remotely.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <code className="flex-1 truncate rounded-control border border-subtle bg-muted px-3 py-2.5 font-mono text-xs text-ink">
                {qr.scanUrl}
              </code>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleCopyUrl()}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copy Link
              </Button>
            </div>
            <a
              href={qr.publicPath}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand-accent hover:underline"
            >
              Preview customer intake page
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>

          <div className="border-t border-subtle pt-5">
            <h3 className="text-sm font-semibold text-ink">Strict QR Mode & Rotation</h3>
            <p className="mt-1 text-xs text-ink-secondary">
              Strict QR check is currently{" "}
              <span className="font-semibold text-ink">
                {qr.requireValidQrToken ? "ENABLED" : "DISABLED"}
              </span>
              . Rotating the QR token invalidates previously printed strict-mode posters
              immediately.
            </p>
            <div className="mt-3">
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => setConfirmRotateOpen(true)}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Rotate QR Code
              </Button>
            </div>
          </div>
        </section>
      </div>

      <ConfirmModal
        open={confirmRotateOpen}
        tone="danger"
        title="Rotate Branch QR Token?"
        description="If strict QR verification is enabled on this branch, previously printed QR posters will stop accepting new tokens immediately."
        confirmLabel="Rotate QR Code"
        cancelLabel="Cancel"
        loading={rotating}
        onCancel={() => setConfirmRotateOpen(false)}
        onConfirm={() => void handleRotateQr()}
      />
    </div>
  );
}
