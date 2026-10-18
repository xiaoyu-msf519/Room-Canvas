import { Quaternion, Vector3 } from 'three'
import type { Vec3 } from '../types/scene'

const UP = new Vector3(0, 1, 0)

/** Retain heading while removing pitch and roll from a furniture rotation. */
export function groundRotation(rotation: Quaternion): Quaternion {
  const forward = new Vector3(0, 0, -1).applyQuaternion(rotation.clone().normalize())
  const yaw = Math.atan2(-forward.x, -forward.z)
  return new Quaternion().setFromAxisAngle(UP, yaw)
}

export function furnitureDimensions(size: Vec3, original: Vec3, scale: Vector3) {
  const dimensions: Vec3 = [size[0] * scale.x, size[1] * scale.y, size[2] * scale.z]
  const factors: Vec3 = dimensions.map((value, axis) => value / Math.max(original[axis], 0.0001)) as Vec3
  return { dimensions, factors }
}

export function clampFurnitureScale(scale: Vector3, size: Vec3, original: Vec3) {
  const values = [scale.x, scale.y, scale.z].map((value, axis) => {
    const factor = Math.max(0.05, Math.min(20, value * size[axis] / Math.max(original[axis], 0.0001)))
    return factor * original[axis] / Math.max(size[axis], 0.0001)
  })
  return scale.set(values[0], values[1], values[2])
}
