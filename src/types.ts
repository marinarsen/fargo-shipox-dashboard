export type RiskLevel = 'ok' | 'watch' | 'risk' | 'critical'

export type PeriodOption = {
  key: string
  label: string
  rangeLabel: string
}

export type StatusOption = {
  key: string
  label: string
}

export type Kpi = {
  key: string
  label: string
  value: string
  delta: string
  risk: RiskLevel
}

export type ClientMetric = {
  key: string
  name: string
  manager: string
  email?: string
  region?: string
  active: number
  delivered: number
  cohortDelivered?: number
  cohortReturns?: number
  cohortDeliveryTimeSum?: number
  cohortDeliveryTime?: number
  pickupVolume?: number
  pickupDelta?: number
  deliveryVolume?: number
  deliveryDelta?: number
  deliveryTime: number
  firstAttemptTime: number
  noAttempt2d: number
  stale: number
  tails: number
  returns: number
  failed: number
  risk: RiskLevel
}

export type CityMetric = {
  key: string
  name: string
  region: string
  manager: string
  email?: string
  availabilityLagDays?: number
  active: number
  delivered?: number
  pickupVolume: number
  pickupDelta: number
  deliveryVolume: number
  deliveryDelta: number
  deliveryTime: number
  firstAttemptTime: number
  noAttempt2d: number
  stale: number
  tails: number
  failed: number
  risk: RiskLevel
}

export type RegionMetric = {
  key: string
  name: string
  manager: string
  email: string
  region?: string
  availabilityLagDays: number
  active: number
  pickupVolume: number
  pickupDelta: number
  deliveryVolume: number
  deliveryDelta: number
  delivered: number
  deliveredDelta?: number
  deliveryTime: number
  deliveryTimeDelta?: number
  firstAttemptTime: number
  noAttempt2d: number
  stale: number
  tails: number
  returns: number
  failed: number
  risk: RiskLevel
}

export type DeliveryFlowMetric = {
  key: string
  name?: string
  label: string
  shortLabel: string
  manager?: string
  email?: string
  region?: string
  active: number
  delivered: number
  cohortDelivered?: number
  cohortReturns?: number
  cohortDeliveryTimeSum?: number
  cohortDeliveryTime?: number
  pickupVolume: number
  pickupDelta: number
  deliveryVolume: number
  deliveryDelta: number
  deliveryTime: number
  firstAttemptTime: number
  noAttempt2d: number
  stale: number
  share: number
  risk: RiskLevel
}

export type AlertItem = {
  id: string
  title: string
  detail: string
  owner: string
  risk: RiskLevel
}

export type TimelinePoint = {
  label: string
  active: number
  delivered: number
  deliveryTime: number
  firstAttemptTime: number
}

export type OrderRecord = {
  id: string
  clientKey: string
  clientName: string
  cityKey: string
  cityName: string
  manager: string
  flowKey: string
  flowLabel: string
  status: string
  createdAt: string
  statusUpdatedAt: string
  firstAttemptAt: string
  ageDays: number
  source: 'Shipox API' | 'Mongo first attempt'
}

export type DailyMetric = {
  date: string
  kind: 'client' | 'city' | 'region' | 'flow'
  key: string
  name: string
  manager: string
  email?: string
  region?: string
  availabilityLagDays?: number
  active: number
  delivered: number
  cohortDelivered?: number
  cohortReturns?: number
  cohortDeliveryTimeSum?: number
  pickupVolume: number
  deliveryVolume: number
  deliveryTimeSum: number
  firstAttemptTimeSum: number
  deliveryAttemptCount?: number
  noAttempt2d: number
  stale: number
  tails: number
  returns: number
  failed: number
}

export type DailyRouteMetric = {
  date: string
  clientKey: string
  clientName: string
  cityKey: string
  cityName: string
  regionKey: string
  regionName: string
  manager: string
  email: string
  availabilityLagDays: number
  flowKey: string
  flowLabel: string
  active: number
  delivered: number
  cohortDelivered?: number
  cohortReturns?: number
  cohortDeliveryTimeSum?: number
  pickupVolume: number
  deliveryVolume: number
  deliveryTimeSum: number
  firstAttemptTimeSum: number
  deliveryAttemptCount?: number
  noAttempt2d: number
  stale: number
  tails: number
  returns: number
  failed: number
}

export type DashboardSnapshot = {
  generatedAt: string
  environment: 'DEV' | 'PROD'
  sourceMode: 'sample' | 'pipeline'
  periodOptions: PeriodOption[]
  statusOptions: StatusOption[]
  kpis: Kpi[]
  clients: ClientMetric[]
  cities: CityMetric[]
  regions?: RegionMetric[]
  deliveryFlows: DeliveryFlowMetric[]
  alerts: AlertItem[]
  timeline: TimelinePoint[]
  orders: OrderRecord[]
  dailyMetrics?: DailyMetric[]
  dailyRoutes?: DailyRouteMetric[]
  cohortRoutes?: DailyRouteMetric[]
}
