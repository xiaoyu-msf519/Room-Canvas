import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createServer } from 'vite'
import React from 'react'
import { create, act } from '@react-three/test-renderer'
import { useThree } from '@react-three/fiber'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
let renderer
try {
  const { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } = await import('three')
  const { createWallVisuals } = await vite.ssrLoadModule('/src/scene/wallVisibility.ts')
  const { createWallTransparency } = await vite.ssrLoadModule('/src/scene/wallTransparency.ts')
  const scene = await fetch('http://127.0.0.1:8000/api/scenes/latest').then((response) => response.json())
  const furniture = Array.from({ length: 100 }, (_, index) => scene.furniture[index % scene.furniture.length])
  const visuals = createWallVisuals(scene.room.surfaces)
  const transparency = createWallTransparency(visuals.walls)
  try {
    const path = Array.from({ length: 600 }, (_, index) => new Vector3(Math.sin(index / 600 * Math.PI * 2) * 8, 7, Math.cos(index / 600 * Math.PI * 2) * 8))
    for (const point of path.slice(0, 100)) visuals.update(point, true, furniture)
    const started = performance.now()
    for (const point of path) visuals.update(point, true, furniture)
    const elapsed = performance.now() - started
    console.log(`Wall visibility: ${visuals.walls.length} panels / 100 furniture, ${(elapsed / path.length).toFixed(3)} ms per camera update (${elapsed.toFixed(1)} ms / ${path.length} updates).`)
    visuals.update(new Vector3(8, 7, 8), true, scene.furniture)
    visuals.advance(1)
    const opaque = new Set(visuals.walls.filter((wall) => wall.material.opacity === 1).map((wall) => wall.surface.id))
    const reduced = transparency.meshes.filter((mesh) => !opaque.has(mesh.userData.wallId)).length + opaque.size
    console.log(`Wall color draws: ${transparency.meshes.length} BSP groups -> ${reduced} with opaque walls batched (${opaque.size} opaque panels).`)
    assert.ok(reduced < transparency.meshes.length, 'The actual scan must exercise opaque wall batching')
  } finally { transparency.dispose(); visuals.dispose() }
  const { useRoomCanvasStore } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts')
  const { ScannedRoom } = await vite.ssrLoadModule('/src/scene/ScannedRoom.tsx')
  const { AdaptiveResolution } = await vite.ssrLoadModule('/src/scene/AdaptiveResolution.tsx')
  useRoomCanvasStore.getState().applyScan(scene)
  const prior = useRoomCanvasStore.getState()
  useRoomCanvasStore.getState().applyScan(structuredClone(scene))
  assert.equal(useRoomCanvasStore.getState(), prior, 'Identical polling must not notify the whole scene')
  const updated = structuredClone(scene)
  updated.warnings = [...updated.warnings, 'performance-test-metadata']
  useRoomCanvasStore.getState().applyScan(updated)
  assert.equal(useRoomCanvasStore.getState().scan.room, prior.scan.room, 'Metadata changes must retain room geometry')
  assert.equal(useRoomCanvasStore.getState().furnitureList, prior.furnitureList, 'Metadata changes must retain unchanged furniture instances')
  let camera, renderState
  function Probe() { renderState = useThree(); camera = renderState.camera; return null }
  renderer = await create(React.createElement(React.Fragment, null, React.createElement(ScannedRoom), React.createElement(AdaptiveResolution), React.createElement(Probe)), { camera: { position: [8,7,8] } })
  await renderer.advanceFrames(40, 1 / 60)
  const fragments = renderer.scene.findAll((node) => node.instance.name === 'scan-wall-fragment')
  const solids = renderer.scene.findAll((node) => node.instance.name === 'scan-wall-solid')
  const sources = renderer.scene.findAll((node) => node.instance.name === 'scan-wall')
  const visibleWalls = () => fragments.filter((node) => node.instance.visible).length + solids.filter((node) => node.instance.visible).length
  assert.ok(visibleWalls() < fragments.length)
  console.log(`Actual R3F wall draws: ${fragments.length} -> ${visibleWalls()} at [8,7,8].`)
  for (let step = 0; step < 60; step++) {
    camera.position.set(Math.sin(step / 60 * Math.PI * 2) * 8, 7, Math.cos(step / 60 * Math.PI * 2) * 8)
    await renderer.advanceFrames(1, 1 / 60)
    solids.forEach((solid, index) => {
      const opacity = sources[index].instance.material.opacity
      assert.equal(solid.instance.visible, opacity === 1, 'Opaque and blended passes must swap on the exact same frame')
      const wallId = scene.room.surfaces.filter((surface) => surface.kind === 'wall')[index].id
      assert.ok(fragments.filter((node) => node.instance.userData.wallId === wallId).every((node) => node.instance.visible === (opacity < 1)))
      assert.equal(solid.instance.material.transparent, false)
      assert.equal(solid.instance.material.depthWrite, true)
    })
  }
  const originalWindow = globalThis.window
  try {
    globalThis.window = { devicePixelRatio: 2 }
    await act(async () => renderState.set({ performance: { ...renderState.performance, current: 0.7 } }))
    assert.ok(Math.abs(renderState.viewport.dpr - 1.35 * 0.7) < 1e-8)
    await act(async () => useRoomCanvasStore.getState().setMode('play'))
    assert.equal(renderState.viewport.dpr, 1.4, 'Play must retain its own native resolution cap')
    assert.ok(solids.every((node) => !node.instance.visible))
    await act(async () => renderState.set({ performance: { ...renderState.performance, current: 1 } }))
    assert.equal(renderState.viewport.dpr, 2, 'Stopping must restore full resolution')
  } finally { globalThis.window = originalWindow }
  const { createModelDisplay } = await vite.ssrLoadModule('/src/scene/modelDisplay.ts')
  const source = new Group()
  const mesh = new Mesh(new BoxGeometry(2, 3, 4), new MeshStandardMaterial())
  source.position.set(0.3, 0.2, -0.4)
  source.add(mesh)
  const first = createModelDisplay(source), second = createModelDisplay(source)
  assert.notEqual(first.display, second.display)
  assert.equal(first.display.children[0].geometry, second.display.children[0].geometry)
  assert.equal(first.display.children[0].material, mesh.material, 'Instances must not allocate duplicate materials')
  assert.equal(first.center, second.center, 'Model bounds must be measured once per source')
  assert.deepEqual(first.extents.toArray(), [2, 3, 4])
  assert.ok(first.center.distanceTo(source.position) < 1e-8, 'Source wrapper transform must remain part of centering')
  mesh.geometry.dispose(); mesh.material.dispose()
  console.log('PASS: batched opaque walls, synchronized fade handoff, poll identity reuse, shared model resources and motion/full-resolution restoration.')
} finally {
  if (renderer) await renderer.unmount()
  await vite.close()
}
