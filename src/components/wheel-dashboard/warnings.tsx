import { AlertTriangle, ChevronDown } from "lucide-react";
import type { Warning } from "@/lib/wheel/types";
import { badgeClass, warningTone } from "./styles";

export function WarningBadges({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) {
    return <span className="text-xs text-zinc-500">None</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {warnings.map((warning, index) => (
        <span
          aria-label={`${warning.severity}: ${warning.message}`}
          className={`rounded-md border px-2 py-1 text-[11px] font-medium ${badgeClass(warning.severity)}`}
          key={`${warning.type}-${index}`}
        >
          {warning.message}
        </span>
      ))}
    </div>
  );
}

export function CompactWarnings({
  warnings,
  expanded,
  onToggle,
}: {
  warnings: Warning[];
  expanded: boolean;
  onToggle: () => void;
}) {
  if (warnings.length === 0) {
    return <span className="text-sm text-zinc-500">None</span>;
  }

  return (
    <div className="max-w-[260px]">
      <button
        aria-expanded={expanded}
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition hover:brightness-125 ${warningTone(warnings)}`}
        onClick={onToggle}
        type="button"
      >
        <AlertTriangle className="size-3" />
        <span>
          {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
        </span>
        <ChevronDown
          className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded ? (
        <div className="mt-2 grid gap-1.5 whitespace-normal">
          {warnings.map((warning, index) => (
            <div
              className={`rounded-md border px-2.5 py-2 text-xs leading-5 ${badgeClass(warning.severity)}`}
              key={`${warning.type}-${index}`}
            >
              {warning.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
