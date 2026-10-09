import Link from "next/link";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Daftar tugas lapangan "Hari Ini".
 *
 * Dirancang untuk disentuh dari ponsel di dapur: tiap kartu berupa tautan utuh
 * dengan tinggi minimal 88 piksel, ikon mengikuti nada (aman/perhatian/bahaya),
 * dan teks utama memakai warna navy agar terbaca di layar terang.
 */
export type TaskTone = "safe" | "warning" | "danger";

export type TaskItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: TaskTone;
  meta?: string;
};

const TONE_ICON = {
  safe: CheckCircle2,
  warning: AlertTriangle,
  danger: ShieldAlert,
} as const;

export function TaskList({ tasks }: { tasks: TaskItem[] }) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        title="Tidak ada tugas untuk hari ini"
        description="Tidak ada penerimaan yang harus dicatat, keputusan yang menunggu persetujuan, maupun titik keamanan pangan yang belum sesuai."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {tasks.map((task) => {
        const Icon = TONE_ICON[task.tone];
        return (
          <li key={task.id}>
            <Link
              href={task.href}
              className="flex min-h-[88px] items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-navy-700/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Badge
                tone={task.tone}
                className="h-10 w-10 shrink-0 justify-center rounded-full p-0"
              >
                <Icon className="h-5 w-5" aria-hidden />
              </Badge>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-navy-900">{task.title}</span>
                <span className="text-sm text-muted-foreground">
                  {task.detail}
                </span>
                {task.meta && (
                  <span className="text-xs text-muted-foreground">
                    {task.meta}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
