import type {
  PolymarketCategory,
  PolymarketOrderBy,
  PolymarketTimePeriod,
} from "@/lib/polymarket/types";
import {
  polymarketCategories,
  polymarketOrderByValues,
  polymarketTimePeriods,
} from "@/lib/polymarket/types";
import type { TraderAppliedFilters } from "@/lib/dashboard-url-state";

interface FilterControlsProps {
  appliedFilters: TraderAppliedFilters;
  category: PolymarketCategory;
  hasUnappliedChanges: boolean;
  limit: number;
  minValue: number;
  onApply: () => void;
  onCategoryChange: (category: PolymarketCategory) => void;
  onLimitChange: (limit: number) => void;
  onMinValueChange: (value: number) => void;
  onOrderByChange: (orderBy: PolymarketOrderBy) => void;
  onTimePeriodChange: (period: PolymarketTimePeriod) => void;
  orderBy: PolymarketOrderBy;
  showMinValue: boolean;
  timePeriod: PolymarketTimePeriod;
}

export function FilterControls({
  appliedFilters,
  category,
  hasUnappliedChanges,
  limit,
  minValue,
  onApply,
  onCategoryChange,
  onLimitChange,
  onMinValueChange,
  onOrderByChange,
  onTimePeriodChange,
  orderBy,
  showMinValue,
  timePeriod,
}: FilterControlsProps) {
  return (
    <section className="grid gap-3 rounded-lg border border-white/10 bg-[#151718] p-4 md:grid-cols-4 xl:grid-cols-6">
      <label className="grid gap-1.5 text-sm">
        <span className="text-zinc-400">Category</span>
        <select
          className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
          onChange={(event) =>
            onCategoryChange(event.target.value as PolymarketCategory)
          }
          value={category}
        >
          {polymarketCategories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="text-zinc-400">Period</span>
        <select
          className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
          onChange={(event) =>
            onTimePeriodChange(event.target.value as PolymarketTimePeriod)
          }
          value={timePeriod}
        >
          {polymarketTimePeriods.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="text-zinc-400">Rank By</span>
        <select
          className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
          onChange={(event) =>
            onOrderByChange(event.target.value as PolymarketOrderBy)
          }
          value={orderBy}
        >
          {polymarketOrderByValues.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="text-zinc-400">Rows</span>
        <input
          className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
          max={50}
          min={1}
          onChange={(event) => onLimitChange(Number(event.target.value))}
          type="number"
          value={limit}
        />
      </label>
      {showMinValue ? (
        <label className="grid gap-1.5 text-sm">
          <span className="text-zinc-400">Min Value</span>
          <input
            className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
            min={0}
            onChange={(event) => onMinValueChange(Number(event.target.value))}
            step={1000}
            type="number"
            value={minValue}
          />
        </label>
      ) : null}
      <div className="grid content-end gap-1.5">
        <button
          className="h-10 rounded-lg bg-cyan-300 px-4 text-sm font-semibold text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!hasUnappliedChanges}
          onClick={onApply}
          type="button"
        >
          Apply filters
        </button>
        <span className="text-[11px] text-zinc-500">
          {hasUnappliedChanges
            ? "Draft changes are pending."
            : `${appliedFilters.category} · ${appliedFilters.timePeriod}`}
        </span>
      </div>
    </section>
  );
}
