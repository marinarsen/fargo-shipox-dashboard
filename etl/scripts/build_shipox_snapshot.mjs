import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
loadEnv({ path: path.join(ROOT, '.env.local') })
loadEnv({ path: path.join(ROOT, '.env') })

const AUTH_URL = process.env.SHIPOX_AUTH_URL || 'https://gateway.fargo.uz/api/v1/authenticate'
const ORDERS_URL = process.env.SHIPOX_ORDERS_URL || 'https://gateway.fargo.uz/api/v2/admin/orders'
const OUT_TS = path.join(ROOT, 'src', 'data', 'generatedSnapshot.ts')
const OUT_SRC_JSON = path.join(ROOT, 'src', 'data', 'generatedSnapshot.json')
const OUT_PUBLIC_JSON = path.join(ROOT, 'public', 'generatedSnapshot.json')
const OUT_JSON = path.join(ROOT, 'artifacts', 'dev', 'shipox-snapshot.json')

const FINAL = new Set(['completed', 'issued', 'cancelled', 'cancelled_due_to_out_of_delivery_area', 'returned_to_origin', 'destroyed_on_customer_request', 'lost'])
const DELIVERED = new Set(['completed', 'issued'])
const RETURNS = new Set(['returned_to_origin', 'returning_to_origin', 'out_for_return', 'to_be_returned'])
const FAILED = new Set(['delivery_failed', 'delivery_rejected', 'recipient_mobile_no_response', 'recipient_mobile_switched_off', 'recipient_not_available', 'bad_recipient_address'])

function parseArgs(argv) {
  const options = {
    from: process.env.SNAPSHOT_FROM_SHIPOX || '2026-01-01 00:00',
    pageSize: Number(process.env.SHIPOX_PAGE_SIZE || 200),
    limitPages: Number(process.env.SHIPOX_LIMIT_PAGES || 0),
    concurrency: Number(process.env.SHIPOX_CONCURRENCY || 4),
    requestTimeoutMs: Number(process.env.SHIPOX_REQUEST_TIMEOUT_MS || 120000),
    customerId: process.env.SHIPOX_CUSTOMER_ID || '',
    pagesJsonl: '',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => String(argv[++i] || '')
    if (arg === '--from') options.from = next()
    else if (arg.startsWith('--from=')) options.from = arg.slice('--from='.length)
    else if (arg === '--page-size') options.pageSize = Number(next()) || options.pageSize
    else if (arg.startsWith('--page-size=')) options.pageSize = Number(arg.slice('--page-size='.length)) || options.pageSize
    else if (arg === '--limit-pages') options.limitPages = Number(next()) || 0
    else if (arg.startsWith('--limit-pages=')) options.limitPages = Number(arg.slice('--limit-pages='.length)) || 0
    else if (arg === '--concurrency') options.concurrency = Number(next()) || options.concurrency
    else if (arg.startsWith('--concurrency=')) options.concurrency = Number(arg.slice('--concurrency='.length)) || options.concurrency
    else if (arg === '--request-timeout-ms') options.requestTimeoutMs = Number(next()) || options.requestTimeoutMs
    else if (arg.startsWith('--request-timeout-ms=')) options.requestTimeoutMs = Number(arg.slice('--request-timeout-ms='.length)) || options.requestTimeoutMs
    else if (arg === '--customer-id') options.customerId = next()
    else if (arg.startsWith('--customer-id=')) options.customerId = arg.slice('--customer-id='.length)
    else if (arg === '--pages-jsonl') options.pagesJsonl = next()
    else if (arg.startsWith('--pages-jsonl=')) options.pagesJsonl = arg.slice('--pages-jsonl='.length)
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  options.pageSize = Math.min(Math.max(options.pageSize, 1), 200)
  options.concurrency = Math.min(Math.max(options.concurrency, 1), 8)
  options.requestTimeoutMs = Math.min(Math.max(options.requestTimeoutMs, 5000), 120000)
  return options
}

function printHelp() {
  console.log(`
Usage:
  npm run etl:shipox:snapshot -- --from "2026-01-01 00:00"
  npm run etl:shipox:snapshot -- --limit-pages 2
  npm run etl:shipox:snapshot -- --limit-pages 480 --concurrency 4 --request-timeout-ms 120000
  npm run etl:shipox:snapshot -- --pages-jsonl "../tez-export/shipox_order_export_fargo_all.pages.jsonl"

Needs .env.local with SHIPOX_USERNAME/SHIPOX_PASSWORD or SHIPOX_ID_TOKEN.
`)
}

async function requestJson(url, options = {}) {
  const attempts = options.attempts || 4
  const timeoutMs = options.timeoutMs || 60000
  const clean = { ...options }
  delete clean.attempts
  delete clean.timeoutMs
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...clean, signal: controller.signal })
      const text = await response.text()
      const json = text ? JSON.parse(text) : {}
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(json).slice(0, 600)}`)
      return json
    } catch (error) {
      lastError = error?.name === 'AbortError' ? new Error(`Timeout after ${timeoutMs} ms`) : error
      if (attempt === attempts) break
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError
}

async function getAuth() {
  if (process.env.SHIPOX_ID_TOKEN) {
    return {
      idToken: process.env.SHIPOX_ID_TOKEN,
      marketplaceId: process.env.SHIPOX_MARKETPLACE_ID || '307345429',
      source: 'token',
    }
  }
  const username = process.env.SHIPOX_USERNAME || ''
  const password = process.env.SHIPOX_PASSWORD || ''
  if (!username || !password) throw new Error('Missing SHIPOX_USERNAME/SHIPOX_PASSWORD or SHIPOX_ID_TOKEN in .env.local')
  const json = await requestJson(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, remember_me: true }),
    timeoutMs: Number(process.env.SHIPOX_AUTH_TIMEOUT_MS || 60000),
  })
  const idToken = json?.data?.id_token
  if (!idToken) throw new Error('Authentication response did not contain data.id_token')
  return {
    idToken,
    marketplaceId: json?.data?.user?.marketplace_id || process.env.SHIPOX_MARKETPLACE_ID || '307345429',
    source: 'username-password',
  }
}

function keyFrom(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '')
}

function asDate(value) {
  const date = new Date(value || '')
  return Number.isNaN(date.getTime()) ? null : date
}

function dateKey(value) {
  const date = asDate(value)
  return date ? date.toISOString().slice(0, 10) : ''
}

function daysBetween(from, to) {
  const a = asDate(from)
  const b = asDate(to)
  if (!a || !b || b < a) return 0
  return (b.getTime() - a.getTime()) / 86400000
}

function cityName(order) {
  return order?.aPackage?.toCity || order?.destination_warehouse?.name || 'Не определено'
}

function flowLabel(order) {
  return order?.aPackage?.courierType || 'Не определено'
}

function riskOf(item) {
  if (item.noAttempt2d > 100 || item.stale > 300 || item.failed > 80) return 'critical'
  if (item.noAttempt2d > 30 || item.stale > 80 || item.failed > 25) return 'risk'
  if (item.active > 200 || item.noAttempt2d > 0 || item.stale > 0 || item.returns > 0) return 'watch'
  return 'ok'
}

function emptyRoute(order, date) {
  const clientName = order?.customer?.name || 'Не определено'
  const city = cityName(order)
  const flow = flowLabel(order)
  return {
    date,
    clientKey: keyFrom(order?.customer?._id || clientName),
    clientName,
    cityKey: keyFrom(city),
    cityName: city,
    regionKey: keyFrom(city),
    regionName: city,
    manager: 'Не назначен',
    email: '',
    availabilityLagDays: 1,
    flowKey: keyFrom(flow),
    flowLabel: flow,
    active: 0,
    delivered: 0,
    cohortDelivered: 0,
    cohortReturns: 0,
    cohortDeliveryTimeSum: 0,
    pickupVolume: 0,
    deliveryVolume: 0,
    deliveryTimeSum: 0,
    firstAttemptTimeSum: 0,
    noAttempt2d: 0,
    stale: 0,
    tails: 0,
    returns: 0,
    failed: 0,
  }
}

function addOrderToRoute(route, order, snapshotDate, mode) {
  const status = String(order.status || '')
  const isFinal = FINAL.has(status)
  const isDelivered = DELIVERED.has(status)
  const isReturn = RETURNS.has(status)
  const isFailed = FAILED.has(status)
  const created = order.created_date || order.createdDate
  const updated = order.last_status_date || order.lastStatusDate
  const age = daysBetween(created, snapshotDate)
  const staleAge = daysBetween(updated, snapshotDate)
  route.deliveryVolume += 1
  route.pickupVolume += order.pick_up_warehouse?.name ? 1 : 0
  if (mode === 'cohort') {
    route.active += isFinal ? 0 : 1
    route.cohortDelivered += isDelivered ? 1 : 0
    route.cohortReturns += isReturn ? 1 : 0
    route.noAttempt2d += !isFinal && age >= 2 && Number(order.deliveryAttemptCount || 0) <= 0 ? 1 : 0
    route.stale += !isFinal && staleAge >= 2 ? 1 : 0
    route.tails += !isFinal && age >= 7 ? 1 : 0
  } else {
    route.active += !isFinal ? 1 : 0
    route.delivered += isDelivered ? 1 : 0
    route.returns += isReturn ? 1 : 0
    route.failed += isFailed ? 1 : 0
  }
  if (isDelivered) {
    const deliveryTime = daysBetween(created, updated)
    if (mode === 'cohort') route.cohortDeliveryTimeSum += deliveryTime
    else route.deliveryTimeSum += deliveryTime
  }
}

async function fetchOrders(options, auth) {
  const orders = []
  let page = 0
  let total = 0
  async function fetchPage(pageNumber) {
    const params = new URLSearchParams({
      size: String(options.pageSize),
      from_date_time: options.from,
      page: String(pageNumber),
      simple: 'false',
    })
    if (options.customerId) params.set('customer_id', options.customerId)
    const json = await requestJson(`${ORDERS_URL}?${params}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'ru',
        Authorization: `Bearer ${auth.idToken}`,
        marketplace_id: String(auth.marketplaceId || '307345429'),
      },
      timeoutMs: options.requestTimeoutMs,
    })
    const list = json?.data?.list || []
    return {
      page: pageNumber,
      list,
      total: Number(json?.data?.total || 0),
    }
  }

  while (true) {
    if (options.limitPages && page >= options.limitPages) break
    if (total && orders.length >= total) break

    const totalPages = total ? Math.ceil(total / options.pageSize) : Number.POSITIVE_INFINITY
    const targetPages = options.limitPages ? Math.min(options.limitPages, totalPages) : totalPages
    const pages = []
    for (let p = page; p < targetPages && pages.length < options.concurrency; p += 1) {
      pages.push(p)
    }
    if (!pages.length) break

    const fetched = await Promise.all(pages.map((pageNumber) => fetchPage(pageNumber)))
    fetched.sort((a, b) => a.page - b.page)
    for (const result of fetched) {
      total = Number(result.total || total || 0)
      orders.push(...result.list)
      page = result.page + 1
      console.log(`Shipox page ${result.page}: ${result.list.length}; total fetched ${orders.length}/${total || '?'}`)
      if (!result.list.length) return { orders, total, pages: page }
      if (total && orders.length >= total) return { orders, total, pages: page }
    }
  }
  return { orders, total, pages: page }
}

async function readOrdersFromPagesJsonl(filePath) {
  const text = await fsp.readFile(path.resolve(filePath), 'utf8')
  const orders = []
  let total = 0
  let pages = 0
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const page = JSON.parse(line)
    const list = page.list || []
    total = Number(page.total || total || 0)
    orders.push(...list)
    pages += 1
  }
  return { orders, total, pages }
}

function aggregateRoutes(routes, kind) {
  const map = new Map()
  for (const route of routes) {
    let key
    let labels
    if (kind === 'client') {
      key = route.clientKey
      labels = { key: route.clientKey, name: route.clientName, manager: 'Операции' }
    } else if (kind === 'city') {
      key = route.cityKey
      labels = { key: route.cityKey, name: route.cityName, region: route.regionName, manager: route.manager, email: route.email, availabilityLagDays: route.availabilityLagDays }
    } else if (kind === 'flow') {
      key = route.flowKey
      labels = { key: route.flowKey, name: route.flowLabel, label: route.flowLabel, shortLabel: route.flowLabel, manager: 'Операции' }
    } else {
      key = route.regionKey
      labels = { key: route.regionKey, name: route.regionName, manager: route.manager, email: route.email, availabilityLagDays: route.availabilityLagDays }
    }
    const item = map.get(key) || {
      ...labels,
      active: 0,
      delivered: 0,
      pickupVolume: 0,
      pickupDelta: 0,
      deliveryVolume: 0,
      deliveryDelta: 0,
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
    for (const field of ['active', 'delivered', 'cohortDelivered', 'cohortReturns', 'pickupVolume', 'deliveryVolume', 'deliveryTimeSum', 'firstAttemptTimeSum', 'cohortDeliveryTimeSum', 'noAttempt2d', 'stale', 'tails', 'returns', 'failed']) {
      item[field] += route[field] || 0
    }
    map.set(key, item)
  }
  return [...map.values()].map((item) => ({
    ...item,
    deliveryTime: item.delivered ? item.deliveryTimeSum / item.delivered : 0,
    firstAttemptTime: item.delivered ? item.firstAttemptTimeSum / item.delivered : 0,
    cohortDeliveryTime: item.cohortDelivered ? item.cohortDeliveryTimeSum / item.cohortDelivered : 0,
    share: 0,
    risk: riskOf(item),
  }))
}

function buildOrders(orders, snapshotDate) {
  return orders
    .filter((order) => !FINAL.has(String(order.status || '')) || FAILED.has(String(order.status || '')) || RETURNS.has(String(order.status || '')))
    .slice(0, 1500)
    .map((order) => {
      const clientName = order?.customer?.name || 'Не определено'
      const city = cityName(order)
      const status = String(order.status || '')
      return {
        id: String(order.order_number || order.id || ''),
        clientKey: keyFrom(order?.customer?._id || clientName),
        clientName,
        cityKey: keyFrom(city),
        cityName: city,
        manager: 'Операции',
        flowKey: keyFrom(flowLabel(order)),
        flowLabel: flowLabel(order),
        status: FINAL.has(status) ? status : daysBetween(order.created_date, snapshotDate) >= 2 ? 'Без попытки / активный' : status,
        createdAt: dateKey(order.created_date),
        statusUpdatedAt: dateKey(order.last_status_date),
        firstAttemptAt: '',
        ageDays: Math.round(daysBetween(order.created_date, snapshotDate)),
        source: 'Shipox API',
      }
    })
}

async function writeSnapshot(snapshot) {
  await fsp.mkdir(path.dirname(OUT_JSON), { recursive: true })
  await fsp.mkdir(path.dirname(OUT_SRC_JSON), { recursive: true })
  await fsp.mkdir(path.dirname(OUT_PUBLIC_JSON), { recursive: true })
  await fsp.writeFile(OUT_JSON, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  await fsp.writeFile(OUT_SRC_JSON, `${JSON.stringify(snapshot)}\n`, 'utf8')
  await fsp.writeFile(OUT_PUBLIC_JSON, `${JSON.stringify(snapshot)}\n`, 'utf8')
  await fsp.writeFile(OUT_TS, `import snapshot from './generatedSnapshot.json'\nimport type { DashboardSnapshot } from '../types'\n\nexport const generatedSnapshot = snapshot as DashboardSnapshot\n`, 'utf8')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const fetched = options.pagesJsonl
    ? await readOrdersFromPagesJsonl(options.pagesJsonl)
    : await fetchOrders(options, await getAuth())
  const snapshotDate = fetched.orders.map((order) => order.last_status_date || order.created_date).filter(Boolean).sort().at(-1) || new Date().toISOString()
  const eventRoutes = new Map()
  const cohortRouteMap = new Map()
  for (const order of fetched.orders) {
    const eventDate = dateKey(order.last_status_date || order.lastStatusDate || order.created_date || order.createdDate)
    const cohortDate = dateKey(order.created_date || order.createdDate)
    if (eventDate) {
      const base = emptyRoute(order, eventDate)
      const key = `${base.date}|${base.clientKey}|${base.cityKey}|${base.flowKey}`
      const route = eventRoutes.get(key) || base
      addOrderToRoute(route, order, snapshotDate, 'event')
      eventRoutes.set(key, route)
    }
    if (cohortDate) {
      const base = emptyRoute(order, cohortDate)
      const key = `${base.date}|${base.clientKey}|${base.cityKey}|${base.flowKey}`
      const route = cohortRouteMap.get(key) || base
      addOrderToRoute(route, order, snapshotDate, 'cohort')
      cohortRouteMap.set(key, route)
    }
  }
  const dailyRoutes = [...eventRoutes.values()]
  const cohortRoutes = [...cohortRouteMap.values()]
  const clients = aggregateRoutes(dailyRoutes, 'client').sort((a, b) => b.deliveryVolume - a.deliveryVolume).slice(0, 500)
  const cities = aggregateRoutes(dailyRoutes, 'city').sort((a, b) => b.deliveryVolume - a.deliveryVolume).slice(0, 500)
  const regions = aggregateRoutes(dailyRoutes, 'region').sort((a, b) => b.deliveryVolume - a.deliveryVolume)
  const totalActive = clients.reduce((sum, item) => sum + item.active, 0)
  const deliveryFlows = aggregateRoutes(dailyRoutes, 'flow').map((item) => ({ ...item, label: item.name, shortLabel: item.name, share: Math.round((item.active / Math.max(1, totalActive)) * 100) }))
  const alerts = regions.filter((item) => item.risk !== 'ok').slice(0, 8).map((item) => ({
    id: `region-${item.key}`,
    title: `${item.name}: ${item.noAttempt2d} без попытки 2+ дня`,
    detail: `Активные ${item.active}, без обновления ${item.stale}, возвраты ${item.returns}, failed ${item.failed}.`,
    owner: item.manager || 'Операции',
    risk: item.risk,
  }))
  const snapshot = {
    generatedAt: new Date().toLocaleString('ru-RU'),
    environment: 'DEV',
    sourceMode: 'pipeline',
    periodOptions: [
      { key: 'y2026', label: 'Весь 2026', rangeLabel: '01.01.2026 - сегодня' },
      { key: 'today', label: 'Сегодня', rangeLabel: 'Сегодня' },
      { key: 'yesterday', label: 'Вчера', rangeLabel: 'Вчера' },
      { key: 'last7', label: '7 дней', rangeLabel: 'Последние 7 дней' },
      { key: 'last30', label: '30 дней', rangeLabel: 'Последние 30 дней' },
    ],
    statusOptions: [
      { key: 'all', label: 'Все статусы' },
      { key: 'active', label: 'Только активные' },
      { key: 'no_attempt', label: 'Без попытки 2+ дня' },
      { key: 'stale', label: 'Нет обновления статуса' },
      { key: 'tails', label: 'Старые хвосты' },
      { key: 'failed', label: 'Delivery failed' },
      { key: 'returns', label: 'Возвраты' },
    ],
    kpis: [],
    clients,
    cities,
    regions,
    deliveryFlows,
    alerts,
    timeline: [],
    orders: buildOrders(fetched.orders, snapshotDate),
    dailyMetrics: [],
    dailyRoutes,
    cohortRoutes,
  }
  await writeSnapshot(snapshot)
  console.log(JSON.stringify({ ok: true, source: options.pagesJsonl ? 'shipox_pages_jsonl' : 'shipox', orders: fetched.orders.length, totalReported: fetched.total, pages: fetched.pages, routes: dailyRoutes.length, cohortRoutes: cohortRoutes.length, out: OUT_JSON }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exit(1)
})
