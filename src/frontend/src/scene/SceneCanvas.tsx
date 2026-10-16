import { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import { EditCameraController, PlayCameraController } from './CameraControllers'
import { EmptyRoom } from './EmptyRoom'
import { Lighting } from './Lighting'

export function SceneCanvas() {
  const setSelectedId = useRoomCanvasStore((state) => state.setSelectedId)
  const controlsRef = useRef<OrbitControlsImpl>(null)

  return (
    <div className="scene-canvas" aria-label="RoomCanvas 3D scene">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [4.8, 4.4, 6.2], fov: 52, near: 0.05, far: 100 }}
        onPointerMissed={() => setSelectedId(null)}
        gl={{ antialias: true, logarithmicDepthBuffer: true }}
      >
        <color attach="background" args={["#c7d5db"]} />
        <Lighting />
        <EmptyRoom />
        <EditCameraController controlsRef={controlsRef} />
        <PlayCameraController controlsRef={controlsRef} />
      </Canvas>
    </div>
  )
}
