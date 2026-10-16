import { useMemo, useRef } from 'react'
import { TransformControls, useGLTF } from '@react-three/drei'
import type { Group, Object3D } from 'three'
import { Box3, Euler, Quaternion, Vector3 } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import type { FurnitureItem, Vec3 } from '../types/scene'

function cloneForDisplay(source: Object3D, ghost: boolean) {
  const clone = source.clone(true)
  clone.traverse((child) => {
    if (!('isMesh' in child) || !child.isMesh) return
    const mesh = child as typeof child & { material?: any }
    if (!mesh.material) return
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((material) => material.clone()) : mesh.material.clone()
    if (ghost) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => {
        material.transparent = true
        material.opacity = 0.34
        material.depthWrite = false
        if ('color' in material) material.color.set('#83e0ee')
      })
    }
  })
  return clone
}

function quatToEuler(rotation: FurnitureItem['rotation']) {
  return new Euler().setFromQuaternion(new Quaternion(...rotation).normalize())
}

function ModelObject({ modelUrl, size, ghost = false }: { modelUrl: string; size: Vec3; ghost?: boolean }) {
  const { scene } = useGLTF(modelUrl)
  const display = useMemo(() => cloneForDisplay(scene, ghost), [ghost, scene])
  const fit = useMemo(() => {
    const bounds = new Box3().setFromObject(display)
    const center = bounds.getCenter(new Vector3())
    const extents = bounds.getSize(new Vector3())
    return {
      center,
      scale: [size[0] / Math.max(extents.x, 0.0001), size[1] / Math.max(extents.y, 0.0001), size[2] / Math.max(extents.z, 0.0001)] as Vec3,
    }
  }, [display, size])
  return <group position={[-fit.center.x * fit.scale[0], -fit.center.y * fit.scale[1], -fit.center.z * fit.scale[2]]} scale={fit.scale}><primitive object={display} /></group>
}

function FurnitureObject({ item }: { item: FurnitureItem }) {
  const selectedId = useRoomCanvasStore((state) => state.selectedId)
  const transformMode = useRoomCanvasStore((state) => state.transformMode)
  const setSelectedId = useRoomCanvasStore((state) => state.setSelectedId)
  const updateFurniture = useRoomCanvasStore((state) => state.updateFurniture)
  const groupRef = useRef<Group>(null)
  const selected = selectedId === item.id

  const commitTransform = () => {
    const group = groupRef.current
    if (!group) return
    const nextPosition: Vec3 = [group.position.x, Math.max(item.size[1] / 2, group.position.y), group.position.z]
    const nextRotation: FurnitureItem['rotation'] = [group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w]
    const nextScale: Vec3 = [item.size[0] * group.scale.x, item.size[1] * group.scale.y, item.size[2] * group.scale.z]
    group.position.y = nextPosition[1]
    updateFurniture(item.id, { position: nextPosition, rotation: nextRotation, size: nextScale })
  }

  if (!item.modelUrl) return null
  return <group onClick={(event) => { event.stopPropagation(); setSelectedId(item.id) }}>
    {selected && <TransformControls mode={transformMode} size={0.7} showX showY={transformMode !== 'translate'} showZ axis={transformMode === 'rotate' ? 'Y' : undefined} onObjectChange={commitTransform}>
      <group ref={groupRef} position={item.position} rotation={quatToEuler(item.rotation)}>
        <ModelObject modelUrl={item.modelUrl} size={item.size} />
      </group>
    </TransformControls>}
    {!selected && <group ref={groupRef} position={item.position} rotation={quatToEuler(item.rotation)}><ModelObject modelUrl={item.modelUrl} size={item.size} /></group>}
  </group>
}

function PlacementPreview({ asset }: { asset: { modelUrl?: string; dimensionsMm?: { width: number; depth: number; height: number } } }) {
  const placementPreview = useRoomCanvasStore((state) => state.placementPreview)
  if (!placementPreview || !asset.dimensionsMm) return null
  const size: Vec3 = [asset.dimensionsMm.width / 1000, asset.dimensionsMm.height / 1000, asset.dimensionsMm.depth / 1000]
  const position: Vec3 = [placementPreview[0], size[1] / 2, placementPreview[2]]
  return <group position={position}>
    {asset.modelUrl ? <ModelObject modelUrl={asset.modelUrl} size={size} ghost /> : <mesh position={[0, -size[1] / 2 + 0.01, 0]}><boxGeometry args={[size[0], 0.02, size[2]]} /><meshBasicMaterial color="#83e0ee" transparent opacity={0.35} /></mesh>}
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

useGLTF.preload('/demo/sofa-scaled.glb')
