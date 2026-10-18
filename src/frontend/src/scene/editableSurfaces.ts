import type { RoomSurface } from '../types/scene'

export function wallFaceSurface(surface: RoomSurface, side: 'positive' | 'negative'): RoomSurface {
  const face = surface.wallFaces?.[side]
  return face ? { ...surface, ...face, id: face.id ?? `${surface.id}:${side}`, wallFaces: undefined } : surface
}

export function editableSurfaces(surfaces: RoomSurface[]): RoomSurface[] {
  return surfaces.flatMap((surface) => surface.wallFaces
    ? [wallFaceSurface(surface, 'positive'), wallFaceSurface(surface, 'negative')]
    : [surface])
}

export function wallSelectionId(surface: RoomSurface, materialIndex: number | undefined): string {
  if (!surface.wallFaces) return surface.id
  const side = materialIndex === 2 ? 'negative' : 'positive'
  return surface.wallFaces[side].id ?? `${surface.id}:${side}`
}
