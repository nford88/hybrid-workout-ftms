interface Props {
  label: string
  unit: string
  color: string
  value?: string
}

export default function MetricCard({ label, unit, color, value = '—' }: Props) {
  return (
    <div className="metric-card-compact">
      <h3>{label}</h3>
      <div className={`metric-value ${color}`}>{value}</div>
      <div className="metric-unit">{unit}</div>
    </div>
  )
}
