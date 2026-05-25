import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
loadEnv({ path: path.join(ROOT, '.env.local') })
loadEnv({ path: path.join(ROOT, '.env') })

const AUTH_URL = process.env.SHIPOX_AUTH_URL || 'https://gateway.fargo.uz/api/v1/authenticate'
const ORDERS_URL = process.env.SHIPOX_ORDERS_URL || 'https://gateway.fargo.uz/api/v2/admin/orders'
const OUT_DIR = path.join(ROOT, 'artifacts', 'shipox-probe')

function parseArgs(argv) {
  const options = {
    from: process.env.SHIPOX_PROBE_FROM || '2026-01-01 00:00',
    pageSize: Number(process.env.SHIPOX_PROBE_PAGE_SIZE || 20),
    page: Number(process.env.SHIPOX_PROBE_PAGE || 0),
    customerId: process.env.SHIPOX_CUSTOMER_ID || '',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => String(argv[++i] || '')
    if (arg === '--from') options.from = next()
    else if (arg.startsWith('--from=')) options.from = arg.slice('--from='.length)
    else if (arg === '--page-size') options.pageSize = Number(next()) || options.pageSize
    else if (arg.startsWith('--page-size=')) options.pageSize = Number(arg.slice('--page-size='.length)) || options.pageSize
    else if (arg === '--page') options.page = Number(next()) || 0
    else if (arg.startsWith('--page=')) options.page = Number(arg.slice('--page='.length)) || 0
    else if (arg === '--customer-id') options.customerId = next()
    else if (arg.startsWith('--customer-id=')) options.customerId = arg.slice('--customer-id='.length)
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  options.pageSize = Math.min(Math.max(options.pageSize, 1), 200)
  return options
}

function printHelp() {
  console.log(`
Usage:
  node etl/scripts/probe_shipox_orders.mjs --page-size 5
  node etl/scripts/probe_shipox_orders.mjs --from "2026-05-01 00:00"
  node etl/scripts/probe_shipox_orders.mjs --customer-id 123 --page-size 20

Credentials:
  Put values into .env.local:
    SHIPOX_USERNAME=...
    SHIPOX_PASSWORD=...

  or:
    SHIPOX_ID_TOKEN=...
    SHIPOX_MARKETPLACE_ID=...
`)
}

async function requestJson(url, options = {}) {
  const attempts = options.attempts || 3
  const timeoutMs = options.timeoutMs || 45000
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
      let json
      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        throw new Error(`Non-JSON response: ${text.slice(0, 300)}`)
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${JSON.stringify(json).slice(0, 600)}`)
      }
      return json
    } catch (error) {
      lastError = error?.name === 'AbortError' ? new Error(`Timeout after ${timeoutMs} ms`) : error
      if (attempt === attempts) break
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
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
      source: 'SHIPOX_ID_TOKEN',
    }
  }

  const username = process.env.SHIPOX_USERNAME || ''
  const password = process.env.SHIPOX_PASSWORD || ''
  if (!username || !password) {
    throw new Error('Missing Shipox credentials. Fill .env.local with SHIPOX_USERNAME/SHIPOX_PASSWORD or SHIPOX_ID_TOKEN.')
  }

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
    source: 'SHIPOX_USERNAME/SHIPOX_PASSWORD',
  }
}

function pick(order, pathText) {
  return pathText.split('.').reduce((value, key) => (value == null ? undefined : value[key]), order)
}

function summarize(order) {
  return {
    order_number: pick(order, 'order_number'),
    status: pick(order, 'status'),
    created_date: pick(order, 'created_date'),
    last_status_date: pick(order, 'last_status_date'),
    pick_up_warehouse_name: pick(order, 'pick_up_warehouse.name'),
    customer_name: pick(order, 'customer.name'),
    from_city: pick(order, 'aPackage.fromCity'),
    to_city: pick(order, 'aPackage.toCity'),
    courier_type: pick(order, 'aPackage.courierType'),
    delivery_attempt_count: pick(order, 'deliveryAttemptCount'),
  }
}

function collectPaths(value, prefix = '', out = new Set()) {
  if (!value || typeof value !== 'object') return out
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key
    out.add(next)
    if (child && typeof child === 'object' && !Array.isArray(child)) collectPaths(child, next, out)
  }
  return out
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const auth = await getAuth()
  const params = new URLSearchParams({
    size: String(options.pageSize),
    page: String(options.page),
    simple: 'false',
    from_date_time: options.from,
  })
  if (options.customerId) params.set('customer_id', options.customerId)

  const json = await requestJson(`${ORDERS_URL}?${params}`, {
    headers: {
      Authorization: `Bearer ${auth.idToken}`,
      Accept: 'application/json',
      'Accept-Language': 'ru',
      marketplace_id: String(auth.marketplaceId || ''),
    },
    timeoutMs: Number(process.env.SHIPOX_REQUEST_TIMEOUT_MS || 60000),
  })

  const list = json?.data?.list || []
  const first = list[0] || {}
  const paths = [...collectPaths(first)].sort()
  const summary = {
    ok: true,
    authSource: auth.source,
    marketplaceIdPresent: Boolean(auth.marketplaceId),
    totalReported: Number(json?.data?.total || 0),
    rowsReturned: list.length,
    from: options.from,
    page: options.page,
    pageSize: options.pageSize,
    customerId: options.customerId || null,
    sampleFields: list.slice(0, 5).map(summarize),
    availablePathsInFirstOrder: paths,
  }

  await fs.mkdir(OUT_DIR, { recursive: true })
  const outFile = path.join(OUT_DIR, 'latest-probe.json')
  await fs.writeFile(outFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...summary, availablePathsInFirstOrder: `${paths.length} paths`, outFile }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exit(1)
})
