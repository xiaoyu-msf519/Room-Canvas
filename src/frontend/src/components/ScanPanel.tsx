import { useRef, useState, type ChangeEvent } from 'react'
import { Archive, FolderOpen, ScanLine, WandSparkles, RefreshCw } from 'lucide-react'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import type { SceneManifest } from '../types/scene'

export function ScanPanel({ onToast }: { onToast: (message: string) => void }) {
  const scan = useRoomCanvasStore((state) => state.scan)
  const applyScan = useRoomCanvasStore((state) => state.applyScan)
  const setSelectedId = useRoomCanvasStore((state) => state.setSelectedId)
  const [busy, setBusy] = useState(false)
  const zipInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const request = async (url: string, body?: FormData) => {
    setBusy(true)
    try {
      const response = await fetch(url, { method: 'POST', body })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || '扫描导入失败')
      applyScan(payload as SceneManifest)
    } catch (error) { onToast(error instanceof Error ? error.message : '扫描请求失败') }
    finally { setBusy(false) }
  }
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return
    const form = new FormData()
    files.forEach((file) => form.append('files', file, file.webkitRelativePath || file.name))
    void request('/api/scans', form)
    event.target.value = ''
  }
  const complete = scan?.furniture.filter((item) => item.generationStatus === 'succeeded').length ?? 0
  const active = scan?.furniture.some((item) => ['queued', 'generating', 'scaling'].includes(item.generationStatus ?? ''))

  return <aside className="scan-panel glass-panel">
    <div className="scan-header"><ScanLine size={15} /><strong>扫描房间</strong><span>{scan ? `${complete} / ${scan.furniture.length}` : '未导入'}</span></div>
    <div className="scan-import-actions">
      <button type="button" disabled={busy} onClick={() => void request('/api/scans/demo')}><ScanLine size={13} />载入样例</button>
      <button type="button" disabled={busy} title="导入扫描 ZIP" onClick={() => zipInput.current?.click()}><Archive size={14} /></button>
      <button type="button" disabled={busy} title="导入扫描文件夹" onClick={() => folderInput.current?.click()}><FolderOpen size={14} /></button>
      <input ref={zipInput} type="file" accept=".zip" hidden onChange={upload} />
      <input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: '' }} onChange={upload} />
    </div>
    {scan && <>
      <div className="scan-title" title={scan.title}>{scan.title}</div>
      <button className="scan-reconstruct" type="button" disabled={busy || active} onClick={() => void request(`/api/scenes/${scan.id}/reconstruct`)}><WandSparkles size={14} />{active ? '家具重建中' : complete === scan.furniture.length ? '重建完成' : '重建扫描家具'}</button>
      <div className="scan-furniture-list">
        {scan.furniture.map((item) => <div className="scan-furniture-row" key={item.id}>
          <button className="scan-object" type="button" onClick={() => setSelectedId(item.id)}>
            {item.cropUrl && <img src={item.cropUrl} alt={item.name} />}
            <span><strong>{item.name}</strong><small title={item.error ?? item.stageMessage}>{item.generationStatus === 'succeeded' ? '已原位回填' : item.generationStatus === 'failed' ? '重建失败' : item.stageMessage ?? '等待重建'}</small></span>
          </button>
          {item.generationStatus === 'failed' && <button type="button" title="重试此家具" onClick={() => void request(`/api/scenes/${scan.id}/furniture/${item.id}/reconstruct`)}><RefreshCw size={13} /></button>}
        </div>)}
      </div>
    </>}
  </aside>
}
