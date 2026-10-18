import { memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { Group } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import type { FurnitureItem, Vec3 } from '../types/scene'
import { groundRotation } from './furnitureTransform'
import { FurnitureGizmo } from './FurnitureGizmo'
import { createModelDisplay } from './modelDisplay'
import { FurnitureReadout } from './FurnitureReadout'

function ModelObject({ modelUrl, size }: { modelUrl: string; size: Vec3 }) {
  const gl = useThree((state) => state.gl)
  const { scene } = useGLTF(modelUrl)
  const fit = useMemo(() => createModelDisplay(scene), [scene])
  const scale: Vec3 = [size[0] / Math.max(fit.extents.x, 0.0001), size[1] / Math.max(fit.extents.y, 0.0001), size[2] / Math.max(fit.extents.z, 0.0001)]
  useEffect(() => { gl.shadowMap.needsUpdate = true }, [fit, gl])
  return <group scale={scale}><group position={[-fit.center.x, -fit.center.y, -fit.center.z]}><primitive object={fit.display} dispose={null} /></group></group>
}

function LowProxy({ size }: { size: Vec3 }) {
  return <group>
    <mesh castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#78aeb8" transparent opacity={0.18} roughness={0.9} wireframe />
    </mesh>
    <mesh position={[0, -size[1] / 2 + 0.012, 0]} receiveShadow>
      <boxGeometry args={[size[0] * 0.92, 0.02, size[2] * 0.92]} />
      <meshBasicMaterial color="#83e0ee" transparent opacity={0.18} />
    </mesh>
  </group>
}

function FurnitureVisual({ modelUrl, size }: { modelUrl?: string; size: Vec3 }) {
  return <Suspense fallback={<LowProxy size={size} />}>{modelUrl ? <ModelObject modelUrl={modelUrl} size={size} /> : <LowProxy size={size} />}</Suspense>
}

const FurnitureObject = memo(function FurnitureObject({ item }: { item: FurnitureItem }) {
  const selected = useRoomCanvasStore((state) => state.selectedId === item.id)
  const originalSize = item.originalSize ?? item.originalBounds?.size ?? item.size
  const mode = useRoomCanvasStore((state) => state.mode)
  const setSelectedId = useRoomCanvasStore((state) => state.setSelectedId)
  const updateFurniture = useRoomCanvasStore((state) => state.updateFurniture)
  const setIsTransforming = useRoomCanvasStore((state) => state.setIsTransforming)
  const groupRef = useRef<Group>(null)
  const initialized = useRef(false)

  useEffect(() => () => {
    setIsTransforming(false)
  }, [setIsTransforming])

  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group || initialized.current) return
    group.position.fromArray(item.position)
    group.quaternion.copy(groundRotation(group.quaternion.fromArray(item.rotation)))
    group.scale.set(1, 1, 1)
    group.updateMatrixWorld(true)
    initialized.current = true
  }, [item.position, item.rotation])

  const commitTransform = () => {
    const group = groupRef.current
    if (!group) return
    group.quaternion.copy(groundRotation(group.quaternion))
    const nextPosition: Vec3 = [group.position.x, group.position.y, group.position.z]
    const nextSize: Vec3 = [item.size[0] * group.scale.x, item.size[1] * group.scale.y, item.size[2] * group.scale.z]
    const nextRotation: FurnitureItem['rotation'] = [group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w]
    group.position.y = nextPosition[1]
    group.scale.set(1, 1, 1)
    group.updateMatrixWorld(true)
    updateFurniture(item.id, {
      position: nextPosition,
      rotation: nextRotation,
      size: nextSize,
      originalSize: [...originalSize],
    })
    requestAnimationFrame(() => {
      setIsTransforming(false)
    })
  }

  const modelUrl = mode === 'play' ? item.modelUrl : item.editModelUrl
  const group = <group name="furniture-object" userData={{ furnitureId: item.id }} ref={groupRef} onClick={(event) => { event.stopPropagation(); setSelectedId(item.id) }}>
    <FurnitureVisual modelUrl={modelUrl} size={item.size} />
  </group>

  return <>
    {group}
    {selected && mode === 'edit' && <FurnitureGizmo
      target={groupRef}
      height={item.position[1] * 2}
      size={item.size}
      originalSize={originalSize}
      onDragStart={() => setIsTransforming(true)}
      onDragEnd={commitTransform}
    />}
    {selected && mode === 'edit' && <FurnitureReadout target={groupRef} size={item.size} original={originalSize} />}
  </>
})

function PlacementPreview({ asset }: { asset: { dimensionsMm?: { width: number; depth: number; height: number } } }) {
  const placementPreview = useRoomCanvasStore((state) => state.placementPreview)
  const dimensions = asset.dimensionsMm
  const size = useMemo<Vec3 | null>(() => dimensions ? [dimensions.width / 1000, dimensions.height / 1000, dimensions.depth / 1000] : null, [dimensions?.depth, dimensions?.height, dimensions?.width])
  if (!placementPreview || !size) return null
  const position: Vec3 = [placementPreview[0], size[1] / 2, placementPreview[2]]
  return <group position={position}>
    <LowProxy size={size} />
  </group>
}

export function FurnitureModels() {
  const furnitureList = useRoomCanvasStore((state) => state.furnitureList)
  const draggingAssetId = useRoomCanvasStore((state) => state.draggingAssetId)
  const asset = useRoomCanvasStore((state) => state.uploadedAssets.find((item) => item.id === draggingAssetId))
  return <>
    {furnitureList.map((item) => <FurnitureObject key={item.id} item={item} />)}
    {asset && <PlacementPreview asset={asset} />}
  </>
}

if (typeof window !== 'undefined') useGLTF.preload('/demo/sofa-edit-low.glb')
