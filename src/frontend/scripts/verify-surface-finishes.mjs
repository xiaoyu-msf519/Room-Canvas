import assert from 'node:assert/strict'
import React from 'react'
import { act, create } from '@react-three/test-renderer'
import { createServer } from 'vite'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const storage = new Map()
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }
const { Texture, TextureLoader, Vector3, Quaternion } = await import('three')
const originalLoad = TextureLoader.prototype.load
TextureLoader.prototype.load = function (url, onLoad) {
  const texture = new Texture({ width: 4, height: 4 })
  queueMicrotask(() => onLoad?.(texture))
  return texture
}
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
let renderer
try {
  const { useRoomCanvasStore } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts')
  const { useSurfaceFinishStore, surfaceGroupId } = await vite.ssrLoadModule('/src/state/useSurfaceFinishStore.ts')
  const { ScannedRoom } = await vite.ssrLoadModule('/src/scene/ScannedRoom.tsx')
  const { createMetricWallGeometry } = await vite.ssrLoadModule('/src/scene/surfaceAppearance.ts')
  const finish = { baseColor: '#bbccdd', roughness: 0.8, method: 'rgbd-uniform-v1', sourceSurfaceId: 'wall', frameCount: 2, sampleCount: 100, coverage: 0.7 }
  const wallA = { id: 'wall-0', kind: 'wall', position: [-1, 1.5, -2], size: [2, 3, 0.1], rotation: [0, 0, 0, 1], finish }
  const wallB = { ...wallA, id: 'wall-1', position: [1, 1.5, -2] }
  const floor = { id: 'floor', kind: 'floor', position: [0, 0, 0], size: [4, 4, 0.1], rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], polygonCorners: [[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0]] }
  const scan = { id: 'finish-fixture', room: { surfaces: [wallA, wallB, floor], colliders: [], bounds: [4,3,4], min: [-2,0,-2], max: [2,3,2] }, furniture: [] }
  useRoomCanvasStore.getState().applyScan(scan)
  renderer = await create(React.createElement(ScannedRoom))
  let walls = renderer.scene.findAll((node) => node.instance.name === 'scan-wall')
  const fragments = renderer.scene.findAll((node) => node.instance.name === 'scan-wall-fragment')
  const identities = fragments.map((node) => node.instance.geometry.uuid)
  await act(async () => { await renderer.fireEvent(fragments[0], 'click', { delta: 0, stopPropagation() {} }) })
  assert.equal(surfaceGroupId(scan.room.surfaces.find((surface) => surface.id === useRoomCanvasStore.getState().selectedSurfaceId)), 'wall')
  const appearance = { catalogId: 'decoration-005001', name: 'test', textureUrl: '/fixture.jpg', coverageMeters: [1.5, 1], rotationDegrees: 0 }
  await act(async () => useSurfaceFinishStore.getState().setFinish(scan.id, 'wall', appearance))
  assert.ok(walls.every((wall) => wall.instance.material.map), 'Both door panels must share the finish')
  assert.equal(walls[0].instance.material.map.source, walls[1].instance.material.map.source, 'Door panels must share the image/GPU source')
  assert.ok(walls.every((wall) => wall.instance.material.color.getHexString() === 'ffffff'), 'Recovered wall paint must not tint a user texture')
  assert.equal(walls[0].instance.material.map.repeat.x, 1 / 1.5)
  assert.deepEqual(renderer.scene.findAll((node) => node.instance.name === 'scan-wall-fragment').map((node) => node.instance.geometry.uuid), identities, 'Changing paint must not rebuild the BSP')
  await act(async () => useRoomCanvasStore.getState().applyScan(structuredClone(scan)))
  assert.ok(walls.every((wall) => wall.instance.material.map), 'Polling must preserve user paint')
  await act(async () => useRoomCanvasStore.getState().setMode('play'))
  assert.ok(walls.every((wall) => wall.instance.material.map && wall.instance.material.transparent === false && wall.instance.material.opacity === 1))
  await act(async () => useRoomCanvasStore.getState().setMode('edit'))
  await act(async () => useRoomCanvasStore.getState().setSelectedId('furniture'))
  assert.equal(useRoomCanvasStore.getState().selectedSurfaceId, null)
  const floorNode = renderer.scene.findAll((node) => node.instance.name === 'scan-floor')[0]
  await act(async () => { await renderer.fireEvent(floorNode, 'click', { delta: 0, stopPropagation() {} }) })
  assert.equal(useRoomCanvasStore.getState().selectedId, null)
  assert.equal(useRoomCanvasStore.getState().selectedSurfaceId, 'floor')
  await act(async () => useSurfaceFinishStore.getState().setFinish(scan.id, 'floor', { ...appearance, rotationDegrees: 90 }))
  assert.equal(floorNode.instance.material.map.rotation, Math.PI / 2)
  assert.ok(JSON.parse(storage.get('roomcanvas-surface-finishes-v1')).state.rooms[scan.id].floor)
  await act(async () => useRoomCanvasStore.getState().applyScan({ ...scan, id: 'other-room' }))
  assert.equal(useRoomCanvasStore.getState().selectedSurfaceId, null)
  assert.equal(floorNode.instance.material.map, null, 'Finish must not leak to another room')
  await act(async () => useRoomCanvasStore.getState().applyScan(scan))
  assert.ok(floorNode.instance.material.map, 'Returning to a room must restore its finish')
  await act(async () => useSurfaceFinishStore.getState().setFinish(scan.id, 'wall', null))
  walls = renderer.scene.findAll((node) => node.instance.name === 'scan-wall')
  assert.ok(walls.every((wall) => !wall.instance.material.map && wall.instance.material.color.getHexString() === 'bbccdd'))
  // Adjacent panels, even on a rotated wall, must agree at their common edge.
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0,1,0), 0.7)
  const panels = [wallA, wallB].map((wall) => ({ ...wall, position: new Vector3(...wall.position).applyQuaternion(rotation).toArray(), rotation: rotation.toArray() }))
  const edgeUVs = panels.map((wall, panel) => {
    const geometry = createMetricWallGeometry(wall, panels[0])
    const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
    const values = []
    for (let i=0; i<position.count; i++) if (Math.abs(position.getX(i) - (panel ? -1 : 1)) < 0.0001 && Math.abs(position.getY(i)-1.5)<0.0001 && position.getZ(i)>0) values.push([uv.getX(i),uv.getY(i)])
    geometry.dispose()
    return values[0]
  })
  assert.ok(edgeUVs[0].every((value,index) => Math.abs(value-edgeUVs[1][index])<0.0001), 'Metric UVs must be continuous across panels')
  // The internal drag adapter produces a real image File for the existing uploader.
  const { catalogImageFile } = await vite.ssrLoadModule('/src/types/catalog.ts')
  const savedFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => { calls.push(url); return url.includes('/image?') ? new Response(new Blob(['image'], { type: 'image/jpeg' }), { headers: { 'content-type': 'image/jpeg' } }) : Response.json({ name: 'chair', imageUrl: 'https://untrusted.invalid/image' }) }
  try {
    const file = await catalogImageFile('furniture-000001')
    assert.equal(file.type, 'image/jpeg')
    assert.ok(calls.every((url) => url.startsWith('/api/catalog/items/furniture-000001')))
    await assert.rejects(catalogImageFile('../API.md'))
    await assert.rejects(catalogImageFile('decoration-005001'))
  } finally { globalThis.fetch = savedFetch }
  console.log('PASS: per-wall/floor selection, shared metric textures, unchanged BSP, poll/Play/room persistence, original-paint reset, and internal furniture image import.')
} finally {
  if (renderer) await renderer.unmount()
  TextureLoader.prototype.load = originalLoad
  await vite.close()
}
