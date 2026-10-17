import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { collectScanFiles, uploadScan } = await vite.ssrLoadModule('/src/services/scanUpload.ts')
  const files = new Map()
  const file = (path, contents) => {
    const result = new File([typeof contents === 'string' ? contents : JSON.stringify(contents)], path.split('/').at(-1))
    Object.defineProperty(result, 'webkitRelativePath', { value: 'any-room/' + path })
    files.set(path, result)
    return result
  }
  file('manifest.json', { id: 'scan-1', schemaVersion: 'roomcanvas.scan.v1', status: 'complete' })
  file('scene.json', { scanId: 'scan-1', schemaVersion: 'roomcanvas.scene.v1', objects: [{ crops: [{ imagePath: 'objects/crop.png' }] }] })
  file('cameras.json', [{ imagePath: 'frames/image.jpg', depth: { depthPath: 'depth/image.f32', confidencePath: 'depth/image.u8' } }])
  file('objects/crop.png', 'image')
  file('frames/image.jpg', 'image')
  file('depth/image.f32', 'depth')
  file('depth/image.u8', 'confidence')
  file('room.usdz', 'unused large export')
  file('private.key', 'not an input')
  file('frames/image.json', 'unused sidecar')
  const selected = await collectScanFiles([...files.values()])
  assert.deepEqual(selected.map((entry) => entry.path).sort(), ['manifest.json', 'scene.json', 'cameras.json', 'objects/crop.png', 'frames/image.jpg', 'depth/image.f32', 'depth/image.u8'].sort())
  const modelName = 'a'.repeat(64) + '.glb'
  file('.roomcanvas-cache/cache.json', { schemaVersion: 'roomcanvas.cache.v1', furniture: [{ model: { file: 'models/' + modelName, sha256: 'a'.repeat(64) } }] })
  file('.roomcanvas-cache/models/' + modelName, 'cached-model')
  const portable = await collectScanFiles([...files.values()])
  assert.ok(portable.some((entry) => entry.path === '.roomcanvas-cache/cache.json') && portable.some((entry) => entry.path.endsWith(modelName)), 'Folder reupload discarded its portable models')
  await assert.rejects(collectScanFiles([...files.values()].filter((entry) => entry !== files.get('frames/image.jpg'))), /frames\/image.jpg/)
  file('cameras.json', [{ imagePath: '../outside.jpg' }])
  await assert.rejects(collectScanFiles([...files.values()]), /越界/)
  file('manifest.json', { id: 'scan-1', schemaVersion: 'roomcanvas.scan.v1', status: 'capturing' })
  await assert.rejects(collectScanFiles([...files.values()]), /未完成/)
  let transport
  globalThis.XMLHttpRequest = class {
    upload = {}
    constructor() { transport = this }
    open(method, url) { assert.equal(method, 'POST'); assert.equal(url, '/api/scans') }
    send(body) { assert.ok(body instanceof FormData) }
  }
  const percent = []
  const pending = uploadScan(new FormData(), (value) => percent.push(value))
  transport.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 })
  transport.status = 201
  transport.responseText = JSON.stringify({ id: 'automatic-scene' })
  transport.onload()
  assert.equal((await pending).id, 'automatic-scene')
  assert.deepEqual(percent, [50])
  const failed = uploadScan(new FormData(), () => {})
  transport.status = 422
  transport.responseText = JSON.stringify({ detail: 'invalid scan' })
  transport.onload()
  await assert.rejects(failed, /invalid scan/)
  const { useRoomCanvasStore } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts')
  const { ScanPanel } = await vite.ssrLoadModule('/src/components/ScanPanel.tsx')
  useRoomCanvasStore.setState({ scan: { id: 'ready', title: 'room', room: {}, furniture: [], source: {}, pipeline: { autoReconstruct: true, status: 'ready', preparation: 'complete', stageMessage: '房间已建成', completed: 0, total: 0 } } })
  Object.assign(useRoomCanvasStore.getInitialState(), { scan: useRoomCanvasStore.getState().scan })
  const markup = renderToStaticMarkup(React.createElement(ScanPanel, { onToast() {} }))
  assert.ok(markup.includes('房间已建成') && markup.includes('北向待校准') && markup.includes('webkitdirectory'))
  assert.equal(markup.includes('继续家具重建'), false, 'Automatic import still requires a manual reconstruction click')
  assert.ok(markup.includes('连接 App') && markup.includes('手机接收端'), 'Mobile receiver pairing control is missing')
  const { AssetDrawer } = await vite.ssrLoadModule('/src/components/AssetDrawer.tsx')
  const assetsMarkup = renderToStaticMarkup(React.createElement(AssetDrawer, { onToast() {} }))
  assert.equal(assetsMarkup.includes('淘宝商品链接'), false, 'Reserved product URL input was not removed')
  Object.assign(useRoomCanvasStore.getInitialState().scan, {
    furniture: [
      { id: 'one', name: 'chair', generationStatus: 'generating' },
      { id: 'two', name: 'table', generationStatus: 'queued' },
      { id: 'three', name: 'bed', generationStatus: 'needs_review', error: '家具截断过多，需要更完整视角' },
    ],
    pipeline: { autoReconstruct: true, status: 'processing', preparation: 'complete', stageMessage: '生成中 1 件 · 排队 1 件；另 1 件待补拍', completed: 0, total: 3 },
  })
  const progressMarkup = renderToStaticMarkup(React.createElement(ScanPanel, { onToast() {} }))
  assert.ok(progressMarkup.includes('生成中 1') && progressMarkup.includes('排队 1') && progressMarkup.includes('待补拍 1'), 'Active and blocked furniture counts are not visible')
  assert.ok(progressMarkup.includes('查看待补拍原因') && progressMarkup.includes('家具截断过多，需要更完整视角') && progressMarkup.includes('<details'), 'Blocked reasons only exist in a hover title')
  console.log('PASS: arbitrary folder selection, required-file and portable-cache upload, input validation, upload progress/errors, automatic scene progress UI; no browser/network/paid calls')
} finally {
  await vite.close()
  delete globalThis.XMLHttpRequest
}
