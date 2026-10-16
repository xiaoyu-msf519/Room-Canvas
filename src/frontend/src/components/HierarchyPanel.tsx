import { useState } from 'react'
import { Box, ChevronDown, ChevronRight, FolderTree, Package, ScanLine, ShoppingCart } from 'lucide-react'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'

interface TreeGroupProps {
  icon: typeof Box
  label: string
  count: number
  emptyLabel: string
}

function TreeGroup({ icon: Icon, label, count, emptyLabel }: TreeGroupProps) {
  const [open, setOpen] = useState(true)
  return (
    <div className="tree-group">
      <button className="tree-group-heading" type="button" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Icon size={14} />
        <span>{label}</span>
        <em>{count}</em>
      </button>
      {open && <div className="tree-group-content">{count ? <div className="tree-placeholder">对象已载入</div> : <span className="tree-empty">{emptyLabel}</span>}</div>}
    </div>
  )
}

export function HierarchyPanel() {
  const furnitureList = useRoomCanvasStore((state) => state.furnitureList)
  const originals = furnitureList.filter((item) => item.kind === 'original').length
  const imported = furnitureList.filter((item) => item.kind === 'imported').length

  return (
    <aside className="hud-panel hierarchy-panel glass-panel">
      <div className="panel-heading">
        <div className="panel-title"><FolderTree size={15} /><span>Hierarchy</span></div>
        <span className="panel-meta">SCENE / 00</span>
      </div>
      <div className="hierarchy-body">
        <div className="scene-root-row"><ScanLine size={14} /><span>RoomCanvas Scene</span><span className="live-dot" /></div>
        <TreeGroup icon={Box} label="房间底座" count={0} emptyLabel="暂未载入房间扫描数据" />
        <TreeGroup icon={Package} label="原有家具" count={originals} emptyLabel="暂无原有家具" />
        <TreeGroup icon={ShoppingCart} label="新增家具" count={imported} emptyLabel="暂无摆放家具" />
      </div>
      <div className="panel-footer"><span>米制空间</span><span>右手坐标 / Y-UP</span></div>
    </aside>
  )
}
