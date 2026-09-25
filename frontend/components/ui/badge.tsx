import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge dasar. Variannya memakai token palet design.md §4 (navy/status), bukan
 * warna bawaan Tailwind — supaya tidak ada warna "liar" yang masuk diam-diam.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-grey-500/30 bg-grey-500/10 text-grey-500",
        safe: "border-status-safe/40 bg-status-safe/10 text-status-safe",
        warning: "border-status-warning/50 bg-status-warning/20 text-navy-900",
        danger: "border-status-danger/40 bg-status-danger/10 text-status-danger",
        info: "border-navy-700/30 bg-navy-700/10 text-navy-700",
        outline: "border-border bg-card text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
