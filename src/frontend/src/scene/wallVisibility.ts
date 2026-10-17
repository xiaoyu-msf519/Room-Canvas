import { Box3, Matrix4, MeshStandardMaterial, Quaternion, Vector2, Vector3, Vector4 } from 'three'
import type { RoomSurface } from '../types/scene'
import { createWalkFloor } from './navigation'

export const CUTAWAY_OPACITY = 0.18
const EPSILON = 0.00001

export interface RoomVolume {
  planes: Vector4[]
  heights: Vector2[]
}

/** Decompose the concave room footprint into exact vertical triangular prisms. */
export function createRoomVolume(surfaces: RoomSurface[]): RoomVolume {
  const bounds = new Box3()
  for (const surface of surfaces.filter((item) => item.kind === 'wall')) {
    const transform = new Matrix4().compose(new Vector3(...surface.position), new Quaternion(...surface.rotation), new Vector3(1, 1, 1))
    const half = new Vector3(...surface.size).multiplyScalar(0.5)
    bounds.union(new Box3(half.clone().negate(), half).applyMatrix4(transform))
  }
  const planes: Vector4[] = []
  const heights: Vector2[] = []
  if (bounds.isEmpty()) return { planes, heights }
  for (const floor of surfaces.filter((surface) => surface.kind === 'floor')) {
    for (const triangle of createWalkFloor([floor])) {
      const points = [triangle.a, triangle.b, triangle.c]
      const center = triangle.getMidpoint(new Vector3())
      for (let edge = 0; edge < 3; edge++) {
        const a = points[edge], b = points[(edge + 1) % 3]
        const normal = new Vector3(-(b.z - a.z), 0, b.x - a.x).normalize()
        let constant = -normal.dot(a)
        if (normal.dot(center) + constant < 0) {
          normal.negate()
          constant = -constant
        }
        planes.push(new Vector4(normal.x, normal.y, normal.z, constant))
      }
      heights.push(new Vector2(floor.position[1], bounds.max.y))
    }
  }
  return { planes, heights }
}

/** Test the entire forward ray, including room segments before or beyond the wall. */
export function wallRayIntersectsRoom(volume: RoomVolume, camera: Vector3, point: Vector3, edit: boolean): boolean {
  if (!edit) return false
  const direction = point.clone().sub(camera)
  if (direction.lengthSq() < EPSILON * EPSILON) return false
  direction.normalize()
  return volume.heights.some((height, prism) => {
    let near = 0, far = Infinity
    const clip = (plane: Vector4) => {
      const distance = plane.x * camera.x + plane.y * camera.y + plane.z * camera.z + plane.w
      const slope = plane.x * direction.x + plane.y * direction.y + plane.z * direction.z
      if (Math.abs(slope) < EPSILON) return distance >= 0
      const t = -distance / slope
      if (slope > 0) near = Math.max(near, t)
      else far = Math.min(far, t)
      return far > near + EPSILON
    }
    if (!clip(new Vector4(0, 1, 0, -height.x)) || !clip(new Vector4(0, -1, 0, height.y))) return false
    return volume.planes.slice(prism * 3, prism * 3 + 3).every(clip) && far > near + EPSILON
  })
}

export function createWallMaterials(volume: RoomVolume) {
  const edit = { value: true }
  const declarations = `
    varying vec3 rcWallWorldPosition;
    uniform bool rcEditCutaway;
    uniform vec4 rcPrismPlanes[${Math.max(1, volume.planes.length)}];
    uniform vec2 rcPrismHeights[${Math.max(1, volume.heights.length)}];

    bool rcClip(vec4 plane, vec3 origin, vec3 direction, inout float nearT, inout float farT) {
      float distanceToPlane = dot(plane.xyz, origin) + plane.w;
      float slope = dot(plane.xyz, direction);
      if (abs(slope) < ${EPSILON}) return distanceToPlane >= 0.0;
      float t = -distanceToPlane / slope;
      if (slope > 0.0) nearT = max(nearT, t);
      else farT = min(farT, t);
      return farT > nearT + ${EPSILON};
    }

    bool rcRayCrossesInterior() {
      if (!rcEditCutaway) return false;
      vec3 viewDirection = rcWallWorldPosition - cameraPosition;
      if (length(viewDirection) < ${EPSILON}) return false;
      vec3 direction = normalize(viewDirection);
      for (int prism = 0; prism < ${volume.heights.length}; prism++) {
        float nearT = 0.0;
        float farT = 1.0e20;
        vec2 heights = rcPrismHeights[prism];
        if (!rcClip(vec4(0.0, 1.0, 0.0, -heights.x), cameraPosition, direction, nearT, farT)) continue;
        if (!rcClip(vec4(0.0, -1.0, 0.0, heights.y), cameraPosition, direction, nearT, farT)) continue;
        bool hit = true;
        for (int edge = 0; edge < 3; edge++) {
          if (!rcClip(rcPrismPlanes[prism * 3 + edge], cameraPosition, direction, nearT, farT)) {
            hit = false;
            break;
          }
        }
        if (hit && farT > nearT + ${EPSILON}) return true;
      }
      return false;
    }
  `

  const create = (ghost: boolean) => {
    const material = new MeshStandardMaterial({ color: '#d6dadb', roughness: 0.92, transparent: ghost, depthWrite: !ghost })
    material.name = ghost ? 'wall-cutaway-overlay' : 'wall-solid'
    material.onBeforeCompile = (shader) => {
      shader.uniforms.rcPrismPlanes = { value: volume.planes.length ? volume.planes : [new Vector4()] }
      shader.uniforms.rcPrismHeights = { value: volume.heights.length ? volume.heights : [new Vector2()] }
      shader.uniforms.rcEditCutaway = edit
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 rcWallWorldPosition;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nrcWallWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + declarations)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          bool rcCutaway = rcRayCrossesInterior();
          ${ghost ? 'if (!rcCutaway) discard;' : 'if (rcCutaway) discard;'}
        `)
      if (ghost) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>\ngl_FragColor.a *= ${CUTAWAY_OPACITY};`)
    }
    material.customProgramCacheKey = () => `roomcanvas-wall-ray-v1-${volume.heights.length}-${ghost ? 'overlay' : 'solid'}`
    return material
  }

  return {
    solid: create(false), overlay: create(true), edit,
    dispose() { this.solid.dispose(); this.overlay.dispose() },
  }
}
