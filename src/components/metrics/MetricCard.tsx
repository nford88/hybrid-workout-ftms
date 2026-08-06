interface Props {
  label: string
  unit: string
  color: string
  value?: string
  /**
   * A short warning shown under the value, e.g. "clamped".
   *
   * Its reason for existing: the gear card already turned amber when the drivetrain model
   * wanted more resistance than the ±25% grade clamp can deliver, but colour was the ONLY
   * signal — invisible to anyone who does not know the palette, and a single channel that a
   * glance at 1.2 m can easily miss. The word is the signal; the colour reinforces it.
   */
  warning?: string
}

export default function MetricCard({ label, unit, color, value = '—', warning }: Props) {
  return (
    <div className="metric-card-compact">
      <h3>{label}</h3>
      <div className={`metric-value ${color}`}>{value}</div>
      {warning ? (
        <div className="metric-unit flex items-center justify-center gap-0.5 font-semibold text-amber-400">
          <span aria-hidden="true">▲</span>
          {warning}
        </div>
      ) : (
        <div className="metric-unit">{unit}</div>
      )}
    </div>
  )
}
