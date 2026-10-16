import { useEffect } from 'react'
import {
  CloudSun,
  Eye,
  EyeOff,
  Maximize2,
  Moon,
  Move,
  Play,
  RotateCw,
  Save,
  Square,
  Sun,
} from 'lucide-react'
import { useRoomCanvasStore, type LightingPreset, type TransformMode } from '../state/useRoomCanvasStore'

interface TopToolbarProps {
  onToast: (message: string) => void
}

const transformTools: Array<{ id: TransformMode; label: string; shortcut: string; icon: typeof Move }> = [
  { id: 'translate', label: '移动', shortcut: 'W', icon: Move },
  { id: 'rotate', label: '旋转', shortcut: 'E', icon: RotateCw },
  { id: 'scale', label: '缩放', shortcut: 'R', icon: Maximize2 },
]

const lightingTools: Array<{ id: LightingPreset; label: string; icon: typeof Sun }> = [
  { id: 'morning', label: '晨光', icon: CloudSun },
  { id: 'sunset', label: '暖阳', icon: Sun },
  { id: 'night', label: '夜灯', icon: Moon },
]

export function TopToolbar({ onToast }: TopToolbarProps) {
  const mode = useRoomCanvasStore((state) => state.mode)
  const transformMode = useRoomCanvasStore((state) => state.transformMode)
  const showWireframe = useRoomCanvasStore((state) => state.showWireframe)
  const lightingPreset = useRoomCanvasStore((state) => state.lightingPreset)
  const setMode = useRoomCanvasStore((state) => state.setMode)
  const setTransformMode = useRoomCanvasStore((state) => state.setTransformMode)
  const setShowWireframe = useRoomCanvasStore((state) => state.setShowWireframe)
  const setLightingPreset = useRoomCanvasStore((state) => state.setLightingPreset)

  const playMode = mode === 'play'

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (mode !== 'edit' || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const shortcut = event.key.toLowerCase()
      if (shortcut === 'w') setTransformMode('translate')
      if (shortcut === 'e') setTransformMode('rotate')
      if (shortcut === 'r') setTransformMode('scale')
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [mode, setTransformMode])

  return (
    <header className="top-toolbar glass-panel">
      <div className="toolbar-section toolbar-brand">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <div>
          <strong>ROOM<span>CANVAS</span></strong>
          <small>SPATIAL EDITOR / 01</small>
        </div>
      </div>

      <div className="toolbar-section transform-tools" aria-label="Transform tools">
        {transformTools.map(({ id, label, shortcut, icon: Icon }) => (
          <button
            className={`tool-button ${transformMode === id ? 'is-active' : ''}`}
            key={id}
            type="button"
            onClick={() => setTransformMode(id)}
            title={`${label} (${shortcut})`}
          >
            <Icon size={15} strokeWidth={1.8} />
            <span>{label}</span>
            <kbd>{shortcut}</kbd>
          </button>
        ))}
        <span className="toolbar-divider" />
        <button
          className={`tool-button wireframe-button ${showWireframe ? 'is-active' : ''}`}
          type="button"
          onClick={() => setShowWireframe(!showWireframe)}
          title="显示原家具 Bounding Box"
        >
          {showWireframe ? <Eye size={15} /> : <EyeOff size={15} />}
          <span>原框对比</span>
        </button>
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
