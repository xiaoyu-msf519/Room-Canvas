import type { RoomSurface } from '../types/scene'

export function wallFaceSurface(surface: RoomSurface, side: 'positive' | 'negative'): RoomSurface {
  const face = surface.wallFaces?.[side]
  return face ? { ...surface, ...face, id: face.id ?? `${surface.id}:${side}`, wallFaces: undefined } : surface
}

export function wallSideSurface(surface: RoomSurface): RoomSurface {
  const parentGroup = surface.editGroupId ?? surface.id
  return { ...surface, id: `${surface.id}:side`, zoneId: surface.zoneId ?? surface.wallFaces?.positive.zoneId, editGroupId: `${parentGroup}:side`, label: `${surface.label ?? '墙面'} · 侧面`, wallFaces: undefined }
}

export function editableSurfaces(surfaces: RoomSurface[]): RoomSurface[] {
  return surfaces.flatMap((surface) => surface.kind !== 'wall' ? [surface] : surface.wallFaces
    ? [wallSideSurface(surface), wallFaceSurface(surface, 'positive'), wallFaceSurface(surface, 'negative')]
    : [wallSideSurface(surface), surface])
}

export function wallSelectionId(surface: RoomSurface, materialIndex: number | undefined): string {
  if (materialIndex === 0) return wallSideSurface(surface).id
  if (!surface.wallFaces) return surface.id
  const side = materialIndex === 2 ? 'negative' : 'positive'
  return surface.wallFaces[side].id ?? `${surface.id}:${side}`
}
