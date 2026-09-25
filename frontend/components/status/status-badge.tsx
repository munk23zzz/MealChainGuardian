import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { LocationStatus, SafetyStatus, SupplyRecord } from "@/lib/api/schema";
import {
  decisionStatusLabel,
  decisionStatusTone,
  locationStatusLabel,
  locationStatusTone,
  normalizeDecisionStatus,
  safetyStatusLabel,
  safetyStatusTone,
  supplyStatusLabel,
  supplyStatusTone,
} from "@/lib/design-tokens";
import { evidenceTone } from "@/lib/evidence";

/**
 * StatusBadge — satu-satunya cara menampilkan status di UI (design.md §4).
 *
 * Tujuannya: PASS/FAIL/NEEDS_VERIFICATION, surplus/deficit, status keputusan, dan
 * konsistensi bukti tidak divisualkan berbeda-beda di tiap halaman — itu yang
 * bikin status "ambigu sekilas" (prinsip design.md §1.2).
 */
export type StatusBadgeProps =
  | { kind: "decision"; value: string; className?: string }
  | { kind: "safety"; value: SafetyStatus; className?: string }
  | { kind: "location"; value: LocationStatus; className?: string }
  | { kind: "supply"; value: SupplyRecord["status"]; className?: string }
  | { kind: "evidence"; value: boolean | null; className?: string };

export function StatusBadge(props: StatusBadgeProps) {
  switch (props.kind) {
    case "decision": {
      const status = normalizeDecisionStatus(props.value);
      return (
        <Badge tone={decisionStatusTone(status)} className={props.className}>
          {decisionStatusLabel(status)}
        </Badge>
      );
    }
    case "safety":
      return (
        <Badge tone={safetyStatusTone(props.value)} className={props.className}>
          {safetyStatusLabel(props.value)}
        </Badge>
      );
    case "location":
      return (
        <Badge tone={locationStatusTone(props.value)} className={props.className}>
          {locationStatusLabel(props.value)}
        </Badge>
      );
    case "supply":
      return (
        <Badge tone={supplyStatusTone(props.value)} className={props.className}>
          {supplyStatusLabel(props.value)}
        </Badge>
      );
    case "evidence": {
      const label =
        props.value === true
          ? "Bukti konsisten"
          : props.value === false
            ? "Bukti tidak konsisten"
            : "Bukti belum diuji";
      return (
        <Badge tone={evidenceTone(props.value)} className={props.className}>
          {label}
        </Badge>
      );
    }
  }
}

/** Badge dengan tone eksplisit — untuk penanda non-status (mis. urgensi). */
export function ToneBadge({
  tone,
  children,
  className,
}: {
  tone: "neutral" | "safe" | "warning" | "danger" | "info" | "outline";
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge tone={tone} className={className}>
      {children}
    </Badge>
  );
}
