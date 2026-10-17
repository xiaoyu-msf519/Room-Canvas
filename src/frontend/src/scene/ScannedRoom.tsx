import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { DoubleSide, MeshBasicMaterial, Shape, Vector3 } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import type { RoomSurface } from '../types/scene'
import { createWallVisuals } from './wallVisibility'
import { createWallTransparency } from './wallTransparency'

function Floor({ surface }: { surface: RoomSurface }) {
  const shape = useMemo(() => {
    const corners = surface.polygonCorners ?? []
    const result = new Shape()
    corners.forEach(([x, y], index) => index ? result.lineTo(x, y) : result.moveTo(x, y))
    result.closePath()
    return result
  }, [surface.polygonCorners])
  return <mesh name="scan-floor" position={surface.position} quaternion={surface.rotation} receiveShadow>
    <shapeGeometry args={[shape]} />
    <meshStandardMaterial color="#a2abae" roughness={0.95} side={DoubleSide} />
  </mesh>
}

export function ScannedRoom() {
  const scan = useRoomCanvasStore((state) => state.scan)
  const edit = useRoomCanvasStore((state) => state.mode === 'edit')
  const { camera } = useThree()
  // Task polling replaces the manifest; geometry-identical polls must reuse GPU resources.
  const geometryKey = JSON.stringify(scan?.room.surfaces ?? [])
  const visuals = useMemo(() => createWallVisuals(JSON.parse(geometryKey)), [geometryKey])
  const transparency = useMemo(() => createWallTransparency(visuals.walls), [visuals])
  const shadowOnly = useMemo(() => new MeshBasicMaterial({ colorWrite: false, depthWrite: false }), [])
  const cameraPosition = useMemo(() => new Vector3(), [])
  const reducedMotion = useRef(false)
  const updateWalls = () => {
    camera.getWorldPosition(cameraPosition)
    visuals.update(cameraPosition, edit, useRoomCanvasStore.getState().furnitureList)
    if (edit) transparency.update(cameraPosition)
  }
  useFrame((_, delta) => {
    updateWalls()
    visuals.advance(delta, reducedMotion.current)
  })
  useLayoutEffect(updateWalls, [edit, camera, visuals, transparency, cameraPosition])
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => { reducedMotion.current = preference.matches }
    sync()
    preference.addEventListener('change', sync)
    return () => preference.removeEventListener('change', sync)
  }, [])
  useEffect(() => () => visuals.dispose(), [visuals])
  useEffect(() => () => transparency.dispose(), [transparency])
  useEffect(() => () => shadowOnly.dispose(), [shadowOnly])
  if (!scan) return null
  return <group name="scanned-room">
    {scan.room.surfaces.filter((surface) => surface.kind === 'floor').map((surface) => <Floor key={surface.id} surface={surface} />)}
    {visuals.walls.map(({ surface, material }) =>
      <mesh key={surface.id} name="scan-wall" visible={!edit} material={material} position={surface.position} quaternion={surface.rotation} receiveShadow castShadow>
        <boxGeometry args={surface.size} />
      </mesh>
    )}
    {edit && visuals.walls.map(({ surface }) => <mesh key={`shadow-${surface.id}`} name="scan-wall-shadow" material={shadowOnly} position={surface.position} quaternion={surface.rotation} castShadow>
      <boxGeometry args={surface.size} />
    </mesh>)}
    <group name="edit-wall-fragments" visible={edit}>
      {transparency.meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}
    </group>
  </group>
}
