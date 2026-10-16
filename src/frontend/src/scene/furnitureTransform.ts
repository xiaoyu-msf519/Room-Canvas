import { Quaternion, Vector3 } from 'three'

const UP = new Vector3(0, 1, 0)

/** Retain heading while removing pitch and roll from a furniture rotation. */
export function groundRotation(rotation: Quaternion): Quaternion {
  const forward = new Vector3(0, 0, -1).applyQuaternion(rotation.clone().normalize())
  const yaw = Math.atan2(-forward.x, -forward.z)
  return new Quaternion().setFromAxisAngle(UP, yaw)
}
