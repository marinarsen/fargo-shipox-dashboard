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
const CITIES_CSV_URL = process.env.CITIES_CSV_URL || 'https://docs.google.com/spreadsheets/d/13BEV_oYxVfuBytV8iJsTQnUB7VcPUeAM1MgU5RiKKoA/export?format=csv&gid=523447778'
const WAREHOUSE_MANAGERS_CSV_URL = process.env.WAREHOUSE_MANAGERS_CSV_URL || 'https://docs.google.com/spreadsheets/d/13BEV_oYxVfuBytV8iJsTQnUB7VcPUeAM1MgU5RiKKoA/export?format=csv&gid=1959131115'

const FINAL = new Set(['completed', 'issued', 'cancelled', 'cancelled_due_to_out_of_delivery_area', 'returned_to_origin', 'destroyed_on_customer_request', 'lost'])
const DELIVERED = new Set(['completed', 'issued'])
const RETURNS = new Set(['returned_to_origin', 'returning_to_origin', 'out_for_return', 'to_be_returned'])
const FAILED = new Set(['delivery_failed', 'delivery_rejected', 'recipient_mobile_no_response', 'recipient_mobile_switched_off', 'recipient_not_available', 'bad_recipient_address'])
const TASHKENT_MANAGER = 'Турабек Касимов / Марсель Харисов'
const TASHKENT_EMAIL = 'turabek.kasimov@fargo.uz marsel.kharisov@fargo.uz'
const QOQON_YANGI_BOZOR_MANAGER = 'Бахтиер Низаметдинов'
const QOQON_YANGI_BOZOR_EMAIL = 'baxtiyor.nizametdinov@fargo.uz'
const QOQON_YANGI_BOZOR_KEYS = new Set([
  'QOQONYANGIBOZOR',
  'QOQONYANGIBOZORFARGOOFFICE',
  "QO'QONYANGIBOZOR",
  "QO'QONYANGIBOZORFARGOOFFICE",
])
const TASHKENT_KEYS = new Set([
  'TOSHKENT',
  'TASHKENT',
  'MIRZOULUGBEK',
  'YUNUSOBOD',
  'SHAYXONTOHUR',
  'CHILONZOR',
  'SERGELI',
  'YASHNOBOD',
  'YAKKASAROY',
  'UCHTEPA',
  'OLMAZOR',
  'BEKTEMIR',
  'MIROBOD',
  'YANGIHAYOT',
  'TOSHKENTTUMANI',
  'ZANGIOTA',
  'QIBRAY',
])

function parseArgs(argv) {
  const options = {
    from: process.env.SNAPSHOT_FROM_SHIPOX || '2026-01-01 00:00',
    to: process.env.SNAPSHOT_TO_SHIPOX || '',
    chunkDays: Number(process.env.SHIPOX_CHUNK_DAYS || 14),
    pageSize: Number(process.env.SHIPOX_PAGE_SIZE || 200),
    limitPages: Number(process.env.SHIPOX_LIMIT_PAGES || 0),
    concurrency: Number(process.env.SHIPOX_CONCURRENCY || 4),
    requestTimeoutMs: Number(process.env.SHIPOX_REQUEST_TIMEOUT_MS || 120000),
    customerId: process.env.SHIPOX_CUSTOMER_ID || '',
    baseSnapshot: process.env.SHIPOX_BASE_SNAPSHOT || '',
    pagesJsonl: '',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => String(argv[++i] || '')
    if (arg === '--from') options.from = next()
    else if (arg.startsWith('--from=')) options.from = arg.slice('--from='.length)
    else if (arg === '--to') options.to = next()
    else if (arg.startsWith('--to=')) options.to = arg.slice('--to='.length)
    else if (arg === '--chunk-days') options.chunkDays = Number(next()) || options.chunkDays
    else if (arg.startsWith('--chunk-days=')) options.chunkDays = Number(arg.slice('--chunk-days='.length)) || options.chunkDays
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
    else if (arg === '--base-snapshot') options.baseSnapshot = next()
    else if (arg.startsWith('--base-snapshot=')) options.baseSnapshot = arg.slice('--base-snapshot='.length)
    else if (arg === '--pages-jsonl') options.pagesJsonl = next()
    else if (arg.startsWith('--pages-jsonl=')) options.pagesJsonl = arg.slice('--pages-jsonl='.length)
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  options.pageSize = Math.min(Math.max(options.pageSize, 1), 200)
  options.concurrency = Math.min(Math.max(options.concurrency, 1), 8)
  options.chunkDays = Math.min(Math.max(options.chunkDays, 1), 31)
  options.requestTimeoutMs = Math.min(Math.max(options.requestTimeoutMs, 5000), 120000)
  return options
}

function printHelp() {
  console.log(`
Usage:
  npm run etl:shipox:snapshot -- --from "2026-01-01 00:00"
  npm run etl:shipox:snapshot -- --from "2026-01-01 00:00" --to "2026-12-31 23:59" --chunk-days 14
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

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeLookup(value) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[`’ʻ]/g, "'")
    .replace(/[^A-ZА-Я0-9']/g, '')
}

function isTashkentWarehouse(value) {
  const key = normalizeLookup(value)
  if (!key) return false
  if (TASHKENT_KEYS.has(key)) return true
  return key.includes('TOSHKENT') || key.includes('TASHKENT')
}

function isQoqonYangiBozor(value) {
  const key = normalizeLookup(value)
  if (!key) return false
  return QOQON_YANGI_BOZOR_KEYS.has(key) || (key.includes('QO') && key.includes('QON') && key.includes('YANGIBOZOR'))
}

function warehouseKey(value) {
  return normalizeLookup(
    String(value || '')
      .replace(/^\s*\d+\s+/, '')
      .replace(/\bWAREHOUSE\b/gi, '')
      .replace(/\bFARGO\s+OFFICE\b/gi, '')
      .replace(/\bOFFICE\b/gi, '')
  )
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }
  row.push(cell)
  rows.push(row)
  return rows.filter((items) => items.some((item) => cleanText(item)))
}

async function fetchCsv(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`CSV fetch failed ${response.status}: ${url}`)
  return parseCsv(await response.text())
}

async function loadReferences() {
  const [cityRows, managerRows] = await Promise.all([
    fetchCsv(CITIES_CSV_URL),
    fetchCsv(WAREHOUSE_MANAGERS_CSV_URL),
  ])
  const cityToWarehouse = new Map()
  for (const row of cityRows.slice(1)) {
    const city = cleanText(row[0])
    const warehouse = cleanText(row[1])
    if (city && warehouse) cityToWarehouse.set(normalizeLookup(city), warehouse)
  }
  const warehouseManagers = new Map()
  for (const row of managerRows.slice(1)) {
    const warehouse = cleanText(row[0])
    if (!warehouse) continue
    warehouseManagers.set(warehouseKey(warehouse), {
      warehouse,
      region: cleanText(row[1]) || warehouse,
      availabilityLagDays: Number(row[2]) || 1,
      manager: cleanText(row[3]) || 'Не назначен',
      email: cleanText(row[4]),
      ccEmail: cleanText(row[5]),
      tailSlaDays: Number(row[6]) || 7,
      responseDeadlineHours: Number(row[7]) || 24,
    })
  }
  return { cityToWarehouse, warehouseManagers }
}

function formatTashkentNow() {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date())
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

function getWarehouseMeta(rawCity, references) {
  const city = cleanText(rawCity)
  const mappedWarehouse = references.cityToWarehouse.get(normalizeLookup(city))
  const warehouse = mappedWarehouse || cleanText(city.replace(/^\s*\d+\s+/, '').replace(/\bWAREHOUSE\b/gi, '')) || 'Не определено'
  if (isTashkentWarehouse(city) || isTashkentWarehouse(warehouse)) {
    return {
      city: 'TOSHKENT',
      region: 'TOSHKENT',
      manager: TASHKENT_MANAGER,
      email: TASHKENT_EMAIL,
      availabilityLagDays: 1,
    }
  }
  if (isQoqonYangiBozor(city) || isQoqonYangiBozor(warehouse)) {
    return {
      city: "QO'QON (YANGI BOZOR)",
      region: "QO'QON (YANGI BOZOR)",
      manager: QOQON_YANGI_BOZOR_MANAGER,
      email: QOQON_YANGI_BOZOR_EMAIL,
      availabilityLagDays: 1,
    }
  }
  const manager = references.warehouseManagers.get(warehouseKey(warehouse)) || references.warehouseManagers.get(normalizeLookup(warehouse))
  return {
    city: cleanText(warehouse),
    region: manager?.region || cleanText(warehouse),
    manager: manager?.manager || 'Не назначен',
    email: manager?.email || '',
    availabilityLagDays: manager?.availabilityLagDays || 1,
  }
}

function cityName(order, references) {
  const rawCity = order?.aPackage?.toCity || order?.destination_warehouse?.name || 'Не определено'
  return getWarehouseMeta(rawCity, references).city
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

function emptyRoute(order, date, references) {
  const clientName = order?.customer?.name || 'Не определено'
  const rawCity = order?.aPackage?.toCity || order?.destination_warehouse?.name || 'Не определено'
  const cityMeta = getWarehouseMeta(rawCity, references)
  const city = cityMeta.city
  const flow = flowLabel(order)
  return {
    date,
    clientKey: keyFrom(order?.customer?._id || clientName),
    clientName,
    cityKey: keyFrom(city),
    cityName: city,
    regionKey: keyFrom(cityMeta.region),
    regionName: cityMeta.region,
    manager: cityMeta.manager,
    email: cityMeta.email,
    availabilityLagDays: cityMeta.availabilityLagDays,
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

function parseShipoxDate(value) {
  const [datePart, timePart = '00:00'] = String(value).split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  return new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0))
}

function formatShipoxDate(date, endOfDay = false) {
  const pad = (value) => String(value).padStart(2, '0')
  const hours = endOfDay ? '23:59' : '00:00'
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${hours}`
}

function dateWindows(fromText, toText, chunkDays) {
  if (!toText) return [{ from: fromText, to: '' }]
  const windows = []
  let cursor = parseShipoxDate(fromText)
  const finalDate = parseShipoxDate(toText)
  while (cursor <= finalDate) {
    const end = new Date(cursor)
    end.setUTCDate(end.getUTCDate() + chunkDays - 1)
    if (end > finalDate) end.setTime(finalDate.getTime())
    windows.push({ from: formatShipoxDate(cursor), to: formatShipoxDate(end, true) })
    cursor = new Date(end)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return windows
}

async function fetchOrders(options, auth) {
  const orders = []
  let pages = 0
  let total = 0
  async function fetchPage(pageNumber, window) {
    const params = new URLSearchParams({
      size: String(options.pageSize),
      from_date_time: window.from,
      page: String(pageNumber),
      simple: 'false',
    })
    if (window.to) params.set('to_date_time', window.to)
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

  for (const window of dateWindows(options.from, options.to, options.chunkDays)) {
    let page = 0
    let windowTotal = 0
    const beforeWindow = orders.length
    console.log(`Shipox window ${window.from}${window.to ? ` - ${window.to}` : ''}`)
    while (true) {
      if (options.limitPages && pages >= options.limitPages) break
      if (windowTotal && orders.length - beforeWindow >= windowTotal) break

      const totalPages = windowTotal ? Math.ceil(windowTotal / options.pageSize) : Number.POSITIVE_INFINITY
      const targetPages = totalPages
      const pageNumbers = []
      for (let p = page; p < targetPages && pageNumbers.length < options.concurrency; p += 1) {
        pageNumbers.push(p)
      }
      if (!pageNumbers.length) break

      const fetched = await Promise.all(pageNumbers.map((pageNumber) => fetchPage(pageNumber, window)))
      fetched.sort((a, b) => a.page - b.page)
      for (const result of fetched) {
        windowTotal = Number(result.total || windowTotal || 0)
        total += result.page === 0 ? windowTotal : 0
        orders.push(...result.list)
        page = result.page + 1
        pages += 1
        console.log(`Shipox ${window.from} page ${result.page}: ${result.list.length}; window fetched ${orders.length - beforeWindow}/${windowTotal || '?'}`)
        if (!result.list.length) break
      }
      if (fetched.some((result) => !result.list.length)) break
    }
    if (options.limitPages && pages >= options.limitPages) {
      console.log(`Stopped by SHIPOX_LIMIT_PAGES=${options.limitPages}`)
      break
    }
  }
  return { orders, total, pages }
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

function buildOrders(orders, snapshotDate, references) {
  return orders
    .filter((order) => !FINAL.has(String(order.status || '')) || FAILED.has(String(order.status || '')) || RETURNS.has(String(order.status || '')))
    .slice(0, 1500)
    .map((order) => {
      const clientName = order?.customer?.name || 'Не определено'
      const city = cityName(order, references)
      const cityMeta = getWarehouseMeta(city, references)
      const status = String(order.status || '')
      return {
        id: String(order.order_number || order.id || ''),
        clientKey: keyFrom(order?.customer?._id || clientName),
        clientName,
        cityKey: keyFrom(city),
        cityName: city,
        manager: cityMeta.manager || 'Операции',
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

function dateOnly(value) {
  return String(value || '').slice(0, 10)
}

function isInsideRange(date, from, to) {
  const key = dateOnly(date)
  if (!key) return false
  return key >= from && key <= to
}

function routeKey(route) {
  return [
    route.date,
    route.clientKey,
    route.cityKey,
    route.regionKey,
    route.flowKey,
  ].join('|')
}

function mergeRoutes(baseRoutes, freshRoutes, from, to) {
  const merged = new Map()
  for (const route of Array.isArray(baseRoutes) ? baseRoutes : []) {
    if (!isInsideRange(route.date, from, to)) merged.set(routeKey(route), route)
  }
  for (const route of freshRoutes) {
    merged.set(routeKey(route), route)
  }
  return [...merged.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

function mergeOrders(baseOrders, freshOrders, from, to) {
  const merged = new Map()
  for (const order of Array.isArray(baseOrders) ? baseOrders : []) {
    const date = order.statusUpdatedAt || order.createdAt
    if (!isInsideRange(date, from, to)) merged.set(order.id, order)
  }
  for (const order of freshOrders) {
    merged.set(order.id, order)
  }
  return [...merged.values()].slice(0, 1500)
}

function dataRange(routes) {
  const dates = routes.map((route) => dateOnly(route.date)).filter(Boolean).sort()
  if (!dates.length) return null
  return { from: dates[0], to: dates.at(-1) }
}

async function readBaseSnapshot(file) {
  if (!file) return null
  try {
    const text = await fsp.readFile(file, 'utf8')
    return JSON.parse(text)
  } catch (error) {
    console.warn(`Base snapshot not used: ${error?.message || String(error)}`)
    return null
  }
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
  const references = await loadReferences()
  const baseSnapshot = await readBaseSnapshot(options.baseSnapshot)
  const snapshotDate = fetched.orders.map((order) => order.last_status_date || order.created_date).filter(Boolean).sort().at(-1) || new Date().toISOString()
  const eventRoutes = new Map()
  const cohortRouteMap = new Map()
  for (const order of fetched.orders) {
    const eventDate = dateKey(order.last_status_date || order.lastStatusDate || order.created_date || order.createdDate)
    const cohortDate = dateKey(order.created_date || order.createdDate)
    if (eventDate) {
      const base = emptyRoute(order, eventDate, references)
      const key = `${base.date}|${base.clientKey}|${base.cityKey}|${base.flowKey}`
      const route = eventRoutes.get(key) || base
      addOrderToRoute(route, order, snapshotDate, 'event')
      eventRoutes.set(key, route)
    }
    if (cohortDate) {
      const base = emptyRoute(order, cohortDate, references)
      const key = `${base.date}|${base.clientKey}|${base.cityKey}|${base.flowKey}`
      const route = cohortRouteMap.get(key) || base
      addOrderToRoute(route, order, snapshotDate, 'cohort')
      cohortRouteMap.set(key, route)
    }
  }
  const refreshFrom = dateOnly(options.from)
  const refreshTo = dateOnly(options.to || snapshotDate || new Date().toISOString())
  const freshDailyRoutes = [...eventRoutes.values()]
  const freshCohortRoutes = [...cohortRouteMap.values()]
  const freshOrders = buildOrders(fetched.orders, snapshotDate, references)
  const dailyRoutes = baseSnapshot
    ? mergeRoutes(baseSnapshot.dailyRoutes, freshDailyRoutes, refreshFrom, refreshTo)
    : freshDailyRoutes
  const cohortRoutes = baseSnapshot
    ? mergeRoutes(baseSnapshot.cohortRoutes, freshCohortRoutes, refreshFrom, refreshTo)
    : freshCohortRoutes
  const orders = baseSnapshot
    ? mergeOrders(baseSnapshot.orders, freshOrders, refreshFrom, refreshTo)
    : freshOrders
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
  const range = dataRange(dailyRoutes) || { from: refreshFrom, to: refreshTo }
  const loadedRangeLabel = `${range.from} - ${range.to}`
  const snapshot = {
    generatedAt: `${formatTashkentNow()} Asia/Tashkent`,
    environment: 'DEV',
    sourceMode: 'pipeline',
    periodOptions: [
      { key: 'y2026', label: 'Все загруженные данные', rangeLabel: loadedRangeLabel },
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
    orders,
    dailyMetrics: [],
    dailyRoutes,
    cohortRoutes,
  }
  await writeSnapshot(snapshot)
  console.log(JSON.stringify({
    ok: true,
    source: options.pagesJsonl ? 'shipox_pages_jsonl' : 'shipox',
    mode: baseSnapshot ? 'incremental-merge' : 'fresh',
    refreshFrom,
    refreshTo,
    orders: fetched.orders.length,
    totalReported: fetched.total,
    pages: fetched.pages,
    freshRoutes: freshDailyRoutes.length,
    routes: dailyRoutes.length,
    cohortRoutes: cohortRoutes.length,
    out: OUT_JSON,
  }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exit(1)
})
