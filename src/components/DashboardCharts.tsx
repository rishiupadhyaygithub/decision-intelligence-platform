'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// Live charts wired to computed facts (statistical + ML). Every series traces to
// a real fact row — no fabricated points. Indigo/slate palette.
const INDIGO = '#6366f1'
const SLATE = '#94a3b8'

export interface RevenuePoint { date: string; revenue: number }
export interface BarPoint { label: string; value: number }

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="mb-3">
        <h3 className="font-medium text-slate-900 text-sm">{title}</h3>
        {sub && <p className="text-xs text-slate-400">{sub}</p>}
      </div>
      {children}
    </section>
  )
}

function Empty() {
  return <div className="h-[200px] flex items-center justify-center text-sm text-slate-400">No data</div>
}

export default function DashboardCharts({
  revenue,
  forecast,
  churn,
  sentiment,
}: {
  revenue: RevenuePoint[]
  forecast: BarPoint[]
  churn: BarPoint[]
  sentiment: BarPoint[]
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
      <Panel title="Revenue trend" sub="v_revenue_by_region_daily · aggregated daily">
        {revenue.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={revenue} margin={{ left: -16, right: 8, top: 4 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={INDIGO} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={INDIGO} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={false} width={48} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Area type="monotone" dataKey="revenue" stroke={INDIGO} strokeWidth={2} fill="url(#rev)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <Empty />
        )}
      </Panel>

      <Panel title="Demand forecast · next month" sub="ml:holt — Holt linear-trend per region">
        {forecast.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={forecast} margin={{ left: -16, right: 8, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={false} width={48} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Bar dataKey="value" fill={INDIGO} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Empty />
        )}
      </Panel>

      <Panel title="Churn risk · top SKUs" sub="ml:logreg — probability next-week velocity drop">
        {churn.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={churn} layout="vertical" margin={{ left: 8, right: 16, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
              <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: SLATE }} tickLine={false} axisLine={false} width={90} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {churn.map((d, i) => (
                  <Cell key={i} fill={d.value >= 0.5 ? '#ef4444' : d.value >= 0.25 ? '#f59e0b' : INDIGO} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Empty />
        )}
      </Panel>

      <Panel title="Signal sentiment · by category" sub="ml:rule — lexical score, −1 to +1">
        {sentiment.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sentiment} margin={{ left: -16, right: 8, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={false} />
              <YAxis domain={[-1, 1]} tick={{ fontSize: 11, fill: SLATE }} tickLine={false} axisLine={false} width={48} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {sentiment.map((d, i) => (
                  <Cell key={i} fill={d.value < 0 ? '#ef4444' : '#10b981'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Empty />
        )}
      </Panel>
    </div>
  )
}
