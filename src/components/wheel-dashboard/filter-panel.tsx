"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { WheelFilters } from "@/lib/wheel/types";

function NumericFilter({
  label,
  value,
  min,
  max,
  step,
  prefix,
  suffix,
  onChange,
}: {
  label: string;
  value: number | string;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-1.5 text-sm">
      <span className="text-zinc-400">{label}</span>
      <div className="grid grid-cols-[1fr_92px] items-center gap-2">
        <input
          aria-label={`${label} slider`}
          className="accent-emerald-300"
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.target.value))}
          step={step}
          type="range"
          value={value}
        />
        <div className="flex h-10 items-center rounded-lg border border-white/10 bg-black/30 px-2">
          {prefix ? (
            <span className="pr-1 text-xs text-zinc-500">{prefix}</span>
          ) : null}
          <input
            aria-label={label}
            className="w-full bg-transparent font-mono text-sm text-white outline-none"
            max={max}
            min={min}
            onChange={(event) => onChange(Number(event.target.value))}
            step={step}
            type="number"
            value={value}
          />
          {suffix ? (
            <span className="pl-1 text-xs text-zinc-500">{suffix}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ToggleFilter({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
      <span className="text-zinc-300">{label}</span>
      <input
        checked={checked}
        className="size-4 accent-emerald-300"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

export function FilterPanel({
  filters,
  onChange,
  onReset,
}: {
  filters: WheelFilters;
  onChange: (filters: WheelFilters) => void;
  onReset: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  function update<K extends keyof WheelFilters>(
    key: K,
    value: WheelFilters[K],
  ) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <SlidersHorizontal className="size-4 text-emerald-200" />
            Strategy Filters
          </h2>
          <p className="mt-1 text-xs text-zinc-500 xl:hidden">
            Tune only when the ranked list needs a narrower mandate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            aria-expanded={expanded}
            className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white xl:hidden"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? "Hide" : "Show"}
          </button>
          <button
            className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-white/[0.06] hover:text-white"
            onClick={onReset}
            type="button"
          >
            Reset
          </button>
        </div>
      </div>
      <div className={`mt-4 gap-4 ${expanded ? "grid" : "hidden"} xl:grid`}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <NumericFilter
            label="DTE min"
            max={365}
            min={1}
            onChange={(value) => update("dteMin", Math.round(value))}
            step={1}
            value={filters.dteMin}
          />
          <NumericFilter
            label="DTE max"
            max={730}
            min={1}
            onChange={(value) => update("dteMax", Math.round(value))}
            step={1}
            value={filters.dteMax}
          />
          <NumericFilter
            label="Delta min"
            max={1}
            min={0}
            onChange={(value) => update("deltaMin", value)}
            step={0.01}
            value={filters.deltaMin}
          />
          <NumericFilter
            label="Delta max"
            max={1}
            min={0}
            onChange={(value) => update("deltaMax", value)}
            step={0.01}
            value={filters.deltaMax}
          />
        </div>
        <NumericFilter
          label="Minimum premium yield"
          max={10}
          min={0}
          onChange={(value) => update("minPremiumYield", value / 100)}
          step={0.1}
          suffix="%"
          value={(filters.minPremiumYield * 100).toFixed(1)}
        />
        <NumericFilter
          label="Minimum volume"
          max={5000}
          min={0}
          onChange={(value) => update("minVolume", Math.round(value))}
          step={10}
          value={filters.minVolume}
        />
        <NumericFilter
          label="Minimum open interest"
          max={10000}
          min={0}
          onChange={(value) => update("minOpenInterest", Math.round(value))}
          step={25}
          value={filters.minOpenInterest}
        />
        <NumericFilter
          label="Max spread / mid"
          max={100}
          min={0}
          onChange={(value) => update("maxSpreadPctOfMid", value / 100)}
          step={0.5}
          suffix="%"
          value={(filters.maxSpreadPctOfMid * 100).toFixed(1)}
        />
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-sm font-medium text-white">Spread filters</div>
          <div className="mt-3 grid gap-4">
            <NumericFilter
              label="Minimum return on risk"
              max={200}
              min={0}
              onChange={(value) => update("minSpreadReturnOnRisk", value / 100)}
              step={1}
              suffix="%"
              value={(filters.minSpreadReturnOnRisk * 100).toFixed(0)}
            />
            <NumericFilter
              label="Max spread width"
              max={100}
              min={1}
              onChange={(value) => update("maxSpreadWidth", Math.round(value))}
              prefix="$"
              step={1}
              value={filters.maxSpreadWidth}
            />
            <NumericFilter
              label="Long legs to test"
              max={10}
              min={1}
              onChange={(value) => update("spreadLongLegCount", Math.round(value))}
              step={1}
              value={filters.spreadLongLegCount}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <ToggleFilter
            checked={filters.excludeEarnings}
            label="Exclude earnings windows"
            onChange={(checked) => update("excludeEarnings", checked)}
          />
          <ToggleFilter
            checked={filters.includeWeeklies}
            label="Include weeklies"
            onChange={(checked) => update("includeWeeklies", checked)}
          />
        </div>
      </div>
    </section>
  );
}
