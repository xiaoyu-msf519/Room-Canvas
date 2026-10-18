import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'

export function AdaptiveResolution() {
  const mode = useRoomCanvasStore((state) => state.mode)
  const current = useThree((state) => state.performance.current)
  const setDpr = useThree((state) => state.setDpr)
  const deviceDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const base = Math.min(deviceDpr, mode === 'play' ? 2 : 1.35)
  useEffect(() => { setDpr(base * current) }, [base, current, setDpr])
  return null
}
