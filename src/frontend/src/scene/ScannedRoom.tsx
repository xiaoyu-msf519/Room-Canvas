import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial, Shape, Vector3 } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import type { RoomSurface } from '../types/scene'
import { createWallVisuals } from './wallVisibility'
import { createWallTransparency } from './wallTransparency'
import { surfaceGroupId, useSurfaceFinishStore, type SurfaceFinish } from '../state/useSurfaceFinishStore'
import { createMetricWallGeometry, useSurfaceAppearance } from './surfaceAppearance'

function selectSurface(event: ThreeEvent<MouseEvent>, id: string) {
  const state = useRoomCanvasStore.getState()
  if (state.mode !== 'edit' || state.isTransforming || event.delta > 3) return
  event.stopPropagation()
  state.setSelectedSurfaceId(id)
}

function Floor({ surface }: { surface: RoomSurface }) {
  const sceneId = useRoomCanvasStore((state) => state.scan?.id)
  const selected = useRoomCanvasStore((state) => state.mode === 'edit' && state.selectedSurfaceId === surface.id)
  const finish = useSurfaceFinishStore((state) => sceneId ? state.rooms[sceneId]?.[surfaceGroupId(surface)] : undefined)
  const material = useMemo(() => new MeshStandardMaterial({ side: DoubleSide }), [])
  useSurfaceAppearance(material, surface, finish, selected)
  useEffect(() => () => material.dispose(), [material])
  const shape = useMemo(() => {
    const corners = surface.polygonCorners ?? []
    const result = new Shape()
    corners.forEach(([x, y], index) => index ? result.lineTo(x, y) : result.moveTo(x, y))
    result.closePath()
    return result
  }, [surface.polygonCorners])
  return <mesh name="scan-floor" position={surface.position} quaternion={surface.rotation} material={material} receiveShadow onClick={(event) => selectSurface(event, surface.id)}>
    <shapeGeometry args={[shape]} />
  </mesh>
}

function WallAppearance({ wall, reference, finish, selected, edit }: { wall: ReturnType<typeof createWallVisuals>['walls'][number]; reference: RoomSurface; finish?: SurfaceFinish; selected: boolean; edit: boolean }) {
  const { surface, material, opaqueMaterial } = wall
  const materials = useMemo(() => [material, opaqueMaterial], [material, opaqueMaterial])
  useSurfaceAppearance(materials, surface, finish, selected)
  const geometry = useMemo(() => createMetricWallGeometry(surface, reference), [surface, reference])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <>
    <mesh name="scan-wall" visible={!edit} material={material} geometry={geometry} position={surface.position} quaternion={surface.rotation} receiveShadow castShadow />
    <mesh name="scan-wall-solid" ref={(mesh) => { wall.solid = mesh }} visible={edit && material.opacity === 1} material={opaqueMaterial} geometry={geometry} position={surface.position} quaternion={surface.rotation} receiveShadow onClick={(event) => selectSurface(event, surface.id)} />
  </>
}

function Ceiling({ surface, edit }: { surface: RoomSurface; edit: boolean }) {
  const shape = useMemo(() => {
    const result = new Shape()
    const corners = surface.polygonCorners ?? []
    corners.forEach(([x, y], index) => index ? result.lineTo(x, y) : result.moveTo(x, y))
    result.closePath()
    return result
  }, [surface.polygonCorners])
  return <mesh name="scan-ceiling" position={surface.position} quaternion={surface.rotation} receiveShadow={!edit} castShadow>
    <extrudeGeometry args={[shape, { depth: 0.08, bevelEnabled: false }]} />
    <meshStandardMaterial color="#d6d9d5" roughness={0.94} side={DoubleSide} transparent opacity={edit ? 0.16 : 0.94} />
  </mesh>
}

export function ScannedRoom() {
  const scan = useRoomCanvasStore((state) => state.scan)
  const edit = useRoomCanvasStore((state) => state.mode === 'edit')
  const selectedId = useRoomCanvasStore((state) => state.selectedSurfaceId)
  const finishes = useSurfaceFinishStore((state) => scan ? state.rooms[scan.id] : undefined)
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
  const syncWallPasses = () => {
    for (const wall of visuals.walls) if (wall.solid) wall.solid.visible = edit && wall.material.opacity === 1
    transparency.syncOpaqueWalls(edit)
  }
  useFrame((_, delta) => {
    updateWalls()
    visuals.advance(delta, reducedMotion.current)
    syncWallPasses()
  })
  useLayoutEffect(() => { updateWalls(); syncWallPasses() }, [edit, camera, visuals, transparency, cameraPosition])
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
  const selectedSurface = scan.room.surfaces.find((surface) => surface.id === selectedId)
  const selectedGroup = selectedSurface ? surfaceGroupId(selectedSurface) : null
  return <group name="scanned-room">
    {scan.room.surfaces.filter((surface) => surface.kind === 'floor').map((surface) => <Floor key={surface.id} surface={surface} />)}
    {scan.room.surfaces.filter((surface) => surface.kind === 'ceiling').map((surface) => <Ceiling key={surface.id} surface={surface} edit={edit} />)}
    {visuals.walls.map((wall) => {
      const { surface } = wall
      const group = surfaceGroupId(surface)
      const reference = visuals.walls.find((wall) => surfaceGroupId(wall.surface) === group)!.surface
      return <WallAppearance key={surface.id} wall={wall} reference={reference} finish={finishes?.[group]} selected={edit && selectedGroup === group} edit={edit} />
    })}
    {edit && visuals.walls.map(({ surface }) => <mesh key={`shadow-${surface.id}`} name="scan-wall-shadow" material={shadowOnly} position={surface.position} quaternion={surface.rotation} castShadow raycast={() => {}}>
      <boxGeometry args={surface.size} />
    </mesh>)}
    <group name="edit-wall-fragments" visible={edit}>
      {transparency.meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} onClick={(event: ThreeEvent<MouseEvent>) => selectSurface(event, mesh.userData.wallId)} />)}
    </group>
  </group>
}
