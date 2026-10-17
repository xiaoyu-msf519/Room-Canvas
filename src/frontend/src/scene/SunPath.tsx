import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Mesh, Vector3 } from 'three'
import type { MutableRefObject } from 'react'
import type { SolarTable } from '../types/solar'
import { sampleSolarDirection } from '../solar/ephemeris'
import { useSolarStore } from '../state/useSolarStore'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'

export function SunPath({ table, direction, center, radius }: { table: MutableRefObject<SolarTable | null>; direction: Vector3; center: Vector3; radius: number }) {
  const visible = useSolarStore((state) => state.showPath)
  const edit = useRoomCanvasStore((state) => state.mode === 'edit')
  const marker = useRef<Mesh>(null)
  const samples = useMemo(() => ({ a: new Vector3(), b: new Vector3(), lastTable: null as SolarTable | null, day: NaN, north: NaN }), [])
  const geometry = useMemo(() => {
    const result = new BufferGeometry()
    result.setAttribute('position', new BufferAttribute(new Float32Array(288 * 6), 3))
    result.setDrawRange(0, 0)
    return result
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame(() => {
    if (!visible || !edit) return
    if (marker.current) {
      marker.current.visible = direction.y > 0
      marker.current.position.copy(direction).multiplyScalar(radius)
    }
    const { day, north } = useSolarStore.getState()
    const atlas = table.current
    if (!atlas || (atlas === samples.lastTable && day === samples.day && north === samples.north)) return
    const positions = geometry.getAttribute('position')
    let count = 0
    for (let step = 0; step < 288; step++) {
      sampleSolarDirection(atlas, day, step * 5, north, samples.a)
      sampleSolarDirection(atlas, day, (step + 1) * 5, north, samples.b)
      if (samples.a.y < 0 && samples.b.y < 0) continue
      positions.setXYZ(count++, samples.a.x, Math.max(0, samples.a.y), samples.a.z)
      positions.setXYZ(count++, samples.b.x, Math.max(0, samples.b.y), samples.b.z)
    }
    positions.needsUpdate = true
    geometry.setDrawRange(0, count)
    geometry.computeBoundingSphere()
    samples.lastTable = atlas; samples.day = day; samples.north = north
  })
  return <group name="sun-path" visible={visible && edit} position={center}>
    <lineSegments geometry={geometry} scale={radius}>
      <lineBasicMaterial color="#f2c77b" transparent opacity={0.55} depthWrite={false} />
    </lineSegments>
    <mesh ref={marker}>
      <sphereGeometry args={[0.13, 12, 8]} />
      <meshBasicMaterial color="#ffe4a1" />
    </mesh>
  </group>
}
