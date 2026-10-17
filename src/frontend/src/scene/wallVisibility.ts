import { Box3, Matrix4, MeshStandardMaterial, Quaternion, Ray, Vector3 } from 'three'
import { Easing } from 'three/examples/jsm/libs/tween.module.js'
import type { Triangle } from 'three'
import type { RoomSurface, SceneCollider } from '../types/scene'
import { createWalkFloor } from './navigation'

export const CUTAWAY_OPACITY = 0.18
export const WALL_FADE_SECONDS = 0.5
const REDUCED_FADE_SECONDS = 0.2
const NO_FURNITURE: SceneCollider[] = []

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

/** Ray/OBB intersection limited to the camera-to-target segment. */
export function createWallOccluder(surface: RoomSurface) {
  const inverse = new Matrix4().compose(new Vector3(...surface.position), new Quaternion(...surface.rotation), new Vector3(1, 1, 1)).invert()
  const half = new Vector3(...surface.size).multiplyScalar(0.5)
  const bounds = new Box3(half.clone().negate(), half)
  const clearance = bounds.clone().expandByScalar(0.08)
  const origin = new Vector3(), end = new Vector3(), direction = new Vector3(), hit = new Vector3()
  const ray = new Ray()
  return {
    containsTarget(point: Vector3) { return clearance.containsPoint(end.copy(point).applyMatrix4(inverse)) },
    blocks(camera: Vector3, target: Vector3) {
      origin.copy(camera).applyMatrix4(inverse)
      end.copy(target).applyMatrix4(inverse)
      // An endpoint on/in the wall is not interior content hidden behind it.
      if (clearance.containsPoint(end)) return false
      direction.subVectors(end, origin)
      const distance = direction.length()
      if (distance < 0.1) return false
      ray.set(origin, direction.divideScalar(distance))
      return ray.intersectBox(bounds, hit) !== null && origin.distanceTo(hit) < distance - 0.08
    },
  }
}

function createInteriorTargets(surfaces: RoomSurface[], floor: Triangle[], occluders: ReturnType<typeof createWallOccluder>[]): Vector3[] {
  const bounds = new Box3()
  for (const triangle of floor) for (const point of [triangle.a, triangle.b, triangle.c]) bounds.expandByPoint(point)
  if (bounds.isEmpty()) return []
  const floorY = surfaces.find((surface) => surface.kind === 'floor')?.position[1] ?? 0
  const size = bounds.getSize(new Vector3())
  const spacing = Math.max(0.5, Math.sqrt(size.x * size.z / 256))
  const targets: Vector3[] = []
  const add = (x: number, z: number) => {
    for (const height of [0.18, 1.2]) {
      const target = new Vector3(x, floorY + height, z)
      if (!occluders.some((wall) => wall.containsTarget(target))) targets.push(target)
    }
  }
  // Triangle centroids cover narrow wings that can fall between the grid cells.
  for (const triangle of floor) {
    const center = triangle.getMidpoint(new Vector3())
    add(center.x, center.z)
  }
  for (let x = bounds.min.x + spacing / 2; x < bounds.max.x; x += spacing) {
    for (let z = bounds.min.z + spacing / 2; z < bounds.max.z; z += spacing) {
      if (isInsideFloor(new Vector3(x, 0, z), floor)) add(x, z)
    }
  }
  return targets
}

function createFurnitureTargets(furniture: SceneCollider[], floor: Triangle[]): Vector3[] {
  const targets: Vector3[] = []
  for (const item of furniture) {
    const rotation = new Quaternion(...item.rotation)
    for (const [x, y, z] of [[0, 0, 0], [-0.35, 0.3, -0.35], [0.35, 0.3, -0.35], [-0.35, 0.3, 0.35], [0.35, 0.3, 0.35]]) {
      const point = new Vector3(x * item.size[0], y * item.size[1], z * item.size[2]).applyQuaternion(rotation).add(new Vector3(...item.position))
      if (isInsideFloor(point, floor)) targets.push(point)
    }
  }
  return targets
}

export function createWallVisuals(surfaces: RoomSurface[]) {
  const floor = createWalkFloor(surfaces)
  const walls = surfaces.filter((surface) => surface.kind === 'wall').map((surface) => ({
    surface,
    facing: createWallFacing(surface, floor),
    occluder: createWallOccluder(surface),
    material: new MeshStandardMaterial({ color: surface.finish?.baseColor ?? '#d6dadb', roughness: surface.finish?.roughness ?? 0.92 }),
    fade: { from: 1, target: 1, elapsed: WALL_FADE_SECONDS },
  }))
  const interiorTargets = createInteriorTargets(surfaces, floor, walls.map((wall) => wall.occluder))
  const ceiling = Math.max(...walls.map(({ surface }) => surface.position[1] + surface.size[1] / 2))
  const lastCamera = new Vector3(Infinity, Infinity, Infinity)
  let lastEdit: boolean | undefined
  let lastFurniture: SceneCollider[] | undefined
  let furnitureTargets: Vector3[] = []
  return {
    walls,
    update(camera: Vector3, edit: boolean, furniture: SceneCollider[] = NO_FURNITURE) {
      if (camera.equals(lastCamera) && edit === lastEdit && furniture === lastFurniture) return
      const modeChanged = edit !== lastEdit
      if (furniture !== lastFurniture) furnitureTargets = createFurnitureTargets(furniture, floor)
      lastCamera.copy(camera)
      lastEdit = edit
      lastFurniture = furniture
      const cameraInside = edit && isInsideFloor(camera, floor)
      const checkOcclusion = edit && (!cameraInside || camera.y > ceiling + 0.05)
      for (const wall of walls) {
        if (modeChanged) {
          // Edit uses smooth blending with BSP-ordered faces, including at opacity 1.
          wall.material.transparent = edit
          wall.material.depthWrite = !edit
          wall.material.alphaHash = false
          wall.material.needsUpdate = true
        }
        let opacity = wallOpacityAt(wall.facing, camera, edit, cameraInside)
        if (checkOcclusion && opacity > CUTAWAY_OPACITY && (
          furnitureTargets.some((target) => wall.occluder.blocks(camera, target)) ||
          interiorTargets.some((target) => wall.occluder.blocks(camera, target))
        )) opacity = CUTAWAY_OPACITY
        if (!edit) {
          // Play must be solid immediately, even if Edit was mid-transition.
          wall.fade = { from: 1, target: 1, elapsed: WALL_FADE_SECONDS }
          wall.material.opacity = 1
        } else if (Math.abs(wall.fade.target - opacity) > 0.000001) {
          wall.fade = { from: wall.material.opacity, target: opacity, elapsed: 0 }
        }
      }
    },
    advance(deltaSeconds: number, reducedMotion = false) {
      const duration = reducedMotion ? REDUCED_FADE_SECONDS : WALL_FADE_SECONDS
      for (const wall of walls) {
        if (wall.material.opacity === wall.fade.target) continue
        wall.fade.elapsed = Math.min(duration, wall.fade.elapsed + Math.max(0, deltaSeconds))
        const progress = wall.fade.elapsed / duration
        const opacity = progress >= 1 - 1e-8 ? wall.fade.target :
          wall.fade.from + (wall.fade.target - wall.fade.from) * Easing.Cubic.Out(progress)
        wall.material.opacity = opacity
      }
    },
    dispose() { walls.forEach((wall) => wall.material.dispose()) },
  }
}
