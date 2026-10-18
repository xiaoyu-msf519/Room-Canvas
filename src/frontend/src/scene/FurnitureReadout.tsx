import { useRef, type RefObject } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Group } from 'three'
import type { Vec3 } from '../types/scene'
import { furnitureDimensions } from './furnitureTransform'

function scaleLabel(factors: Vec3) {
  if (Math.max(...factors) - Math.min(...factors) < 0.0001) return `缩放 ${factors[0].toFixed(2)}x`
  return `长 ${factors[0].toFixed(2)}x / 宽 ${factors[2].toFixed(2)}x / 高 ${factors[1].toFixed(2)}x`
}

export function FurnitureReadout({ target, size, original }: { target: RefObject<Group>; size: Vec3; original: Vec3 }) {
  const anchor = useRef<Group>(null)
  const ratio = useRef<HTMLSpanElement>(null)
  const length = useRef<HTMLElement>(null), width = useRef<HTMLElement>(null), height = useRef<HTMLElement>(null)
  useFrame(() => {
    const model = target.current
    if (!model || !anchor.current) return
    const { dimensions, factors } = furnitureDimensions(size, original, model.scale)
    anchor.current.position.copy(model.position)
    anchor.current.position.y += dimensions[1] / 2 + 0.18
    const write = (element: HTMLElement | null, value: string) => { if (element && element.textContent !== value) element.textContent = value }
    write(ratio.current, scaleLabel(factors))
    write(length.current, `${Math.round(dimensions[0] * 1000)} mm`)
    write(width.current, `${Math.round(dimensions[2] * 1000)} mm`)
    write(height.current, `${Math.round(dimensions[1] * 1000)} mm`)
  })
  if (typeof document === 'undefined') return null
  return <group ref={anchor}><Html style={{ pointerEvents: 'none', transform: 'translate(16px,-100%)' }} zIndexRange={[2, 0]}>
    <div className="furniture-readout"><span ref={ratio}>{scaleLabel(size.map((value, axis) => value / Math.max(original[axis], 0.0001)) as Vec3)}</span><dl><div><dt>长</dt><dd ref={length}>{Math.round(size[0] * 1000)} mm</dd></div><div><dt>宽</dt><dd ref={width}>{Math.round(size[2] * 1000)} mm</dd></div><div><dt>高</dt><dd ref={height}>{Math.round(size[1] * 1000)} mm</dd></div></dl></div>
  </Html></group>
}
