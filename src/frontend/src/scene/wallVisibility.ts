import { MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import type { Triangle } from 'three'
import type { RoomSurface } from '../types/scene'
import { createWalkFloor } from './navigation'

export const CUTAWAY_OPACITY = 0.18

export interface WallFacing {
  center: Vector3
  inward: Vector3
  halfThickness: number
  resolved: boolean
}

export function isInsideFloor(point: Vector3, floor: Triangle[]): boolean {
  const projected = new Vector3(point.x, 0, point.z)
  return floor.some((triangle) => triangle.containsPoint(projected))
}

/** Infer the interior half-space from the real floor, not a concave room's center. */
export function createWallFacing(surface: RoomSurface, floor: Triangle[]): WallFacing {
  const center = new Vector3(...surface.position)
  const inward = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...surface.rotation))
  inward.y = 0
  inward.normalize()
  const halfThickness = surface.size[2] / 2
  const facing = { center, inward, halfThickness, resolved: false }
  const sample = new Vector3()
  for (const distance of [halfThickness + 0.08, 0.3, 0.6]) {
    const positive = isInsideFloor(sample.copy(center).addScaledVector(inward, distance), floor)
    const negative = isInsideFloor(sample.copy(center).addScaledVector(inward, -distance), floor)
    if (positive !== negative) {
      if (negative) inward.negate()
      facing.resolved = true
      return facing
    }
  }
  // Short corner panels can miss both side samples. Use the nearest floor point
  // to orient the normal; leave ambiguous internal walls solid rather than guess.
  const origin = new Vector3(center.x, 0, center.z)
  let nearest = Infinity
  let side = 0
  for (const triangle of floor) {
    triangle.closestPointToPoint(origin, sample)
    const distance = sample.distanceToSquared(origin)
    const dot = sample.sub(origin).dot(inward)
    if (distance < nearest && Math.abs(dot) > 0.0001) {
      nearest = distance
      side = dot
    }
  }
  if (side !== 0) {
    if (side < 0) inward.negate()
    facing.resolved = true
  }
  return facing
}

/** Blueprint3D camera-side test, adapted from visibility to opacity:
 * https://github.com/furnishup/blueprint3d/blob/master/src/three/edge.ts
 */
export function wallOpacityAt(facing: WallFacing, camera: Vector3, edit: boolean, cameraInside: boolean): number {
  if (!edit || cameraInside || !facing.resolved) return 1
  const signedDistance = facing.inward.dot(camera) - facing.inward.dot(facing.center)
  const t = Math.max(0, Math.min(1, (signedDistance + facing.halfThickness + 0.2) / 0.22))
  const smooth = t * t * (3 - 2 * t)
  return CUTAWAY_OPACITY + (1 - CUTAWAY_OPACITY) * smooth
}

export function createWallVisuals(surfaces: RoomSurface[]) {
  const floor = createWalkFloor(surfaces)
  const walls = surfaces.filter((surface) => surface.kind === 'wall').map((surface) => ({
    surface,
    facing: createWallFacing(surface, floor),
    material: new MeshStandardMaterial({ color: '#d6dadb', roughness: 0.92 }),
  }))
  return {
    walls,
    update(camera: Vector3, edit: boolean) {
      const cameraInside = edit && isInsideFloor(camera, floor)
      for (const wall of walls) {
        const opacity = wallOpacityAt(wall.facing, camera, edit, cameraInside)
        const transparent = opacity < 0.999
        if (wall.material.transparent !== transparent) {
          wall.material.transparent = transparent
          wall.material.needsUpdate = true
        }
        wall.material.opacity = transparent ? opacity : 1
        wall.material.depthWrite = !transparent
      }
    },
    dispose() { walls.forEach((wall) => wall.material.dispose()) },
  }
}
