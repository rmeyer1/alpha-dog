"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

type CompanyLogoSize = "sm" | "md" | "lg";

const sizeClasses: Record<CompanyLogoSize, string> = {
  sm: "size-8 text-[11px]",
  md: "size-10 text-xs",
  lg: "size-16 text-lg",
};

const logoSurfaceClasses =
  "border border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_2px_rgba(0,0,0,0.24)]";

function logoInitials(symbol: string) {
  const compact = symbol.replace(/[^A-Z0-9]/gi, "").toUpperCase();

  return compact.slice(0, 2) || "--";
}

export function CompanyLogo({
  className = "",
  name,
  size = "md",
  symbol,
}: {
  className?: string;
  name?: string | null;
  size?: CompanyLogoSize;
  symbol: string;
}) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const [failedSymbol, setFailedSymbol] = useState<string | null>(null);
  const [loadedSymbol, setLoadedSymbol] = useState<string | null>(null);
  const initials = useMemo(
    () => logoInitials(normalizedSymbol),
    [normalizedSymbol],
  );
  const failed = failedSymbol === normalizedSymbol;
  const loaded = loadedSymbol === normalizedSymbol;

  if (!normalizedSymbol || failed) {
    return (
      <span
        aria-label={`${normalizedSymbol || "Company"} logo unavailable`}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg font-mono font-semibold text-zinc-300 ${logoSurfaceClasses} ${sizeClasses[size]} ${className}`}
        title={name ?? normalizedSymbol}
      >
        {initials}
      </span>
    );
  }

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg ${logoSurfaceClasses} ${sizeClasses[size]} ${className}`}
      title={name ?? normalizedSymbol}
    >
      {!loaded ? (
        <span className="absolute inset-0 inline-flex items-center justify-center bg-white/[0.035] font-mono font-semibold text-zinc-500">
          {initials}
        </span>
      ) : null}
      <Image
        alt={`${name ?? normalizedSymbol} logo`}
        className={`size-full object-contain p-1 transition-opacity ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        fill
        onError={() => setFailedSymbol(normalizedSymbol)}
        onLoad={() => setLoadedSymbol(normalizedSymbol)}
        sizes="64px"
        src={`/api/logos/${encodeURIComponent(normalizedSymbol)}?v=1`}
        unoptimized
      />
    </span>
  );
}
