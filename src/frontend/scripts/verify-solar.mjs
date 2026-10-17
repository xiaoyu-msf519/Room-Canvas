import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Worker as NodeWorker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { create, act } from '@react-three/test-renderer'
import { useThree } from '@react-three/fiber'
import { build } from 'esbuild'
import { createServer } from 'vite'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { Vector3 } = createRequire(import.meta.url)('three')
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
const originalWorker = globalThis.Worker
let renderer, atlas
try {
  const solar = await vite.ssrLoadModule('/src/solar/ephemeris.ts')
  const { directSolarDirection, sampleSolarDirection, clockDate, daylightAt, daysInYear, SHANGHAI } = solar
  const { getPosition } = await import('suncalc')
  assert.equal(daysInYear(2026), 365)
  assert.equal(daysInYear(2028), 366)
  assert.equal(clockDate(2026, 0, 480, 8).toISOString(), '2026-01-01T00:00:00.000Z')
  // Published NREL SPA example: 2003-10-17 12:30:30 UTC-7, Colorado.
  const reference = getPosition(new Date('2003-10-17T19:30:30Z'), 39.742476, -105.1786)
  assert.ok(Math.abs(reference.azimuth - 194.34024) < 0.2, `North/degree convention mismatch: ${reference.azimuth}`)
  assert.ok(Math.abs(reference.altitude - 39.88838) < 0.2, `NREL reference mismatch: ${reference.altitude}`)
  const compiled = await build({ entryPoints: ['src/solar/solar.worker.ts'], bundle: true, write: false, format: 'iife', platform: 'browser' })
  const bridge = `const {parentPort}=require('node:worker_threads');globalThis.self={addEventListener:(type,fn)=>parentPort.on('message',data=>fn({data})),postMessage:(data,options)=>parentPort.postMessage(data,options?.transfer)};\n`
  let workerStarts = 0
  globalThis.Worker = class {
    constructor() {
      workerStarts++
      this.worker = new NodeWorker(bridge + compiled.outputFiles[0].text, { eval: true })
      this.worker.on('message', (data) => this.onmessage?.({ data }))
      this.worker.on('error', (error) => this.onerror?.(error))
    }
    postMessage(data) { this.worker.postMessage(data) }
    terminate() { void this.worker.terminate() }
  }
  const { createSolarAtlas } = await vite.ssrLoadModule('/src/solar/solarAtlas.ts')
  let table, status
  atlas = createSolarAtlas((next) => { table = next }, (next) => { status = next })
  const waitReady = async () => {
    const start = performance.now()
    while (status !== 'ready') {
      if (status === 'error') throw new Error('Solar worker failed')
      assert.ok(performance.now() - start < 15000, 'Solar worker timed out')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  let heartbeats = 0
  const heartbeat = setInterval(() => heartbeats++, 5)
  const precomputeStart = performance.now()
  atlas.load(2026, SHANGHAI)
  await waitReady()
  const precomputeMs = performance.now() - precomputeStart
  clearInterval(heartbeat)
  assert.ok(heartbeats > 0, 'Precomputation blocked the main event loop')
  assert.equal(table.vectors.length, 366 * 289 * 3)
  assert.ok(table.vectors.every(Number.isFinite))
  const same = table
  atlas.load(2026, SHANGHAI)
  assert.equal(table, same, 'Switching back to a cached site rebuilt its table')
  assert.equal(workerStarts, 1, 'A cache hit started another worker')
  const direction = new Vector3(), expected = new Vector3()
  let maxError = 0
  for (const day of [0, 79, 171, 265, 354]) {
    for (const minute of [60, 301.25, 480.5, 720, 1081.75, 1380]) {
      sampleSolarDirection(table, day, minute, 0, direction)
      directSolarDirection(2026, day, minute, SHANGHAI, expected)
      maxError = Math.max(maxError, direction.angleTo(expected) * 180 / Math.PI)
    }
  }
  assert.ok(maxError < 0.12, `5-minute interpolation error is too large: ${maxError} degrees`)
  sampleSolarDirection(table, 171, 480, 0, direction)
  assert.ok(direction.x > 0, 'Morning sun must be east of the room')
  sampleSolarDirection(table, 171, 1080, 0, direction)
  assert.ok(direction.x < 0, 'Evening sun must be west of the room')
  sampleSolarDirection(table, 171, 720, 0, direction)
  const summerAltitude = direction.y
  sampleSolarDirection(table, 354, 720, 0, direction)
  assert.ok(summerAltitude > direction.y, 'Shanghai winter sun is higher than summer sun')
  for (const [d1, t1, d2, t2] of [[171, 1439.99999, 171, 0], [364.99999, 720, 0, 720]]) {
    sampleSolarDirection(table, d1, t1, 0, direction)
    sampleSolarDirection(table, d2, t2, 0, expected)
    assert.ok(direction.distanceTo(expected) < 1e-5, 'A circular control has a direction discontinuity at its wrap')
  }
  sampleSolarDirection(table, 171, 720, 90, direction)
  sampleSolarDirection(table, 171, 720, 0, expected)
  assert.ok(Math.abs(direction.x + expected.z) < 1e-6 && Math.abs(direction.z - expected.x) < 1e-6, 'North calibration rotates in the wrong direction')
  assert.equal(daylightAt(-0.3).sun, 0)
  assert.equal(daylightAt(-0.3).sky, 0)
  const sampleStart = performance.now()
  for (let i = 0; i < 100000; i++) sampleSolarDirection(table, (i / 15) % 365, (i * 0.1) % 1440, 25, direction)
  const lookupMs = performance.now() - sampleStart
  assert.ok(lookupMs < 1500, `Lookup path is too slow: ${lookupMs}ms/100k`)
  atlas.load(2026, { name: 'polar', latitude: 90, longitude: 0, utcOffset: 0 })
  await waitReady()
  assert.ok(table.vectors.every(Number.isFinite), 'Polar day/night produced invalid solar vectors')
  sampleSolarDirection(table, 171, 0, 0, direction)
  assert.ok(direction.y > 0, 'North pole summer must have midnight sun')
  sampleSolarDirection(table, 354, 720, 0, direction)
  assert.ok(direction.y < 0, 'North pole winter must have polar night')
  atlas.load(2026, { name: 'cancelled', latitude: -50, longitude: 0, utcOffset: 0 })
  atlas.load(2028, SHANGHAI)
  await waitReady()
  assert.equal(table.year, 2028, 'A stale location request overwrote the latest result')
  assert.equal(table.days, 366)
  atlas.dispose(); atlas = null

  const { useSolarStore } = await vite.ssrLoadModule('/src/state/useSolarStore.ts')
  const { useRoomCanvasStore } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts')
  const { useSolarScanSync } = await vite.ssrLoadModule('/src/state/useSolarScanSync.ts')
  const { Lighting } = await vite.ssrLoadModule('/src/scene/Lighting.tsx')
  const { TopToolbar } = await vite.ssrLoadModule('/src/components/TopToolbar.tsx')
  useSolarStore.setState({ year: 2026, day: 171, minute: 720, site: SHANGHAI, north: 0, status: 'computing' })
  useSolarStore.getState().setAnimateDayNight(true)
  useSolarStore.getState().advanceSolar(1.5)
  assert.equal(useSolarStore.getState().day, 171, 'Day/night mode changed the date')
  assert.equal(useSolarStore.getState().minute, 1080, 'Day/night mode is not running at six seconds per day')
  useSolarStore.getState().advanceSolar(4.5)
  assert.equal(useSolarStore.getState().minute, 720, 'Day/night mode did not wrap the time slider')
  useSolarStore.getState().setAnimateDayNight(false)
  useSolarStore.getState().setClock({ day: 171, minute: 720 })
  useSolarStore.getState().setAnimateSeasons(true)
  useSolarStore.getState().advanceSolar(10)
  assert.ok(Math.abs(useSolarStore.getState().day - (171 + 365 / 4)) < 1e-6, 'Season macro mode did not advance one quarter year in ten seconds')
  assert.equal(useSolarStore.getState().minute, 720, 'Seasons mode changed the time of day')
  useSolarStore.getState().setAnimateDayNight(true)
  useSolarStore.getState().advanceSolar(1.5)
  assert.equal(useSolarStore.getState().minute, 1080, 'Enabling seasons disabled day/night')
  assert.ok(Math.abs(useSolarStore.getState().day - (171 + 365 / 4 + 365 * 1.5 / 40)) < 1e-6, 'Enabling day/night disabled seasons')
  useSolarStore.getState().setAnimateSeasons(false)
  useSolarStore.getState().setAnimateDayNight(false)
  useSolarStore.getState().setClock({ day: 171, minute: 720 })
  const markup = renderToStaticMarkup(React.createElement(TopToolbar, { onToast() {} }))
  assert.equal((markup.match(/role="slider"/g) ?? []).length, 2, 'Toolbar does not contain both circular sliders')
  assert.ok(!markup.includes('暖阳') && !markup.includes('晨光') && !markup.includes('夜灯'))
  assert.ok(markup.includes('type="date"') && markup.includes('type="time"') && markup.includes('北向角'))
  let gl
  function Probe() { gl = useThree((state) => state.gl); return null }
  renderer = await create(React.createElement(React.Fragment, null, React.createElement(Lighting), React.createElement(Probe)))
  await renderer.advanceFrames(90, 1 / 60)
  const sun = renderer.scene.findByProps({ name: 'solar-sun' }).instance
  const moon = renderer.scene.findByProps({ name: 'solar-moon' }).instance
  assert.ok(sun.intensity > 2, 'Noon sunlight is missing')
  const path = renderer.scene.findByProps({ name: 'sun-path' }).instance.children[0].geometry
  const pathPositions = path.attributes.position
  const oldVersion = pathPositions.version
  await act(async () => useSolarStore.getState().setClock({ minute: 0 }))
  await renderer.advanceFrames(1, 1 / 60)
  assert.ok(sun.intensity > 0, 'Time changes skipped the smooth lighting transition')
  await renderer.advanceFrames(90, 1 / 60)
  assert.equal(sun.intensity, 0, 'The sun still illuminates the room at midnight')
  assert.ok(moon.intensity > 0.1, 'Night moonlight is missing')
  assert.equal(pathPositions.version, oldVersion, 'Changing only the time rebuilt the daily path')
  assert.equal(renderer.scene.findByProps({ name: 'solar-sun' }).instance, sun, 'Changing time recreated the light')
  assert.equal(gl.shadowMap.autoUpdate, false)
  gl.shadowMap.needsUpdate = false
  await renderer.advanceFrames(10, 1 / 60)
  assert.equal(gl.shadowMap.needsUpdate, false, 'A stationary scene keeps regenerating shadows')
  await act(async () => useSolarStore.getState().setClock({ minute: 720 }))
  await renderer.advanceFrames(90, 1 / 60)
  assert.ok(sun.intensity > 2 && gl.shadowMap.needsUpdate, 'Sunrise did not refresh the shadow map')
  await renderer.unmount(); renderer = null
  function ScanSync() { useSolarScanSync(); return null }
  renderer = await create(React.createElement(ScanSync))
  const captured = { id: 'heading-scene', room: { surfaces: [], colliders: [] }, furniture: [], source: { orientation: {
    reference: 'true-north', northAngleDegrees: 90, location: { latitude: 30, longitude: 120 }, utcOffsetMinutes: 480,
  } } }
  await act(async () => useRoomCanvasStore.getState().applyScan(captured))
  assert.equal(useSolarStore.getState().north, 90)
  assert.equal(useSolarStore.getState().site.latitude, 30)
  useSolarStore.getState().setNorth(45)
  await act(async () => useRoomCanvasStore.getState().applyScan(structuredClone(captured)))
  assert.equal(useSolarStore.getState().north, 45, 'Scan polling overwrote a manual north correction')
  await act(async () => useRoomCanvasStore.getState().applyScan({ ...captured, id: 'magnetic', source: { orientation: { ...captured.source.orientation, reference: 'magnetic-north' } } }))
  assert.equal(useSolarStore.getState().north, 45, 'Magnetic north was silently treated as true north')
  const actual = await fetch('http://127.0.0.1:8000/api/scenes/latest').then((response) => response.json())
  if (actual.source.orientation?.reference === 'true-north') {
    await act(async () => useRoomCanvasStore.getState().applyScan(actual))
    assert.equal(useSolarStore.getState().north, actual.source.orientation.northAngleDegrees, 'Real scan north did not reach the solar state')
    if (actual.source.orientation.location) assert.equal(useSolarStore.getState().site.latitude, actual.source.orientation.location.latitude)
    const angle = actual.source.orientation.northAngleDegrees * Math.PI / 180
    const north = actual.source.orientation.northInWorld
    assert.ok(Math.abs(north[0] - Math.sin(angle)) < 1e-6 && Math.abs(north[2] + Math.cos(angle)) < 1e-6, 'Backend north angle uses a different Web axis/sign convention')
    const unchanged = useSolarStore.getState().north
    await act(async () => useRoomCanvasStore.getState().applyScan(structuredClone(actual)))
    assert.equal(useSolarStore.getState().north, unchanged)
  }
  console.log(`PASS: NREL reference, real transferable Worker (${precomputeMs.toFixed(1)}ms, ${heartbeats} main-thread heartbeats), 365/366-day tables, vector seams/north/timezone, ${maxError.toFixed(4)}deg max sampled interpolation error, ${(lookupMs * 10).toFixed(2)}ns/lookup, cached sites/cancellation, toolbar controls, persistent smooth lights, day/night, shadow reuse, true-north scan import with manual correction preserved.`)
} finally {
  atlas?.dispose()
  if (renderer) await renderer.unmount()
  if (originalWorker) globalThis.Worker = originalWorker
  else delete globalThis.Worker
  await vite.close()
}
