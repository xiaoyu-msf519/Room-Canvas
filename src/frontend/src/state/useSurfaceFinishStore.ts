import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { RoomSurface } from '../types/scene'

export interface SurfaceFinish {
  catalogId: string
  name: string
  textureUrl: string
  coverageMeters: [number, number]
  rotationDegrees: number
  loadVersion?: number
}

export function surfaceGroupId(surface: RoomSurface): string {
  return surface.kind === 'wall' ? surface.finish?.sourceSurfaceId ?? surface.id.replace(/-\d+$/, '') : surface.id
}

interface SurfaceFinishState {
  rooms: Record<string, Record<string, SurfaceFinish>>
  setFinish: (sceneId: string, surfaceId: string, finish: SurfaceFinish | null) => void
}

export const useSurfaceFinishStore = create<SurfaceFinishState>()(persist((set) => ({
  rooms: {},
  setFinish: (sceneId, surfaceId, finish) => set((state) => {
    const room = { ...state.rooms[sceneId] }
    if (finish) room[surfaceId] = finish
    else delete room[surfaceId]
    return { rooms: { ...state.rooms, [sceneId]: room } }
  }),
}), { name: 'roomcanvas-surface-finishes-v1', storage: createJSONStorage(() => localStorage) }))
