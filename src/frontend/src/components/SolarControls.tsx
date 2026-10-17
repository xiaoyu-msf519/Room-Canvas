import { useRef, useState } from 'react'
import { CalendarDays, Clock3, FastForward, MapPin, Orbit, RotateCw, Sun, X } from 'lucide-react'
import { useSolarStore } from '../state/useSolarStore'
import { clockDate, daysInYear, SHANGHAI, validateSite } from '../solar/ephemeris'
import { PROVINCES } from '../solar/provinces'
import { CircularSlider } from './CircularSlider'

export function SolarControls() {
  const { year, day, minute, site, north, status, showPath, animationMode, setClock, setSite, setNorth, setShowPath, setAnimationMode } = useSolarStore()
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState({ province: site.name, latitude: String(site.latitude), longitude: String(site.longitude), offset: String(site.utcOffset), north: String(north) })
  const [error, setError] = useState('')
  const dateValue = clockDate(year, Math.floor(day), 0, 0).toISOString().slice(0, 10)
  const hours = String(Math.floor(minute / 60)).padStart(2, '0')
  const minutes = String(Math.floor(minute % 60)).padStart(2, '0')
  const timeValue = `${hours}:${minutes}`
  const openLocation = () => {
    setDraft({ province: PROVINCES.some((entry) => entry.name === site.name) ? site.name : 'custom', latitude: String(site.latitude), longitude: String(site.longitude), offset: String(site.utcOffset), north: String(north) })
    setError(''); dialog.current?.showModal()
  }
  return <div className="solar-controls" aria-label="日照模拟">
    <div className="solar-dial">
      <CircularSlider label="一年日期" icon={CalendarDays} value={day} period={daysInYear(year)} step={1} valueText={dateValue} onChange={(value) => setClock({ day: value })} />
      <label><span>日期</span><input type="date" aria-label="日照日期" value={dateValue} min="1900-01-01" max="2100-12-31" onChange={(event) => {
        if (!event.currentTarget.value) return
        const date = new Date(`${event.currentTarget.value}T00:00:00Z`)
        const nextYear = date.getUTCFullYear()
        setClock({ year: nextYear, day: (date.getTime() - Date.UTC(nextYear, 0, 1)) / 86400000 })
      }} /></label>
    </div>
    <div className="solar-dial">
      <CircularSlider label="一天时间" icon={Clock3} value={minute} period={1440} step={5} valueText={timeValue} onChange={(value) => setClock({ minute: value })} />
      <label><span>时间 · UTC{site.utcOffset >= 0 ? '+' : ''}{site.utcOffset}</span><input type="time" aria-label="日照时间" value={timeValue} step="60" onChange={(event) => {
        const value = event.currentTarget.valueAsNumber
        if (Number.isFinite(value)) setClock({ minute: value / 60000 })
      }} /></label>
    </div>
    <button className={`solar-site-button ${status === 'computing' ? 'is-computing' : ''}`} type="button" title={`${site.name} · ${site.latitude.toFixed(3)}°, ${site.longitude.toFixed(3)}° · 北向 ${north}°`} onClick={openLocation}>
      <MapPin size={15} /><span>{site.name}</span><i aria-label={status === 'computing' ? '太阳轨迹计算中' : status === 'error' ? '计算失败' : '太阳轨迹就绪'} data-status={status} />
    </button>
    {status === 'error' && <button className="solar-icon-button" title="重新计算太阳轨迹" type="button" onClick={() => setSite({ ...site })}><RotateCw size={15} /></button>}
    <button className={`solar-icon-button ${showPath ? 'is-active' : ''}`} type="button" title="太阳轨迹" aria-label="显示太阳轨迹" aria-pressed={showPath} onClick={() => setShowPath(!showPath)}><Orbit size={16} /></button>
    <div className="solar-macro-switches" aria-label="宏观时间推进">
      <button className={`solar-macro-button ${animationMode === 'day-night' ? 'is-active' : ''}`} type="button" title="日夜更替：6 秒经过一天" aria-pressed={animationMode === 'day-night'} onClick={() => setAnimationMode(animationMode === 'day-night' ? 'none' : 'day-night')}><Sun size={14} /><span>日夜</span></button>
      <button className={`solar-macro-button ${animationMode === 'seasons' ? 'is-active' : ''}`} type="button" title="四季更替：10 秒经过一个季节" aria-pressed={animationMode === 'seasons'} onClick={() => setAnimationMode(animationMode === 'seasons' ? 'none' : 'seasons')}><FastForward size={14} /><span>四季</span></button>
    </div>
    <dialog ref={dialog} className="solar-location-dialog" aria-labelledby="solar-location-title" onClick={(event) => { if (event.target === dialog.current) dialog.current.close() }}>
      <form onSubmit={(event) => {
        event.preventDefault()
        try {
          if ((draft.latitude.trim() === '') !== (draft.longitude.trim() === '')) throw new Error('请同时填写经度和纬度')
          const latitude = draft.latitude.trim() ? Number(draft.latitude) : SHANGHAI.latitude
          const longitude = draft.longitude.trim() ? Number(draft.longitude) : SHANGHAI.longitude
          const preset = PROVINCES.find((entry) => entry.name === draft.province)
          const name = !draft.latitude.trim() ? SHANGHAI.name : preset && preset.latitude === latitude && preset.longitude === longitude ? preset.name : '自定义'
          const next = { name, latitude, longitude, utcOffset: draft.offset.trim() ? Number(draft.offset) : 8 }
          validateSite(next)
          const angle = draft.north.trim() ? Number(draft.north) : 0
          if (!Number.isFinite(angle)) throw new Error('北向角度无效')
          setSite(next); setNorth(angle); dialog.current?.close()
        } catch (cause) { setError(cause instanceof Error ? cause.message : '位置无效') }
      }}>
        <div className="solar-location-heading"><strong id="solar-location-title">位置与朝向</strong><button className="solar-icon-button" type="button" title="关闭" onClick={() => dialog.current?.close()}><X size={17} /></button></div>
        <label>省份<select value={draft.province} onChange={(event) => {
          const preset = PROVINCES.find((entry) => entry.name === event.currentTarget.value)
          setDraft({ ...draft, province: event.currentTarget.value, ...(preset ? { latitude: String(preset.latitude), longitude: String(preset.longitude), offset: String(preset.utcOffset) } : {}) })
        }}><option value="custom">自定义经纬度</option>{PROVINCES.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}</select></label>
        <div className="solar-location-grid">
          <label>纬度 (°N)<input type="number" aria-label="纬度" min="-90" max="90" step="any" placeholder="31.2304" value={draft.latitude} onChange={(event) => setDraft({ ...draft, latitude: event.currentTarget.value, province: 'custom' })} /></label>
          <label>经度 (°E)<input type="number" aria-label="经度" min="-180" max="180" step="any" placeholder="121.4737" value={draft.longitude} onChange={(event) => setDraft({ ...draft, longitude: event.currentTarget.value, province: 'custom' })} /></label>
          <label>时区 (UTC)<input type="number" aria-label="UTC 时区" min="-12" max="14" step="0.25" value={draft.offset} onChange={(event) => setDraft({ ...draft, offset: event.currentTarget.value })} /></label>
          <label title="真北相对场景 -Z 轴的顺时针角度">北向角 (°)<input type="number" aria-label="北向角" step="any" value={draft.north} onChange={(event) => setDraft({ ...draft, north: event.currentTarget.value })} /></label>
        </div>
        {error && <p className="solar-form-error" role="alert">{error}</p>}
        <button className="solar-apply" type="submit">应用位置</button>
      </form>
    </dialog>
  </div>
}
