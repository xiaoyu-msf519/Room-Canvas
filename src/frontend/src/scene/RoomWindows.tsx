import { useEffect, useMemo } from 'react'
import { BoxGeometry, DoubleSide, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { RoomWindow } from '../types/scene'

export function RoomWindows({ windows }: { windows: RoomWindow[] }) {
  const geometry = useMemo(() => {
    const bars: BoxGeometry[] = []
    const thickness = 0.045
    for (const window of windows) {
      const [width, height] = window.size
      const pose = new Matrix4().compose(new Vector3(...window.position), new Quaternion(...window.rotation), new Vector3(1, 1, 1))
      const addBar = (x: number, y: number, w: number, h: number) => {
        const bar = new BoxGeometry(w, h, 0.09)
        bar.translate(x, y, 0).applyMatrix4(pose)
        bars.push(bar)
      }
      addBar(0, (height - thickness) / 2, width, thickness)
      addBar(0, -(height - thickness) / 2, width, thickness)
      addBar((width - thickness) / 2, 0, thickness, height - thickness * 2)
      addBar(-(width - thickness) / 2, 0, thickness, height - thickness * 2)
      if (width >= 1.6) addBar(0, 0, thickness, height - thickness * 2)
    }
    const merged = mergeGeometries(bars)
    bars.forEach((bar) => bar.dispose())
    return merged
  }, [windows])
  const glass = useMemo(() => ({
    clear: new MeshStandardMaterial({ color: '#bbd9e3', transparent: true, opacity: 0.1, roughness: 0.15, depthWrite: false, side: DoubleSide }),
    privacy: new MeshStandardMaterial({ color: '#c3d2d5', transparent: true, opacity: 0.5, roughness: 1, depthWrite: false, side: DoubleSide }),
  }), [])
  useEffect(() => () => geometry?.dispose(), [geometry])
  useEffect(() => () => { glass.clear.dispose(); glass.privacy.dispose() }, [glass])
  return <group name="room-windows">
    {geometry && <mesh name="room-window-frames" geometry={geometry} castShadow receiveShadow><meshStandardMaterial color="#78858a" roughness={0.6} /></mesh>}
    {windows.map((window) => <mesh key={window.id} name="room-window-glass" position={window.position} quaternion={window.rotation} material={window.privacy ? glass.privacy : glass.clear} userData={{ windowId: window.id }}>
      <planeGeometry args={[window.size[0] - 0.09, window.size[1] - 0.09]} />
    </mesh>)}
  </group>
}
