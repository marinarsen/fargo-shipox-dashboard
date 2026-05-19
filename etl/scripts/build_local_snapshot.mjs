import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const TEZ_JSONL = 'D:/Арсен/Codex/Tezbank-dashboard/shipox_order_export_dev_api.csv.pages.jsonl'
const TEZ_MONGO = 'D:/Арсен/Codex/Tezbank-dashboard/mongo_first_delivery_attempts_dev_api_fast_full.csv'
const ORIFLAME_CSV = 'D:/Арсен/Codex/oriflame/latest_oriflame_export.csv'
const OUT_TS = path.join(ROOT, 'src', 'data', 'generatedSnapshot.ts')
const OUT_JSON = path.join(ROOT, 'artifacts', 'dev', 'real-local-snapshot.json')

const FINAL_STATUSES = new Set(['completed', 'cancelled', 'returned_to_origin', 'Order Completed', 'Order Cancelled', 'Returned to origin'])
const RETURN_STATUSES = new Set(['returned_to_origin', 'Returned to origin'])
const FAILED_STATUSES = new Set(['delivery_failed', 'Delivery failed'])

function inc(map, key, amount = 1) {
  const k = String(key || '').trim() || 'Не определено'
  map.set(k, (map.get(k) || 0) + amount)
}

function cleanCity(value) {
  return String(value || '')
    .replace(/^\d+\s+/, '')
    .replace(/\s+WAREHOUSE$/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Tashkent$/i, 'Ташкент')
    .replace(/^Samarqand$/i, 'Самарканд')
    .replace(/^Samarkand$/i, 'Самарканд')
    .replace(/^Farg'?ona$/i, 'Фергана')
    .replace(/^Andijon$/i, 'Андижан')
    .replace(/^Buxoro$/i, 'Бухара')
    .replace(/^Qarshi$/i, 'Карши')
    .replace(/^Termiz$/i, 'Термез')
    .replace(/^Urganch$/i, 'Ургенч')
    .replace(/^Nukus$/i, 'Нукус')
    .replace(/^Namangan$/i, 'Наманган')
    .replace(/^Jizzax$/i, 'Джизак')
    .replace(/^Navoiy$/i, 'Навои')
    .replace(/^Guliston$/i, 'Гулистан')
    .replace(/^Qo'?qon$/i, 'Коканд')
    .replace(/^Chirchiq$/i, 'Чирчик')
    .replace(/^Angren$/i, 'Ангрен')
    .replace(/^Denov$/i, 'Денов')
    .replace(/^Shahrisabz$/i, 'Шахрисабз')
    .replace(/^Zarafshon$/i, 'Зарафшан')
    .replace(/^G'?ijduvon$/i, 'Гиждувон')
    .replace(/^Kattaq'?orgo'?n$/i, 'Каттакурган')
}

function cityKey(city) {
  return String(city || 'unknown').toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-')
}

function normalizeClient(name) {
  const s = String(name || '').trim()
  if (/TEZBANK/i.test(s)) return { key: 'tezbank', name: 'TEZBANK' }
  if (/HAMKORBANK/i.test(s)) return { key: 'hamkorbank', name: 'Hamkorbank' }
  if (/oriflame/i.test(s)) return { key: 'oriflame', name: 'Oriflame' }
  return { key: s.toLowerCase().replace(/[^a-z0-9]+/gi, '-') || 'unknown', name: s || 'Не определено' }
}

function flowFromCourierType(type, packageName = '') {
  const value = String(type || '').toUpperCase()
  const text = String(packageName || '').toLowerCase()
  if (value === 'DOOR_DOOR' || text.includes('двери до двери')) return { key: 'door_door', label: 'Дверь -> дверь' }
  if (value === 'OFFICE_DOOR' || text.includes('пункта') && text.includes('до двери')) return { key: 'pvz_door', label: 'ПВЗ -> дверь' }
  if (value === 'DOOR_OFFICE' || text.includes('двери до пункта')) return { key: 'door_pvz', label: 'Дверь -> ПВЗ' }
  if (value === 'OFFICE_OFFICE' || text.includes('пункта') && text.includes('до пункта')) return { key: 'pvz_pvz', label: 'ПВЗ -> ПВЗ' }
  return { key: 'unknown', label: 'Не определено' }
}

function parseDate(value) {
  if (!value) return null
  const s = String(value).replace(/^'+/, '').trim()
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
    return new Date(Number(m[3]), months[m[2]], Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0))
  }
  return null
}

function daysBetween(a, b) {
  if (!a || !b) return null
  return Math.max(0, (b.getTime() - a.getTime()) / 86400000)
}

function is2026(date) {
  return date && date.getFullYear() === 2026
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') cell += ch
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

async function readFirstAttempts(file) {
  const map = new Map()
  if (!fs.existsSync(file)) return map
  const rows = parseCsv(await fsp.readFile(file, 'utf8'))
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] || '').replace(/^'+/, '').trim()
    const dt = parseDate(rows[i][1])
    if (id && dt && !map.has(id)) map.set(id, dt)
  }
  return map
}

async function readTezOrders(firstAttempts) {
  const byId = new Map()
  const rl = readline.createInterface({ input: fs.createReadStream(TEZ_JSONL, { encoding: 'utf8' }) })
  for await (const line of rl) {
    if (!line.trim()) continue
    const page = JSON.parse(line)
    for (const order of page.list || []) {
      const id = String(order.order_number || '').trim()
      const createdAt = parseDate(order.created_date)
      if (!id || !is2026(createdAt)) continue
      const statusUpdatedAt = parseDate(order.last_status_date) || createdAt
      const old = byId.get(id)
      if (old && old.statusUpdatedAt >= statusUpdatedAt) continue
      const customer = normalizeClient(order.customer?.name)
      const flow = flowFromCourierType(order.package?.courier_type || order.logistic_type || order.type, order.package?.name)
      const pickupCity = cleanCity(order.package?.from_city || order.pick_up_warehouse?.name || order.locations?.find((x) => x.pickup)?.city)
      const deliveryCity = cleanCity(order.package?.to_city || order.destination_warehouse?.name || order.locations?.find((x) => !x.pickup)?.city)
      const firstAttemptAt = firstAttempts.get(id) || null
      byId.set(id, {
        id,
        clientKey: customer.key,
        clientName: customer.name,
        pickupCity,
        deliveryCity,
        flowKey: flow.key,
        flowLabel: flow.label,
        status: order.status || '',
        createdAt,
        statusUpdatedAt,
        firstAttemptAt,
        actualPickupAt: parseDate(order.actual_pickup_time),
        actualDeliveryAt: parseDate(order.actual_delivery_time),
        driver: order.driver?.name || '',
        pickupDriver: order.pick_up_driver?.name || '',
        source: 'Shipox API',
      })
    }
  }
  return [...byId.values()]
}

async function readOriflameOrders() {
  if (!fs.existsSync(ORIFLAME_CSV)) return []
  const rows = parseCsv(await fsp.readFile(ORIFLAME_CSV, 'utf8'))
  const out = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const id = String(row[0] || '').replace(/^'+/, '').trim()
    const createdAt = parseDate(row[2])
    if (!id || !is2026(createdAt)) continue
    const statusUpdatedAt = parseDate(row[3]) || createdAt
    out.push({
      id,
      clientKey: 'oriflame',
      clientName: 'Oriflame',
      pickupCity: cleanCity(row[6] || 'Ташкент'),
      deliveryCity: cleanCity(row[7]),
      flowKey: 'pvz_door',
      flowLabel: 'ПВЗ -> дверь',
      status: row[1] || '',
      createdAt,
      statusUpdatedAt,
      firstAttemptAt: parseDate(row[4]),
      actualPickupAt: parseDate(row[5]),
      actualDeliveryAt: null,
      driver: '',
      pickupDriver: '',
      source: 'Shipox CSV',
    })
  }
  return out
}

function statusDisplay(status) {
  const map = {
    completed: 'Доставлен',
    cancelled: 'Отменен',
    returned_to_origin: 'Возврат',
    delivery_failed: 'Delivery failed',
    unassigned: 'Order received',
    dispatched: 'Dispatched',
    in_sorting_facility: 'In sorting facility',
  }
  return map[status] || status || 'Не определено'
}

function summarize(orders) {
  const now = new Date('2026-05-17T12:00:00+05:00')
  const clients = new Map()
  const cities = new Map()
  const flows = new Map()
  const timeline = new Map()
  const sampleOrders = []
  const alerts = []

  function getClient(order) {
    if (!clients.has(order.clientKey)) {
      clients.set(order.clientKey, { key: order.clientKey, name: order.clientName, manager: order.driver || order.pickupDriver || 'Не найден в Shipox', active: 0, delivered: 0, deliveryTimeSum: 0, firstAttemptSum: 0, firstAttemptCount: 0, noAttempt2d: 0, stale: 0, tails: 0, returns: 0, failed: 0 })
    }
    return clients.get(order.clientKey)
  }

  function getCity(cityName) {
    const key = cityKey(cityName)
    if (!cities.has(key)) {
      cities.set(key, { key, name: cityName || 'Не определено', region: 'Из Shipox', manager: 'Не найден в Shipox', active: 0, pickupVolume: 0, pickupDelta: 0, deliveryVolume: 0, deliveryDelta: 0, deliveryTimeSum: 0, delivered: 0, firstAttemptSum: 0, firstAttemptCount: 0, noAttempt2d: 0, stale: 0, tails: 0, failed: 0 })
    }
    return cities.get(key)
  }

  function getFlow(order) {
    if (!flows.has(order.flowKey)) {
      flows.set(order.flowKey, { key: order.flowKey, label: order.flowLabel, shortLabel: order.flowLabel, active: 0, delivered: 0, pickupVolume: 0, pickupDelta: 0, deliveryVolume: 0, deliveryDelta: 0, deliveryTimeSum: 0, firstAttemptSum: 0, firstAttemptCount: 0, noAttempt2d: 0, stale: 0, share: 0 })
    }
    return flows.get(order.flowKey)
  }

  for (const order of orders) {
    const final = FINAL_STATUSES.has(order.status)
    const returned = RETURN_STATUSES.has(order.status)
    const failed = FAILED_STATUSES.has(order.status)
    const completed = order.status === 'completed' || order.status === 'Order Completed'
    const active = !final
    const ageDays = daysBetween(order.createdAt, now) || 0
    const stale = active && daysBetween(order.statusUpdatedAt, now) >= 2
    const noAttempt2d = active && !order.firstAttemptAt && ageDays >= 2
    const tail = active && ageDays >= 7
    const deliveryDays = completed ? daysBetween(order.createdAt, order.actualDeliveryAt || order.statusUpdatedAt) : null
    const firstAttemptDays = order.firstAttemptAt ? daysBetween(order.createdAt, order.firstAttemptAt) : null

    const client = getClient(order)
    const city = getCity(order.deliveryCity)
    const pickupCity = getCity(order.pickupCity)
    const flow = getFlow(order)
    if (order.driver && city.manager === 'Не найден в Shipox') city.manager = order.driver
    if (order.pickupDriver && pickupCity.manager === 'Не найден в Shipox') pickupCity.manager = order.pickupDriver

    for (const rec of [client, city, flow]) {
      if (active) rec.active++
      if (completed) rec.delivered++
      if (deliveryDays != null) rec.deliveryTimeSum += deliveryDays
      if (firstAttemptDays != null) {
        rec.firstAttemptSum += firstAttemptDays
        rec.firstAttemptCount++
      }
      if (noAttempt2d) rec.noAttempt2d++
      if (stale) rec.stale++
      if ('tails' in rec && tail) rec.tails++
      if ('failed' in rec && failed) rec.failed++
    }
    if (returned) client.returns++
    pickupCity.pickupVolume++
    city.deliveryVolume++
    flow.pickupVolume += order.flowLabel.startsWith('ПВЗ') || order.flowLabel.includes('ПВЗ') ? 1 : 0
    flow.deliveryVolume += order.flowLabel.includes('дверь') || order.flowLabel.includes('ПВЗ') ? 1 : 0

    const month = order.createdAt.toLocaleString('ru-RU', { month: 'short' }).replace('.', '')
    if (!timeline.has(month)) timeline.set(month, { label: month, active: 0, delivered: 0, deliveryTime: 0, firstAttemptTime: 0, deliveryTimeSum: 0, firstAttemptSum: 0, firstAttemptCount: 0 })
    const t = timeline.get(month)
    if (active) t.active++
    if (completed) t.delivered++
    if (deliveryDays != null) t.deliveryTimeSum += deliveryDays
    if (firstAttemptDays != null) {
      t.firstAttemptSum += firstAttemptDays
      t.firstAttemptCount++
    }

    if ((noAttempt2d || stale || tail || failed || returned) && sampleOrders.length < 300) {
      sampleOrders.push({
        id: order.id,
        clientKey: order.clientKey,
        clientName: order.clientName,
        cityKey: cityKey(order.deliveryCity),
        cityName: order.deliveryCity || 'Не определено',
        manager: order.driver || order.pickupDriver || 'Не найден в Shipox',
        flowKey: order.flowKey,
        flowLabel: order.flowLabel,
        status: noAttempt2d ? 'Без попытки 2+ дня' : stale ? 'Нет обновления статуса' : tail ? 'Старый хвост' : statusDisplay(order.status),
        createdAt: order.createdAt.toISOString().slice(0, 10),
        statusUpdatedAt: order.statusUpdatedAt.toISOString().slice(0, 10),
        firstAttemptAt: order.firstAttemptAt ? order.firstAttemptAt.toISOString().slice(0, 10) : '',
        ageDays: Math.round(ageDays),
        source: order.firstAttemptAt ? 'Mongo first attempt' : 'Shipox API',
      })
    }
  }

  const totalOrders = orders.length
  const finalizeRisk = (rec) => rec.noAttempt2d > 100 || rec.stale > 120 ? 'critical' : rec.noAttempt2d > 30 || rec.stale > 40 ? 'risk' : rec.active > 1000 ? 'watch' : 'ok'
  const clientsOut = [...clients.values()].map((rec) => {
    const { deliveryTimeSum, firstAttemptSum, firstAttemptCount, ...clean } = rec
    return { ...clean, deliveryTime: rec.delivered ? deliveryTimeSum / rec.delivered : 0, firstAttemptTime: firstAttemptCount ? firstAttemptSum / firstAttemptCount : 0, risk: finalizeRisk(rec) }
  })
  const citiesOut = [...cities.values()].map((rec) => {
    const { deliveryTimeSum, firstAttemptSum, firstAttemptCount, delivered, ...clean } = rec
    return { ...clean, pickupDelta: Math.round((rec.pickupVolume / Math.max(1, totalOrders)) * 100 - 4), deliveryDelta: Math.round((rec.deliveryVolume / Math.max(1, totalOrders)) * 100 - 4), deliveryTime: delivered ? deliveryTimeSum / delivered : 0, firstAttemptTime: firstAttemptCount ? firstAttemptSum / firstAttemptCount : 0, risk: finalizeRisk(rec) }
  })
  const flowsOut = [...flows.values()].map((rec) => {
    const { deliveryTimeSum, firstAttemptSum, firstAttemptCount, ...clean } = rec
    return { ...clean, share: Math.round((rec.active / Math.max(1, clientsOut.reduce((s, x) => s + x.active, 0))) * 100), pickupDelta: Math.round((rec.pickupVolume / Math.max(1, totalOrders)) * 100 - 10), deliveryDelta: Math.round((rec.deliveryVolume / Math.max(1, totalOrders)) * 100 - 10), deliveryTime: rec.delivered ? deliveryTimeSum / rec.delivered : 0, firstAttemptTime: firstAttemptCount ? firstAttemptSum / firstAttemptCount : 0, risk: finalizeRisk(rec) }
  })

  for (const city of citiesOut.sort((a, b) => b.noAttempt2d - a.noAttempt2d).slice(0, 4)) {
    alerts.push({ id: `city-${city.key}`, title: `${city.name}: ${city.noAttempt2d} без первой попытки`, detail: `Активные ${city.active}, статусы без обновления ${city.stale}. Ответственный из Shipox: ${city.manager}.`, owner: city.manager, risk: city.risk })
  }

  return {
    generatedAt: new Date().toLocaleString('ru-RU'),
    environment: 'DEV',
    sourceMode: 'pipeline',
    periodOptions: [
      { key: 'y2026', label: 'Весь 2026', rangeLabel: '01.01.2026 - 17.05.2026' },
      { key: 'last30', label: '30 дней', rangeLabel: 'последние 30 дней' },
      { key: 'last7', label: '7 дней', rangeLabel: 'последние 7 дней' },
      { key: 'may', label: 'Май 2026', rangeLabel: '01.05.2026 - 17.05.2026' },
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
    clients: clientsOut,
    cities: citiesOut,
    deliveryFlows: flowsOut,
    alerts,
    timeline: [...timeline.values()].map((x) => ({ label: x.label, active: x.active, delivered: x.delivered, deliveryTime: x.delivered ? x.deliveryTimeSum / x.delivered : 0, firstAttemptTime: x.firstAttemptCount ? x.firstAttemptSum / x.firstAttemptCount : 0 })),
    orders: sampleOrders,
  }
}

async function main() {
  const firstAttempts = await readFirstAttempts(TEZ_MONGO)
  const orders = [...await readTezOrders(firstAttempts), ...await readOriflameOrders()]
  const snapshot = summarize(orders)
  await fsp.mkdir(path.dirname(OUT_JSON), { recursive: true })
  await fsp.writeFile(OUT_JSON, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  await fsp.writeFile(OUT_TS, `import type { DashboardSnapshot } from '../types'\n\nexport const generatedSnapshot: DashboardSnapshot = ${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    orders: orders.length,
    clients: snapshot.clients.length,
    cities: snapshot.cities.length,
    flows: snapshot.deliveryFlows.length,
    drilldownOrders: snapshot.orders.length,
    out: OUT_JSON,
  }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exit(1)
})
