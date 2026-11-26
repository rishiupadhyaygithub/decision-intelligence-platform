// Tiny inline trend line (no chart library): last N weekly values, last point marked.
export default function Sparkline({
  values,
  tone = 'neutral',
  width = 112,
  height = 32,
  label,
}: {
  values: number[]
  tone?: 'act' | 'watch' | 'good' | 'neutral'
  width?: number
  height?: number
  label?: string
}) {
  if (values.length < 2) return <div style={{ width, height }} />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 3
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (width - pad * 2) + pad,
    height - pad - ((v - min) / span) * (height - pad * 2),
  ])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const color = { act: '#b4342c', watch: '#b86e00', good: '#0f7b5f', neutral: '#637079' }[tone]
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? 'trend'}>
      <path d={`${d} L${lx.toFixed(1)},${height} L${pad},${height} Z`} fill={color} opacity={0.08} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.6} fill={color} />
    </svg>
  )
}
