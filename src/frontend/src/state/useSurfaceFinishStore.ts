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
  return surface.editGroupId ?? (surface.kind === 'wall' ? surface.finish?.sourceSurfaceId ?? surface.id.replace(/-\d+$/, '') : surface.id)
}

interface SurfaceFinishState {
  rooms: Record<string, Record<string, SurfaceFinish>>
  setFinish: (sceneId: string, surfaceId: string, finish: SurfaceFinish | null) => void
  migrateSurfaceGroups: (sceneId: string, surfaces: RoomSurface[]) => void
}

export const useSurfaceFinishStore = create<SurfaceFinishState>()(persist((set) => ({
  rooms: {},
  setFinish: (sceneId, surfaceId, finish) => set((state) => {
    const room = { ...state.rooms[sceneId] }
    if (finish) room[surfaceId] = finish
    else delete room[surfaceId]
    return { rooms: { ...state.rooms, [sceneId]: room } }
  }),
  migrateSurfaceGroups: (sceneId, surfaces) => set((state) => {
    const prior = state.rooms[sceneId]
    if (!prior) return state
    const room = { ...prior }, migrated = new Set<string>()
    for (const surface of surfaces) {
      if (!surface.wallFaces) continue
      const oldGroup = surfaceGroupId(surface)
      if (!prior[oldGroup]) continue
      for (const face of Object.values(surface.wallFaces)) room[face.editGroupId] ??= prior[oldGroup]
      migrated.add(oldGroup)
    }
    if (!migrated.size) return state
    migrated.forEach((group) => delete room[group])
    return { rooms: { ...state.rooms, [sceneId]: room } }
  }),
}), { name: 'roomcanvas-surface-finishes-v1', storage: createJSONStorage(() => localStorage) }))
