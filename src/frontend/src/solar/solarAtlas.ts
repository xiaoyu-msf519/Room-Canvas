import { solarKey } from './ephemeris'
import type { SolarRequest, SolarResponse, SolarSite, SolarStatus, SolarTable } from '../types/solar'

const cache = new Map<string, SolarTable>()

export function createSolarAtlas(onTable: (table: SolarTable) => void, onStatus: (status: SolarStatus) => void) {
  let worker: Worker | null = null
  let requestId = 0
  return {
    load(year: number, site: SolarSite) {
      requestId++
      worker?.terminate()
      worker = null
      const key = solarKey(year, site)
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key); cache.set(key, existing)
        onTable(existing); onStatus('ready')
        return
      }
      onStatus('computing')
      const id = requestId
      try { worker = new Worker(new URL('./solar.worker.ts', import.meta.url), { type: 'module' }) }
      catch { onStatus('error'); return }
      worker.onmessage = ({ data }: MessageEvent<SolarResponse>) => {
        if (data.id !== requestId) return
        worker?.terminate(); worker = null
        if ('error' in data) { onStatus('error'); return }
        cache.delete(data.table.key)
        cache.set(data.table.key, data.table)
        if (cache.size > 3) cache.delete(cache.keys().next().value!)
        onTable(data.table); onStatus('ready')
      }
      worker.onerror = () => {
        if (id !== requestId) return
        onStatus('error'); worker?.terminate(); worker = null
      }
      worker.postMessage({ id: requestId, year, site } satisfies SolarRequest)
    },
    dispose() { requestId++; worker?.terminate(); worker = null },
  }
}
