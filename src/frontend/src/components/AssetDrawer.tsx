import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { ClipboardPaste, FileImage, Link, PackageOpen, Plus, Ruler, Upload, X } from 'lucide-react'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import type { AssetSource, UploadedAsset } from '../types/scene'

interface AssetDrawerProps { onToast: (message: string) => void }
interface Dimensions { width: string; depth: string; height: string }
const emptyDimensions: Dimensions = { width: '', depth: '', height: '' }

function imageUrlFromHtml(html: string) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match?.[1] ?? null
}

function assetName(name: string) {
  return name.replace(/\.[^/.]+$/, '').slice(0, 32) || '上传商品图'
}

export function AssetDrawer({ onToast }: AssetDrawerProps) {
  const mode = useRoomCanvasStore((state) => state.mode)
  const assets = useRoomCanvasStore((state) => state.uploadedAssets)
  const addAsset = useRoomCanvasStore((state) => state.addUploadedAsset)
  const updateAsset = useRoomCanvasStore((state) => state.updateUploadedAsset)
  const removeAsset = useRoomCanvasStore((state) => state.removeUploadedAsset)
  const setDraggingAssetId = useRoomCanvasStore((state) => state.setDraggingAssetId)
  const [dragging, setDragging] = useState(false)
  const [dimensions, setDimensions] = useState<Record<string, Dimensions>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (assets.some((asset) => asset.source === 'demo')) return
    addAsset({
      id: 'demo-sofa', name: '沙发示例 · Rodin GLB', previewUrl: '/demo/sofa.png', source: 'demo',
      status: 'succeeded', dimensionsMm: { width: 2100, depth: 900, height: 850 }, modelUrl: '/demo/sofa-scaled.glb', editModelUrl: '/demo/sofa-edit-low.glb',
      stageMessage: '生成完成，已按输入尺寸校准', createdAt: Date.now(),
    })
  }, [addAsset, assets])

  const addFile = (file: File, source: AssetSource) => {
    if (!file.type.startsWith('image/')) { onToast('只支持图片格式的商品图'); return }
    const id = crypto.randomUUID()
    addAsset({ id, name: assetName(file.name), previewUrl: URL.createObjectURL(file), source, status: 'needs_dimensions', stageMessage: '输入真实尺寸后开始 Rodin 生成', createdAt: Date.now() })
    setDimensions((current) => ({ ...current, [id]: { ...emptyDimensions } }))
    onToast('商品图已加入，请输入真实尺寸')
  }

  const handleFiles = (files: FileList | File[], source: AssetSource = 'file') => Array.from(files).forEach((file) => addFile(file, source))

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setDragging(false)
    if (event.dataTransfer.files.length) { handleFiles(event.dataTransfer.files, 'drop'); return }
    if (event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/html')) {
      onToast(imageUrlFromHtml(event.dataTransfer.getData('text/html')) ? '淘宝商品链接导入暂未开放，请拖入图片文件' : '链接导入暂未开放，请拖入图片文件')
    }
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (mode !== 'edit') return
      const imageFile = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'))
        ?? Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'))?.getAsFile()
      if (imageFile) { event.preventDefault(); addFile(imageFile, 'clipboard'); return }
      if (event.clipboardData?.getData('text/plain')) onToast('淘宝商品链接导入暂未开放，请粘贴图片截图')
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  const setDimension = (assetId: string, key: keyof Dimensions, value: string) => setDimensions((current) => ({ ...current, [assetId]: { ...(current[assetId] ?? emptyDimensions), [key]: value } }))
  const getDimensions = (asset: UploadedAsset) => dimensions[asset.id] ?? { width: asset.dimensionsMm?.width.toString() ?? '', depth: asset.dimensionsMm?.depth.toString() ?? '', height: asset.dimensionsMm?.height.toString() ?? '' }

  const pollJob = async (assetId: string, jobId: string) => {
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 2200))
      const response = await fetch(`/api/jobs/${jobId}`)
      const payload = await response.json() as { status: UploadedAsset['status']; stage_message?: string; model_url?: string; edit_model_url?: string; error?: string }
      if (!response.ok) throw new Error(payload.error || '任务状态读取失败')
      if (payload.status === 'scaling') updateAsset(assetId, { status: 'scaling', stageMessage: payload.stage_message || '正在按真实尺寸缩放…' })
      if (payload.status === 'generating') updateAsset(assetId, { status: 'generating', stageMessage: payload.stage_message || 'Rodin 正在生成独立 3D 模型…' })
      if (payload.status === 'succeeded') { updateAsset(assetId, { status: 'succeeded', stageMessage: '生成完成，已按输入尺寸校准', modelUrl: payload.model_url, editModelUrl: payload.edit_model_url }); onToast('3D 模型已完成真实尺度校准'); return }
      if (payload.status === 'failed') throw new Error(payload.error || 'Rodin 生成失败')
    }
  }

  const startGeneration = async (asset: UploadedAsset) => {
    const input = getDimensions(asset)
    const width = Number(input.width), depth = Number(input.depth), height = Number(input.height)
    if (![width, depth, height].every((value) => Number.isFinite(value) && value > 0)) { onToast('请填写宽度、深度和高度，单位为 mm'); return }
    const dimensionsMm = { width, depth, height }
    updateAsset(asset.id, { status: 'uploading', dimensionsMm, stageMessage: '上传图片到安全后端…', error: undefined })
    try {
      const imageResponse = await fetch(asset.previewUrl)
      if (!imageResponse.ok) throw new Error('无法读取商品图片')
      const formData = new FormData()
      formData.append('image', await imageResponse.blob(), `${asset.name}.png`)
      formData.append('asset_id', asset.id); formData.append('name', asset.name)
      formData.append('width_mm', String(width)); formData.append('depth_mm', String(depth)); formData.append('height_mm', String(height))
      const response = await fetch('/api/generations', { method: 'POST', body: formData })
      const payload = await response.json().catch(() => ({})) as { job_id?: string; detail?: string }
      if (!response.ok || !payload.job_id) throw new Error(payload.detail || '生成服务暂不可用')
      updateAsset(asset.id, { status: 'generating', jobId: payload.job_id, stageMessage: 'Rodin 正在生成独立 3D 模型…' })
      await pollJob(asset.id, payload.job_id)
    } catch (error) {
      updateAsset(asset.id, { status: 'failed', stageMessage: '生成未完成', error: error instanceof Error ? error.message : '生成失败' })
    }
  }

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) handleFiles(event.target.files); event.target.value = '' }

  return <section className="asset-drawer glass-panel">
    <div className="asset-upload-column">
      <div className="drawer-heading"><div className="panel-title"><Upload size={15} /><span>Asset Drawer</span></div><span className="panel-meta">IMAGE TO 3D</span></div>
      <div className={`drop-zone ${dragging ? 'is-dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click() }}>
        <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={onFileInput} />
        <div className="drop-icon"><FileImage size={20} /></div><strong>{dragging ? '松开以导入商品图' : '拖拽商品图到这里'}</strong><span>淘宝缩略图 / 本地图片 / 截图</span>
        <div className="drop-hints"><span><ClipboardPaste size={11} /> Ctrl + V</span><span><Upload size={11} /> 点击上传</span></div>
      </div>
      <div className="url-input-row is-disabled"><Link size={14} /><input disabled placeholder="淘宝商品链接（预留，暂未开放）" /><span className="disabled-label">SOON</span></div>
    </div>
    <div className="asset-list-column">
      <div className="drawer-list-heading"><div><span>商品资产</span><em>{String(assets.length).padStart(2, '0')}</em></div><span>UPLOAD → RODIN → SCALE</span></div>
      {assets.length === 0 ? <div className="asset-empty"><PackageOpen size={24} /><span>暂无商品资产</span><small>从左侧拖拽款式图、Ctrl + V 粘贴截图或上传图片</small></div> : <div className="asset-cards">
        {assets.map((asset) => {
          const input = getDimensions(asset), processing = ['uploading', 'generating', 'scaling'].includes(asset.status)
          const draggable = asset.status === 'succeeded' && Boolean(asset.modelUrl && asset.dimensionsMm)
          return <article className={`asset-card ${processing ? 'is-processing' : ''} ${asset.status === 'succeeded' ? 'is-ready' : ''} ${draggable ? 'is-draggable' : ''}`} key={asset.id} draggable={draggable} onDragStart={(event) => { if (!draggable) return; event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain', asset.id); setDraggingAssetId(asset.id) }} onDragEnd={() => setDraggingAssetId(null)}>
            <div className="asset-thumb"><img src={asset.previewUrl} alt={asset.name} /><button type="button" className="remove-asset" onClick={() => removeAsset(asset.id)} title="移除资产"><X size={12} /></button>{processing && <div className="asset-loading-shade"><span className="loading-spinner" /><small>{asset.status === 'scaling' ? 'SCALE' : 'RODIN'}</small></div>}</div>
            <div className="asset-card-info"><strong title={asset.name}>{asset.name}</strong>
              {asset.status === 'needs_dimensions' && <><span className="dimension-label"><Ruler size={11} />真实尺寸 / mm</span><div className="dimension-inputs"><input aria-label="宽度 mm" placeholder="宽" inputMode="decimal" value={input.width} onChange={(event) => setDimension(asset.id, 'width', event.target.value)} /><input aria-label="深度 mm" placeholder="深" inputMode="decimal" value={input.depth} onChange={(event) => setDimension(asset.id, 'depth', event.target.value)} /><input aria-label="高度 mm" placeholder="高" inputMode="decimal" value={input.height} onChange={(event) => setDimension(asset.id, 'height', event.target.value)} /></div><button type="button" className="add-to-room generate-button" onClick={() => void startGeneration(asset)}><Plus size={12} />开始生成 3D</button></>}
              {processing && <span className="processing-status">{asset.stageMessage}</span>}
              {asset.status === 'succeeded' && <span className="ready-status">已完成 · 真实尺度</span>}
              {asset.status === 'failed' && <><span className="error-status">{asset.error || '生成失败'}</span><button type="button" className="add-to-room retry-button" onClick={() => void startGeneration(asset)}>重试生成</button></>}
            </div>
          </article>
        })}
      </div>}
    </div>
  </section>
}
