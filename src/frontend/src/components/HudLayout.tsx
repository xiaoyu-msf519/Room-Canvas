import { Crosshair } from 'lucide-react'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import { AssetDrawer } from './AssetDrawer'
import { HierarchyPanel } from './HierarchyPanel'
import { InspectorPanel } from './InspectorPanel'
import { TopToolbar } from './TopToolbar'

interface HudLayoutProps {
  onToast: (message: string) => void
}

export function HudLayout({ onToast }: HudLayoutProps) {
  const mode = useRoomCanvasStore((state) => state.mode)
  const isPlay = mode === 'play'
  return (
    <div className={`hud-layer ${isPlay ? 'is-play-mode' : ''}`}>
      <TopToolbar onToast={onToast} />
      {!isPlay && <><HierarchyPanel /><InspectorPanel /><AssetDrawer onToast={onToast} /></>}
      {isPlay && <div className="play-hint"><Crosshair size={13} /> WASD / 方向键移动 <span>·</span> 鼠标环视 <span>·</span> ESC 退出</div>}
    </div>
  )
}
