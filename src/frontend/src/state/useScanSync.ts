import { useEffect } from 'react'
import { useRoomCanvasStore } from './useRoomCanvasStore'
import type { SceneManifest } from '../types/scene'

export function useScanSync() {
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const sync = async () => {
      try {
        const current = useRoomCanvasStore.getState()
        // Avoid replacing scene data during an active gizmo gesture.
        if (!current.isTransforming) {
          const url = current.scan ? `/api/scenes/${current.scan.id}` : '/api/scenes/latest'
          const response = await fetch(url)
          if (response.ok && !cancelled) {
            const scene = await response.json() as SceneManifest
            const latest = useRoomCanvasStore.getState()
            if (!cancelled && !latest.isTransforming && latest.scan?.id === current.scan?.id) current.applyScan(scene)
          }
        }
      } catch { /* Keep the existing scene usable during a network interruption. */ }
      if (!cancelled) timer = window.setTimeout(sync, 4000)
    }
    void sync()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [])
}
