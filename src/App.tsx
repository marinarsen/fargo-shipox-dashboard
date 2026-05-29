import {
  Building2,
  CalendarDays,
  Filter,
  MapPin,
  PackageCheck,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import type {
  ClientMetric,
  DailyRouteMetric,
  DashboardSnapshot,
  Kpi,
  RegionMetric,
  RiskLevel,
} from './types'

type AnalysisMode = 'events' | 'cohort'

type PieSegment = {
  key: string
  name: string
  value: number
  color: string
}

type MetricAccumulator = {
  key: string
  name: string
  manager: string
  email: string
  region: string
  availabilityLagDays: number
  active: number
  delivered: number
  pickupVolume: number
  deliveryVolume: number
  deliveryTimeSum: number
  firstAttemptTimeSum: number
  cohortDelivered: number
  cohortReturns: number
  cohortDeliveryTimeSum: number
  noAttempt2d: number
  stale: number
  tails: number
  returns: number
  failed: number
}

const riskOrder: Record<RiskLevel, number> = {
  critical: 4,
  risk: 3,
  watch: 2,
  ok: 1,
}

type StatusMetricKey = 'active' | 'noAttempt2d' | 'stale' | 'tails' | 'failed' | 'returns'

const statusMetric: Record<string, StatusMetricKey> = {
  active: 'active',
  no_attempt: 'noAttempt2d',
  stale: 'stale',
  tails: 'tails',
  failed: 'failed',
  returns: 'returns',
}

const DEFAULT_TODAY = '2026-05-25'
const pieColors = ['#1f8a5f', '#2f6fb2', '#d7a31f', '#d66a2f', '#5f7f95', '#8a63a8', '#b8c4cf']
const QUICK_WORKFLOW_URL = 'https://github.com/marinarsen/fargo-shipox-dashboard/actions/workflows/update-shipox-dashboard.yml'
const DEEP_WORKFLOW_URL = 'https://github.com/marinarsen/fargo-shipox-dashboard/actions/workflows/deep-shipox-dashboard.yml'
const TASHKENT_MANAGER = 'Турабек Касимов / Марсель Харисов'
const TASHKENT_EMAIL = 'turabek.kasimov@fargo.uz marsel.kharisov@fargo.uz'
const QOQON_YANGI_BOZOR_MANAGER = 'Бахтиер Низаметдинов'
const QOQON_YANGI_BOZOR_KEYS = new Set([
  'qo-qon-yangi-bozor',
  'qo-qon-yangibozor',
  'qoqon-yangi-bozor',
  'qoqon-yangibozor',
])
const TASHKENT_REGION_KEYS = new Set([
  'toshkent',
  'tashkent',
  'mirzo-ulug-bek',
  'yunusobod',
  'shayxontohur',
  'chilonzor',
  'sergeli',
  'yashnobod',
  'yakkasaroy',
  'uchtepa',
  'olmazor',
  'bektemir',
  'mirobod',
  'yangihayot',
  'toshkent-tumani',
  'zangiota',
  'qibray',
])

function formatNumber(value: number) {
  return Math.round(value).toLocaleString('ru-RU')
}

function formatDelta(value: number) {
  if (value > 0) return `+${value}%`
  return `${value}%`
}

function formatSignedDays(value = 0) {
  if (!value) return '0,0 дн'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1).replace('.', ',')} дн`
}

function deltaClass(value: number | undefined, positiveIsGood: boolean, enabled: boolean) {
  if (!enabled || !value) return 'delta-value delta-neutral'
  const isGood = positiveIsGood ? value > 0 : value < 0
  return `delta-value ${isGood ? 'delta-good' : 'delta-bad'}`
}

function normalizeRouteRegion(route: DailyRouteMetric): DailyRouteMetric {
  if (QOQON_YANGI_BOZOR_KEYS.has(route.regionKey) || QOQON_YANGI_BOZOR_KEYS.has(route.cityKey)) {
    return {
      ...route,
      manager: QOQON_YANGI_BOZOR_MANAGER,
    }
  }
  if (!TASHKENT_REGION_KEYS.has(route.regionKey) && !TASHKENT_REGION_KEYS.has(route.cityKey)) return route
  return {
    ...route,
    cityKey: route.cityKey && TASHKENT_REGION_KEYS.has(route.cityKey) ? 'toshkent' : route.cityKey,
    cityName: route.cityKey && TASHKENT_REGION_KEYS.has(route.cityKey) ? 'TOSHKENT' : route.cityName,
    regionKey: 'toshkent',
    regionName: 'TOSHKENT',
    manager: TASHKENT_MANAGER,
    email: TASHKENT_EMAIL,
  }
}

function kpiClass(kpi: Kpi) {
  return `kpi-card kpi-${kpi.risk}`
}

function barWidth(value: number, max: number) {
  return `${Math.max(4, Math.round((value / Math.max(1, max)) * 100))}%`
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(value: string, days: number) {
  const date = toDate(value)
  date.setUTCDate(date.getUTCDate() + days)
  return toIsoDate(date)
}

function daysBetween(from: string, to: string) {
  return Math.max(1, Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86400000) + 1)
}

function rangeLabel(from: string, to: string) {
  return `${from.split('-').reverse().join('.')} - ${to.split('-').reverse().join('.')}`
}

function normalizeRange(range: { from: string; to: string }) {
  if (range.from <= range.to) return range
  return { from: range.to, to: range.from }
}

function getPresetRange(period: string, today: string) {
  if (period === 'today') return { from: today, to: today }
  if (period === 'yesterday') return { from: addDays(today, -1), to: addDays(today, -1) }
  if (period === 'last7') return { from: addDays(today, -6), to: today }
  if (period === 'last30') return { from: addDays(today, -29), to: today }
  if (period === 'may') return { from: '2026-05-01', to: today }
  return { from: '2026-01-01', to: today }
}

function getMonthRange(month: string, today: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const from = `${month}-01`
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
  return { from, to: lastDay > today ? today : lastDay }
}

function getWeekRange(week: string, today: string) {
  const [, weekText] = week.split('-W')
  const firstThursday = new Date(Date.UTC(2026, 0, 1))
  const start = new Date(firstThursday)
  start.setUTCDate(firstThursday.getUTCDate() + (Number(weekText) - 1) * 7 - 3)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)
  return { from: toIsoDate(start), to: toIsoDate(end) > today ? today : toIsoDate(end) }
}

function routeMatchesStatus(route: DailyRouteMetric, status: string) {
  if (status === 'all') return true
  const metric = statusMetric[status]
  if (!metric) return true
  return Number(route[metric] || 0) > 0
}

function riskOf(item: Pick<MetricAccumulator, 'active' | 'noAttempt2d' | 'stale' | 'failed' | 'returns'>): RiskLevel {
  if (item.noAttempt2d > 100 || item.stale > 300 || item.failed > 80) return 'critical'
  if (item.noAttempt2d > 30 || item.stale > 80 || item.failed > 25) return 'risk'
  if (item.active > 200 || item.noAttempt2d > 0 || item.stale > 0 || item.returns > 0) return 'watch'
  return 'ok'
}

function emptyAccumulator(key: string, name: string): MetricAccumulator {
  return {
    key,
    name,
    manager: '',
    email: '',
    region: '',
    availabilityLagDays: 1,
    active: 0,
    delivered: 0,
    pickupVolume: 0,
    deliveryVolume: 0,
    deliveryTimeSum: 0,
    firstAttemptTimeSum: 0,
    cohortDelivered: 0,
    cohortReturns: 0,
    cohortDeliveryTimeSum: 0,
    noAttempt2d: 0,
    stale: 0,
    tails: 0,
    returns: 0,
    failed: 0,
  }
}

function addRoute(target: MetricAccumulator, route: DailyRouteMetric) {
  target.active += route.active
  target.delivered += route.delivered
  target.pickupVolume += route.pickupVolume
  target.deliveryVolume += route.deliveryVolume
  target.deliveryTimeSum += route.deliveryTimeSum
  target.firstAttemptTimeSum += route.firstAttemptTimeSum
  target.cohortDelivered += route.cohortDelivered || 0
  target.cohortReturns += route.cohortReturns || 0
  target.cohortDeliveryTimeSum += route.cohortDeliveryTimeSum || 0
  target.noAttempt2d += route.noAttempt2d
  target.stale += route.stale
  target.tails += route.tails
  target.returns += route.returns
  target.failed += route.failed
}

function calcDelta(current: number, previous: number) {
  if (!previous && !current) return 0
  if (!previous) return 0
  return Math.round(((current - previous) / previous) * 100)
}

function sortOtherLast<T extends { name: string }>(item: T) {
  return item.name === 'OTHER' || item.name === 'Прочие города' ? 1 : 0
}

function aggregateRoutes(
  routes: DailyRouteMetric[],
  dimension: 'client' | 'city' | 'region' | 'flow',
  previousRoutes: DailyRouteMetric[] = [],
) {
  const previousMap = new Map<string, MetricAccumulator>()
  for (const route of previousRoutes) {
    const key = dimension === 'client' ? route.clientKey : dimension === 'city' ? route.cityKey : dimension === 'region' ? route.regionKey : route.flowKey
    const name = dimension === 'client' ? route.clientName : dimension === 'city' ? route.cityName : dimension === 'region' ? route.regionName : route.flowLabel
    const row = previousMap.get(key) || emptyAccumulator(key, name)
    addRoute(row, route)
    previousMap.set(key, row)
  }

  const map = new Map<string, MetricAccumulator>()
  for (const route of routes) {
    const key = dimension === 'client' ? route.clientKey : dimension === 'city' ? route.cityKey : dimension === 'region' ? route.regionKey : route.flowKey
    const name = dimension === 'client' ? route.clientName : dimension === 'city' ? route.cityName : dimension === 'region' ? route.regionName : route.flowLabel
    const row = map.get(key) || emptyAccumulator(key, name)
    row.manager = dimension === 'client' ? '' : route.manager
    row.email = route.email
    row.region = route.regionName
    row.availabilityLagDays = route.availabilityLagDays
    addRoute(row, route)
    map.set(key, row)
  }

  return [...map.values()].map((row) => {
    const previous = previousMap.get(row.key)
    const deliveryTime = row.delivered ? row.deliveryTimeSum / row.delivered : 0
    const previousDeliveryTime = previous?.delivered ? previous.deliveryTimeSum / previous.delivered : 0
    return {
      ...row,
      pickupDelta: calcDelta(row.pickupVolume, previous?.pickupVolume || 0),
      deliveryDelta: calcDelta(row.deliveryVolume, previous?.deliveryVolume || 0),
      deliveredDelta: calcDelta(row.delivered, previous?.delivered || 0),
      deliveryTime,
      deliveryTimeDelta: previousDeliveryTime ? deliveryTime - previousDeliveryTime : 0,
      firstAttemptTime: row.delivered ? row.firstAttemptTimeSum / row.delivered : 0,
      cohortDeliveryTime: row.cohortDelivered ? row.cohortDeliveryTimeSum / row.cohortDelivered : 0,
      risk: riskOf(row),
    }
  })
}

function latestSnapshotDate(snapshot: DashboardSnapshot) {
  const dates = [
    ...(snapshot.dailyRoutes || []).map((route) => route.date),
    ...snapshot.orders.map((order) => order.createdAt.slice(0, 10)),
  ].filter(Boolean)
  return dates.sort().at(-1) || DEFAULT_TODAY
}

function buildPieGradient(segments: PieSegment[]) {
  const total = segments.reduce((sum, item) => sum + item.value, 0)
  if (!total) return '#edf2f6'
  let cursor = 0
  return `conic-gradient(${segments.map((item) => {
    const start = cursor
    cursor += (item.value / total) * 100
    return `${item.color} ${start}% ${cursor}%`
  }).join(', ')})`
}

function TopClientsPie({ segments }: { segments: PieSegment[] }) {
  const total = segments.reduce((sum, item) => sum + item.value, 0)
  return (
    <article className="panel-block pie-panel">
      <div className="section-head compact">
        <div><h2>Топ клиентов</h2><p>Доля в доставленных заказах</p></div>
        <PackageCheck size={19} />
      </div>
      <div className="pie-wrap">
        <div className="pie-chart" style={{ background: buildPieGradient(segments) }}>
          <div><strong>{formatNumber(total)}</strong><span>доставлено</span></div>
        </div>
        <div className="pie-legend">
          {segments.map((item) => (
            <div key={item.key}>
              <i style={{ background: item.color }} />
              <span>{item.name}</span>
              <strong>{Math.round((item.value / Math.max(1, total)) * 100)}%</strong>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

function isAdminView() {
  return new URLSearchParams(window.location.search).get('admin') === '1'
}

function AdminRefreshMenu() {
  return (
    <details className="admin-refresh">
      <summary>Обновить</summary>
      <div>
        <a href={QUICK_WORKFLOW_URL} target="_blank" rel="noreferrer">Быстрое 30 дней</a>
        <a href={DEEP_WORKFLOW_URL} target="_blank" rel="noreferrer">Глубокое 3 месяца</a>
      </div>
    </details>
  )
}

function DashboardApp({ snapshot }: { snapshot: DashboardSnapshot }) {
  const today = useMemo(() => latestSnapshotDate(snapshot), [snapshot])
  const showAdminControls = useMemo(() => isAdminView(), [])
  const [period, setPeriod] = useState(snapshot.periodOptions[0].key)
  const [status, setStatus] = useState(snapshot.statusOptions[0].key)
  const [client, setClient] = useState('all')
  const [clientSearch, setClientSearch] = useState('')
  const [city, setCity] = useState('all')
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('events')
  const [clientMode, setClientMode] = useState<'top' | 'all'>('top')
  const [regionMode, setRegionMode] = useState<'top' | 'all'>('top')
  const [periodMode, setPeriodMode] = useState<'preset' | 'month' | 'week' | 'range'>('preset')
  const [month, setMonth] = useState('2026-05')
  const [week, setWeek] = useState('2026-W20')
  const [dateFrom, setDateFrom] = useState('2026-05-01')
  const [dateTo, setDateTo] = useState(today)
  const currentRange = useMemo(() => {
    if (periodMode === 'month') return normalizeRange(getMonthRange(month, today))
    if (periodMode === 'week') return normalizeRange(getWeekRange(week, today))
    if (periodMode === 'range') return normalizeRange({ from: dateFrom, to: dateTo })
    return normalizeRange(getPresetRange(period, today))
  }, [dateFrom, dateTo, month, period, periodMode, today, week])

  const previousRange = useMemo(() => {
    const length = daysBetween(currentRange.from, currentRange.to)
    if (length === 1) return { from: addDays(currentRange.from, -7), to: addDays(currentRange.to, -7) }
    return { from: addDays(currentRange.from, -length), to: addDays(currentRange.from, -1) }
  }, [currentRange.from, currentRange.to])

  const allRoutes = useMemo(() => (
    analysisMode === 'cohort'
      ? snapshot.cohortRoutes || snapshot.dailyRoutes || []
      : snapshot.dailyRoutes || []
  ).map(normalizeRouteRegion), [analysisMode, snapshot.cohortRoutes, snapshot.dailyRoutes])
  const clientSearchNeedle = normalizeSearch(clientSearch)
  const routes = useMemo(() => {
    return allRoutes.filter((route) => {
      if (route.date < currentRange.from || route.date > currentRange.to) return false
      if (client !== 'all' && route.clientKey !== client) return false
      if (client === 'all' && clientSearchNeedle && !normalizeSearch(route.clientName).includes(clientSearchNeedle)) return false
      if (city !== 'all' && route.cityKey !== city) return false
      return routeMatchesStatus(route, status)
    })
  }, [allRoutes, city, client, clientSearchNeedle, currentRange.from, currentRange.to, status])

  const previousRoutes = useMemo(() => {
    return allRoutes.filter((route) => {
      if (route.date < previousRange.from || route.date > previousRange.to) return false
      if (client !== 'all' && route.clientKey !== client) return false
      if (client === 'all' && clientSearchNeedle && !normalizeSearch(route.clientName).includes(clientSearchNeedle)) return false
      if (city !== 'all' && route.cityKey !== city) return false
      return routeMatchesStatus(route, status)
    })
  }, [allRoutes, city, client, clientSearchNeedle, previousRange.from, previousRange.to, status])

  const clients = useMemo(() => {
    return aggregateRoutes(routes, 'client', previousRoutes)
      .sort((a, b) => riskOrder[b.risk] - riskOrder[a.risk] || b.active + b.delivered - (a.active + a.delivered)) as ClientMetric[]
  }, [previousRoutes, routes])

  const regions = useMemo(() => {
    return aggregateRoutes(routes, 'region', previousRoutes)
      .map((item) => ({ ...item, name: item.name === 'OTHER' ? 'Прочие города' : item.name }))
      .sort((a, b) => sortOtherLast(a) - sortOtherLast(b) || riskOrder[b.risk] - riskOrder[a.risk] || b.deliveryVolume - a.deliveryVolume) as RegionMetric[]
  }, [previousRoutes, routes])

  const clientOptions = useMemo(() => {
    const map = new Map(allRoutes.map((route) => [route.clientKey, route.clientName]))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'))
  }, [allRoutes])

  const handleClientSearch = (value: string) => {
    setClientSearch(value)
    const exact = clientOptions.find(([, name]) => normalizeSearch(name) === normalizeSearch(value))
    setClient(exact ? exact[0] : 'all')
  }

  const cityOptions = useMemo(() => {
    const map = new Map(allRoutes.map((route) => [route.cityKey, route.cityName]))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'))
  }, [allRoutes])

  const visibleClients = clientMode === 'top' ? clients.slice(0, 8) : clients
  const visibleRegions = regionMode === 'top' ? regions.slice(0, 8) : regions
  const maxRegionActive = Math.max(1, ...regions.map((item) => item.deliveryVolume))
  const isCohort = analysisMode === 'cohort'
  const showNoAttempt = clients.some((item) => item.noAttempt2d > 0)
  const showStale = clients.some((item) => item.stale > 0)
  const showTails = isCohort && clients.some((item) => item.tails > 0)

  const totalDelivered = routes.reduce((sum, item) => sum + (isCohort ? item.cohortDelivered || 0 : item.delivered), 0)
  const totalNoAttempt = routes.reduce((sum, item) => sum + item.noAttempt2d, 0)
  const totalPickup = routes.reduce((sum, item) => sum + item.pickupVolume, 0)
  const totalDelivery = routes.reduce((sum, item) => sum + item.deliveryVolume, 0)
  const totalReturns = routes.reduce((sum, item) => sum + (isCohort ? item.cohortReturns || 0 : item.returns), 0)
  const totalDeliveryTime = routes.reduce((sum, item) => sum + (isCohort ? item.cohortDeliveryTimeSum || 0 : item.deliveryTimeSum), 0)
  const avgDt = totalDelivered ? totalDeliveryTime / totalDelivered : 0
  const prevPickup = previousRoutes.reduce((sum, item) => sum + item.pickupVolume, 0)
  const prevDelivery = previousRoutes.reduce((sum, item) => sum + item.deliveryVolume, 0)
  const selectedRangeLabel = rangeLabel(currentRange.from, currentRange.to)
  const hasPreviousData = previousRoutes.length > 0
  const pickupComparison = hasPreviousData ? `к прошлому периоду ${formatDelta(calcDelta(totalPickup, prevPickup))}` : 'нет базы для сравнения'
  const deliveryComparison = hasPreviousData ? `к прошлому периоду ${formatDelta(calcDelta(totalDelivery, prevDelivery))}` : 'нет базы для сравнения'
  const deltaText = (value: number) => (hasPreviousData ? formatDelta(value) : 'без сравнения')
  const topClientPie = useMemo(() => {
    const top = [...clients].sort((a, b) => (isCohort ? b.cohortDelivered || 0 : b.delivered) - (isCohort ? a.cohortDelivered || 0 : a.delivered)).slice(0, 6)
    const topTotal = top.reduce((sum, item) => sum + (isCohort ? item.cohortDelivered || 0 : item.delivered), 0)
    const allTotal = clients.reduce((sum, item) => sum + (isCohort ? item.cohortDelivered || 0 : item.delivered), 0)
    const segments = top.map((item, index) => ({
      key: item.key,
      name: item.name,
      value: isCohort ? item.cohortDelivered || 0 : item.delivered,
      color: pieColors[index],
    })).filter((item) => item.value > 0)
    if (allTotal > topTotal) segments.push({ key: 'other', name: 'Остальные', value: allTotal - topTotal, color: pieColors[6] })
    return segments
  }, [clients, isCohort])

  const kpis: Kpi[] = [
    { key: 'created', label: isCohort ? 'Создано заказов' : 'Заказов со статусом', value: formatNumber(totalDelivery), delta: selectedRangeLabel, risk: 'ok' },
    { key: 'delivered', label: 'Доставлено', value: formatNumber(totalDelivered), delta: selectedRangeLabel, risk: 'ok' },
    { key: 'pickup', label: 'Из ПВЗ / прием', value: formatNumber(totalPickup), delta: pickupComparison, risk: 'ok' },
    { key: 'delivery', label: 'В город доставки', value: formatNumber(totalDelivery), delta: deliveryComparison, risk: 'ok' },
    { key: 'dt', label: 'Delivery time', value: `${avgDt.toFixed(1)} дн`, delta: avgDt > 4 ? 'хуже нормы' : 'в норме', risk: avgDt > 4 ? 'risk' : 'ok' },
    { key: 'attempt', label: 'До 1-й попытки', value: 'н/д', delta: 'ожидает webhook первой попытки', risk: 'watch' },
    { key: 'no_attempt', label: 'Без попытки 2+ дня', value: formatNumber(totalNoAttempt), delta: totalNoAttempt ? 'ручной контроль' : 'нет открытых сигналов', risk: totalNoAttempt > 250 ? 'critical' : 'watch' },
    { key: 'returns', label: 'Возвраты', value: formatNumber(totalReturns), delta: isCohort ? 'по созданным заказам' : 'по событиям статуса', risk: totalReturns > 500 ? 'risk' : 'watch' },
  ]

  return (
    <main className="dashboard">
      <div className="sticky-command">
        <header className="topbar">
          <div className="brand-block">
            <img className="brand-logo" src={`${import.meta.env.BASE_URL}fargo-logo-original.png`} alt="Fargo Parcel Service" />
            <div>
              <h1>Fargo / Shipox Control Tower</h1>
              <p>Операционный контроль доставки, приема, ПВЗ, городов, клиентов и ответственных менеджеров</p>
            </div>
          </div>
          <div className="topbar-meta">
            {showAdminControls && <AdminRefreshMenu />}
            <span>{snapshot.environment}</span>
            <span>обновлено {snapshot.generatedAt}</span>
          </div>
        </header>

        <section className="period-toolbar" aria-label="Период">
          <div className="period-tabs">
            <button className={periodMode === 'preset' ? 'active' : ''} type="button" onClick={() => setPeriodMode('preset')}>Пресет</button>
            <button className={periodMode === 'month' ? 'active' : ''} type="button" onClick={() => setPeriodMode('month')}>Месяц</button>
            <button className={periodMode === 'week' ? 'active' : ''} type="button" onClick={() => setPeriodMode('week')}>Неделя</button>
            <button className={periodMode === 'range' ? 'active' : ''} type="button" onClick={() => setPeriodMode('range')}>Точный отрезок</button>
          </div>
          {periodMode === 'preset' && <label><CalendarDays size={16} /><span>Период</span><select value={period} onChange={(event) => setPeriod(event.target.value)}>{snapshot.periodOptions.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label>}
          {periodMode === 'month' && <label><CalendarDays size={16} /><span>Месяц</span><input type="month" value={month} max={today.slice(0, 7)} onChange={(event) => setMonth(event.target.value)} /></label>}
          {periodMode === 'week' && <label><CalendarDays size={16} /><span>Неделя</span><input type="week" value={week} onChange={(event) => setWeek(event.target.value)} /></label>}
          {periodMode === 'range' && <><label><CalendarDays size={16} /><span>С</span><input type="date" value={dateFrom} min="2026-01-01" max={today} onChange={(event) => setDateFrom(event.target.value)} /></label><label><CalendarDays size={16} /><span>По</span><input type="date" value={dateTo} min="2026-01-01" max={today} onChange={(event) => setDateTo(event.target.value)} /></label></>}
          <button className="quick-period" type="button" onClick={() => { setPeriodMode('preset'); setPeriod('last7') }}>7 дней</button>
          <button className="quick-period" type="button" onClick={() => { setPeriodMode('preset'); setPeriod('last30') }}>30 дней</button>
          <button className="quick-period" type="button" onClick={() => { setPeriodMode('preset'); setPeriod('y2026') }}>Все</button>
        </section>

        <section className="control-strip" aria-label="Фильтры">
          <label className="client-search"><Building2 size={16} /><span>Клиент</span><input list="client-options" value={clientSearch} placeholder="Все клиенты" onChange={(event) => handleClientSearch(event.target.value)} /><datalist id="client-options">{clientOptions.map(([key, name]) => <option value={name} key={key} />)}</datalist>{clientSearch && <button type="button" onClick={() => { setClientSearch(''); setClient('all') }}>×</button>}</label>
          <label><MapPin size={16} /><span>Город</span><select value={city} onChange={(event) => setCity(event.target.value)}><option value="all">Все города</option>{cityOptions.map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></label>
          <label><Filter size={16} /><span>Статус</span><select value={status} onChange={(event) => setStatus(event.target.value)}>{snapshot.statusOptions.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label>
          <div className="range-note"><Search size={16} /><span>{selectedRangeLabel}</span></div>
        </section>
      </div>

      <section className="kpi-grid" aria-label="Главные показатели">
        {kpis.map((kpi) => (
          <article className={kpiClass(kpi)} key={kpi.key}>
            <div className="kpi-topline"><span>{kpi.label}</span></div>
            <strong>{kpi.value}</strong>
            <small>{kpi.delta}</small>
          </article>
        ))}
      </section>

      <section className="main-grid">
        <section className="work-area">
          <div className="section-head">
            <div>
              <h2>Клиенты</h2>
              <p>{isCohort ? 'Когорта: берем заказы, созданные в выбранный период, и смотрим их текущий результат.' : 'События: считаем доставки, возвраты и DT по дате финального статуса внутри периода.'}</p>
            </div>
            <div className="client-tools">
              <div className="view-toggle analysis-toggle">
                <button className={analysisMode === 'events' ? 'active' : ''} type="button" onClick={() => setAnalysisMode('events')}>События периода</button>
                <button className={analysisMode === 'cohort' ? 'active' : ''} type="button" onClick={() => setAnalysisMode('cohort')}>Когорта созданных</button>
              </div>
              <div className="view-toggle">
                <button className={clientMode === 'top' ? 'active' : ''} type="button" onClick={() => setClientMode('top')}>Топ</button>
                <button className={clientMode === 'all' ? 'active' : ''} type="button" onClick={() => setClientMode('all')}>Все</button>
              </div>
            </div>
          </div>

          <div className="clients-layout">
            <div className="table-shell client-table-shell">
              <table className="smart-table clients-table">
                <thead>
                  <tr>
                    <th>Клиент</th><th>{isCohort ? 'Создано' : 'Статусов'}</th><th>Доставлено</th><th>DT</th>{isCohort && <th>Доля</th>}{showNoAttempt && <th>Нет попытки</th>}{showStale && <th>Нет статуса</th>}{showTails && <th>Хвосты</th>}<th>Возвраты</th><th>Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleClients.map((item) => (
                    <tr key={item.key}>
                      <td><span className="row-label">{item.name}</span></td>
                      <td>{formatNumber(item.deliveryVolume || 0)}</td>
                      <td>{formatNumber(isCohort ? item.cohortDelivered || 0 : item.delivered)}</td>
                      <td>{(isCohort ? item.cohortDeliveryTime || 0 : item.deliveryTime).toFixed(1)}</td>
                      {isCohort && <td>{`${Math.round(((item.cohortDelivered || 0) / Math.max(1, item.deliveryVolume || 0)) * 1000) / 10}%`}</td>}
                      {showNoAttempt && <td>{formatNumber(item.noAttempt2d)}</td>}
                      {showStale && <td>{formatNumber(item.stale)}</td>}
                      {showTails && <td>{formatNumber(item.tails)}</td>}
                      <td>{formatNumber(isCohort ? item.cohortReturns || 0 : item.returns)}</td><td>{formatNumber(item.failed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TopClientsPie segments={topClientPie} />
          </div>

          <article className="panel-block region-panel">
            <div className="section-head compact">
              <div>
                <h2>Регионы</h2>
                <p>Объемы из Shipox API, DT сейчас по созданию и финальному статусу. Для одного дня сравниваем с тем же днем прошлой недели.</p>
              </div>
              <div className="view-toggle small">
                <button className={regionMode === 'top' ? 'active' : ''} type="button" onClick={() => setRegionMode('top')}>Топ</button>
                <button className={regionMode === 'all' ? 'active' : ''} type="button" onClick={() => setRegionMode('all')}>Все</button>
              </div>
            </div>
            <div className="table-shell region-table-shell">
              <table className="smart-table region-table">
                <thead>
                  <tr>
                    <th>Регион</th>
                    <th>Ответственные</th>
                    <th>На доставку</th>
                    <th>Доставлено</th>
                    <th>DT</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRegions.map((item) => (
                    <tr key={item.key}>
                      <td>
                        <span className="row-label">{item.name}</span>
                        <div className="region-bar"><span style={{ width: barWidth(item.deliveryVolume, maxRegionActive) }} /></div>
                      </td>
                      <td>{item.manager || 'Не назначен'}</td>
                      <td><strong>{formatNumber(item.deliveryVolume)}</strong><small className={deltaClass(item.deliveryDelta, true, hasPreviousData)}>{deltaText(item.deliveryDelta)}</small></td>
                      <td><strong>{formatNumber(item.delivered)}</strong><small className={deltaClass(item.deliveredDelta, true, hasPreviousData)}>{deltaText(item.deliveredDelta || 0)}</small></td>
                      <td><strong>{item.deliveryTime.toFixed(1)}</strong><small className={deltaClass(item.deliveryTimeDelta, false, hasPreviousData)}>{formatSignedDays(item.deliveryTimeDelta)}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      </section>
    </main>
  )
}

function App() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)

  useEffect(() => {
    let mounted = true
    fetch(`${import.meta.env.BASE_URL}generatedSnapshot.json?v=${Date.now()}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((data: DashboardSnapshot) => {
        if (mounted) setSnapshot(data)
      })
      .catch(() => {
        if (mounted) setSnapshot(null)
      })
    return () => {
      mounted = false
    }
  }, [])

  if (!snapshot) {
    return (
      <main className="dashboard loading-screen">
        <section className="detail-card">
          <h1>Fargo / Shipox Control Tower</h1>
          <p>Загружаю snapshot Shipox...</p>
        </section>
      </main>
    )
  }

  return <DashboardApp snapshot={snapshot} />
}

export default App
