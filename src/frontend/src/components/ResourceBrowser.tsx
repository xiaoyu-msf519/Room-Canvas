import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Armchair, ChevronRight, Layers, PanelRightClose, PanelRightOpen, RefreshCw, RotateCcw, RotateCw, Search, Square, X } from 'lucide-react'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import { surfaceGroupId, useSurfaceFinishStore, type SurfaceFinish } from '../state/useSurfaceFinishStore'
import { CATALOG_DRAG_TYPE, catalogImageFile, type CatalogItem, type CatalogKind, type CatalogPage } from '../types/catalog'
import { acquireSurfaceTexture } from '../services/surfaceTextures'
import { CatalogThumbnail } from './CatalogThumbnail'
import { editableSurfaces } from '../scene/editableSurfaces'

const tabs = [{ id: 'furniture', label: '家具', icon: Armchair }, { id: 'wall', label: '墙面', icon: Square }, { id: 'floor', label: '地板', icon: Layers }] as const

export function ResourceBrowser({ onToast }: { onToast: (message: string) => void }) {
  const scan = useRoomCanvasStore((state) => state.scan)
  const selectedId = useRoomCanvasStore((state) => state.selectedSurfaceId)
  const selectSurface = useRoomCanvasStore((state) => state.setSelectedSurfaceId)
  const addAsset = useRoomCanvasStore((state) => state.addUploadedAsset)
  const setFinish = useSurfaceFinishStore((state) => state.setFinish)
  const surfaces = editableSurfaces(scan?.room.surfaces ?? [])
  const selected = surfaces.find((surface) => surface.id === selectedId)
  const selectedGroup = selected ? surfaceGroupId(selected) : null
  const finish = useSurfaceFinishStore((state) => scan && selectedGroup ? state.rooms[scan.id]?.[selectedGroup] : undefined)
  const [kind, setKind] = useState<CatalogKind>('furniture')
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)
  const [category, setCategory] = useState('')
  const [color, setColor] = useState('')
  const [texture, setTexture] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<CatalogPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const application = useRef(0)

  const switchKind = (next: CatalogKind) => {
    setKind(next); setCategory(''); setColor(''); setTexture(''); setQuery(''); setPage(1); setData(null)
  }
  useEffect(() => {
    if (selected?.kind === 'wall' || selected?.kind === 'floor') {
      if (kind !== selected.kind) switchKind(selected.kind)
      setCollapsed(false)
    }
  }, [selectedId])
  useEffect(() => () => { application.current++ }, [])
  useEffect(() => { application.current++; setApplyingId(null) }, [scan?.id, selectedId])
  useEffect(() => {
    const retry = () => setRevision((value) => value + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ kind, category, color, texture, q: query, page: String(page) })
      void fetch(`/api/catalog/items?${params}`, { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error('资源库暂不可用')
        const result = await response.json() as CatalogPage
        if (!controller.signal.aborted) setData(result)
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取失败') })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 150)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [kind, category, color, texture, query, page, revision])

  const importFurniture = async (item: CatalogItem) => {
    try {
      const file = await catalogImageFile(item.id)
      addAsset({ id: crypto.randomUUID(), name: item.name, previewUrl: URL.createObjectURL(file), source: 'drop', status: 'needs_dimensions', stageMessage: '输入真实尺寸后开始 Rodin 生成', createdAt: Date.now() })
      onToast('商品图已加入，请输入真实尺寸')
    } catch (reason) { onToast(reason instanceof Error ? reason.message : '资源读取失败') }
  }
  const applyMaterial = async (item: CatalogItem) => {
    if (!scan || !selected || !selectedGroup || selected.kind !== kind) { onToast(kind === 'wall' ? '请先选择一面墙' : '请先选择地板'); return }
    const request = ++application.current
    setApplyingId(item.id)
    const source = acquireSurfaceTexture(item.textureUrl)
    try {
      const loaded = await source.ready
      if (request !== application.current) return
      const image = loaded.image as { width: number; height: number }
      const coverage: [number, number] = item.coverageMeters ?? [1, image.height / image.width]
      setFinish(scan.id, selectedGroup, { catalogId: item.id, name: item.name, textureUrl: item.textureUrl, coverageMeters: coverage, rotationDegrees: 0, loadVersion: Date.now() })
      onToast('涂装已更新')
    } catch { if (request === application.current) onToast('贴图读取失败，请重试') }
    finally { source.release(); if (request === application.current) setApplyingId(null) }
  }
  const changeFinish = (patch: Partial<SurfaceFinish>) => {
    if (scan && selectedGroup && finish) setFinish(scan.id, selectedGroup, { ...finish, ...patch })
  }
  const targets = surfaces.filter((surface) => surface.kind === kind).filter((surface, index, all) => all.findIndex((entry) => surfaceGroupId(entry) === surfaceGroupId(surface)) === index)
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 24))

  if (collapsed) return <button className="resource-reopen glass-panel" onClick={() => setCollapsed(false)} title="展开资源库" aria-label="展开资源库"><PanelRightOpen size={17} /></button>
  return <aside className="resource-browser glass-panel" aria-label="资源库">
    <header className="resource-heading"><span><Layers size={15} />资源库</span><div><button className="resource-icon" onClick={() => setRevision((value) => value + 1)} title="刷新资源库" aria-label="刷新资源库"><RefreshCw size={14} /></button><button className="resource-icon" onClick={() => setCollapsed(true)} title="收起资源库" aria-label="收起资源库"><PanelRightClose size={15} /></button></div></header>
    <div className="resource-tabs" role="tablist" aria-label="资源类型">{tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={kind === id} className={kind === id ? 'is-active' : ''} onClick={() => switchKind(id)}><Icon size={13} />{label}</button>)}</div>
    {kind !== 'furniture' && <div className="surface-context">
      <label>当前表面<select aria-label="选择涂装表面" value={selected?.kind === kind ? selectedGroup ?? '' : ''} onChange={(event) => selectSurface(targets.find((surface) => surfaceGroupId(surface) === event.target.value)?.id ?? null)}><option value="">{kind === 'wall' ? '未选中墙面' : '未选中地板'}</option>{targets.map((surface, index) => <option key={surfaceGroupId(surface)} value={surfaceGroupId(surface)}>{surface.label ?? `${kind === 'wall' ? '墙面' : '地板'} ${String(index + 1).padStart(2, '0')}`}{surfaceGroupId(surface) === selectedGroup && finish ? ` · ${finish.name}` : ''}</option>)}</select>{finish && selected?.kind === kind && <button className="resource-icon" title="恢复扫描涂装" aria-label="恢复扫描涂装" onClick={() => { application.current++; setApplyingId(null); if (scan && selectedGroup) setFinish(scan.id, selectedGroup, null) }}><RotateCcw size={13} /></button>}</label>
      {finish && selected?.kind === kind && <>
        <div className="surface-tiling"><span>整图覆盖 / m</span>{finish.coverageMeters.map((value, index) => <input key={index} aria-label={index === 0 ? '贴图覆盖宽度 m' : '贴图覆盖高度 m'} type="number" min="0.05" max="1000" step="0.1" value={Number(value.toFixed(3))} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next) && next >= 0.05 && next <= 1000) { const coverageMeters: [number, number] = [...finish.coverageMeters]; coverageMeters[index] = next; changeFinish({ coverageMeters }) } }} />)}<button className="resource-icon" title={`旋转贴图 90° · 当前 ${finish.rotationDegrees}°`} aria-label="旋转贴图 90 度" onClick={() => changeFinish({ rotationDegrees: (finish.rotationDegrees + 90) % 360 })}><RotateCw size={13} /></button></div>
      </>}
    </div>}
    <div className="resource-filters">
      <label className="resource-search"><Search size={13} /><input aria-label="搜索资源" placeholder="搜索名称、材质或编号" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} />{query && <button className="resource-icon" title="清空搜索" aria-label="清空搜索" onClick={() => { setQuery(''); setPage(1) }}><X size={12} /></button>}</label>
      <label><span>类别</span><select aria-label="资源类别" value={category} onChange={(event) => { setCategory(event.target.value); setColor(''); setTexture(''); setPage(1) }}><option value="">全部类别</option>{data?.categories.map((value) => <option key={value}>{value}</option>)}</select></label>
      <div className="resource-subfilters"><label><span>颜色</span><select aria-label="资源颜色" value={color} onChange={(event) => { setColor(event.target.value); setTexture(''); setPage(1) }}><option value="">全部颜色</option>{data?.colors.map((value) => <option key={value}>{value}</option>)}</select></label><ChevronRight size={11} /><label><span>纹理</span><select aria-label="资源纹理" value={texture} onChange={(event) => { setTexture(event.target.value); setPage(1) }}><option value="">全部纹理</option>{data?.textures.map((value) => <option key={value}>{value}</option>)}</select></label></div>
    </div>
    <div className={`resource-grid ${kind === 'furniture' ? 'is-furniture-list' : ''}`} aria-busy={loading}>
      {error ? <div className="resource-empty">{error}</div> : loading ? <div className="resource-empty"><span className="loading-spinner" /></div> : !data?.items.length ? <div className="resource-empty">暂无匹配资源</div> : data.items.map((item) => <button key={item.id} className={`resource-card ${finish?.catalogId === item.id && selected?.kind === kind ? 'is-selected' : ''}`} draggable={kind === 'furniture'} title={`${item.name} · ${item.color} · ${item.texture}${kind === 'furniture' ? ' · 导入商品图' : ` · ${item.coverageNote}`}\n${item.source ?? ''} ${item.rights ?? ''}`} onDragStart={(event) => { if (kind !== 'furniture') { event.preventDefault(); return } event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData(CATALOG_DRAG_TYPE, item.id) }} onClick={() => { if (kind === 'furniture') void importFurniture(item); else void applyMaterial(item) }} disabled={kind !== 'furniture' && (!selected || selected.kind !== kind)}>
        <div className={`resource-image ${kind === 'furniture' ? 'is-furniture' : ''}`}><CatalogThumbnail key={`${item.id}-${revision}`} src={item.thumbnailUrl} name={item.name} revision={revision} />{applyingId === item.id && <span className="resource-applying"><span className="loading-spinner" /></span>}</div><div className="resource-card-copy"><strong>{item.name}</strong><small>{kind === 'furniture' ? `${item.category} · ` : ''}{item.color} · {item.texture}</small></div>
      </button>)}
    </div>
    <footer className="resource-pagination"><span>{data?.total ?? 0} 项</span><div><button className="resource-icon" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} title="上一页" aria-label="上一页"><ArrowLeft size={14} /></button><span>{page} / {pages}</span><button className="resource-icon" disabled={page >= pages || loading} onClick={() => setPage(page + 1)} title="下一页" aria-label="下一页"><ArrowRight size={14} /></button></div></footer>
  </aside>
}
