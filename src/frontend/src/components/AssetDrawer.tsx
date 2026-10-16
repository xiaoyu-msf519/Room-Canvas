import { useEffect, useRef, useState, type DragEvent, type ChangeEvent } from 'react'
import { ClipboardPaste, FileImage, Link, PackageOpen, Plus, Upload, X } from 'lucide-react'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import type { AssetSource } from '../types/scene'

interface AssetDrawerProps {
  onToast: (message: string) => void
}

function normalizeImageUrl(rawUrl: string) {
  const url = rawUrl.trim()
  return url.replace(/(_\d+x\d+q?\d*\.[a-z0-9]+_?\.[a-z0-9]+)$/i, '').replace(/(_\d+x\d+q?\d*)(?=\.[a-z0-9]+$)/i, '')
}

function filenameFromUrl(url: string) {
  try {
    const parsed = new URL(url)
    const filename = parsed.pathname.split('/').pop() || '淘宝商品图'
    return decodeURIComponent(filename).split('.')[0].slice(0, 28) || '淘宝商品图'
  } catch {
    return '淘宝商品图'
  }
}

function imageUrlFromHtml(html: string) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match?.[1] ?? null
}

export function AssetDrawer({ onToast }: AssetDrawerProps) {
  const mode = useRoomCanvasStore((state) => state.mode)
  const assets = useRoomCanvasStore((state) => state.uploadedAssets)
  const addAsset = useRoomCanvasStore((state) => state.addUploadedAsset)
  const removeAsset = useRoomCanvasStore((state) => state.removeUploadedAsset)
  const [dragging, setDragging] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFile = (file: File, source: AssetSource) => {
    if (!file.type.startsWith('image/')) {
      onToast('只支持图片格式的商品图')
      return
    }
    addAsset({
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^/.]+$/, '').slice(0, 32) || '上传商品图',
      previewUrl: URL.createObjectURL(file),
      source,
      status: 'pending',
      createdAt: Date.now(),
    })
    onToast('商品图已加入资产抽屉')
  }

  const addUrl = (rawUrl: string, source: AssetSource = 'url') => {
    const url = normalizeImageUrl(rawUrl)
    if (!/^https?:\/\//i.test(url)) {
      onToast('请输入可访问的图片链接')
      return
    }
    addAsset({ id: crypto.randomUUID(), name: filenameFromUrl(url), previewUrl: url, source, status: 'pending', createdAt: Date.now() })
    setUrlValue('')
    onToast('图片链接已加入资产抽屉')
  }

  const handleFiles = (files: FileList | File[], source: AssetSource = 'file') => Array.from(files).forEach((file) => addFile(file, source))

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length) {
      handleFiles(event.dataTransfer.files, 'drop')
      return
    }
    const uri = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')
    const htmlImage = imageUrlFromHtml(event.dataTransfer.getData('text/html'))
    if (htmlImage || uri) addUrl(htmlImage || uri, 'drop')
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (mode !== 'edit') return
      const imageFile = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'))
        ?? Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'))?.getAsFile()
      if (imageFile) {
        event.preventDefault()
        addFile(imageFile, 'clipboard')
        return
      }
      const text = event.clipboardData?.getData('text/plain')
      if (text && /^https?:\/\//i.test(text)) addUrl(text, 'clipboard')
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) handleFiles(event.target.files)
    event.target.value = ''
  }

  return (
    <section className="asset-drawer glass-panel">
      <div className="asset-upload-column">
        <div className="drawer-heading"><div className="panel-title"><Upload size={15} /><span>Asset Drawer</span></div><span className="panel-meta">MULTIMODAL INPUT</span></div>
        <div className={`drop-zone ${dragging ? 'is-dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click() }}>
          <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={onFileInput} />
          <div className="drop-icon"><FileImage size={20} /></div>
          <strong>{dragging ? '松开以导入商品图' : '拖拽商品图到这里'}</strong>
          <span>淘宝缩略图 / 本地图片 / 截图</span>
          <div className="drop-hints"><span><ClipboardPaste size={11} /> Ctrl + V</span><span><Upload size={11} /> 点击上传</span></div>
        </div>
        <div className="url-input-row"><Link size={14} /><input value={urlValue} onChange={(event) => setUrlValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addUrl(urlValue) }} placeholder="粘贴淘宝图片 CDN 链接" /><button type="button" onClick={() => addUrl(urlValue)} title="添加图片链接"><Plus size={15} /></button></div>
      </div>
      <div className="asset-list-column">
        <div className="drawer-list-heading"><div><span>商品资产</span><em>{String(assets.length).padStart(2, '0')}</em></div><span>IMAGE TO 3D / READY</span></div>
        {assets.length === 0 ? (
          <div className="asset-empty"><PackageOpen size={24} /><span>暂无商品资产</span><small>从左侧拖拽淘宝款式图、Ctrl + V<br />粘贴截图或上传图片</small></div>
        ) : (
          <div className="asset-cards">
            {assets.map((asset) => <article className="asset-card" key={asset.id}><div className="asset-thumb"><img src={asset.previewUrl} alt={asset.name} /><button type="button" className="remove-asset" onClick={() => removeAsset(asset.id)} title="移除资产"><X size={12} /></button></div><div className="asset-card-info"><strong title={asset.name}>{asset.name}</strong><span className="pending-status">待生成 3D</span><button type="button" className="add-to-room" onClick={() => onToast('模型生成接口接入后即可放入房间')}><Plus size={12} />放入房间</button></div></article>)}
          </div>
        )}
      </div>
    </section>
  )
}
