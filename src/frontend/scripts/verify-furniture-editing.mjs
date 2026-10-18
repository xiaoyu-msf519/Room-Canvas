import assert from 'node:assert/strict'
import React from 'react'
import { create } from '@react-three/test-renderer'
import { createServer } from 'vite'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const storage = new Map()
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }
let confirmations = 0, confirmed = false
globalThis.window = { confirm: () => { confirmations++; return confirmed } }
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let renderer
try {
  const { useRoomCanvasStore: store } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts')
  const { saveCurrentRoomDraft } = await vite.ssrLoadModule('/src/state/useRoomDraftSync.ts')
  const { confirmFurnitureDeletion, handleFurnitureDeleteKey } = await vite.ssrLoadModule('/src/services/furnitureDeletion.ts')
  const { useSurfaceFinishStore: finishes } = await vite.ssrLoadModule('/src/state/useSurfaceFinishStore.ts')
  const item = (id, kind = 'original') => ({ id, kind, name: id, position: [0,0.5,0], size: [2,1,1], rotation: [0,0,0,1], modelUrl: '/api/assets/model.glb', editModelUrl: '/api/assets/model-edit.glb' })
  const room = { surfaces: [], colliders: [], min: [-5,0,-5], max: [5,3,5], bounds: [10,3,10] }
  const scan = { id: 'edited-room', room, furniture: [item('sofa'), item('chair')] }
  store.getState().applyScan(scan)
  store.getState().addFurniture(item('imported-desk', 'imported'))
  store.getState().updateFurniture('chair', { position: [2,0.8,3], size: [3,1.6,0.8], rotation: [0,0.6,0,0.8] })
  store.getState().addUploadedAsset({ id: 'source-asset', name: 'asset', previewUrl: '/image.jpg', status: 'succeeded', source: 'file', createdAt: 1 })
  const finish = { catalogId: 'paint', name: 'paint', textureUrl: '/paint.jpg', coverageMeters: [1,1], rotationDegrees: 0 }
  finishes.getState().setFinish(scan.id, 'wall-face', finish)
  finishes.getState().setFinish(scan.id, 'floor', { ...finish, textureUrl: '/floor.jpg' })
  const savedPaint = storage.get('roomcanvas-surface-finishes-v1')
  const chair = structuredClone(store.getState().furnitureList.find((entry) => entry.id === 'chair'))
  store.getState().setSelectedId('sofa')
  assert.ok(saveCurrentRoomDraft())
  assert.equal(confirmFurnitureDeletion(), false)
  assert.equal(store.getState().furnitureList.length, 3, 'Cancel must keep all furniture')
  confirmed = true
  assert.equal(confirmFurnitureDeletion(), true)
  assert.equal(store.getState().selectedId, null)
  assert.deepEqual(store.getState().furnitureList.map((entry) => entry.id), ['chair', 'imported-desk'])
  assert.equal(store.getState().uploadedAssets.length, 1, 'Deleting a placed item must retain its source asset')
  const poll = structuredClone(scan)
  poll.furniture[1].stageMessage = 'updated'
  poll.furniture[1].modelUrl = '/api/assets/new-model.glb'
  store.getState().applyScan(poll)
  assert.equal(store.getState().furnitureList.some((entry) => entry.id === 'sofa'), false, 'Polling resurrected deleted furniture')
  assert.deepEqual(store.getState().furnitureList[0].position, chair.position)
  assert.deepEqual(store.getState().furnitureList[0].size, chair.size)
  assert.equal(store.getState().furnitureList[0].modelUrl, '/api/assets/new-model.glb')
  assert.ok(saveCurrentRoomDraft())
  store.getState().applyScan({ id: 'other-room', room, furniture: [] })
  assert.deepEqual(store.getState().furnitureList, [])
  store.getState().applyScan(poll)
  assert.deepEqual(store.getState().furnitureList.map((entry) => entry.id), ['chair', 'imported-desk'])
  assert.deepEqual(store.getState().furnitureList[0].position, chair.position)
  assert.deepEqual(store.getState().furnitureList[0].rotation, chair.rotation)
  assert.deepEqual(store.getState().furnitureList[0].size, chair.size)
  assert.ok(saveCurrentRoomDraft())
  store.setState({ scan: null, furnitureList: [], deletedFurnitureIds: [] })
  store.getState().applyScan(poll)
  assert.deepEqual(store.getState().furnitureList.map((entry) => entry.id), ['chair', 'imported-desk'], 'Reload lost the placed furniture or deletion history')
  assert.deepEqual(store.getState().furnitureList[0].size, chair.size)
  assert.equal(storage.get('roomcanvas-surface-finishes-v1'), savedPaint, 'Furniture edits modified wallpaper/floor finishes')
  const { rememberRoomSession } = await vite.ssrLoadModule('/src/state/roomDraftSession.ts')
  rememberRoomSession(store.getState())
  const { useRoomCanvasStore: hotStore } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts?hot-restore-test')
  assert.equal(hotStore.getState().scan, store.getState().scan, 'Hot update discarded the active room')
  assert.equal(hotStore.getState().furnitureList, store.getState().furnitureList, 'Hot update discarded placed furniture')
  assert.equal(hotStore.getState().uploadedAssets, store.getState().uploadedAssets, 'Hot update discarded uploaded assets')
  store.getState().setSelectedId('chair')
  let prevented = 0
  const event = (patch = {}) => ({ key: 'Delete', repeat: false, target: null, preventDefault: () => prevented++, ...patch })
  const before = confirmations
  handleFurnitureDeleteKey(event({ target: { closest: () => ({}) } }))
  store.getState().setMode('play')
  handleFurnitureDeleteKey(event())
  store.getState().setMode('edit')
  store.getState().setSelectedId('chair')
  store.getState().setIsTransforming(true)
  handleFurnitureDeleteKey(event())
  store.getState().setIsTransforming(false)
  assert.equal(confirmations, before, 'Typing, Play or transforming must not open deletion confirmation')
  confirmed = false
  handleFurnitureDeleteKey(event())
  assert.equal(store.getState().furnitureList.length, 2)
  confirmed = true
  handleFurnitureDeleteKey(event())
  assert.deepEqual(store.getState().furnitureList.map((entry) => entry.id), ['imported-desk'])
  assert.equal(prevented, 2)
  delete globalThis.window
  const { EmptyRoom } = await vite.ssrLoadModule('/src/scene/EmptyRoom.tsx')
  renderer = await create(React.createElement(EmptyRoom))
  const ground = renderer.scene.findAll((node) => node.instance.isMesh && Math.abs(node.instance.position.y + 0.012) < 1e-7)[0]
  assert.equal(ground.instance.geometry.parameters.width, 80)
  assert.equal(ground.instance.geometry.parameters.height, 80)
  console.log('PASS: confirmed/cancelled deletion, keyboard guards, polling, room switch/reload and hot-update restore, source assets and wall/floor finishes retained, 80m ground.')
} finally {
  if (renderer) await renderer.unmount()
  await vite.close()
  delete globalThis.window
  delete globalThis.localStorage
}
