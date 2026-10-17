export interface SolarSite {
  name: string
  latitude: number
  longitude: number
  utcOffset: number
}

export interface SolarTable {
  key: string
  year: number
  days: number
  steps: number
  minutesPerStep: number
  vectors: Float32Array
}

export type SolarStatus = 'computing' | 'ready' | 'error'
export interface SolarRequest { id: number; year: number; site: SolarSite }
export type SolarResponse = { id: number; table: SolarTable } | { id: number; error: string }
