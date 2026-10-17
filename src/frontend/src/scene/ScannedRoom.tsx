import { useEffect, useLayoutEffect, useMemo } from 'react'
import { DoubleSide, Shape } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import type { RoomSurface } from '../types/scene'
import { createRoomVolume, createWallMaterials } from './wallVisibility'

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
  // Task polling replaces the manifest; geometry-identical polls must reuse GPU resources.
  const geometryKey = JSON.stringify(scan?.room.surfaces ?? [])
  const wallMaterials = useMemo(() => createWallMaterials(createRoomVolume(JSON.parse(geometryKey))), [geometryKey])
  useLayoutEffect(() => { wallMaterials.edit.value = edit }, [edit, wallMaterials])
  useEffect(() => () => wallMaterials.dispose(), [wallMaterials])
  if (!scan) return null
  return <group name="scanned-room">
    {scan.room.surfaces.map((surface) => surface.kind === 'floor' ? <Floor key={surface.id} surface={surface} /> : <group key={surface.id} position={surface.position} quaternion={surface.rotation}>
      <mesh name="scan-wall" material={wallMaterials.solid} receiveShadow>
        <boxGeometry args={surface.size} />
      </mesh>
      {edit && <mesh name="scan-wall-cutaway" material={wallMaterials.overlay} renderOrder={1} receiveShadow>
        <boxGeometry args={surface.size} />
      </mesh>}
    </group>)}
  </group>
}
