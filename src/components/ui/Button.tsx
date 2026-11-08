import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "text-white shadow-card hover:brightness-110",
        secondary: "border border-border bg-surface text-text hover:bg-surface-muted",
        ghost: "text-text hover:bg-surface-muted",
        danger: "bg-danger text-white hover:brightness-110",
      },
      size: { sm: "h-9 px-4 text-sm", md: "h-11 px-6 text-base", lg: "h-12 px-8 text-base" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  loading?: boolean;
}

export function Button({ className, variant, size, loading, disabled, children, style, ...rest }: Props) {
  return (
    <button
      className={cn(buttonStyles({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      style={variant === undefined || variant === "primary" ? { background: "var(--primary-gradient)", ...style } : style}
      {...rest}
    >
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}
