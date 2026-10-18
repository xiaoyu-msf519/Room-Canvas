import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { BoxGeometry, Color, Quaternion, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three'
import type { MeshStandardMaterial, Texture } from 'three'
import type { RoomSurface } from '../types/scene'
import type { SurfaceFinish } from '../state/useSurfaceFinishStore'
import { acquireSurfaceTexture } from '../services/surfaceTextures'

/** World-space metric UVs keep door/window panels on a single continuous sheet. */
export function createMetricWallGeometry(surface: RoomSurface, reference = surface) {
  const geometry = new BoxGeometry(...surface.size)
  geometry.clearGroups()
  geometry.addGroup(0, 24, 0)
  geometry.addGroup(24, 6, 1)
  geometry.addGroup(30, 6, 2)
  const rotation = new Quaternion(...surface.rotation)
  const axisRotation = new Quaternion(...reference.rotation)
  const uAxis = new Vector3(1, 0, 0).applyQuaternion(axisRotation)
  const vAxis = new Vector3(0, 1, 0).applyQuaternion(axisRotation)
  const position = new Vector3(...surface.position)
  const vertices = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  const point = new Vector3()
  for (let index = 0; index < vertices.count; index++) {
    point.fromBufferAttribute(vertices, index).applyQuaternion(rotation).add(position)
    uv.setXY(index, point.dot(uAxis), point.dot(vAxis))
  }
  uv.needsUpdate = true
  return geometry
}

export function configureSurfaceTexture(texture: Texture, finish: SurfaceFinish) {
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(1 / finish.coverageMeters[0], 1 / finish.coverageMeters[1])
  texture.rotation = finish.rotationDegrees * Math.PI / 180
  texture.anisotropy = 4
  texture.needsUpdate = true
}

export function useSurfaceAppearance(target: MeshStandardMaterial | MeshStandardMaterial[], surface: RoomSurface, finish: SurfaceFinish | undefined, selected: boolean) {
  const materials = useMemo(() => Array.isArray(target) ? target : [target], [target])
  const [loaded, setLoaded] = useState<{ url: string; texture: Texture } | null>(null)
  useEffect(() => {
    setLoaded(null)
    if (!finish?.textureUrl) return
    const url = finish.textureUrl
    let active = true
    let clone: Texture | null = null
    const source = acquireSurfaceTexture(url)
    void source.ready.then((result) => {
      if (!active) return
      // Clones keep independent tiling but share one image/GPU source across panels.
      clone = result.clone()
      setLoaded({ url, texture: clone })
    }).catch(() => { if (active) setLoaded(null) })
    return () => { active = false; clone?.dispose(); source.release() }
  }, [finish?.textureUrl, finish?.loadVersion])
  useLayoutEffect(() => {
    if (loaded && finish && loaded.url === finish.textureUrl) {
      configureSurfaceTexture(loaded.texture, finish)
    }
    for (const material of materials) {
      if (loaded && finish && loaded.url === finish.textureUrl) {
        material.map = loaded.texture
        material.color.set('#ffffff')
      } else {
        material.map = null
        material.color.set(surface.finish?.baseColor ?? (surface.kind === 'floor' ? '#a2abae' : '#d6dadb'))
      }
      material.roughness = surface.finish?.roughness ?? (surface.kind === 'floor' ? 0.95 : 0.92)
      material.needsUpdate = true
    }
  }, [loaded, finish, materials, surface.finish, surface.kind])
  useLayoutEffect(() => {
    for (const material of materials) {
      material.emissive.copy(new Color(selected ? '#216175' : '#000000'))
      material.emissiveIntensity = selected ? 0.25 : 0
    }
  }, [materials, selected])
}
