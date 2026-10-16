import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Euler, PerspectiveCamera, Vector3 } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import { canStandAt, captureEditorView, createWalkObstacles, EYE_HEIGHT, findWalkSpawn, restoreEditorView, setWalkFocus } from './navigation'
import { bindPlayExit } from './playExit'

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
  if (useRoomCanvasStore.getState().mode !== 'play') return
  try {
    const result = element.requestPointerLock({ unadjustedMovement: true })
    if (result && typeof result.catch === 'function') {
      void result.catch(() => {
        if (useRoomCanvasStore.getState().mode === 'play') element.requestPointerLock()
      })
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
      enableDamping={false}
      enableZoom={mode === 'edit'}
      zoomSpeed={1.1}
      minDistance={0.25}
      maxDistance={80}
      maxPolarAngle={Math.PI * 0.49}
      target={[0, 0.8, 0]}
      mouseButtons={{ LEFT: 0, MIDDLE: 1, RIGHT: 2 }}
    />
  )
}

export function PlayCameraController({ controlsRef }: { controlsRef: ControlsRef }) {
  const mode = useRoomCanvasStore((state) => state.mode)
  const setMode = useRoomCanvasStore((state) => state.setMode)
  const furnitureList = useRoomCanvasStore((state) => state.furnitureList)
  const roomColliders = useRoomCanvasStore((state) => state.roomColliders)
  const obstacles = useMemo(() => createWalkObstacles([...roomColliders, ...furnitureList]), [furnitureList, roomColliders])
  const { camera, gl } = useThree()
  const keys = useRef(new Set<string>())
  const yaw = useRef(0)
  const pitch = useRef(-0.1)
  const lookEuler = useRef(new Euler(0, 0, 0, 'YXZ'))
  const pendingLook = useRef({ x: 0, y: 0 })
  const ignoreMouseUntil = useRef(0)
  const lastMode = useRef(mode)
  const editorView = useRef<ReturnType<typeof captureEditorView> | null>(null)
  const exitMonitor = useRef<ReturnType<typeof bindPlayExit> | null>(null)
  const focusFov = useRef<number | null>(null)
  const releaseFocus = useCallback(() => {
    if (camera instanceof PerspectiveCamera && focusFov.current !== null) {
      setWalkFocus(camera, false, focusFov.current)
      focusFov.current = null
    }
  }, [camera])

  // Register before requesting lock, and retain listeners across mode changes.
  useLayoutEffect(() => {
    const monitor = bindPlayExit(
      gl.domElement,
      () => useRoomCanvasStore.getState().mode === 'play',
      () => {
        releaseFocus()
        keys.current.clear()
        pendingLook.current.x = 0
        pendingLook.current.y = 0
        setMode('edit')
      },
    )
    exitMonitor.current = monitor
    return () => {
      monitor.dispose()
      exitMonitor.current = null
    }
  }, [gl.domElement, releaseFocus, setMode])

  useLayoutEffect(() => {
    const controls = controlsRef.current
    if (mode === 'play' && lastMode.current !== 'play') {
      // Snapshot before spawning; do not let OrbitControls consume a Play frame.
      editorView.current = captureEditorView(camera, controls?.target ?? new Vector3())
      if (controls) controls.enabled = false
      keys.current.clear()
      pendingLook.current.x = 0
      pendingLook.current.y = 0
      const spawn = findWalkSpawn(obstacles)
      if (!spawn) {
        setMode('edit')
        return
      }
      const direction = new Vector3()
      camera.getWorldDirection(direction)
      yaw.current = Math.atan2(-direction.x, -direction.z)
      pitch.current = 0
      camera.position.copy(spawn)
      lookEuler.current.set(0, yaw.current, 0, 'YXZ')
      camera.quaternion.setFromEuler(lookEuler.current)
      if (camera instanceof PerspectiveCamera) {
        camera.fov = 52
        camera.zoom = 1
        camera.updateProjectionMatrix()
      }
      requestRawPointerLock(gl.domElement)
    }
    if (mode === 'edit' && lastMode.current === 'play') {
      releaseFocus()
      if (document.pointerLockElement === gl.domElement) document.exitPointerLock()
      keys.current.clear()
      pendingLook.current.x = 0
      pendingLook.current.y = 0
      if (editorView.current && controls) {
        restoreEditorView(camera, controls.target, editorView.current)
      }
      if (controls) controls.enabled = true
    }
    lastMode.current = mode
  }, [camera, controlsRef, gl.domElement, mode, obstacles, releaseFocus, setMode])

  useEffect(() => {
    const element = gl.domElement
    const onKeyDown = (event: KeyboardEvent) => {
      if (useRoomCanvasStore.getState().mode === 'play') {
        const key = event.key.toLowerCase()
        if (event.code === 'KeyC' || key === 'c') {
          if (event.ctrlKey || event.metaKey || event.altKey) return
          event.preventDefault()
          if (camera instanceof PerspectiveCamera && focusFov.current === null) {
            focusFov.current = camera.fov
            setWalkFocus(camera, true, focusFov.current)
          }
          return
        }
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
          event.preventDefault()
          keys.current.add(key)
        }
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current.delete(event.key.toLowerCase())
      if (event.code === 'KeyC' || event.key.toLowerCase() === 'c') releaseFocus()
    }
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
      if (mode === 'play' && document.pointerLockElement !== element) requestRawPointerLock(element)
    }
    const onWheel = (event: WheelEvent) => {
      if (useRoomCanvasStore.getState().mode === 'play') event.preventDefault()
    }
    const onPointerLockChange = () => {
      if (document.pointerLockElement === element) {
        pendingLook.current.x = 0
        pendingLook.current.y = 0
        ignoreMouseUntil.current = performance.now() + 80
        return
      }
    }
    const clearLookInput = () => {
      releaseFocus()
      pendingLook.current.x = 0
      pendingLook.current.y = 0
      keys.current.clear()
    }
    const onPointerLockError = () => clearLookInput()
    const onVisibilityChange = () => {
      if (document.hidden) clearLookInput()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('pointerlockerror', onPointerLockError)
    document.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', clearLookInput)
    element.addEventListener('click', onClick)
    return () => {
      releaseFocus()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('pointerlockerror', onPointerLockError)
      document.removeEventListener('wheel', onWheel)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('blur', clearLookInput)
      element.removeEventListener('click', onClick)
    }
  }, [camera, gl.domElement, mode, releaseFocus])

  useFrame((_, delta) => {
    exitMonitor.current?.checkLock()
    if (mode !== 'play' || useRoomCanvasStore.getState().mode !== 'play') return

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
    camera.position.y = EYE_HEIGHT

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
    const step = speed * Math.min(delta, 0.05) / length
    const nextX = camera.position.x + (forwardX * forward + rightX * strafe) * step
    const nextZ = camera.position.z + (forwardZ * forward + rightZ * strafe) * step
    if (canStandAt(nextX, camera.position.z, obstacles)) camera.position.x = nextX
    if (canStandAt(camera.position.x, nextZ, obstacles)) camera.position.z = nextZ
  })

  return null
}
