import type { ReactNode } from "react";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { Card } from "@/components/ui/Field";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <>
      <BlobBackground />
      <main className="mx-auto flex min-h-[70vh] max-w-[560px] flex-col justify-center px-4 py-12">
        <Card>
          <h1 className="font-display text-3xl font-bold">{title}</h1>
          {subtitle && <p className="mt-2 text-text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </Card>
      </main>
    </>
  );
}
