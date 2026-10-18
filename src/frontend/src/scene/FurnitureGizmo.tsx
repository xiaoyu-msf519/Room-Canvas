import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { PivotControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Group } from 'three'
import type { OrbitControls } from 'three-stdlib'
import { clampFurnitureScale, groundRotation } from './furnitureTransform'
import type { Vec3 } from '../types/scene'

interface FurnitureGizmoProps {
  target: RefObject<Group>
  height: number
  size?: Vec3
  originalSize?: Vec3
  onDragStart: () => void
  onDragEnd: () => void
}

export function FurnitureGizmo({ target, height, size, originalSize, onDragStart, onDragEnd }: FurnitureGizmoProps) {
  const gizmo = useRef<Group>(null)
  const scalingGizmo = useRef<Group>(null)
  const controls = useThree((state) => state.controls as OrbitControls | undefined)
  const dragging = useRef(false)
  const bottom = useRef(0)
  const regress = useThree((state) => state.performance.regress)

  // Keep handles and model on the same world transform without reparenting the model.
  const syncMatrix = () => {
    if (!target.current) return
    target.current.updateWorldMatrix(true, false)
    for (const handle of [gizmo.current, scalingGizmo.current]) {
      if (!handle) continue
      handle.name = handle === gizmo.current ? 'furniture-move-gizmo' : 'furniture-scale-gizmo'
      handle.matrix.copy(target.current.matrixWorld)
      handle.updateWorldMatrix(true, true)
    }
  }
  useFrame(syncMatrix)
  useLayoutEffect(syncMatrix)

  useEffect(() => () => {
    if (dragging.current && controls) controls.enabled = true
  }, [controls])

  return <><PivotControls
    ref={gizmo}
    autoTransform={false}
    activeAxes={[true, false, true]}
    disableSliders
    disableScaling
    fixed
    scale={95}
    lineWidth={2.5}
    depthTest={false}
    axisColors={['#ff4f63', '#20df80', '#408bff']}
    hoveredColor="#fff09a"
    onDragStart={() => {
      dragging.current = true
      onDragStart()
    }}
    onDrag={(_local, _deltaLocal, world) => {
      const group = target.current
      if (!group) return
      const local = world.clone()
      if (group.parent) {
        group.parent.updateWorldMatrix(true, false)
        local.premultiply(group.parent.matrixWorld.clone().invert())
      }
      local.decompose(group.position, group.quaternion, group.scale)
      group.quaternion.copy(groundRotation(group.quaternion))
      group.position.y = height / 2
      group.scale.set(1, 1, 1)
      regress()
      syncMatrix()
    }}
    onDragEnd={() => {
      dragging.current = false
      onDragEnd()
      syncMatrix()
    }}
  />{size && originalSize && <PivotControls
    ref={scalingGizmo}
    autoTransform={false}
    activeAxes={[false, true, false]}
    disableAxes
    disableSliders
    disableRotations
    fixed
    scale={115}
    lineWidth={2.5}
    depthTest={false}
    axisColors={['#ff4f63', '#20df80', '#408bff']}
    hoveredColor="#fff09a"
    onDragStart={() => {
      const group = target.current
      if (!group) return
      bottom.current = group.position.y - size[1] * group.scale.y / 2
      dragging.current = true
      onDragStart()
    }}
    onDrag={(_local, _deltaLocal, world) => {
      const group = target.current
      if (!group) return
      const local = world.clone()
      if (group.parent) {
        group.parent.updateWorldMatrix(true, false)
        local.premultiply(group.parent.matrixWorld.clone().invert())
      }
      local.decompose(group.position, group.quaternion, group.scale)
      group.quaternion.copy(groundRotation(group.quaternion))
      clampFurnitureScale(group.scale, size, originalSize)
      group.position.y = bottom.current + size[1] * group.scale.y / 2
      regress()
      syncMatrix()
    }}
    onDragEnd={() => {
      dragging.current = false
      onDragEnd()
      syncMatrix()
    }}
  />}</>
}
