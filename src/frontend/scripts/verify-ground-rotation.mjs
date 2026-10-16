import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { create } from '@react-three/test-renderer'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { Group, Quaternion, Ray, Vector3 } = require('three')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const up = new Vector3(0, 1, 0)
const target = { current: new Group() }
target.current.position.set(1.4, 0.425, -0.7)
let starts = 0
let commits = 0
const captures = new Set()
const pointerTarget = {
  setPointerCapture: (id) => captures.add(id),
  releasePointerCapture: (id) => captures.delete(id),
}
let renderer
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })

try {
  const { FurnitureGizmo } = await vite.ssrLoadModule('/src/scene/FurnitureGizmo.tsx')
  const onDragEnd = () => {
    // Persist and restore the transform, as the furniture component does on release.
    const position = target.current.position.toArray()
    const rotation = target.current.quaternion.toArray()
    target.current.position.fromArray(position)
    target.current.quaternion.fromArray(rotation)
    commits++
  }
  renderer = await create(React.createElement(React.Fragment, null,
    React.createElement('primitive', { object: target.current }),
    React.createElement(FurnitureGizmo, {
      target, height: 0.85, onDragStart: () => starts++, onDragEnd,
    }),
  ), { camera: { position: [6, 5, 7], fov: 52 }, width: 1280, height: 800 })

  const scene = renderer.scene.instance
  const refresh = async () => {
    await renderer.advanceFrames(2, 1 / 60)
    scene.updateMatrixWorld(true)
  }
  const handlers = () => renderer.scene.findAll((node) => typeof node.props.onPointerDown === 'function')
  const getArc = () => handlers().find((node) => new Vector3(0, 0, 1).transformDirection(node.instance.matrixWorld).dot(up) > 0.999)
  const rayFrom = (point) => new Ray(new Vector3(6, 5, 7), point.clone().sub(new Vector3(6, 5, 7)).normalize())
  const eventAt = (point) => ({
    point, ray: rayFrom(point), pointerId: 1, target: pointerTarget, shiftKey: false,
  })
  const assertGrounded = () => {
    assert.ok(up.clone().applyQuaternion(target.current.quaternion).distanceTo(up) < 1e-8, 'Furniture tilted')
    assert.ok(Math.abs(target.current.position.y - 0.425) < 1e-8, 'Furniture height changed')
    assert.ok(target.current.scale.distanceTo(new Vector3(1, 1, 1)) < 1e-8, 'Furniture size changed')
  }

  await refresh()
  assert.equal(handlers().length, 3, 'Expected two movement arrows and one rotation arc at the same time')
  const arc = getArc()
  assert.ok(arc, 'Y rotation arc is missing')
  const arrows = handlers().filter((handle) => handle !== arc)
  assert.equal(arrows.length, 2)
  assert.ok(arrows.every((handle) => Math.abs(new Vector3(0, 1, 0).transformDirection(handle.instance.matrixWorld).y) < 1e-8))

  const initialPosition = target.current.position.clone()
  for (let drag = 0; drag < 16; drag++) {
    await refresh()
    const origin = arc.instance.getWorldPosition(new Vector3())
    assert.ok(origin.distanceTo(target.current.position) < 1e-7, `Initial gizmo center mismatch: ${origin.toArray()} vs ${target.current.position.toArray()}`)
    const scale = arc.instance.getWorldScale(new Vector3()).x
    const localStart = new Vector3(0.65 / Math.SQRT2, 0.65 / Math.SQRT2, 0)
    const click = localStart.applyMatrix4(arc.instance.matrixWorld)
    const endpointBefore = new Vector3(0.65, 0, 0).applyMatrix4(arc.instance.matrixWorld)
    const angle = Math.PI / 6
    const beforeRotation = target.current.quaternion.clone()
    await renderer.fireEvent(arc, 'pointerDown', eventAt(click))
    assert.equal(captures.size, 1)
    for (let step = 1; step <= 12; step++) {
      const point = click.clone().sub(origin).applyAxisAngle(up, angle * step / 12).add(origin)
      await renderer.fireEvent(arc, 'pointerMove', eventAt(point))
      await refresh()
      assertGrounded()
      assert.ok(target.current.position.distanceTo(initialPosition) < 1e-7, `Rotation moved the furniture center: ${target.current.position.toArray()} vs ${initialPosition.toArray()}`)
      const endpoint = new Vector3(0.65, 0, 0).applyMatrix4(arc.instance.matrixWorld)
      const expected = endpointBefore.clone().sub(origin).applyAxisAngle(up, angle * step / 12).add(origin)
      assert.ok(endpoint.distanceTo(expected) < Math.max(1, scale) * 1e-6, 'Green arc did not follow the furniture during rotation')
    }
    const expectedRotation = new Quaternion().setFromAxisAngle(up, angle).multiply(beforeRotation)
    assert.ok(target.current.quaternion.angleTo(expectedRotation) < 1e-6, 'Furniture rotated by the wrong angle')
    const beforeRelease = target.current.matrixWorld.clone()
    await renderer.fireEvent(arc, 'pointerUp', eventAt(click))
    await refresh()
    assert.equal(captures.size, 0)
    assert.ok(target.current.matrixWorld.elements.every((value, index) => Math.abs(value - beforeRelease.elements[index]) < 1e-7), 'Model jumped on release')
  }

  // Both arrows remain usable after multiple complete rotations.
  for (const arrow of arrows) {
    for (let drag = 0; drag < 4; drag++) {
      await refresh()
      const direction = new Vector3(0, 1, 0).transformDirection(arrow.instance.matrixWorld)
      const origin = arrow.instance.getWorldPosition(new Vector3())
      const click = origin.clone().addScaledVector(direction, 0.4)
      const start = target.current.position.clone()
      const beforeRotation = target.current.quaternion.clone()
      await renderer.fireEvent(arrow, 'pointerDown', eventAt(click))
      await renderer.fireEvent(arrow, 'pointerMove', eventAt(click.clone().addScaledVector(direction, 0.2)))
      await refresh()
      assert.ok(target.current.position.distanceTo(start.clone().addScaledVector(direction, 0.2)) < 1e-7, 'Arrow movement used the wrong baseline')
      assert.ok(target.current.quaternion.angleTo(beforeRotation) < 1e-7, 'Moving an arrow changed the heading')
      assertGrounded()
      const beforeRelease = target.current.position.clone()
      await renderer.fireEvent(arrow, 'pointerUp', eventAt(click))
      await refresh()
      assert.ok(target.current.position.distanceTo(beforeRelease) < 1e-7, 'Arrow jumped on release')
      assert.ok(arc.instance.getWorldPosition(new Vector3()).distanceTo(target.current.position) < 1e-7, 'Arc and furniture centers separated')
    }
  }
  assert.equal(starts, 24)
  assert.equal(commits, 24)
  console.log('PASS: actual FurnitureGizmo + PivotControls, 16 rotations and 8 arrow drags; simultaneous handles, rotating arc, grounded model, stable release.')
} finally {
  if (renderer) await renderer.unmount()
  await vite.close()
}
