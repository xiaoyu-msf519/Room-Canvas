import { useMemo } from 'react'
import { DoubleSide, Shape } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import type { RoomSurface } from '../types/scene'

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
  if (!scan) return null
  return <group name="scanned-room">
    {scan.room.surfaces.map((surface) => surface.kind === 'floor' ? <Floor key={surface.id} surface={surface} /> :
      <mesh key={surface.id} name="scan-wall" position={surface.position} quaternion={surface.rotation} receiveShadow>
        <boxGeometry args={surface.size} />
        <meshStandardMaterial color="#d6dadb" roughness={0.92} transparent={edit} opacity={edit ? 0.32 : 1} depthWrite={!edit} />
      </mesh>)}
  </group>
}
