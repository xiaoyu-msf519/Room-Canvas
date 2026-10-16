import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, Fog } from 'three'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'

const presets = {
  morning: {
    background: '#c7d5db',
    ambient: '#dce9e7',
    ambientIntensity: 1.5,
    sun: '#fff7dc',
    sunIntensity: 3,
    position: [-4, 7, 3] as [number, number, number],
  },
  sunset: {
    background: '#4b302f',
    ambient: '#ffc8a6',
    ambientIntensity: 1.2,
    sun: '#ff9d6c',
    sunIntensity: 4,
    position: [5, 5, -4] as [number, number, number],
  },
  night: {
    background: '#0c1220',
    ambient: '#8fa7d2',
    ambientIntensity: 0.4,
    sun: '#9ab8ff',
    sunIntensity: 0.9,
    position: [-3, 6, 2] as [number, number, number],
  },
} as const

export function Lighting() {
  const presetName = useRoomCanvasStore((state) => state.lightingPreset)
  const mode = useRoomCanvasStore((state) => state.mode)
  const preset = presets[presetName]
  const { scene } = useThree()

  useEffect(() => {
    scene.background = new Color(preset.background)
    scene.fog = new Fog(preset.background, 18, 42)
  }, [preset.background, scene])

  return (
    <>
      <ambientLight color={preset.ambient} intensity={preset.ambientIntensity} />
      <hemisphereLight color={preset.ambient} groundColor="#1e2430" intensity={0.45} />
      <directionalLight
        castShadow={mode === 'play'}
        color={preset.sun}
        intensity={preset.sunIntensity}
        position={preset.position}
        shadow-mapSize={mode === 'play' ? [2048, 2048] : [512, 512]}
        shadow-camera-near={0.1}
        shadow-camera-far={35}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      {presetName === 'night' && <pointLight color="#8aa5ff" intensity={2.2} distance={12} position={[0, 3.5, 1]} />}
    </>
  )
}
