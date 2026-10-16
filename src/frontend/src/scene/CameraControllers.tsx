import { useEffect, useRef, type RefObject } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Euler, Vector3 } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'

type ControlsRef = RefObject<OrbitControlsImpl>

const LOOK_SENSITIVITY = 0.0022
const MAX_MOUSE_DELTA = 48
const MAX_PENDING_DELTA = 64
const MAX_FRAME_DELTA = 12

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function requestRawPointerLock(element: HTMLCanvasElement) {
  try {
    const result = element.requestPointerLock({ unadjustedMovement: true })
    if (result && typeof result.catch === 'function') {
      void result.catch(() => element.requestPointerLock())
    }
  } catch {
    // Older browsers do not accept PointerLockOptions.
    element.requestPointerLock()
  }
}

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
  const lookEuler = useRef(new Euler(0, 0, 0, 'YXZ'))
  const pendingLook = useRef({ x: 0, y: 0 })
  const ignoreMouseUntil = useRef(0)
  const exitRequested = useRef(false)
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
      pendingLook.current.x = 0
      pendingLook.current.y = 0
      exitRequested.current = false
      requestRawPointerLock(gl.domElement)
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
      if (mode === 'play') {
        const key = event.key.toLowerCase()
        if (key === 'escape') {
          exitRequested.current = true
          return
        }
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
          event.preventDefault()
          keys.current.add(key)
        }
      }
    }
    const onKeyUp = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase())
    const onMouseMove = (event: MouseEvent) => {
      if (mode !== 'play' || document.pointerLockElement !== element) return
      // Ignore the synthetic delta some browsers emit immediately after lock.
      if (performance.now() < ignoreMouseUntil.current) return
      const legacyEvent = event as MouseEvent & { mozMovementX?: number; mozMovementY?: number; webkitMovementX?: number; webkitMovementY?: number }
      const rawMovementX = event.movementX || legacyEvent.mozMovementX || legacyEvent.webkitMovementX || 0
      const rawMovementY = event.movementY || legacyEvent.mozMovementY || legacyEvent.webkitMovementY || 0
      const movementX = Number.isFinite(rawMovementX) ? rawMovementX : 0
      const movementY = Number.isFinite(rawMovementY) ? rawMovementY : 0
      const magnitude = Math.max(Math.abs(movementX), Math.abs(movementY))

      // A lock transition or a tab/focus resume can report a stale absolute
      // delta. Applying it is the source of the apparent camera teleport.
      // Pointer Lock has no viewport edge; discard the outlier instead.
      if (
        magnitude > MAX_MOUSE_DELTA
      ) {
        pendingLook.current.x = 0
        pendingLook.current.y = 0
        return
      }

      pendingLook.current.x = clamp(pendingLook.current.x + movementX, -MAX_PENDING_DELTA, MAX_PENDING_DELTA)
      pendingLook.current.y = clamp(pendingLook.current.y + movementY, -MAX_PENDING_DELTA, MAX_PENDING_DELTA)
    }
    const onClick = () => {
      if (mode === 'play' && document.pointerLockElement !== element) element.requestPointerLock()
    }
    const onPointerLockChange = () => {
      if (document.pointerLockElement === element) {
        pendingLook.current.x = 0
        pendingLook.current.y = 0
        ignoreMouseUntil.current = performance.now() + 80
        return
      }
      if (mode === 'play' && exitRequested.current) {
        exitRequested.current = false
        setMode('edit')
      }
    }
    const clearLookInput = () => {
      pendingLook.current.x = 0
      pendingLook.current.y = 0
      keys.current.clear()
    }
    const onPointerLockError = () => clearLookInput()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('pointerlockerror', onPointerLockError)
    window.addEventListener('blur', clearLookInput)
    element.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('pointerlockerror', onPointerLockError)
      window.removeEventListener('blur', clearLookInput)
      element.removeEventListener('click', onClick)
    }
  }, [gl.domElement, mode, setMode])

  useFrame((_, delta) => {
    if (mode !== 'play') return

    // Consume relative mouse input once per frame. This decouples camera look
    // from pointer-lock event frequency and prevents one large event from
    // producing a discontinuous jump.
    const lookDeltaX = clamp(pendingLook.current.x, -MAX_FRAME_DELTA, MAX_FRAME_DELTA)
    const lookDeltaY = clamp(pendingLook.current.y, -MAX_FRAME_DELTA, MAX_FRAME_DELTA)
    pendingLook.current.x -= lookDeltaX
    pendingLook.current.y -= lookDeltaY
    yaw.current = wrapAngle(yaw.current - lookDeltaX * LOOK_SENSITIVITY)
    pitch.current = clamp(pitch.current - lookDeltaY * LOOK_SENSITIVITY, -1.35, 1.35)

    lookEuler.current.set(pitch.current, yaw.current, 0, 'YXZ')
    camera.quaternion.setFromEuler(lookEuler.current)

    const forward = Number(keys.current.has('w') || keys.current.has('arrowup')) - Number(keys.current.has('s') || keys.current.has('arrowdown'))
    const strafe = Number(keys.current.has('d') || keys.current.has('arrowright')) - Number(keys.current.has('a') || keys.current.has('arrowleft'))
    if (!forward && !strafe) return
    const speed = keys.current.has('shift') ? 4.6 : 2.8
    const length = Math.hypot(forward, strafe) || 1
    // Three.js cameras look down local -Z. Keep W forward and D right
    // relative to that heading, regardless of the current yaw.
    const forwardX = -Math.sin(yaw.current)
    const forwardZ = -Math.cos(yaw.current)
    const rightX = Math.cos(yaw.current)
    const rightZ = -Math.sin(yaw.current)
    camera.position.x += ((forwardX * forward + rightX * strafe) / length) * speed * delta
    camera.position.z += ((forwardZ * forward + rightZ * strafe) / length) * speed * delta
    camera.position.x = Math.max(-9.7, Math.min(9.7, camera.position.x))
    camera.position.z = Math.max(-9.7, Math.min(9.7, camera.position.z))
    camera.position.y = 1.65
  })

  return null
}
