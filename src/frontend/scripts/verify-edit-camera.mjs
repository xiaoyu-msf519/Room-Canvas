import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const { PerspectiveCamera, Vector3 } = createRequire(import.meta.url)('three')
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { applyEditCameraMove } = await vite.ssrLoadModule('/src/scene/CameraControllers.tsx')
  const camera = new PerspectiveCamera(52, 1, 0.05, 100)
  camera.position.set(0, 4, 6)
  camera.lookAt(0, 1, 0)
  camera.updateMatrixWorld(true)
  const target = new Vector3(0, 1, 0)
  const controls = { target, updates: 0, update() { this.updates++ } }
  const keys = new Set(['w'])
  const before = camera.position.clone(), beforeTarget = target.clone()
  assert.equal(applyEditCameraMove(camera, controls, keys, 1 / 60), true)
  const movement = camera.position.clone().sub(before)
  assert.ok(movement.length() > 0 && Math.abs(movement.y) < 1e-9)
  assert.ok(target.clone().sub(beforeTarget).distanceTo(movement) < 1e-9)
  assert.equal(controls.updates, 1)
  const slowDistance = movement.length()
  camera.position.copy(before); target.copy(beforeTarget)
  keys.clear(); keys.add('shift'); keys.add('d')
  applyEditCameraMove(camera, controls, keys, 1 / 60)
  assert.ok(camera.position.distanceTo(before) > slowDistance)
  camera.position.copy(before); target.copy(beforeTarget)
  keys.clear()
  assert.equal(applyEditCameraMove(camera, controls, keys, 1 / 60), false)
  assert.ok(camera.position.distanceTo(before) < 1e-9 && target.distanceTo(beforeTarget) < 1e-9)
  console.log('PASS: Edit WASD/arrow camera movement follows the horizontal view, pans OrbitControls target with the camera, supports Shift speed, and ignores empty input.')
} finally { await vite.close() }
