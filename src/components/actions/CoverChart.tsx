'use client'

// Stock over the next weeks, with and without the action, against the reorder point.
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { compact } from '@/lib/brief'

export default function CoverChart({ path, reorderPoint }: { path: { week: number; without: number; with: number }[]; reorderPoint: number }) {
  return (
    <div className="mt-2 h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={path} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#edf0ee" />
          <XAxis dataKey="week" tickFormatter={(w) => (w === 0 ? 'now' : `wk ${w}`)} tick={{ fontSize: 11, fill: '#637079' }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: '#637079' }} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            contentStyle={{ borderRadius: 10, border: '1px solid #dde2df', fontSize: 12 }}
            labelFormatter={(w) => (w === 0 ? 'Now' : `In ${w} week${Number(w) > 1 ? 's' : ''}`)}
            formatter={(v, name) => [Math.round(Number(v)).toLocaleString('en-IN'), name]}
          />
          <ReferenceLine y={reorderPoint} stroke="#b86e00" strokeDasharray="4 4" label={{ value: 'reorder point', fontSize: 10, fill: '#b86e00', position: 'insideTopRight' }} />
          <Line type="linear" dataKey="without" name="Without action" stroke="#b4342c" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          <Line type="linear" dataKey="with" name="With action" stroke="#0f7b5f" strokeWidth={2.4} dot={false} animationDuration={500} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
