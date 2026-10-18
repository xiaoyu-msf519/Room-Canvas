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
  // A finish is an editor choice for one physical surface.  The source
  // material id is only provenance for recovered scan colour and must never
  // be used as an editable group: one scanned wall can be split into many
  // panels around doors/windows.
  return surface.editGroupId ?? surface.id
}

function legacySurfaceGroupId(surface: RoomSurface): string {
  // Used only once when loading finishes written by versions that grouped
  // scan wall fragments by their source id.
  return surface.finish?.sourceSurfaceId ?? (surface.kind === 'wall' ? surface.id.replace(/-\d+$/, '') : surface.id)
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
      const oldGroup = legacySurfaceGroupId(surface)
      if (!prior[oldGroup]) continue
      const targets = surface.wallFaces
        ? [...Object.values(surface.wallFaces).map((face) => face.editGroupId), `${surface.id}:side`]
        : [surfaceGroupId(surface)]
      for (const target of targets) room[target] ??= prior[oldGroup]
      migrated.add(oldGroup)
    }
    if (!migrated.size) return state
    migrated.forEach((group) => delete room[group])
    return { rooms: { ...state.rooms, [sceneId]: room } }
  }),
}), { name: 'roomcanvas-surface-finishes-v1', storage: createJSONStorage(() => localStorage) }))
