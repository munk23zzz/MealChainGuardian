import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToneBadge } from "@/components/status/status-badge";
import { CONSTRAINT_LABELS, summarizeConstraints } from "@/lib/urgency";
import type { ConstraintCheck } from "@/lib/api/schema";

/**
 * Hard constraint checklist (design.md §3.3).
 *
 * design.md: "kalau ada yang ❌, kandidat itu otomatis tidak muncul sebagai opsi".
 * Karena itu constraint yang gagal ditandai jelas, dan kalau backend belum
 * mengirim datanya UI bilang belum ada — bukan menampilkan centang kosong.
 */
export function ConstraintChecklist({
  constraints,
  title = "Hard constraint check",
}: {
  constraints?: ConstraintCheck[];
  title?: string;
}) {
  const summary = summarizeConstraints(constraints);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            Syarat mutlak sebelum kandidat boleh dipilih (Skill.md §2).
          </CardDescription>
        </div>
        <ToneBadge tone={summary.allPassed ? "safe" : summary.total === 0 ? "neutral" : "danger"}>
          {summary.total === 0
            ? "Belum ada data"
            : `${summary.passed}/${summary.total} lolos`}
        </ToneBadge>
      </CardHeader>

      <CardContent className="pt-3">
        {summary.total === 0 ? (
          <p className="text-muted-foreground">
            Backend belum mengirim hasil hard constraint check untuk keputusan ini.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {constraints!.map((check) => (
              <li key={check.name} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                    check.passed ? "bg-status-safe" : "bg-status-danger",
                  )}
                >
                  {check.passed ? "✓" : "✗"}
                </span>
                <span className="min-w-0">
                  <span className="font-medium text-navy-900">
                    {CONSTRAINT_LABELS[check.name]}
                  </span>
                  <span
                    className={cn(
                      "ml-1",
                      check.passed ? "text-status-safe" : "text-status-danger",
                    )}
                  >
                    {check.passed ? "lolos" : "gagal"}
                  </span>
                  {check.detail && (
                    <span className="block text-muted-foreground">{check.detail}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
