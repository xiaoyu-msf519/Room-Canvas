import { useEffect, useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { wrap } from '../solar/ephemeris'

interface Props {
  label: string
  value: number
  period: number
  step: number
  valueText: string
  icon: LucideIcon
  onChange: (value: number) => void
}

export function CircularSlider({ label, value, period, step, valueText, icon: Icon, onChange }: Props) {
  const bounds = useRef<DOMRect | null>(null)
  const pending = useRef<number | null>(null)
  const frame = useRef<number | null>(null)
  const change = useRef(onChange)
  change.current = onChange
  const flush = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    if (pending.current !== null) { change.current(pending.current); pending.current = null }
  }
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  const updatePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!bounds.current) return
    const dx = event.clientX - bounds.current.left - bounds.current.width / 2
    const dy = event.clientY - bounds.current.top - bounds.current.height / 2
    if (Math.hypot(dx, dy) < 5) return
    pending.current = wrap((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2), 1) * period
    if (frame.current === null) frame.current = requestAnimationFrame(flush)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const deltas: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 12, PageDown: -step * 12 }
    if (event.key in deltas || event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); event.stopPropagation(); flush()
      onChange(event.key === 'Home' ? 0 : event.key === 'End' ? period - step : wrap(value + deltas[event.key], period))
    }
  }
  const angle = value / period * Math.PI * 2 - Math.PI / 2
  return <div className="circular-slider" role="slider" tabIndex={0} aria-label={label}
    aria-valuemin={0} aria-valuemax={period} aria-valuenow={Math.round(value * 100) / 100} aria-valuetext={valueText}
    title={`${label} · ${valueText}`} onKeyDown={onKeyDown}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus()
      bounds.current = event.currentTarget.getBoundingClientRect()
      event.currentTarget.setPointerCapture(event.pointerId)
      updatePointer(event)
    }}
    onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updatePointer(event) }}
    onPointerUp={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      updatePointer(event); flush(); event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={flush} onLostPointerCapture={flush}>
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle className="dial-track" cx="24" cy="24" r="19" />
      <circle className="dial-progress" cx="24" cy="24" r="19" pathLength="1" strokeDasharray={`${value / period} 1`} transform="rotate(-90 24 24)" />
      <circle className="dial-thumb" cx={24 + Math.cos(angle) * 19} cy={24 + Math.sin(angle) * 19} r="3.8" />
    </svg>
    <Icon className="dial-icon" size={15} aria-hidden="true" />
  </div>
}
