import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Empty state — design.md §4: "Empty (dengan penjelasan, bukan kosong)".
 * Jadi judul + penjelasan kenapa kosong wajib ada; `description` bukan opsional
 * di pemakaian, hanya di tipe (supaya tetap fleksibel untuk kasus sederhana).
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-navy-100 bg-card px-6 py-10 text-center",
        className,
      )}
    >
      <p className="font-medium text-navy-900">{title}</p>
      {description && (
        <p className="max-w-md text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
