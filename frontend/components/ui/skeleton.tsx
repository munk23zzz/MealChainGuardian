import { cn } from "@/lib/utils";

/**
 * Skeleton loading — design.md §4 "State yang wajib didesain": loading harus
 * skeleton, BUKAN spinner polos. Bentuknya menyerupai konten akhir supaya layout
 * tidak melompat saat data tiba.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-navy-100", className)}
    />
  );
}

/** Skeleton untuk satu kartu data (title + 2 baris isi). */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3 h-7 w-1/2" />
      <Skeleton className="mt-3 h-3 w-2/3" />
    </div>
  );
}

/** Skeleton untuk daftar baris (feed / timeline). */
export function SkeletonRows({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
