'use client'

// Weekly revenue, all regions. Week labels as "3 Mar"; values compact (1.2M).
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { compact } from '@/lib/brief'

const fmtWeek = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export default function RevenueChart({ data }: { data: { week: string; revenue: number }[] }) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f7b5f" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#0f7b5f" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#edf0ee" />
          <XAxis
            dataKey="week"
            tickFormatter={fmtWeek}
            tick={{ fontSize: 11, fill: '#637079' }}
            axisLine={false}
            tickLine={false}
            minTickGap={36}
          />
          <YAxis
            tickFormatter={compact}
            tick={{ fontSize: 11, fill: '#637079' }}
            axisLine={false}
            tickLine={false}
            width={44}
            domain={[(min: number) => Math.floor(min * 0.94), (max: number) => Math.ceil(max * 1.03)]}
          />
          <Tooltip
            cursor={{ stroke: '#c3cbc8' }}
            contentStyle={{ borderRadius: 10, border: '1px solid #dde2df', fontSize: 12 }}
            labelFormatter={(w) => `Week of ${fmtWeek(String(w))}`}
            formatter={(v) => [Number(v).toLocaleString(), 'Revenue']}
          />
          <Area type="monotone" dataKey="revenue" stroke="#0f7b5f" strokeWidth={2} fill="url(#rev)" animationDuration={700} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
