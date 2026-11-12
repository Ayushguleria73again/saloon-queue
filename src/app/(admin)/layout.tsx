import type { ReactNode } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { ToastProvider } from "@/components/ui/toast";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AdminShell>{children}</AdminShell>
    </ToastProvider>
  );
}
