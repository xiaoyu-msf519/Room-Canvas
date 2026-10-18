import { Grid, Line } from '@react-three/drei'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'

export function EmptyRoom() {
  const showWireframe = useRoomCanvasStore((state) => state.showWireframe)

  return (
    <group>
      <Grid
        args={[80, 80]}
        cellSize={0.2}
        cellThickness={0.55}
        cellColor="#66818d"
        sectionSize={1}
        sectionThickness={1.5}
        sectionColor="#b6d6dc"
        fadeDistance={120}
        fadeStrength={1.4}
        infiniteGrid={false}
        position={[0, 0.002, 0]}
      />
      <axesHelper args={[2.6]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.012, 0]}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#121a21" transparent opacity={0.62} roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.035, 0]} visible={showWireframe}>
        <boxGeometry args={[80, 0.04, 80]} />
        <meshBasicMaterial color="#76d4e6" wireframe transparent opacity={0.08} />
      </mesh>
      <Line points={[[-40, 0.03, -40], [40, 0.03, -40], [40, 0.03, 40], [-40, 0.03, 40], [-40, 0.03, -40]]} color="#4a6670" transparent opacity={0.55} lineWidth={1} />
    </group>
  )
}
