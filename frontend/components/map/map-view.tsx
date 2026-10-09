"use client";

import { useEffect, useRef } from "react";
import { Map, Marker, Popup, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Location } from "@/lib/api/schema";
import type { LocationSupplySummary } from "@/lib/labels";
import { locationStatusColor, locationStatusLabel, PALETTE } from "@/lib/design-tokens";
import { formatKg } from "@/lib/format";

/**
 * Worker MapLibre disajikan sebagai file statis dari /public (disalin oleh
 * scripts/copy-maplibre-worker.mjs saat predev/prebuild). Tanpa ini, webpack
 * gagal memuat worker dan peta tidak merender tile.
 */
setWorkerUrl("/maplibre-gl-worker.mjs");

/**
 * Titik awal peta: 10 lokasi demo semuanya di Jabodetabek/Cianjur, jadi peta
 * dibuka pada wilayah itu (kalau dibuka pada skala Indonesia, ke-10 marker
 * menumpuk dan tidak terbaca).
 */
const DEFAULT_CENTER: [number, number] = [106.85, -6.35];
const DEFAULT_ZOOM = 8.2;
/** Zoom saat fokus ke satu lokasi (role-aware untuk SPPG staff). */
const FOCUS_ZOOM = 11;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function popupHtml(
  location: Location,
  summary: LocationSupplySummary | undefined,
): string {
  const lines = (summary?.lines ?? [])
    .map(
      (line) =>
        `<li style="display:flex;justify-content:space-between;gap:12px">
           <span>${escapeHtml(line.label)}</span>
           <span style="color:${PALETTE.grey500}">${escapeHtml(formatKg(line.usableStockKg))}</span>
         </li>`,
    )
    .join("");

  return `
    <div style="font:13px/1.45 Inter,system-ui,sans-serif;color:${PALETTE.navy900};min-width:200px">
      <strong>${escapeHtml(location.name)}</strong>
      <div style="color:${PALETTE.grey500}">${escapeHtml(location.region)} · ${escapeHtml(
        locationStatusLabel(location.status),
      )}</div>
      ${lines ? `<ul style="margin:6px 0 0;padding:0;list-style:none">${lines}</ul>` : ""}
      <a href="/decisions?location=${encodeURIComponent(location.id)}"
         style="display:inline-block;margin-top:8px;color:${PALETTE.brandBlue};font-weight:600">
        Lihat keputusan lokasi ini
      </a>
    </div>`;
}

/**
 * Peta 10 lokasi (design.md §3.1).
 *
 * - Marker diwarnai lewat token design.md (hijau normal, kuning tight, merah kritis).
 * - `focusLocationId` dipakai untuk SPPG staff: peta di-zoom ke lokasi sendiri dan
 *   lokasi lain di-mute, supaya staff tidak merasa kewalahan dengan data lintas
 *   lokasi (design.md §1.4 role-aware by default).
 */
export function MapView({
  locations,
  summaries = [],
  focusLocationId = null,
  className,
}: {
  locations: Location[];
  summaries?: LocationSupplySummary[];
  focusLocationId?: string | null;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const hasFocusedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    map.addControl(new NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fokus ke satu lokasi (role-aware SPPG staff).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusLocationId) return;
    const target = locations.find((l) => l.id === focusLocationId);
    if (!target) return;

    map.flyTo({
      center: [target.longitude, target.latitude],
      zoom: FOCUS_ZOOM,
      duration: hasFocusedRef.current ? 900 : 0,
    });
    hasFocusedRef.current = true;
  }, [focusLocationId, locations]);

  // Update marker setiap kali data lokasi/fokus berubah.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const loc of locations) {
      const muted = focusLocationId !== null && loc.id !== focusLocationId;
      const focused = focusLocationId === loc.id;
      const size = focused ? 18 : 14;

      const el = document.createElement("div");
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderRadius = "9999px";
      el.style.backgroundColor = locationStatusColor(loc.status);
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.4)";
      el.style.opacity = muted ? "0.35" : "1";
      el.title = `${loc.name} — ${locationStatusLabel(loc.status)}`;

      const summary = summaries.find((s) => s.locationId === loc.id);

      const marker = new Marker({ element: el })
        .setLngLat([loc.longitude, loc.latitude])
        .setPopup(new Popup({ offset: 16 }).setHTML(popupHtml(loc, summary)))
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [locations, summaries, focusLocationId]);

  return <div ref={containerRef} className={className ?? "h-full w-full"} />;
}
