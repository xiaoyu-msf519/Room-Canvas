import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { AmbientLight, Color, DirectionalLight, Fog, HemisphereLight, Object3D, Quaternion, Vector3 } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import { useSolarStore } from '../state/useSolarStore'
import { createSolarAtlas } from '../solar/solarAtlas'
import { daylightAt, directSolarDirection, sampleSolarDirection } from '../solar/ephemeris'
import type { SolarTable } from '../types/solar'
import { SunPath } from './SunPath'

export function Lighting() {
  const year = useSolarStore((state) => state.year)
  const site = useSolarStore((state) => state.site)
  const setStatus = useSolarStore((state) => state.setStatus)
  const room = useRoomCanvasStore((state) => state.scan?.room)
  const mode = useRoomCanvasStore((state) => state.mode)
  const { scene, gl } = useThree()
  const sun = useRef<DirectionalLight>(null)
  const moon = useRef<DirectionalLight>(null)
  const ambient = useRef<AmbientLight>(null)
  const hemisphere = useRef<HemisphereLight>(null)
  const table = useRef<SolarTable | null>(null)
  const atlas = useRef<ReturnType<typeof createSolarAtlas> | null>(null)
  const center = useMemo(() => new Vector3(((room?.min[0] ?? -5) + (room?.max[0] ?? 5)) / 2, 0, ((room?.min[2] ?? -5) + (room?.max[2] ?? 5)) / 2), [room?.min[0], room?.max[0], room?.min[2], room?.max[2]])
  const radius = Math.max(room?.bounds[0] ?? 10, room?.bounds[2] ?? 10, 6) * 0.85
  const target = useMemo(() => new Object3D(), [])
  const rig = useMemo(() => {
    const state = useSolarStore.getState()
    const current = directSolarDirection(state.year, Math.floor(state.day), state.minute, state.site, new Vector3())
    return { current, desired: current.clone(), previous: new Vector3(Infinity, Infinity, Infinity), turn: new Quaternion(), partial: new Quaternion(),
      night: new Color('#080e1b'), day: new Color('#b7d1db'), dusk: new Color('#d1947b'), warmSun: new Color('#ffae72'), whiteSun: new Color('#fff4e1'),
      background: new Color(), fog: new Fog('#b7d1db', 24, 70), furniture: useRoomCanvasStore.getState().furnitureList, scan: useRoomCanvasStore.getState().scan, reducedMotion: false,
    }
  }, [])
  useEffect(() => {
    atlas.current = createSolarAtlas((next) => { table.current = next }, setStatus)
    return () => { atlas.current?.dispose(); atlas.current = null }
  }, [setStatus])
  useEffect(() => { atlas.current?.load(year, site) }, [year, site])
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => { rig.reducedMotion = preference.matches }
    sync(); preference.addEventListener('change', sync)
    return () => preference.removeEventListener('change', sync)
  }, [rig])
  useEffect(() => {
    const previousBackground = scene.background, previousFog = scene.fog, previousAuto = gl.shadowMap.autoUpdate
    scene.background = rig.background; scene.fog = rig.fog
    gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = true
    return () => { scene.background = previousBackground; scene.fog = previousFog; gl.shadowMap.autoUpdate = previousAuto }
  }, [gl, scene, rig])
  useEffect(() => {
    target.position.copy(center)
    sun.current?.shadow.camera.updateProjectionMatrix()
    gl.shadowMap.needsUpdate = true
  }, [center, radius, mode, gl, target])
  useFrame((_, delta) => {
    if (!sun.current || !moon.current || !ambient.current || !hemisphere.current) return
    const clock = useSolarStore.getState()
    if (table.current) sampleSolarDirection(table.current, clock.day, clock.minute, clock.north, rig.desired)
    // Spherical damping stays interruptible, including for opposite directions.
    rig.turn.setFromUnitVectors(rig.current, rig.desired)
    rig.partial.identity().slerp(rig.turn, rig.reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, 0.05) / 0.045))
    rig.current.applyQuaternion(rig.partial).normalize()
    const { sky, sun: sunlight } = daylightAt(rig.current.y)
    sun.current.position.copy(rig.current).multiplyScalar(radius * 3).add(center)
    sun.current.intensity = sunlight * 4
    sun.current.color.copy(rig.warmSun).lerp(rig.whiteSun, Math.min(1, Math.max(0, rig.current.y) / 0.45))
    ambient.current.intensity = 0.065 + sky * 0.45
    hemisphere.current.intensity = 0.07 + sky * 0.58
    moon.current.intensity = (1 - sky) * 0.18
    rig.background.copy(rig.night).lerp(rig.day, sky)
    const twilight = (1 - Math.min(1, Math.abs(rig.current.y) / 0.14)) * sky * 0.4
    rig.background.lerp(rig.dusk, twilight)
    rig.fog.color.copy(rig.background)
    const state = useRoomCanvasStore.getState()
    if ((sunlight > 0 && rig.previous.distanceToSquared(rig.current) > 1e-8) || state.isTransforming || state.furnitureList !== rig.furniture || state.scan !== rig.scan) {
      gl.shadowMap.needsUpdate = true
      rig.previous.copy(rig.current)
    }
    rig.furniture = state.furnitureList; rig.scan = state.scan
  })
  return <>
    <ambientLight ref={ambient} color="#dce5ee" />
    <hemisphereLight ref={hemisphere} color="#d5e9f2" groundColor="#4a4540" />
    <primitive object={target} />
    <directionalLight ref={sun} name="solar-sun" target={target} castShadow
      shadow-mapSize={[1024, 1024]} shadow-bias={-0.00015} shadow-normalBias={0.025}
      shadow-camera-near={0.1} shadow-camera-far={radius * 5}
      shadow-camera-left={-radius} shadow-camera-right={radius} shadow-camera-top={radius} shadow-camera-bottom={-radius} />
    <directionalLight ref={moon} name="solar-moon" color="#9fb7e0" position={[-6, 9, 4]} />
    <SunPath table={table} direction={rig.current} center={center} radius={radius * 1.12} />
  </>
}
