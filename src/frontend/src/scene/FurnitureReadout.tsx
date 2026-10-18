import { useRef, type RefObject } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Group } from 'three'
import type { Vec3 } from '../types/scene'
import { furnitureDimensions } from './furnitureTransform'

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
    write(ratio.current, `长 ${factors[0].toFixed(2)}x / 宽 ${factors[2].toFixed(2)}x / 高 ${factors[1].toFixed(2)}x`)
    write(length.current, `${Math.round(dimensions[0] * 1000)} mm`)
    write(width.current, `${Math.round(dimensions[2] * 1000)} mm`)
    write(height.current, `${Math.round(dimensions[1] * 1000)} mm`)
  })
  if (typeof document === 'undefined') return null
  return <group ref={anchor}><Html style={{ pointerEvents: 'none', transform: 'translate(16px,-100%)' }} zIndexRange={[2, 0]}>
    <div className="furniture-readout"><span ref={ratio}>长 {(size[0] / original[0]).toFixed(2)}x / 宽 {(size[2] / original[2]).toFixed(2)}x / 高 {(size[1] / original[1]).toFixed(2)}x</span><dl><div><dt>长</dt><dd ref={length}>{Math.round(size[0] * 1000)} mm</dd></div><div><dt>宽</dt><dd ref={width}>{Math.round(size[2] * 1000)} mm</dd></div><div><dt>高</dt><dd ref={height}>{Math.round(size[1] * 1000)} mm</dd></div></dl></div>
  </Html></group>
}
