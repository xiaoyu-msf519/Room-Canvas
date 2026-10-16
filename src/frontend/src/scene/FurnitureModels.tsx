import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { TransformControls, useGLTF } from '@react-three/drei'
import type { Object3D } from 'three'
import { Box3, Group, Vector3 } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import type { FurnitureItem, Vec3 } from '../types/scene'
import type { TransformControls as TransformControlsImpl } from 'three-stdlib'
import { groundRotation } from './furnitureTransform'

function cloneForDisplay(source: Object3D, ghost: boolean) {
  const clone = source.clone(true)
  clone.traverse((child) => {
    if (!('isMesh' in child) || !child.isMesh) return
    const mesh = child as Object3D & { material?: any }
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

function ModelObject({ modelUrl, size }: { modelUrl: string; size: Vec3 }) {
  const { scene } = useGLTF(modelUrl)
  const fit = useMemo(() => {
    // Keep the GLB's own node transforms (including the real-scale wrapper),
    // but measure them inside an identity container. The returned inner offset
    // puts the visual bounds center exactly on the furniture root origin.
    const display = cloneForDisplay(scene, false)
    const measureRoot = new Group()
    measureRoot.add(display)
    measureRoot.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(measureRoot)
    const center = bounds.getCenter(new Vector3())
    const extents = bounds.getSize(new Vector3())
    return {
      display,
      center,
      scale: [size[0] / Math.max(extents.x, 0.0001), size[1] / Math.max(extents.y, 0.0001), size[2] / Math.max(extents.z, 0.0001)] as Vec3,
    }
  }, [scene, size])
  return <group scale={fit.scale}><group position={[-fit.center.x, -fit.center.y, -fit.center.z]}><primitive object={fit.display} /></group></group>
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
  return modelUrl ? <ModelObject modelUrl={modelUrl} size={size} /> : <LowProxy size={size} />
}

function FurnitureObject({ item }: { item: FurnitureItem }) {
  const selectedId = useRoomCanvasStore((state) => state.selectedId)
  const transformMode = useRoomCanvasStore((state) => state.transformMode)
  const mode = useRoomCanvasStore((state) => state.mode)
  const setSelectedId = useRoomCanvasStore((state) => state.setSelectedId)
  const updateFurniture = useRoomCanvasStore((state) => state.updateFurniture)
  const setIsTransforming = useRoomCanvasStore((state) => state.setIsTransforming)
  const groupRef = useRef<Group>(null)
  const controlsRef = useRef<TransformControlsImpl>(null)
  const initialized = useRef(false)
  const selected = selectedId === item.id

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
    const nextPosition: Vec3 = [group.position.x, item.size[1] / 2, group.position.z]
    const nextRotation: FurnitureItem['rotation'] = [group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w]
    const nextSize: Vec3 = [
      Math.max(0.05, item.size[0] * Math.abs(group.scale.x)),
      Math.max(0.05, item.size[1] * Math.abs(group.scale.y)),
      Math.max(0.05, item.size[2] * Math.abs(group.scale.z)),
    ]
    group.position.y = nextPosition[1]
    group.scale.set(1, 1, 1)
    group.updateMatrixWorld(true)
    updateFurniture(item.id, {
      position: nextPosition,
      rotation: nextRotation,
      ...(transformMode === 'scale' ? { size: nextSize } : {}),
    })
    requestAnimationFrame(() => {
      setIsTransforming(false)
      const controls = controlsRef.current
      const currentGroup = groupRef.current
      if (!controls || !currentGroup) return
      controls.detach()
      controls.attach(currentGroup)
      controls.updateMatrixWorld()
    })
  }

  const modelUrl = mode === 'play' ? item.modelUrl : item.editModelUrl
  const group = <group ref={groupRef} onClick={(event) => { event.stopPropagation(); setSelectedId(item.id) }}>
    <FurnitureVisual modelUrl={modelUrl} size={item.size} />
  </group>

  return <>
    {group}
    {selected && mode === 'edit' && <TransformControls
      ref={controlsRef}
      object={groupRef as unknown as MutableRefObject<Group>}
      mode={transformMode}
      size={0.7}
      showX={transformMode !== 'rotate'}
      showY={transformMode !== 'translate'}
      showZ={transformMode !== 'rotate'}
      space="world"
      onMouseDown={() => setIsTransforming(true)}
      onObjectChange={() => {
        if (transformMode === 'rotate' && groupRef.current) {
          groupRef.current.quaternion.copy(groundRotation(groupRef.current.quaternion))
        }
      }}
      onMouseUp={commitTransform}
    />}
  </>
}

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

useGLTF.preload('/demo/sofa-edit-low.glb')
