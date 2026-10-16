import { useRef, useLayoutEffect, useMemo, type DragEvent } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import type { MutableRefObject, RefObject } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Camera, WebGLRenderer } from 'three'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import { EditCameraController, PlayCameraController } from './CameraControllers'
import { EmptyRoom } from './EmptyRoom'
import { FurnitureModels } from './FurnitureModels'
import { Lighting } from './Lighting'
import { ScannedRoom } from './ScannedRoom'
import { createWalkFloor } from './navigation'

function SceneViewportBridge({ cameraRef, rendererRef }: { cameraRef: MutableRefObject<Camera | null>; rendererRef: MutableRefObject<WebGLRenderer | null> }) {
  const { camera, gl } = useThree()
  cameraRef.current = camera
  rendererRef.current = gl
  return null
}

export function SceneCanvas() {
  const mode = useRoomCanvasStore((state) => state.mode)
  const setSelectedId = useRoomCanvasStore((state) => state.setSelectedId)
  const draggingAssetId = useRoomCanvasStore((state) => state.draggingAssetId)
  const assets = useRoomCanvasStore((state) => state.uploadedAssets)
  const setDraggingAssetId = useRoomCanvasStore((state) => state.setDraggingAssetId)
  const setPlacementPreview = useRoomCanvasStore((state) => state.setPlacementPreview)
  const addFurniture = useRoomCanvasStore((state) => state.addFurniture)
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const cameraRef = useRef<Camera | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const scan = useRoomCanvasStore((state) => state.scan)

  const placeBounds = scan?.room
  const floorTriangles = useMemo(() => createWalkFloor(scan?.room.surfaces ?? []), [scan?.room.surfaces])

  const groundPoint = (clientX: number, clientY: number) => {
    const camera = cameraRef.current
    const renderer = rendererRef.current
    if (!camera || !renderer) return null
    const rect = renderer.domElement.getBoundingClientRect()
    const pointer = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    const raycaster = new Raycaster()
    raycaster.setFromCamera(pointer, camera)
    const point = floorTriangles.length
      ? floorTriangles.map((triangle) => raycaster.ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, new Vector3())).find(Boolean)
      : raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())
    if (!point) return null
    return [Math.max(placeBounds?.min[0] ?? -4.8, Math.min(placeBounds?.max[0] ?? 4.8, point.x)), 0, Math.max(placeBounds?.min[2] ?? -4.8, Math.min(placeBounds?.max[2] ?? 4.8, point.z))] as [number, number, number]
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingAssetId) return
    event.preventDefault()
    const point = groundPoint(event.clientX, event.clientY)
    if (point) setPlacementPreview(point)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingAssetId) return
    event.preventDefault()
    const asset = assets.find((item) => item.id === draggingAssetId)
    const point = groundPoint(event.clientX, event.clientY)
    if (asset?.modelUrl && asset.dimensionsMm && point) {
      const size: [number, number, number] = [asset.dimensionsMm.width / 1000, asset.dimensionsMm.height / 1000, asset.dimensionsMm.depth / 1000]
      addFurniture({ id: crypto.randomUUID(), name: asset.name, kind: 'imported', position: [point[0], size[1] / 2, point[2]], size, rotation: [0, 0, 0, 1], modelUrl: asset.modelUrl, editModelUrl: asset.editModelUrl, generationStatus: 'succeeded' })
      setSelectedId(null)
    }
    setDraggingAssetId(null)
  }

  return (
    <div className="scene-canvas" aria-label="RoomCanvas 3D scene" onDragOver={onDragOver} onDrop={onDrop}>
      <Canvas
        shadows={mode === 'play'}
        dpr={mode === 'play' ? [1, 2] : [1, 1.35]}
        camera={{ position: [4.8, 4.4, 6.2], fov: 52, near: 0.05, far: 100 }}
        onPointerMissed={() => {
          if (!useRoomCanvasStore.getState().isTransforming) setSelectedId(null)
        }}
        gl={{ antialias: true, logarithmicDepthBuffer: true }}
      >
        <color attach="background" args={["#c7d5db"]} />
        <Lighting />
        <EmptyRoom />
        <ScannedRoom />
        <ScanCameraFit controlsRef={controlsRef} />
        <SceneViewportBridge cameraRef={cameraRef} rendererRef={rendererRef} />
        <FurnitureModels />
        <EditCameraController controlsRef={controlsRef} />
        <PlayCameraController controlsRef={controlsRef} />
      </Canvas>
    </div>
  )
}

function ScanCameraFit({ controlsRef }: { controlsRef: RefObject<OrbitControlsImpl> }) {
  const scan = useRoomCanvasStore((state) => state.scan)
  const { camera } = useThree()
  useLayoutEffect(() => {
    if (!scan) return
    const radius = Math.max(scan.room.bounds[0], scan.room.bounds[2], 5)
    camera.position.set(radius * 0.65, radius * 0.65, radius * 0.85)
    controlsRef.current?.target.set(0, 0.8, 0)
    camera.lookAt(0, 0.8, 0)
    controlsRef.current?.update()
  }, [scan?.id, camera, controlsRef])
  return null
}
