import { Quaternion, Vector3 } from 'three'
import type { RoomSurface } from '../types/scene'

/**
 * Trim a terminating wall at a T junction so its end stops at the through-wall
 * face. Corner joins remain untouched: only a projection strictly inside the
 * other wall is a T, which avoids creating gaps at L corners.
 */
export function trimWallJunctions(surfaces: RoomSurface[]): RoomSurface[] {
  const walls = surfaces.filter((surface) => surface.kind === 'wall')
  const trims = new Map<string, [number, number]>()
  const endpoint = new Vector3()
  for (const wall of walls) {
    if (wall.size[0] < 0.001 || wall.size[2] < 0.001) continue
    const rotation = new Quaternion(...wall.rotation)
    const axis = new Vector3(1, 0, 0).applyQuaternion(rotation).setY(0).normalize()
    const center = new Vector3(...wall.position)
    const halfLength = wall.size[0] / 2
    const values: [number, number] = [0, 0]
    for (const end of [-1, 1] as const) {
      endpoint.copy(center).addScaledVector(axis, end * halfLength)
      let trim = 0
      for (const other of walls) {
        if (other.id === wall.id || other.size[2] < 0.001) continue
        const otherRotation = new Quaternion(...other.rotation)
        const otherAxis = new Vector3(1, 0, 0).applyQuaternion(otherRotation).setY(0).normalize()
        if (Math.abs(axis.dot(otherAxis)) > 0.98) continue
        const otherCenter = new Vector3(...other.position)
        const otherHalfLength = other.size[0] / 2
        const offset = endpoint.clone().sub(otherCenter)
        const alongOther = offset.dot(otherAxis)
        const otherNormal = new Vector3(-otherAxis.z, 0, otherAxis.x)
        const acrossOther = Math.abs(offset.dot(otherNormal))
        if (Math.abs(alongOther) < otherHalfLength - 0.001 && acrossOther < other.size[2] / 2 + 0.001) {
          trim = Math.max(trim, other.size[2] / 2 - acrossOther + 0.0005)
        }
      }
      values[end < 0 ? 0 : 1] = Math.min(trim, halfLength * 0.45)
    }
    trims.set(wall.id, values)
  }
  return surfaces.map((surface) => {
    const trim = trims.get(surface.id)
    if (!trim || (trim[0] <= 0 && trim[1] <= 0)) return surface
    const rotation = new Quaternion(...surface.rotation)
    const axis = new Vector3(1, 0, 0).applyQuaternion(rotation).setY(0).normalize()
    return {
      ...surface,
      size: [surface.size[0] - trim[0] - trim[1], surface.size[1], surface.size[2]],
      position: new Vector3(...surface.position).addScaledVector(axis, (trim[0] - trim[1]) / 2).toArray() as [number, number, number],
    }
  })
}
