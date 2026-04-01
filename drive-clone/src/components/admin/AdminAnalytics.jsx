import {
  BarChart3,
  HardDrive,
  PieChart as PieChartIcon,
  TrendingUp,
  UploadCloud,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { formatBytes } from '../../lib/storage'

const PIE_COLORS = ['#38bdf8', '#22c55e', '#f59e0b', '#f97316']

function AnalyticsTooltip({ active, payload, label, valueFormatter = (value) => value }) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-xl dark:border-slate-700 dark:bg-slate-950/95">
      {label ? <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p> : null}
      <div className="space-y-2">
        {payload.map((entry) => (
          <div key={`${entry.name}-${entry.value}`} className="flex items-center justify-between gap-4 text-sm">
            <span className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color || entry.fill || '#38bdf8' }} />
              {entry.name}
            </span>
            <span className="font-medium text-slate-950 dark:text-slate-50">{valueFormatter(entry.value, entry.name)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChartPanel({ title, subtitle, Icon, children, footer }) {
  return (
    <article className="min-w-0 rounded-[28px] border border-slate-200/80 bg-white/92 p-5 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/70">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-sky-700 dark:bg-slate-800 dark:text-sky-300">
          <Icon size={20} />
        </span>
        <div>
          <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">{title}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
      </div>
      <div className="mt-5 h-72 min-h-[18rem] min-w-0">{children}</div>
      {footer ? <div className="mt-4">{footer}</div> : null}
    </article>
  )
}

function InlineMetric({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  }

  return (
    <div className={`rounded-2xl px-3 py-2 text-sm ${tones[tone] || tones.slate}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}

function EmptyChartState({ message }) {
  return (
    <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400">
      {message}
    </div>
  )
}

function LoadingPanel() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-[420px] min-w-0 animate-pulse rounded-[28px] border border-slate-200/80 bg-white/75 dark:border-slate-800/80 dark:bg-slate-950/50"
        />
      ))}
    </div>
  )
}

function AdminAnalytics({ analytics, loading = false }) {
  if (loading) {
    return (
      <section className="mt-6 rounded-[30px] border border-white/70 bg-white/88 p-6 shadow-sm backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/75">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">Analytics Overview</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Loading storage, file activity, and user growth analytics.
          </p>
        </div>
        <LoadingPanel />
      </section>
    )
  }

  const storageData = [
    { name: 'Used', value: Number(analytics?.storage?.used || 0) },
    { name: 'Free', value: Number(analytics?.storage?.free || 0) },
  ]
  const totalStorage = storageData.reduce((sum, item) => sum + item.value, 0)
  const fileTypeData = [
    { name: 'Image', value: Number(analytics?.file_types?.image || 0) },
    { name: 'Video', value: Number(analytics?.file_types?.video || 0) },
    { name: 'PDF', value: Number(analytics?.file_types?.pdf || 0) },
    { name: 'Other', value: Number(analytics?.file_types?.other || 0) },
  ]
  const totalFiles = fileTypeData.reduce((sum, item) => sum + item.value, 0)
  const uploadData = Array.isArray(analytics?.uploads_last_7_days) ? analytics.uploads_last_7_days : []
  const growthData = Array.isArray(analytics?.user_growth) ? analytics.user_growth : []

  return (
    <section className="mt-6 rounded-[30px] border border-white/70 bg-white/88 p-6 shadow-sm backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/75">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">Analytics Overview</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Monitor storage balance, file mix, upload momentum, and user growth from one admin view.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartPanel
          title="Storage Usage"
          subtitle="Used capacity versus remaining free platform space."
          Icon={HardDrive}
          footer={(
            <div className="grid gap-3 sm:grid-cols-2">
              <InlineMetric label="Used" value={formatBytes(storageData[0].value)} tone="sky" />
              <InlineMetric label="Free" value={formatBytes(storageData[1].value)} tone="emerald" />
            </div>
          )}
        >
          {totalStorage > 0 ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
              <PieChart>
                <Pie
                  data={storageData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={68}
                  outerRadius={102}
                  paddingAngle={4}
                >
                  {storageData.map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<AnalyticsTooltip valueFormatter={(value) => formatBytes(value)} />} />
                <Legend verticalAlign="bottom" height={24} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChartState message="No storage analytics available yet." />
          )}
        </ChartPanel>

        <ChartPanel
          title="File Types Distribution"
          subtitle="How uploaded files are split across core content types."
          Icon={PieChartIcon}
          footer={(
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <InlineMetric label="Image" value={fileTypeData[0].value.toLocaleString()} tone="sky" />
              <InlineMetric label="Video" value={fileTypeData[1].value.toLocaleString()} tone="emerald" />
              <InlineMetric label="PDF" value={fileTypeData[2].value.toLocaleString()} tone="amber" />
              <InlineMetric label="Other" value={fileTypeData[3].value.toLocaleString()} />
            </div>
          )}
        >
          {totalFiles > 0 ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
              <PieChart>
                <Pie
                  data={fileTypeData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={68}
                  outerRadius={102}
                  paddingAngle={4}
                >
                  {fileTypeData.map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<AnalyticsTooltip />} />
                <Legend verticalAlign="bottom" height={24} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChartState message="No active files available for distribution analytics." />
          )}
        </ChartPanel>

        <ChartPanel
          title="Upload Activity"
          subtitle="Files uploaded per day across the last seven days."
          Icon={UploadCloud}
          footer={<InlineMetric label="7-day total" value={uploadData.reduce((sum, item) => sum + Number(item.count || 0), 0).toLocaleString()} tone="sky" />}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
            <LineChart data={uploadData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
              <XAxis
                dataKey="date"
                tickFormatter={(value) => String(value).slice(5)}
                tickLine={false}
                axisLine={false}
                stroke="#94a3b8"
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} stroke="#94a3b8" />
              <Tooltip content={<AnalyticsTooltip />} />
              <Line
                type="monotone"
                dataKey="count"
                name="Uploads"
                stroke="#38bdf8"
                strokeWidth={3}
                dot={{ r: 4, strokeWidth: 0, fill: '#38bdf8' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel
          title="User Growth"
          subtitle="New users grouped by month across the last six months."
          Icon={TrendingUp}
          footer={<InlineMetric label="6-month total" value={growthData.reduce((sum, item) => sum + Number(item.users || 0), 0).toLocaleString()} tone="emerald" />}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
            <BarChart data={growthData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} stroke="#94a3b8" />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} stroke="#94a3b8" />
              <Tooltip content={<AnalyticsTooltip />} />
              <Bar dataKey="users" name="Users" radius={[12, 12, 4, 4]} fill="#22c55e" />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>

      <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <BarChart3 size={14} />
        Live admin analytics refresh with the dashboard data.
      </div>
    </section>
  )
}

export default AdminAnalytics
