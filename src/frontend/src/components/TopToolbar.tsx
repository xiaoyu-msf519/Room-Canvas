import {
  CloudSun,
  Moon,
  Play,
  Save,
  Square,
  Sun,
} from 'lucide-react'
import { useRoomCanvasStore, type LightingPreset } from '../state/useRoomCanvasStore'

interface TopToolbarProps {
  onToast: (message: string) => void
}

const lightingTools: Array<{ id: LightingPreset; label: string; icon: typeof Sun }> = [
  { id: 'morning', label: '晨光', icon: CloudSun },
  { id: 'sunset', label: '暖阳', icon: Sun },
  { id: 'night', label: '夜灯', icon: Moon },
]

export function TopToolbar({ onToast }: TopToolbarProps) {
  const mode = useRoomCanvasStore((state) => state.mode)
  const lightingPreset = useRoomCanvasStore((state) => state.lightingPreset)
  const setMode = useRoomCanvasStore((state) => state.setMode)
  const setLightingPreset = useRoomCanvasStore((state) => state.setLightingPreset)

  const playMode = mode === 'play'

  return (
    <header className="top-toolbar glass-panel">
      <div className="toolbar-section toolbar-left">
        <div className="toolbar-brand">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div>
            <strong>ROOM<span>CANVAS</span></strong>
            <small>SPATIAL EDITOR / 01</small>
          </div>
        </div>
      </div>

      <div className="mode-switcher" aria-live="polite">
        <span className="mode-label">{playMode ? 'PLAY MODE' : 'EDIT MODE'}</span>
        <button
          className={`play-button ${playMode ? 'is-playing' : ''}`}
          type="button"
          onClick={() => setMode(playMode ? 'edit' : 'play')}
          title={playMode ? '按 Esc 退出漫游' : '进入第一人称漫游'}
        >
          {playMode ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          <span>{playMode ? 'Playing' : 'Play 漫游'}</span>
          <kbd>{playMode ? 'ESC' : '↵'}</kbd>
        </button>
      </div>

      <div className="toolbar-section toolbar-actions">
        <div className="lighting-tools" aria-label="Lighting presets">
          {lightingTools.map(({ id, label, icon: Icon }) => (
            <button
              className={`icon-label-button ${lightingPreset === id ? 'is-active' : ''}`}
              key={id}
              type="button"
              onClick={() => setLightingPreset(id)}
              title={`切换到${label}`}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <button className="save-button" type="button" onClick={() => onToast('场景状态已保存到本地草稿')}>
          <Save size={15} />
          <span>保存场景</span>
        </button>
      </div>
    </header>
  )
}
