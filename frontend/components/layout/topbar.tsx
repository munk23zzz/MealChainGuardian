"use client";

import { DataSourceBadge } from "@/components/ui/data-source-badge";

export function TopBar() {
  return (
    <header
      style={{ backgroundColor: "#0969DA" }}
      className="flex items-center gap-4 border-b border-white/10 px-4 py-3"
    >
      <div className="flex flex-1 items-center gap-3">
        <DataSourceBadge />
      </div>
    </header>
  );
}
