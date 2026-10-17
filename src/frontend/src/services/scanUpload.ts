import type { SceneManifest } from '../types/scene'

export async function collectScanFiles(files: File[]): Promise<Array<{ file: File; path: string }>> {
  const pathOf = (file: File) => file.webkitRelativePath || file.name
  const manifests = files.filter((file) => /(^|\/)manifest\.json$/.test(pathOf(file)))
  if (manifests.length !== 1) throw new Error('请选择包含唯一 manifest.json 的 App 输出目录')
  const prefix = pathOf(manifests[0]).slice(0, -'manifest.json'.length)
  const index = new Map(files.map((file) => [pathOf(file), file]))
  const resource = (relative: string, required = true) => {
    if (!relative || relative.startsWith('/') || relative.includes('\\') || relative.includes(':') || relative.split('/').includes('..')) throw new Error('采集包包含越界路径')
    const file = index.get(prefix + relative)
    if (!file && required) throw new Error(`采集包缺少 ${relative}`)
    return file
  }
  const sceneFile = resource('scene.json')!
  const cameraFile = resource('cameras.json')!
  const [manifest, scene, cameras] = await Promise.all([manifests[0].text(), sceneFile.text(), cameraFile.text()]).then((texts) => texts.map((text) => JSON.parse(text)))
  if (manifest.status !== 'complete' || manifest.schemaVersion !== 'roomcanvas.scan.v1' || scene.schemaVersion !== 'roomcanvas.scene.v1' || manifest.id !== scene.scanId || !Array.isArray(cameras)) throw new Error('采集包未完成或协议不匹配')
  const selected = new Map<string, File>([['manifest.json', manifests[0]], ['scene.json', sceneFile], ['cameras.json', cameraFile]])
  const add = (path: string, required = true) => {
    if (!/\.(png|jpe?g|f32|u8)$/i.test(path)) throw new Error('扫描资源必须为图片或深度文件')
    const file = resource(path, required)
    if (file) selected.set(path, file)
  }
  for (const camera of cameras) {
    add(camera.imagePath)
    if (camera.depth?.depthPath) add(camera.depth.depthPath, false)
    if (camera.depth?.confidencePath) add(camera.depth.confidencePath, false)
  }
  for (const object of scene.objects) for (const crop of object.crops ?? []) add(crop.imagePath, false)
  const result = [...selected].map(([path, file]) => ({ path, file }))
  if (result.reduce((size, entry) => size + entry.file.size, 0) > 300 * 1024 * 1024) throw new Error('所需扫描数据不能超过 300 MB')
  return result
}

export function uploadScan(body: FormData, onProgress: (percent: number) => void): Promise<SceneManifest> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/scans')
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)) }
    request.onerror = () => reject(new Error('扫描上传失败，请检查网络后重试'))
    request.onload = () => {
      try {
        const payload = JSON.parse(request.responseText)
        if (request.status < 200 || request.status >= 300) throw new Error(payload.detail || '扫描导入失败')
        resolve(payload as SceneManifest)
      } catch (error) { reject(error) }
    }
    request.send(body)
  })
}
