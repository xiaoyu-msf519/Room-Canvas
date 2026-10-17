import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Archive, Download, FolderOpen, ScanLine, WandSparkles, RefreshCw } from 'lucide-react'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import type { SceneManifest } from '../types/scene'
import { collectScanFiles, uploadScan } from '../services/scanUpload'

export function ScanPanel({ onToast }: { onToast: (message: string) => void }) {
  const scan = useRoomCanvasStore((state) => state.scan)
  const applyScan = useRoomCanvasStore((state) => state.applyScan)
  const setSelectedId = useRoomCanvasStore((state) => state.setSelectedId)
  const [busy, setBusy] = useState(false)
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [rooms, setRooms] = useState<Array<{ id: string; scanId?: string; title: string; folder: string; status: string; objectCount: number; cachedModels: number }>>([])
  useEffect(() => {
    const controller = new AbortController()
    const refreshRooms = () => {
      void fetch('/api/room-library', { signal: controller.signal }).then((response) => response.ok ? response.json() : { rooms: [] }).then((data) => setRooms(data.rooms)).catch(() => {})
    }
    refreshRooms()
    const timer = window.setInterval(refreshRooms, 10000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [scan?.id, scan?.pipeline?.completed])

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
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return
    event.target.value = ''
    setBusy(true)
    setUploadPercent(0)
    try {
      const form = new FormData()
      const selected = files.length === 1 && /\.zip$/i.test(files[0].name)
        ? [{ file: files[0], path: files[0].name }]
        : await collectScanFiles(files)
      selected.forEach(({ file, path }) => form.append('files', file, path))
      applyScan(await uploadScan(form, setUploadPercent))
    } catch (error) { onToast(error instanceof Error ? error.message : '扫描导入失败') }
    finally { setBusy(false); setUploadPercent(null) }
  }
  const complete = scan?.furniture.filter((item) => item.generationStatus === 'succeeded').length ?? 0
  const active = scan?.pipeline?.status === 'processing' || scan?.furniture.some((item) => ['preparing', 'queued', 'generating', 'scaling'].includes(item.generationStatus ?? ''))
  const retryable = scan?.furniture.some((item) => item.generationStatus === 'failed') || scan?.pipeline?.preparation === 'failed'

  return <aside className="scan-panel glass-panel">
    <div className="scan-header"><ScanLine size={15} /><strong>扫描房间</strong><span>{scan ? `${complete} / ${scan.furniture.length}` : '未导入'}</span></div>
    <div className="scan-import-actions">
      <button type="button" disabled={busy} title="选择 App 输出文件夹并自动建房" aria-label="选择 App 输出文件夹并自动建房" onClick={() => folderInput.current?.click()}><FolderOpen size={13} />导入房间</button>
      <button type="button" disabled={busy} title="导入扫描 ZIP" aria-label="导入扫描 ZIP" onClick={() => zipInput.current?.click()}><Archive size={14} /></button>
      <button type="button" disabled={busy} title="重新载入最近导入的房间" aria-label="重新载入最近导入的房间" onClick={() => void request('/api/scans/demo')}><RefreshCw size={14} /></button>
      <input ref={zipInput} type="file" accept=".zip" hidden onChange={(event) => void upload(event)} />
      <input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: '' }} onChange={(event) => void upload(event)} />
    </div>
    {rooms.length > 0 && <select className="scan-room-select" aria-label="选择本机扫描房间" disabled={busy} value={rooms.find((room) => room.scanId === scan?.source.scanId)?.id ?? ''} onChange={(event) => { if (event.target.value) void request(`/api/room-library/${event.target.value}/load`) }}>
      <option value="" disabled>选择房间（{rooms.length} 份采集）</option>
      {rooms.map((room) => <option key={room.id} value={room.id} disabled={room.status !== 'complete'} title={room.folder}>{room.title} · {room.status !== 'complete' ? '扫描未完成' : `${room.cachedModels}/${room.objectCount} 已缓存`}</option>)}
    </select>}
    {uploadPercent !== null && <div className="scan-pipeline" role="status"><span>{uploadPercent < 100 ? `上传中 ${uploadPercent}%` : '校验采集包中'}</span><progress max={100} value={uploadPercent} /></div>}
    {scan && <>
      <div className="scan-title" title={scan.title}>{scan.title}</div>
      {scan.pipeline && <div className="scan-pipeline" role="status"><span>{scan.pipeline.stageMessage}</span><progress max={Math.max(1, scan.pipeline.total)} value={scan.pipeline.completed} /></div>}
      <div className="scan-orientation">{scan.source.orientation?.reference === 'true-north' ? `北向 ${scan.source.orientation.northAngleDegrees?.toFixed(1)}°` : '北向待校准'}{scan.pipeline?.needsReview ? ` · ${scan.pipeline.needsReview} 件待补拍` : ''}</div>
      {scan.cache?.warning && <div className="scan-cache-warning" role="status">{scan.cache.warning}</div>}
      <button className="scan-cache-download" type="button" title="下载可随扫描目录迁移的模型缓存" onClick={() => window.location.assign(`/api/scenes/${scan.id}/cache`)}><Download size={13} />导出房间缓存</button>
      {(!scan.pipeline?.autoReconstruct || retryable) && <button className="scan-reconstruct" type="button" disabled={busy || active} onClick={() => void request(`/api/scenes/${scan.id}/reconstruct`)}><WandSparkles size={14} />{retryable ? '重试失败任务' : complete === scan.furniture.length ? '重建完成' : '继续家具重建'}</button>}
      <div className="scan-furniture-list">
        {scan.furniture.map((item) => <div className="scan-furniture-row" key={item.id}>
          <button className="scan-object" type="button" onClick={() => setSelectedId(item.id)}>
            {item.cropUrl && <img src={item.cropUrl} alt={item.name} />}
            <span><strong>{item.name}</strong><small title={item.error ?? item.stageMessage}>{item.generationStatus === 'succeeded' ? '已原位回填' : item.generationStatus === 'needs_review' ? '需补拍独立视角' : item.generationStatus === 'failed' ? '重建失败' : item.stageMessage ?? '等待自动处理'}</small></span>
          </button>
          {item.generationStatus === 'failed' && <button type="button" title="重试此家具" onClick={() => void request(`/api/scenes/${scan.id}/furniture/${item.id}/reconstruct`)}><RefreshCw size={13} /></button>}
        </div>)}
      </div>
    </>}
  </aside>
}
