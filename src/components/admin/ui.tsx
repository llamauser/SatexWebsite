"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A titled block of a back-office page. */
export function Section({ title, hint, children, testId }: { title: string; hint?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="rounded-md border border-border bg-surface p-5" data-testid={testId}>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-text-muted">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function TextArea({ label, error, className, ...rest }: { label: string; error?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <textarea
        id={id} rows={3} aria-invalid={error ? true : undefined}
        className={cn("w-full rounded-sm border border-border bg-surface px-3 py-2 text-base aria-[invalid=true]:border-danger", className)}
        {...rest}
      />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Check({ label, className, ...rest }: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label className={cn("flex items-center gap-2 text-sm", className)}>
      <input type="checkbox" className="size-4 accent-[var(--primary)]" {...rest} />
      {label}
    </label>
  );
}

export function PillToggle({ label, on, onToggle, testId }: { label: string; on: boolean; onToggle: () => void; testId?: string }) {
  return (
    <button
      type="button" onClick={onToggle} aria-pressed={on} data-testid={testId}
      className={cn("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-primary bg-primary/10 text-primary" : "border-border text-text-muted hover:bg-surface-muted")}
    >
      {label}
    </button>
  );
}

export const tableCls = "w-full text-start text-sm";
export const thCls = "px-3 py-2 text-start font-medium";
export const tdCls = "px-3 py-2 align-top";
