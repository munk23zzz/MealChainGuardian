"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Error state — design.md §4: "Error (dengan retry action)". Pesan mentah dari
 * backend tetap ditampilkan apa adanya supaya tidak menyembunyikan penyebab.
 */
export function ErrorState({
  message,
  onRetry,
  retrying,
  className,
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-status-danger/40 bg-status-danger/10 px-4 py-3",
        className,
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-status-danger" />
      <span className="flex-1 text-status-danger">{message}</span>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          className="border-status-danger/40 text-status-danger hover:bg-status-danger/10 hover:text-status-danger"
        >
          {retrying ? "Mencoba..." : "Coba lagi"}
        </Button>
      )}
    </div>
  );
}
