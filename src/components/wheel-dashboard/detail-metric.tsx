export function DetailMetric({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-sm text-zinc-100 ${className}`}>
        {value}
      </div>
    </div>
  );
}
