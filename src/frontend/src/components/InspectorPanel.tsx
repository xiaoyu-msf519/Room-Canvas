import { CircleHelp, Image, Move3d, Trash2, WandSparkles } from 'lucide-react'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'

export function InspectorPanel() {
  const selectedId = useRoomCanvasStore((state) => state.selectedId)
  const selectedItem = useRoomCanvasStore((state) => state.furnitureList.find((item) => item.id === selectedId))

  return (
    <aside className="hud-panel inspector-panel glass-panel">
      <div className="panel-heading">
        <div className="panel-title"><Move3d size={15} /><span>Inspector</span></div>
        <span className="panel-meta">PROPERTIES</span>
      </div>
      {!selectedItem ? (
        <div className="inspector-empty">
          <div className="empty-orbit"><CircleHelp size={20} /></div>
          <strong>未选择对象</strong>
          <span>在场景或左侧列表中选择对象<br />以查看属性</span>
          <div className="inspector-preview-placeholder"><Image size={16} /><span>关键帧预览位</span></div>
          <div className="inspector-disabled-actions"><span>TRANSFORM</span><span>AI RECONSTRUCTION</span></div>
        </div>
      ) : (
        <div className="inspector-content">
          <div className="selected-object-title"><span className="status-dot" />{selectedItem.name}<small>{selectedItem.kind === 'original' ? 'ORIGINAL' : 'IMPORTED'}</small></div>
          <div className="inspector-section"><span className="section-label">TRANSFORM / 米</span><div className="value-grid"><label>位置<input value={selectedItem.position.join(' / ')} readOnly /></label><label>尺寸<input value={selectedItem.size.join(' / ')} readOnly /></label><label>旋转<input value={selectedItem.rotation.join(' / ')} readOnly /></label></div></div>
          <div className="inspector-section"><span className="section-label">模型校准</span><label className="radio-row"><input type="radio" defaultChecked name="scaleMode" />保持原比例</label><label className="radio-row"><input type="radio" name="scaleMode" />拉伸贴合原框</label></div>
          <div className="inspector-section"><span className="section-label">关键帧裁剪</span><div className="crop-placeholder"><Image size={15} /><span>暂无预览图</span></div><button className="secondary-action" type="button"><WandSparkles size={14} />AI 重建 3D</button></div>
          <button className="danger-action" type="button"><Trash2 size={14} />删除对象</button>
        </div>
      )}
    </aside>
  )
}
