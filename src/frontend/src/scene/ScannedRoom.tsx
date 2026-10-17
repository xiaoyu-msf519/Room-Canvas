import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { DoubleSide, Shape, Vector3 } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import type { RoomSurface } from '../types/scene'
import { createWallVisuals } from './wallVisibility'

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
  const cameraPosition = useMemo(() => new Vector3(), [])
  const updateWalls = () => visuals.update(camera.getWorldPosition(cameraPosition), edit)
  useFrame(updateWalls)
  useLayoutEffect(updateWalls, [edit, camera, visuals, cameraPosition])
  useEffect(() => () => visuals.dispose(), [visuals])
  if (!scan) return null
  return <group name="scanned-room">
    {scan.room.surfaces.filter((surface) => surface.kind === 'floor').map((surface) => <Floor key={surface.id} surface={surface} />)}
    {visuals.walls.map(({ surface, material }) =>
      <mesh key={surface.id} name="scan-wall" material={material} position={surface.position} quaternion={surface.rotation} receiveShadow>
        <boxGeometry args={surface.size} />
      </mesh>
    )}
  </group>
}
