import { Box3, Matrix3, Matrix4, PerspectiveCamera, Quaternion, ShapeUtils, Triangle, Vector2, Vector3 } from 'three'
import type { Camera } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import type { RoomSurface, SceneCollider } from '../types/scene'

export const EYE_HEIGHT = 1.5
export const WALK_LIMIT = 9.7
const PLAYER_RADIUS = 0.25

export function captureEditorView(camera: Camera, target: Vector3) {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    target: target.clone(),
    zoom: camera instanceof PerspectiveCamera ? camera.zoom : 1,
    fov: camera instanceof PerspectiveCamera ? camera.fov : 52,
  }
}

export function restoreEditorView(camera: Camera, target: Vector3, view: ReturnType<typeof captureEditorView>) {
  camera.position.copy(view.position)
  camera.quaternion.copy(view.quaternion)
  target.copy(view.target)
  if (camera instanceof PerspectiveCamera) {
    camera.fov = view.fov
    camera.zoom = view.zoom
    camera.updateProjectionMatrix()
  }
  camera.updateMatrixWorld(true)
}

export function createWalkObstacles(colliders: SceneCollider[]) {
  return colliders.map((collider) => new OBB(
    new Vector3(...collider.position),
    new Vector3(...collider.size).multiplyScalar(0.5),
    new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(new Quaternion(...collider.rotation).normalize())),
  ))
}

export function createWalkFloor(surfaces: RoomSurface[]): Triangle[] {
  return surfaces.filter((surface) => surface.kind === 'floor').flatMap((floor) => {
    const vertices = (floor.polygonCorners ?? []).map(([x, y]) => new Vector2(x, y))
    const transform = new Matrix4().compose(new Vector3(...floor.position), new Quaternion(...floor.rotation), new Vector3(1, 1, 1))
    const points = vertices.map(({ x, y }) => {
      const world = new Vector3(x, y, 0).applyMatrix4(transform)
      return new Vector3(world.x, 0, world.z)
    })
    return ShapeUtils.triangulateShape(vertices, []).map(([a, b, c]) => new Triangle(points[a], points[b], points[c]))
  })
}

export function canStandAt(x: number, z: number, obstacles: OBB[], floor: Triangle[] = []) {
  if (floor.length) {
    if (!floor.some((triangle) => triangle.containsPoint(new Vector3(x, 0, z)))) return false
  } else if (Math.abs(x) > WALK_LIMIT || Math.abs(z) > WALK_LIMIT) return false
  // Test the body volume, not just the eye point: low furniture also blocks walking.
  const body = new Box3(
    new Vector3(x - PLAYER_RADIUS, 0.02, z - PLAYER_RADIUS),
    new Vector3(x + PLAYER_RADIUS, EYE_HEIGHT + 0.1, z + PLAYER_RADIUS),
  )
  return !obstacles.some((obstacle) => obstacle.intersectsBox3(body))
}

export function findWalkSpawn(obstacles: OBB[], floor: Triangle[] = []) {
  if (canStandAt(0, 0, obstacles, floor)) return new Vector3(0, EYE_HEIGHT, 0)
  // Prefer the smallest displacement from the room origin, in 25cm steps.
  for (let radius = 0.25; radius <= WALK_LIMIT * Math.SQRT2; radius += 0.25) {
    const samples = Math.ceil(2 * Math.PI * radius / 0.25)
    for (let sample = 0; sample < samples; sample++) {
      const angle = sample / samples * Math.PI * 2
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      if (canStandAt(x, z, obstacles, floor)) return new Vector3(x, EYE_HEIGHT, z)
    }
  }
  return null
}

export function setWalkFocus(camera: PerspectiveCamera, held: boolean, baseFov: number) {
  camera.fov = held ? Math.min(baseFov, 30) : baseFov
  camera.updateProjectionMatrix()
}
