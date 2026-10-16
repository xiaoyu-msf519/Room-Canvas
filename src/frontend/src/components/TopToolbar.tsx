import { useEffect } from 'react'
import {
  CloudSun,
  Eye,
  EyeOff,
  Moon,
  Move,
  Play,
  Save,
  RotateCw,
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
  const showWireframe = useRoomCanvasStore((state) => state.showWireframe)
  const lightingPreset = useRoomCanvasStore((state) => state.lightingPreset)
  const transformMode = useRoomCanvasStore((state) => state.transformMode)
  const setMode = useRoomCanvasStore((state) => state.setMode)
  const setShowWireframe = useRoomCanvasStore((state) => state.setShowWireframe)
  const setLightingPreset = useRoomCanvasStore((state) => state.setLightingPreset)
  const setTransformMode = useRoomCanvasStore((state) => state.setTransformMode)

  const playMode = mode === 'play'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (playMode || useRoomCanvasStore.getState().isTransforming || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.code === 'KeyW') setTransformMode('translate')
      if (event.code === 'KeyE') setTransformMode('rotate')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [playMode, setTransformMode])

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

        {!playMode && <div className="furniture-tools" role="group" aria-label="家具变换工具">
          <button className={`tool-button ${transformMode === 'translate' ? 'is-active' : ''}`} type="button" aria-label="移动家具" aria-pressed={transformMode === 'translate'} title="移动家具 (W)" onClick={() => setTransformMode('translate')}><Move size={16} /></button>
          <button className={`tool-button ${transformMode === 'rotate' ? 'is-active' : ''}`} type="button" aria-label="旋转家具" aria-pressed={transformMode === 'rotate'} title="水平旋转家具 (E)" onClick={() => setTransformMode('rotate')}><RotateCw size={16} /></button>
        </div>}

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
