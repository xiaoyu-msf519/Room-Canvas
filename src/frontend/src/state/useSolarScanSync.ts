import { useEffect, useRef } from 'react'
import { useRoomCanvasStore } from './useRoomCanvasStore'
import { useSolarStore } from './useSolarStore'
import { validateSite } from '../solar/ephemeris'

export function useSolarScanSync() {
  const id = useRoomCanvasStore((state) => state.scan?.id)
  const orientation = useRoomCanvasStore((state) => state.scan?.source.orientation)
  const applied = useRef<string | null>(null)
  useEffect(() => {
    if (!id || applied.current === id || orientation?.reference !== 'true-north' || !Number.isFinite(orientation.northAngleDegrees)) return
    applied.current = id
    const state = useSolarStore.getState()
    state.setNorth(orientation.northAngleDegrees!)
    if (orientation.location) {
      const site = { name: '扫描位置', ...orientation.location, utcOffset: (orientation.utcOffsetMinutes ?? state.site.utcOffset * 60) / 60 }
      try { validateSite(site); state.setSite(site) } catch { /* Keep the user's location if metadata is invalid. */ }
    }
  }, [id, orientation])
}
