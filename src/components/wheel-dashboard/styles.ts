import type { Warning } from "@/lib/wheel/types";

export function badgeClass(severity: Warning["severity"]) {
  if (severity === "danger") {
    return "border-red-400/40 bg-red-500/15 text-red-100";
  }

  if (severity === "warning") {
    return "border-amber-300/40 bg-amber-400/15 text-amber-100";
  }

  return "border-cyan-300/30 bg-cyan-400/10 text-cyan-100";
}

export function qualityClass(quality: string) {
  if (quality === "excellent" || quality === "good") {
    return "text-emerald-200";
  }

  if (quality === "weak" || quality === "poor") {
    return "text-amber-200";
  }

  return "text-zinc-300";
}

export function warningTone(warnings: Warning[]) {
  if (warnings.some((warning) => warning.severity === "danger")) {
    return "border-red-400/40 bg-red-500/15 text-red-100";
  }

  if (warnings.some((warning) => warning.severity === "warning")) {
    return "border-amber-300/40 bg-amber-400/15 text-amber-100";
  }

  return "border-cyan-300/30 bg-cyan-400/10 text-cyan-100";
}
