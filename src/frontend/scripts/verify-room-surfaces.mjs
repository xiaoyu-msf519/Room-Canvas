import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import React from 'react'
import { act, create } from '@react-three/test-renderer'
import { createServer } from 'vite'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const storage = new Map()
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }
const root = fileURLToPath(new URL('../../../', import.meta.url))
const scene = JSON.parse(execFileSync(path.join(root, 'env/backend/Scripts/python.exe'), ['-c', "import sys,json; sys.path.insert(0,'src/backend'); from app.example_layout import create_example_layout; print(json.dumps(create_example_layout('surfacetestfixture')))"], { cwd: root, encoding: 'utf8' }))
const { Texture, TextureLoader } = await import('three')
const originalLoad = TextureLoader.prototype.load
TextureLoader.prototype.load = function (url, onLoad) { const texture = new Texture({ width: 4, height: 4 }); queueMicrotask(() => onLoad?.(texture)); return texture }
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
let renderer
try {
  const { editableSurfaces, wallFaceSurface, wallSideSurface } = await vite.ssrLoadModule('/src/scene/editableSurfaces.ts')
  const { useRoomCanvasStore } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts')
  const { useSurfaceFinishStore, surfaceGroupId } = await vite.ssrLoadModule('/src/state/useSurfaceFinishStore.ts')
  const { ScannedRoom } = await vite.ssrLoadModule('/src/scene/ScannedRoom.tsx')
  const targets = editableSurfaces(scene.room.surfaces)
  assert.equal(new Set(targets.filter((surface) => surface.kind === 'floor').map(surfaceGroupId)).size, scene.room.layout.zones.length)
  const targetById = new Map(targets.map((surface) => [surface.id, surface]))
  for (const zone of scene.room.layout.zones) {
    assert.equal(targetById.get(zone.floorSurfaceId)?.zoneId, zone.id)
    assert.ok(zone.wallSurfaceIds.every((id) => targetById.get(id)?.zoneId === zone.id), 'Explicit room wall IDs must resolve to independent editable surfaces')
  }
  for (const zone of scene.room.layout.zones) {
    assert.ok(targets.some((surface) => surface.kind === 'wall' && surface.zoneId === zone.id && surface.id.endsWith(':side')), `${zone.name} needs an independently editable wall side`)
    assert.ok(new Set(targets.filter((surface) => surface.kind === 'wall' && surface.zoneId === zone.id && !surface.id.endsWith(':side')).map(surfaceGroupId)).size >= 4, `${zone.name} needs four independent wall faces`)
  }
  const shared = scene.room.surfaces.find((surface) => surface.wallFaces && surface.wallFaces.positive.zoneId !== surface.wallFaces.negative.zoneId)
  const positive = wallFaceSurface(shared, 'positive'), negative = wallFaceSurface(shared, 'negative')
  const side = wallSideSurface(shared)
  const finish = { catalogId: 'test', name: 'paint', textureUrl: '/test-paint.jpg', coverageMeters: [1,1], rotationDegrees: 0 }
  useRoomCanvasStore.getState().applyScan(scene)
  renderer = await create(React.createElement(ScannedRoom))
  const source = renderer.scene.findAll((node) => node.instance.name === 'scan-wall' && node.instance.userData.wallId === shared.id)[0]
  const solid = renderer.scene.findAll((node) => node.instance.name === 'scan-wall-solid' && node.instance.userData.wallId === shared.id)[0]
  await act(async () => { await renderer.fireEvent(solid, 'click', { delta: 0, face: { materialIndex: 1 }, stopPropagation() {} }) })
  assert.equal(useRoomCanvasStore.getState().selectedSurfaceId, positive.id)
  await act(async () => useSurfaceFinishStore.getState().setFinish(scene.id, surfaceGroupId(positive), finish))
  assert.ok(source.instance.material[1].map)
  assert.ok(source.instance.material[0].map, 'Wall side must receive its own selected finish')
  assert.equal(source.instance.material[2].map, null, 'Shared wall paint leaked into the next room')
  assert.equal(solid.instance.material[1].map.source, source.instance.material[1].map.source)
  await act(async () => { await renderer.fireEvent(solid, 'click', { delta: 0, face: { materialIndex: 2 }, stopPropagation() {} }) })
  assert.equal(useRoomCanvasStore.getState().selectedSurfaceId, negative.id)
  await act(async () => { await renderer.fireEvent(solid, 'click', { delta: 0, face: { materialIndex: 0 }, stopPropagation() {} }) })
  assert.equal(useRoomCanvasStore.getState().selectedSurfaceId, side.id)
  await act(async () => useSurfaceFinishStore.getState().setFinish(scene.id, surfaceGroupId(side), { ...finish, catalogId: 'side' }))
  assert.ok(source.instance.material[0].map, 'Side finish must be independently stored')
  const floor = scene.room.surfaces.find((surface) => surface.kind === 'floor' && surface.zoneId === 'master')
  await act(async () => useSurfaceFinishStore.getState().setFinish(scene.id, surfaceGroupId(floor), finish))
  const floors = renderer.scene.findAll((node) => node.instance.name === 'scan-floor')
  assert.ok(floors.find((node) => node.instance.userData.zoneId === 'master').instance.material.map)
  assert.ok(floors.filter((node) => node.instance.userData.zoneId !== 'master').every((node) => node.instance.material.map === null))
  await act(async () => useRoomCanvasStore.getState().setMode('play'))
  assert.ok(source.instance.material[1].map && source.instance.material.every((material) => !material.transparent))
  const legacyId = surfaceGroupId(shared)
  await act(async () => {
    useSurfaceFinishStore.getState().setFinish(scene.id, legacyId, finish)
    useSurfaceFinishStore.getState().migrateSurfaceGroups(scene.id, scene.room.surfaces)
  })
  assert.ok(useSurfaceFinishStore.getState().rooms[scene.id][surfaceGroupId(negative)])
  assert.equal(useSurfaceFinishStore.getState().rooms[scene.id][legacyId], undefined)
  await act(async () => useSurfaceFinishStore.getState().setFinish(scene.id, surfaceGroupId(positive), null))
  assert.equal(source.instance.material[1].map, null)
  assert.ok(source.instance.material[2].map, 'Resetting one room must not reset its neighbor')
  console.log('PASS: nine independent floors with explicit room surface IDs, four wall groups per room, separate shared-wall sides, click targeting, Edit/Play reuse, legacy paint migration and independent reset.')
} finally {
  if (renderer) await renderer.unmount()
  TextureLoader.prototype.load = originalLoad
  await vite.close()
}
