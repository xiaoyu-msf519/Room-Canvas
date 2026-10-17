import { buildSolarTable } from './ephemeris'
import type { SolarRequest, SolarResponse } from '../types/solar'

self.addEventListener('message', (event: MessageEvent<SolarRequest>) => {
  const { id, year, site } = event.data
  try {
    const table = buildSolarTable(year, site)
    const response: SolarResponse = { id, table }
    self.postMessage(response, { transfer: [table.vectors.buffer] })
  } catch (error) {
    const response: SolarResponse = { id, error: error instanceof Error ? error.message : '太阳轨迹计算失败' }
    self.postMessage(response)
  }
})
