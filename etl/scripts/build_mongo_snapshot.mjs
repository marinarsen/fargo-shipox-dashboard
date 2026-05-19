import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoClient } from 'mongodb'
import 'dotenv/config'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_TS = path.join(ROOT, 'src', 'data', 'generatedSnapshot.ts')
const OUT_SRC_JSON = path.join(ROOT, 'src', 'data', 'generatedSnapshot.json')
const OUT_PUBLIC_JSON = path.join(ROOT, 'public', 'generatedSnapshot.json')
const OUT_JSON = path.join(ROOT, 'artifacts', 'dev', 'mongo-snapshot-2026.json')
const DB_NAME = process.env.MONGODB_DB || 'zood'
const ORDERS_COLLECTION = process.env.MONGODB_ORDERS_COLLECTION || 'shipoxorders'
const FROM = process.env.SNAPSHOT_FROM || '2026-01-01T00:00:00.000Z'
const TO = process.env.SNAPSHOT_TO || '2026-05-19T00:00:00.000Z'

const FINAL = ['completed', 'cancelled', 'cancelled_due_to_out_of_delivery_area', 'returned_to_origin', 'issued', 'destroyed_on_customer_request']
const DELIVERED = ['completed', 'issued']

const REGION_MANAGERS = [
  { key: 'TOSHKENT', cities: ['Tashkent', 'Toshkent tumani', 'Zangiota', 'Qibray'], lag: 1, manager: 'Турабек Касимов / Марсель Харисов', email: 'turabek.kasimov@fargo.uz / marsel.kharisov@fargo.uz' },
  { key: 'NUKUS', cities: ['Nukus', 'Beruniy'], lag: 2, manager: 'Ислом Юсупов', email: 'islom.yusupov@fargo.uz' },
  { key: 'URGANCH', cities: ['Urganch', 'Urganch shahri'], lag: 2, manager: 'Ислом Юсупов', email: 'islom.yusupov@fargo.uz' },
  { key: 'BUXORO', cities: ['Buxoro'], lag: 1, manager: 'Нигора Усмонова', email: 'nigora.ulugberdiyeva@fargo.uz' },
  { key: "G'IJDUVON", cities: ["G'ijduvon"], lag: 1, manager: 'Нигора Усмонова', email: 'nigora.ulugberdiyeva@fargo.uz' },
  { key: 'NAVOIY', cities: ['Navoiy', 'Karmana'], lag: 1, manager: 'Нигора Усмонова', email: 'nigora.ulugberdiyeva@fargo.uz' },
  { key: 'ZARAFSHON', cities: ['Zarafshan'], lag: 1, manager: 'Нигора Усмонова', email: 'nigora.ulugberdiyeva@fargo.uz' },
  { key: 'SAMARQAND', cities: ['Samarqand', 'Samarkand'], lag: 1, manager: 'Зафар Жахонгиров', email: 'zafar.jaxongirov@fargo.uz' },
  { key: 'QARSHI', cities: ['Qarshi', "G'uzor", 'Koson'], lag: 1, manager: 'Зафар Маматкулов', email: 'zafar.mamatqulov@fargo.uz' },
  { key: 'SHAHRISABZ', cities: ['Shahrisabz'], lag: 1, manager: 'Зафар Маматкулов', email: 'zafar.mamatqulov@fargo.uz' },
  { key: 'TERMIZ', cities: ['Termiz', 'Denov'], lag: 2, manager: 'Зафар Маматкулов', email: 'zafar.mamatqulov@fargo.uz' },
  { key: 'DENOV', cities: ['Denov'], lag: 2, manager: 'Зафар Маматкулов', email: 'zafar.mamatqulov@fargo.uz' },
  { key: 'JIZZAX', cities: ['Jizzax'], lag: 1, manager: 'Зафар Маматкулов', email: 'zafar.mamatqulov@fargo.uz' },
  { key: 'GULISTON', cities: ['Guliston'], lag: 1, manager: 'Зафар Маматкулов', email: 'zafar.mamatqulov@fargo.uz' },
  { key: 'CHIRCHIQ', cities: ['Chirchiq'], lag: 1, manager: 'Зафар Маматкулов', email: 'zafar.mamatqulov@fargo.uz' },
  { key: 'ANGREN', cities: ['Angren', 'Olmaliq'], lag: 1, manager: 'Зафар Маматкулов', email: 'zafar.mamatqulov@fargo.uz' },
  { key: 'NAMANGAN', cities: ['Namangan', 'Namangan shahri'], lag: 1, manager: 'Бахтиер Низаметдинов', email: 'baxtiyor.nizametdinov@fargo.uz' },
  { key: 'ANDIJON', cities: ['Andijon'], lag: 1, manager: 'Бахтиер Низаметдинов', email: 'baxtiyor.nizametdinov@fargo.uz' },
  { key: "FARG'ONA", cities: ["Farg'ona", 'Fargona', "Qo'qon", 'Qoqon', "Qo'shtepa tumani", "Farg'ona tumani"], lag: 1, manager: 'Бахтиер Низаметдинов', email: 'baxtiyor.nizametdinov@fargo.uz' },
  { key: "QO'QON", cities: ["Qo'qon", 'Qoqon'], lag: 1, manager: 'Бахтиер Низаметдинов', email: 'baxtiyor.nizametdinov@fargo.uz' },
  { key: "KATTAQO'RG'ON", cities: ["Kattaqo'rg'on"], lag: 1, manager: 'Нигора Усмонова', email: 'nigora.ulugberdiyeva@fargo.uz' },
]

const CITY_TO_REGION = new Map()
for (const region of REGION_MANAGERS) {
  for (const city of region.cities) CITY_TO_REGION.set(cleanCity(city), region)
}

function keyFrom(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '')
}

function cleanCity(value) {
  const raw = String(value || '')
    .replace(/^\d+\s+/, '')
    .replace(/\s+WAREHOUSE$/i, '')
    .trim()
  const map = new Map([
    ['Tashkent', 'Ташкент'], ['Toshkent tumani', 'Ташкентский район'], ['Zangiota', 'Зангиота'], ['Qibray', 'Кибрай'],
    ['Samarqand', 'Самарканд'], ['Samarkand', 'Самарканд'], ["Farg'ona", 'Фергана'], ['Fargona', 'Фергана'],
    ["Farg'ona tumani", 'Ферганский район'], ["Qo'shtepa tumani", 'Куштепа'], ['Andijon', 'Андижан'],
    ['Buxoro', 'Бухара'], ['Qarshi', 'Карши'], ['Koson', 'Касан'], ["G'uzor", 'Гузар'], ['Termiz', 'Термез'],
    ['Urganch', 'Ургенч'], ['Urganch shahri', 'Ургенч'], ['Nukus', 'Нукус'], ['Beruniy', 'Беруни'],
    ['Namangan', 'Наманган'], ['Namangan shahri', 'Наманган'], ['Jizzax', 'Джизак'], ['Navoiy', 'Навои'],
    ['Karmana', 'Кармана'], ['Guliston', 'Гулистан'], ["Qo'qon", 'Коканд'], ['Qoqon', 'Коканд'],
    ['Chirchiq', 'Чирчик'], ['Angren', 'Ангрен'], ['Olmaliq', 'Алмалык'], ['Denov', 'Денов'],
    ['Shahrisabz', 'Шахрисабз'], ['Zarafshan', 'Зарафшан'], ["G'ijduvon", 'Гиждуван'],
    ["Kattaqo'rg'on", 'Каттакурган'],
  ])
  return map.get(raw) || raw || 'Не определено'
}

function regionForCity(city) {
  return CITY_TO_REGION.get(cleanCity(city)) || {
    key: 'Прочие города',
    lag: 1,
    manager: 'Не назначен',
    email: '',
  }
}

function flowLabel(courierType) {
  const map = {
    OFFICE_DOOR: 'ПВЗ -> дверь',
    DOOR_DOOR: 'Дверь -> дверь',
    OFFICE_OFFICE: 'ПВЗ -> ПВЗ',
    DOOR_OFFICE: 'Дверь -> ПВЗ',
    CITY: 'Городская доставка',
    RETURN_DOOR: 'Возврат -> дверь',
    RETURN_OFFICE: 'Возврат -> ПВЗ',
  }
  return map[courierType] || courierType || 'Не определено'
}

function riskOf(x) {
  if (x.noAttempt2d > 100 || x.stale > 300 || x.failed > 80) return 'critical'
  if (x.noAttempt2d > 30 || x.stale > 80 || x.failed > 25) return 'risk'
  if (x.active > 200 || x.noAttempt2d > 0 || x.stale > 0 || x.returns > 0) return 'watch'
  return 'ok'
}

function roundMetric(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function addFields() {
  const toDate = new Date(TO)
  const twoDaysAgo = new Date(toDate.getTime() - 2 * 86400000)
  const sevenDaysAgo = new Date(toDate.getTime() - 7 * 86400000)
  return {
    createdAt: { $toDate: '$createdDate' },
    updatedAt: { $toDate: '$lastStatusDate' },
    day: { $substr: ['$createdDate', 0, 10] },
    isFinal: { $in: ['$status', FINAL] },
    isDelivered: { $in: ['$status', DELIVERED] },
    isReturn: { $in: ['$status', ['returned_to_origin', 'returning_to_origin', 'out_for_return', 'to_be_returned']] },
    isFailed: { $in: ['$status', ['delivery_failed', 'delivery_rejected', 'recipient_mobile_no_response', 'recipient_mobile_switched_off', 'recipient_not_available', 'bad_recipient_address']] },
    noAttempt2dFlag: { $and: [{ $not: [{ $in: ['$status', FINAL] }] }, { $lte: [{ $toDate: '$createdDate' }, twoDaysAgo] }, { $lte: [{ $ifNull: ['$deliveryAttemptCount', 0] }, 0] }] },
    staleFlag: { $and: [{ $not: [{ $in: ['$status', FINAL] }] }, { $lte: [{ $toDate: '$lastStatusDate' }, twoDaysAgo] }] },
    tailFlag: { $and: [{ $not: [{ $in: ['$status', FINAL] }] }, { $lte: [{ $toDate: '$createdDate' }, sevenDaysAgo] }] },
  }
}

function metricGroup(extra = {}) {
  return {
    ...extra,
    active: { $sum: { $cond: ['$isFinal', 0, 1] } },
    delivered: { $sum: { $cond: ['$isDelivered', 1, 0] } },
    deliveryTimeSum: { $sum: { $cond: ['$isDelivered', { $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 86400000] }, 0] } },
    firstAttemptTimeSum: { $sum: 0 },
    noAttempt2d: { $sum: { $cond: ['$noAttempt2dFlag', 1, 0] } },
    stale: { $sum: { $cond: ['$staleFlag', 1, 0] } },
    tails: { $sum: { $cond: ['$tailFlag', 1, 0] } },
    returns: { $sum: { $cond: ['$isReturn', 1, 0] } },
    failed: { $sum: { $cond: ['$isFailed', 1, 0] } },
  }
}

function toDaily(row, kind) {
  const base = {
    date: row._id.day,
    kind,
    key: '',
    name: '',
    manager: '',
    active: row.active || 0,
    delivered: row.delivered || 0,
    pickupVolume: row.pickupVolume || 0,
    deliveryVolume: row.deliveryVolume || 0,
    deliveryTimeSum: roundMetric(row.deliveryTimeSum),
    firstAttemptTimeSum: roundMetric(row.firstAttemptTimeSum),
    noAttempt2d: row.noAttempt2d || 0,
    stale: row.stale || 0,
    tails: row.tails || 0,
    returns: row.returns || 0,
    failed: row.failed || 0,
  }
  if (kind === 'client') {
    base.key = keyFrom(row._id.id || row._id.name)
    base.name = row._id.name || 'Не определено'
    base.manager = 'Менеджеры не делаем по клиентам'
  }
  if (kind === 'city') {
    const city = cleanCity(row._id.name)
    const region = regionForCity(row._id.name)
    base.key = keyFrom(city)
    base.name = city
    base.region = region.key
    base.manager = region.manager
    base.email = region.email
    base.availabilityLagDays = region.lag
  }
  if (kind === 'region') {
    const region = regionForCity(row._id.name)
    base.key = keyFrom(region.key)
    base.name = region.key
    base.manager = region.manager
    base.email = region.email
    base.availabilityLagDays = region.lag
  }
  if (kind === 'flow') {
    const label = flowLabel(row._id.name)
    base.key = keyFrom(label)
    base.name = label
    base.manager = 'Операции'
  }
  return base
}

function rollup(rows, kind) {
  const map = new Map()
  for (const row of rows.filter((item) => item.kind === kind)) {
    const current = map.get(row.key) || { ...row, date: '', deliveryTimeSum: 0, firstAttemptTimeSum: 0, pickupVolume: 0, deliveryVolume: 0, active: 0, delivered: 0, noAttempt2d: 0, stale: 0, tails: 0, returns: 0, failed: 0 }
    for (const field of ['active', 'delivered', 'pickupVolume', 'deliveryVolume', 'deliveryTimeSum', 'firstAttemptTimeSum', 'noAttempt2d', 'stale', 'tails', 'returns', 'failed']) current[field] += row[field] || 0
    map.set(row.key, current)
  }
  return [...map.values()]
}

function finalizeMetric(row) {
  const out = {
    key: row.key,
    name: row.name,
    manager: row.manager,
    email: row.email || '',
    region: row.region || '',
    availabilityLagDays: row.availabilityLagDays || 1,
    active: row.active || 0,
    delivered: row.delivered || 0,
    pickupVolume: row.pickupVolume || 0,
    pickupDelta: 0,
    deliveryVolume: row.deliveryVolume || 0,
    deliveryDelta: 0,
    deliveryTime: row.delivered ? row.deliveryTimeSum / row.delivered : 0,
    firstAttemptTime: row.delivered ? row.firstAttemptTimeSum / row.delivered : 0,
    noAttempt2d: row.noAttempt2d || 0,
    stale: row.stale || 0,
    tails: row.tails || 0,
    returns: row.returns || 0,
    failed: row.failed || 0,
    risk: 'ok',
  }
  out.risk = riskOf(out)
  return out
}

function finalizeFlow(row, totalActive) {
  const metric = finalizeMetric(row)
  return { ...metric, label: metric.name, shortLabel: metric.name, share: Math.round((metric.active / Math.max(1, totalActive)) * 100) }
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required')
  const client = new MongoClient(process.env.MONGODB_URI, {
    appName: 'fargo-shipox-dashboard-mongo-aggregate',
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 240000,
  })
  await client.connect()
  const col = client.db(DB_NAME).collection(ORDERS_COLLECTION)
  const match = { createdDate: { $gte: FROM, $lt: TO } }
  const add = { $addFields: addFields() }

  const [clientRows, cityRows, pickupRows, flowRows, routeCreatedRows, routeFinalRows, drilldownRows, timelineRows] = await Promise.all([
    col.aggregate([
      { $match: match }, add,
      { $group: { _id: { day: '$day', id: '$customer._id', name: '$customer.name' }, ...metricGroup({ deliveryVolume: { $sum: 1 }, pickupVolume: { $sum: 0 } }) } },
    ], { allowDiskUse: true, maxTimeMS: 180000 }).toArray(),
    col.aggregate([
      { $match: match }, add,
      { $group: { _id: { day: '$day', name: '$aPackage.toCity' }, ...metricGroup({ deliveryVolume: { $sum: 1 }, pickupVolume: { $sum: 0 } }) } },
    ], { allowDiskUse: true, maxTimeMS: 180000 }).toArray(),
    col.aggregate([
      { $match: match }, add,
      { $group: { _id: { day: '$day', name: '$aPackage.fromCity' }, pickupVolume: { $sum: 1 } } },
    ], { allowDiskUse: true, maxTimeMS: 180000 }).toArray(),
    col.aggregate([
      { $match: match }, add,
      { $group: { _id: { day: '$day', name: '$aPackage.courierType' }, ...metricGroup({ deliveryVolume: { $sum: 1 }, pickupVolume: { $sum: { $cond: [{ $in: ['$aPackage.courierType', ['OFFICE_DOOR', 'OFFICE_OFFICE', 'OFFICE_POSTAMAT']] }, 1, 0] } } }) } },
    ], { allowDiskUse: true, maxTimeMS: 180000 }).toArray(),
    col.aggregate([
      { $match: match }, add,
      { $group: {
        _id: { day: '$day', clientId: '$customer._id', clientName: '$customer.name', city: '$aPackage.toCity', courierType: '$aPackage.courierType' },
        active: { $sum: { $cond: ['$isFinal', 0, 1] } },
        cohortDelivered: { $sum: { $cond: ['$isDelivered', 1, 0] } },
        cohortReturns: { $sum: { $cond: ['$isReturn', 1, 0] } },
        cohortDeliveryTimeSum: { $sum: { $cond: ['$isDelivered', { $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 86400000] }, 0] } },
        deliveryVolume: { $sum: 1 },
        pickupVolume: { $sum: { $cond: [{ $in: ['$aPackage.courierType', ['OFFICE_DOOR', 'OFFICE_OFFICE', 'OFFICE_POSTAMAT']] }, 1, 0] } },
        noAttempt2d: { $sum: { $cond: ['$noAttempt2dFlag', 1, 0] } },
        stale: { $sum: { $cond: ['$staleFlag', 1, 0] } },
        tails: { $sum: { $cond: ['$tailFlag', 1, 0] } },
      } },
    ], { allowDiskUse: true, maxTimeMS: 180000 }).toArray(),
    col.aggregate([
      { $match: { lastStatusDate: { $gte: FROM, $lt: TO } } }, add,
      { $group: {
        _id: { day: { $substr: ['$lastStatusDate', 0, 10] }, clientId: '$customer._id', clientName: '$customer.name', city: '$aPackage.toCity', courierType: '$aPackage.courierType' },
        delivered: { $sum: { $cond: ['$isDelivered', 1, 0] } },
        returns: { $sum: { $cond: ['$isReturn', 1, 0] } },
        failed: { $sum: { $cond: ['$isFailed', 1, 0] } },
        deliveryTimeSum: { $sum: { $cond: ['$isDelivered', { $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 86400000] }, 0] } },
      } },
    ], { allowDiskUse: true, maxTimeMS: 180000 }).toArray(),
    col.aggregate([
      { $match: match }, add,
      { $match: { $or: [{ isFailed: true }, { isReturn: true }, { isFinal: false }] } },
      { $sort: { lastStatusDate: 1 } },
      { $limit: 1500 },
      { $project: { _id: 0, orderNumber: 1, status: 1, createdDate: 1, lastStatusDate: 1, customer: 1, toCity: '$aPackage.toCity', courierType: '$aPackage.courierType', deliveryAttemptCount: 1 } },
    ], { allowDiskUse: true, maxTimeMS: 180000 }).toArray(),
    col.aggregate([
      { $match: match }, add,
      { $group: { _id: { $substr: ['$createdDate', 5, 2] }, active: { $sum: { $cond: ['$isFinal', 0, 1] } }, delivered: { $sum: { $cond: ['$isDelivered', 1, 0] } }, deliveryTimeSum: { $sum: { $cond: ['$isDelivered', { $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 86400000] }, 0] } } } },
      { $sort: { _id: 1 } },
    ], { allowDiskUse: true, maxTimeMS: 180000 }).toArray(),
  ])

  const pickupByDayCity = new Map(pickupRows.map((row) => [`${row._id.day}|${keyFrom(cleanCity(row._id.name))}`, row.pickupVolume || 0]))
  const dailyClients = clientRows.map((row) => toDaily(row, 'client'))
  const dailyCities = cityRows.map((row) => {
    const item = toDaily(row, 'city')
    item.pickupVolume = pickupByDayCity.get(`${item.date}|${item.key}`) || 0
    return item
  })
  const regionByDate = new Map()
  for (const city of dailyCities) {
    const region = regionForCity(city.name)
    const key = `${city.date}|${keyFrom(region.key)}`
    const row = regionByDate.get(key) || { ...city, kind: 'region', key: keyFrom(region.key), name: region.key, manager: region.manager, email: region.email, availabilityLagDays: region.lag, active: 0, delivered: 0, pickupVolume: 0, deliveryVolume: 0, deliveryTimeSum: 0, firstAttemptTimeSum: 0, noAttempt2d: 0, stale: 0, tails: 0, returns: 0, failed: 0 }
    for (const field of ['active', 'delivered', 'pickupVolume', 'deliveryVolume', 'deliveryTimeSum', 'firstAttemptTimeSum', 'noAttempt2d', 'stale', 'tails', 'returns', 'failed']) row[field] += city[field] || 0
    regionByDate.set(key, row)
  }
  const dailyFlows = flowRows.map((row) => toDaily(row, 'flow'))
  const dailyMetrics = [...dailyClients, ...dailyCities, ...regionByDate.values(), ...dailyFlows]
  const routeMap = new Map()
  const routeKey = (row) => {
    const cityName = cleanCity(row._id.city)
    const region = regionForCity(row._id.city)
    const flow = flowLabel(row._id.courierType)
    const clientName = row._id.clientName || 'Не определено'
    return {
      key: `${row._id.day}|${keyFrom(row._id.clientId || clientName)}|${keyFrom(cityName)}|${keyFrom(flow)}`,
      date: row._id.day,
      clientKey: keyFrom(row._id.clientId || clientName),
      clientName,
      cityKey: keyFrom(cityName),
      cityName,
      regionKey: keyFrom(region.key),
      regionName: region.key,
      manager: region.manager,
      email: region.email,
      availabilityLagDays: region.lag,
      flowKey: keyFrom(flow),
      flowLabel: flow,
    }
  }
  const ensureRoute = (row) => {
    const base = routeKey(row)
    const current = routeMap.get(base.key) || {
      ...base,
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
    routeMap.set(base.key, current)
    return current
  }
  for (const row of routeCreatedRows) {
    const current = ensureRoute(row)
    current.active += row.active || 0
    current.cohortDelivered += row.cohortDelivered || 0
    current.cohortReturns += row.cohortReturns || 0
    current.cohortDeliveryTimeSum += roundMetric(row.cohortDeliveryTimeSum)
    current.pickupVolume += row.pickupVolume || 0
    current.deliveryVolume += row.deliveryVolume || 0
    current.noAttempt2d += row.noAttempt2d || 0
    current.stale += row.stale || 0
    current.tails += row.tails || 0
  }
  for (const row of routeFinalRows) {
    const current = ensureRoute(row)
    current.delivered += row.delivered || 0
    current.returns += row.returns || 0
    current.failed += row.failed || 0
    current.deliveryTimeSum += roundMetric(row.deliveryTimeSum)
  }
  const dailyRoutes = [...routeMap.values()]

  const clientAgg = rollup(dailyMetrics, 'client').map(finalizeMetric).sort((a, b) => b.active + b.delivered - (a.active + a.delivered)).slice(0, 500)
  const cityAgg = rollup(dailyMetrics, 'city').map(finalizeMetric).sort((a, b) => b.deliveryVolume - a.deliveryVolume).slice(0, 500)
  const regionAgg = rollup(dailyMetrics, 'region').map(finalizeMetric).sort((a, b) => b.deliveryVolume - a.deliveryVolume)
  const totalActive = clientAgg.reduce((sum, item) => sum + item.active, 0)
  const flowAgg = rollup(dailyMetrics, 'flow').map((row) => finalizeFlow(row, totalActive)).sort((a, b) => b.deliveryVolume - a.deliveryVolume)
  const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
  const timeline = timelineRows.map((row) => ({ label: monthNames[Number(row._id) - 1] || row._id, active: row.active, delivered: row.delivered, deliveryTime: row.delivered ? row.deliveryTimeSum / row.delivered : 0, firstAttemptTime: 0 }))
  const orders = drilldownRows.map((row) => {
    const city = cleanCity(row.toCity)
    const region = regionForCity(row.toCity)
    const clientName = row.customer?.name || 'Не определено'
    const noAttempt = !FINAL.includes(row.status) && Number(row.deliveryAttemptCount || 0) <= 0
    return {
      id: row.orderNumber,
      clientKey: keyFrom(row.customer?._id || clientName),
      clientName,
      cityKey: keyFrom(city),
      cityName: city,
      manager: region.manager,
      flowKey: keyFrom(flowLabel(row.courierType)),
      flowLabel: flowLabel(row.courierType),
      status: noAttempt ? 'Без попытки 2+ дня' : row.status === 'delivery_failed' ? 'Delivery failed' : row.status === 'returned_to_origin' ? 'Возврат' : 'Активный/проблемный',
      createdAt: String(row.createdDate || '').slice(0, 10),
      statusUpdatedAt: String(row.lastStatusDate || '').slice(0, 10),
      firstAttemptAt: '',
      ageDays: 0,
      source: 'Shipox API',
    }
  })
  const alerts = regionAgg.filter((item) => item.risk !== 'ok').slice(0, 8).map((region) => ({
    id: `region-${region.key}`,
    title: `${region.name}: ${region.noAttempt2d} без первой попытки`,
    detail: `Активные ${region.active}, нет обновления статуса ${region.stale}, возвраты ${region.returns}, delivery failed ${region.failed}.`,
    owner: region.manager,
    risk: region.risk,
  }))
  const snapshot = {
    generatedAt: new Date().toLocaleString('ru-RU'),
    environment: 'DEV',
    sourceMode: 'pipeline',
    periodOptions: [
      { key: 'y2026', label: 'Весь 2026', rangeLabel: '01.01.2026 - 18.05.2026' },
      { key: 'today', label: 'Сегодня', rangeLabel: '18.05.2026' },
      { key: 'yesterday', label: 'Вчера', rangeLabel: '17.05.2026' },
      { key: 'last7', label: '7 дней', rangeLabel: '12.05.2026 - 18.05.2026' },
      { key: 'last30', label: '30 дней', rangeLabel: '19.04.2026 - 18.05.2026' },
      { key: 'may', label: 'Май 2026', rangeLabel: '01.05.2026 - 18.05.2026' },
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
    clients: clientAgg,
    cities: cityAgg,
    regions: regionAgg,
    deliveryFlows: flowAgg,
    alerts,
    timeline,
    orders,
    dailyMetrics,
    dailyRoutes,
  }
  await fsp.mkdir(path.dirname(OUT_JSON), { recursive: true })
  await fsp.mkdir(path.dirname(OUT_SRC_JSON), { recursive: true })
  await fsp.mkdir(path.dirname(OUT_PUBLIC_JSON), { recursive: true })
  await fsp.writeFile(OUT_JSON, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  await fsp.writeFile(OUT_SRC_JSON, `${JSON.stringify(snapshot)}\n`, 'utf8')
  await fsp.writeFile(OUT_PUBLIC_JSON, `${JSON.stringify(snapshot)}\n`, 'utf8')
  await fsp.writeFile(OUT_TS, `import snapshot from './generatedSnapshot.json'\nimport type { DashboardSnapshot } from '../types'\n\nexport const generatedSnapshot = snapshot as DashboardSnapshot\n`, 'utf8')
  console.log(JSON.stringify({ ok: true, source: 'mongo', orders2026: await col.countDocuments(match), clients: clientAgg.length, cities: cityAgg.length, regions: regionAgg.length, flows: flowAgg.length, dailyMetrics: dailyMetrics.length, dailyRoutes: dailyRoutes.length, drilldown: orders.length, out: OUT_JSON }, null, 2))
  await client.close()
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exit(1)
})
