import type { ReactNode } from "react";

interface ListPresentationProps {
  children: ReactNode;
  icon: ReactNode;
  title: string;
  freshness: string;
  filterLabel: string;
}

/** Shared list shell; row implementations stay specialized for their data shape. */
export function ListPresentation({
  children,
  filterLabel,
  freshness,
  icon,
  title,
}: ListPresentationProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#151718]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          {icon}
          {title}
        </div>
        <div className="text-right text-xs text-zinc-500">
          <div>{freshness}</div>
          <div>Generated with {filterLabel}</div>
        </div>
      </div>
      {children}
    </section>
  );
}
