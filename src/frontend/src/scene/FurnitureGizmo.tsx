import { useEffect, useRef, type RefObject } from 'react'
import { PivotControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Group } from 'three'
import type { OrbitControls } from 'three-stdlib'
import { groundRotation } from './furnitureTransform'

interface FurnitureGizmoProps {
  target: RefObject<Group>
  height: number
  onDragStart: () => void
  onDragEnd: () => void
}

export function FurnitureGizmo({ target, height, onDragStart, onDragEnd }: FurnitureGizmoProps) {
  const gizmo = useRef<Group>(null)
  const controls = useThree((state) => state.controls as OrbitControls | undefined)
  const dragging = useRef(false)

  // Keep handles and model on the same world transform without reparenting the model.
  const syncMatrix = () => {
    if (!target.current || !gizmo.current) return
    target.current.updateWorldMatrix(true, false)
    gizmo.current.matrix.copy(target.current.matrixWorld)
    gizmo.current.updateWorldMatrix(true, true)
  }
  useFrame(syncMatrix)

  useEffect(() => () => {
    if (dragging.current && controls) controls.enabled = true
  }, [controls])

  return <PivotControls
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
      syncMatrix()
    }}
    onDragEnd={() => {
      dragging.current = false
      onDragEnd()
      syncMatrix()
    }}
  />
}
