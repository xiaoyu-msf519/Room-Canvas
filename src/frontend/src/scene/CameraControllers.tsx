import { useEffect, useRef, type RefObject } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Vector3 } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'

type ControlsRef = RefObject<OrbitControlsImpl>

export function EditCameraController({ controlsRef }: { controlsRef: ControlsRef }) {
  const mode = useRoomCanvasStore((state) => state.mode)
  return (
    <OrbitControls
      ref={controlsRef}
      enabled={mode === 'edit'}
      enableDamping
      dampingFactor={0.08}
      minDistance={1.2}
      maxDistance={20}
      maxPolarAngle={Math.PI * 0.49}
      target={[0, 0.8, 0]}
      mouseButtons={{ LEFT: 0, MIDDLE: 1, RIGHT: 2 }}
    />
  )
}

export function PlayCameraController({ controlsRef }: { controlsRef: ControlsRef }) {
  const mode = useRoomCanvasStore((state) => state.mode)
  const setMode = useRoomCanvasStore((state) => state.setMode)
  const { camera, gl } = useThree()
  const keys = useRef(new Set<string>())
  const yaw = useRef(0)
  const pitch = useRef(-0.1)
  const lastMode = useRef(mode)

  useEffect(() => {
    if (mode === 'play' && lastMode.current !== 'play') {
      const direction = new Vector3()
      camera.getWorldDirection(direction)
      yaw.current = Math.atan2(-direction.x, -direction.z)
      pitch.current = Math.asin(Math.max(-1, Math.min(1, direction.y)))
      camera.position.y = 1.65
      camera.position.x = Math.max(-9.7, Math.min(9.7, camera.position.x))
      camera.position.z = Math.max(-9.7, Math.min(9.7, camera.position.z))
      gl.domElement.requestPointerLock()
    }
    if (mode === 'edit' && lastMode.current === 'play') {
      document.exitPointerLock()
      const direction = new Vector3()
      camera.getWorldDirection(direction)
      if (controlsRef.current) {
        controlsRef.current.target.copy(camera.position).add(direction.multiplyScalar(3))
        controlsRef.current.update()
      }
    }
    lastMode.current = mode
  }, [camera, controlsRef, gl.domElement, mode])

  useEffect(() => {
    const element = gl.domElement
    const onKeyDown = (event: KeyboardEvent) => {
      if (mode === 'play') keys.current.add(event.key.toLowerCase())
    }
    const onKeyUp = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase())
    const onMouseMove = (event: MouseEvent) => {
      if (mode !== 'play' || document.pointerLockElement !== element) return
      yaw.current -= event.movementX * 0.0022
      pitch.current -= event.movementY * 0.0022
      pitch.current = Math.max(-1.35, Math.min(1.35, pitch.current))
    }
    const onClick = () => {
      if (mode === 'play' && document.pointerLockElement !== element) element.requestPointerLock()
    }
    const onPointerLockChange = () => {
      if (mode === 'play' && document.pointerLockElement !== element) setMode('edit')
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    element.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      element.removeEventListener('click', onClick)
    }
  }, [gl.domElement, mode, setMode])

  useFrame((_, delta) => {
    if (mode !== 'play') return
    const forward = Number(keys.current.has('w') || keys.current.has('arrowup')) - Number(keys.current.has('s') || keys.current.has('arrowdown'))
    const strafe = Number(keys.current.has('d') || keys.current.has('arrowright')) - Number(keys.current.has('a') || keys.current.has('arrowleft'))
    if (!forward && !strafe) return
    const speed = keys.current.has('shift') ? 4.6 : 2.8
    const length = Math.hypot(forward, strafe) || 1
    camera.position.x += ((Math.sin(yaw.current) * forward + Math.cos(yaw.current) * strafe) / length) * speed * delta
    camera.position.z += ((Math.cos(yaw.current) * -forward + Math.sin(yaw.current) * strafe) / length) * speed * delta
    camera.position.x = Math.max(-9.7, Math.min(9.7, camera.position.x))
    camera.position.z = Math.max(-9.7, Math.min(9.7, camera.position.z))
    camera.position.y = 1.65
    camera.rotation.order = 'YXZ'
    camera.rotation.y = yaw.current
    camera.rotation.x = pitch.current
  })

  return null
}
