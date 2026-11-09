import { cn } from "@/lib/utils";

const TONES = {
  neutral: "bg-surface-muted text-text-muted",
  info: "bg-primary/10 text-primary-strong",
  warn: "bg-warning/15 text-warning",
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ label, tone = "neutral", testId, status }: { label: string; tone?: Tone; testId?: string; status?: string }) {
  return (
    <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold", TONES[tone])} data-testid={testId} data-status={status}>
      {label}
    </span>
  );
}

export const ORDER_TONE: Record<string, Tone> = { confirmed: "info", in_preparation: "info", ready: "warn", shipped: "warn", delivered: "success", cancelled: "neutral" };
export const PAYMENT_TONE: Record<string, Tone> = { unpaid: "danger", partial: "warn", paid: "success" };
export const DELIVERY_TONE: Record<string, Tone> = { scheduled: "info", in_transit: "warn", delivered: "success", failed: "danger" };
export const CUTTING_TONE: Record<string, Tone> = { queued: "info", cutting: "warn", ready: "success", cancelled: "neutral" };
