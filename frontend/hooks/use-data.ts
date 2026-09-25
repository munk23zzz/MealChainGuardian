"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getCommodities,
  getDecision,
  getDecisions,
  getDemand,
  getKpi,
  getLocations,
  getSupply,
} from "@/lib/api";

/**
 * Interval polling (ms).
 *
 * design.md §5: real-time cukup dengan polling sederhana (bukan WebSocket).
 * - Data dashboard/supply: 30 detik, cukup supaya demo terasa "hidup".
 * - Agent Activity Log & feed keputusan: 8 detik saat demo, karena screen ini
 *   yang dipertunjukkan ke juri (design.md §3.4).
 */
export const POLL_INTERVAL = 30_000;
export const DEMO_POLL_INTERVAL = 8_000;

export function useLocations() {
  return useQuery({ queryKey: ["locations"], queryFn: getLocations });
}

export function useCommodities() {
  return useQuery({ queryKey: ["commodities"], queryFn: getCommodities });
}

export function useSupply() {
  return useQuery({
    queryKey: ["supply"],
    queryFn: getSupply,
    refetchInterval: POLL_INTERVAL,
  });
}

export function useDemand() {
  return useQuery({
    queryKey: ["demand"],
    queryFn: getDemand,
    refetchInterval: POLL_INTERVAL,
  });
}

export function useDecisions(options?: { demo?: boolean }) {
  return useQuery({
    queryKey: ["decisions"],
    queryFn: getDecisions,
    refetchInterval: options?.demo ? DEMO_POLL_INTERVAL : POLL_INTERVAL,
  });
}

export function useDecision(id: string, options?: { demo?: boolean }) {
  return useQuery({
    queryKey: ["decisions", id],
    queryFn: () => getDecision(id),
    refetchInterval: options?.demo ? DEMO_POLL_INTERVAL : POLL_INTERVAL,
  });
}

export function useKpi() {
  return useQuery({
    queryKey: ["kpi"],
    queryFn: getKpi,
    refetchInterval: POLL_INTERVAL,
  });
}
