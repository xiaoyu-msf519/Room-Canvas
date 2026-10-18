import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { create, act } from '@react-three/test-renderer'
import { useThree } from '@react-three/fiber'
import { createServer } from 'vite'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const originalRaf = globalThis.requestAnimationFrame
globalThis.requestAnimationFrame = (callback) => { queueMicrotask(() => callback(0)); return 1 }
const { Box3, Ray, Vector3 } = createRequire(import.meta.url)('three')
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
let renderer
try {
  const { FurnitureModels } = await vite.ssrLoadModule('/src/scene/FurnitureModels.tsx')
  const { useRoomCanvasStore } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts')
  const { furnitureDimensions, clampFurnitureScale } = await vite.ssrLoadModule('/src/scene/furnitureTransform.ts')
  assert.deepEqual(clampFurnitureScale(new Vector3(1, 1000, 1), [2,1,1], [2,1,1]).toArray(), [20,20,20])
  assert.deepEqual(clampFurnitureScale(new Vector3(1, 0.001, 1), [2,1,1], [2,1,1]).toArray(), [0.05,0.05,0.05])
  const original = [2, 1, 1]
  const item = { id: 'scale-target', name: 'scale target', kind: 'original', position: [0, 0.5, 0], size: [...original], rotation: [0, Math.sin(0.3), 0, Math.cos(0.3)] }
  const scan = { id: 'scale-test', room: { surfaces: [], colliders: [] }, furniture: [item] }
  useRoomCanvasStore.getState().applyScan(scan)
  useRoomCanvasStore.getState().setSelectedId(item.id)
  let camera
  function Probe() { camera = useThree((state) => state.camera); return null }
  renderer = await create(React.createElement(React.Fragment, null, React.createElement(FurnitureModels), React.createElement(Probe)), { camera: { position: [6,5,7], fov: 52 }, width: 1280, height: 800 })
  const model = () => renderer.scene.findByProps({ name: 'furniture-object' }).instance
  const refresh = async () => { await renderer.advanceFrames(2, 1 / 60); renderer.scene.instance.updateMatrixWorld(true) }
  const ancestor = (node, name) => { for (let parent = node.instance; parent; parent = parent.parent) if (parent.name === name) return true; return false }
  const handlers = () => renderer.scene.findAll((node) => typeof node.props.onPointerDown === 'function')
  const captured = new Set()
  const pointerTarget = { setPointerCapture: (id) => captured.add(id), releasePointerCapture: (id) => captured.delete(id) }
  const eventAt = (point) => ({ point, ray: new Ray(camera.position.clone(), point.clone().sub(camera.position).normalize()), pointerId: 1, target: pointerTarget, camera, shiftKey: false })
  await refresh()
  const scaleHandles = handlers().filter((node) => ancestor(node, 'furniture-scale-gizmo'))
  assert.equal(scaleHandles.length, 1, 'Uniform scaling must have exactly one handle')
  assert.equal(handlers().filter((node) => ancestor(node, 'furniture-move-gizmo')).length, 3, 'Move and rotate controls must remain simultaneous')
  for (let cycle = 0; cycle < 9; cycle++) {
    await refresh()
    const handle = scaleHandles[0]
    const direction = new Vector3(0,1,0).transformDirection(handle.instance.matrixWorld)
    const sphere = handle.instance.children.find((child) => child.isMesh)
    const click = sphere.getWorldPosition(new Vector3())
    const before = [...useRoomCanvasStore.getState().furnitureList[0].size]
    const sign = cycle % 2 ? -1 : 1
    await act(async () => { await renderer.fireEvent(handle, 'pointerDown', eventAt(click)) })
    assert.equal(captured.size, 1)
    assert.equal(useRoomCanvasStore.getState().isTransforming, true)
    for (let step = 1; step <= 6; step++) {
      await act(async () => { await renderer.fireEvent(handle, 'pointerMove', eventAt(click.clone().addScaledVector(direction, sign * step * 0.15))) })
      await refresh()
      const live = furnitureDimensions(before, original, model().scale)
      const multiplier = live.dimensions[0] / before[0]
      assert.ok(sign > 0 ? multiplier > 1 : multiplier < 1, 'Handle must both enlarge and shrink')
      for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(live.dimensions[axis] / before[axis] - multiplier) < 1e-7, 'All dimensions must use the same multiplier')
      assert.ok(Math.abs(model().position.y-live.dimensions[1]/2)<1e-7, 'Scaling moved the furniture bottom off the floor')
    }
    const bounds = new Box3().setFromObject(model())
    await act(async () => { await renderer.fireEvent(handle, 'pointerUp', eventAt(click)) })
    await refresh()
    const after = new Box3().setFromObject(model())
    assert.ok(bounds.min.distanceTo(after.min)<1e-6 && bounds.max.distanceTo(after.max)<1e-6, 'Model jumped or changed size on scale release')
    assert.ok(model().scale.distanceTo(new Vector3(1,1,1))<1e-8)
    const current = useRoomCanvasStore.getState().furnitureList[0]
    assert.deepEqual(current.originalSize, original, 'Repeated drags changed the original-size baseline')
    assert.ok(sign > 0 ? current.size[0] > before[0] : current.size[0] < before[0])
    assert.equal(captured.size, 0)
  }
  const scaled = useRoomCanvasStore.getState().furnitureList[0]
  const updated = structuredClone(scan)
  updated.furniture[0].stageMessage = 'poll-complete'
  await act(async () => useRoomCanvasStore.getState().applyScan(updated))
  assert.deepEqual(useRoomCanvasStore.getState().furnitureList[0].size, scaled.size)
  assert.deepEqual(useRoomCanvasStore.getState().furnitureList[0].originalSize, original)
  await refresh()
  const moveHandles = handlers().filter((node) => ancestor(node, 'furniture-move-gizmo'))
  for (const arrow of moveHandles.slice(0, 2)) {
    const direction = new Vector3(0,1,0).transformDirection(arrow.instance.matrixWorld)
    const start = model().position.clone()
    const click = arrow.instance.getWorldPosition(new Vector3()).addScaledVector(direction, 0.4)
    await act(async () => { await renderer.fireEvent(arrow, 'pointerDown', eventAt(click)); await renderer.fireEvent(arrow, 'pointerMove', eventAt(click.clone().addScaledVector(direction, 0.2))) })
    await refresh()
    assert.ok(model().position.distanceTo(start.clone().addScaledVector(direction, 0.2)) < 1e-6)
    await act(async () => { await renderer.fireEvent(arrow, 'pointerUp', eventAt(click)) })
    await refresh()
    assert.deepEqual(useRoomCanvasStore.getState().furnitureList[0].size, scaled.size, 'Moving scaled furniture must preserve dimensions')
  }
  await act(async () => useRoomCanvasStore.getState().setMode('play'))
  assert.equal(handlers().length, 0)
  assert.deepEqual(useRoomCanvasStore.getState().furnitureList[0].size, scaled.size)
  console.log('PASS: actual furniture + one uniform scale handle, 9 enlarging/shrinking drags, proportional dimensions and limits, fixed floor contact, stable release, original baseline, move controls, polling and Play persistence.')
} finally {
  if (renderer) await renderer.unmount()
  globalThis.requestAnimationFrame = originalRaf
  await vite.close()
}
