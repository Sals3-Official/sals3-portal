type MetricCardProps = {
  label: string;
  value: string;
};

/** One number with its label, inside a definition list. */
export default function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-display text-xl font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  );
}
