import { useRef, useState } from 'react'
import { Check, Copy, Smartphone, X } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'

export function MobileConnection({ onToast }: { onToast: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [connection, setConnection] = useState<{ endpoint: string; endpoints: string[]; token: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const open = async () => {
    try {
      const response = await fetch('/api/mobile/connection')
      if (!response.ok) throw new Error('无法读取手机连接信息')
      setConnection(await response.json())
      setCopied(false)
      dialog.current?.showModal()
    } catch (error) { onToast(error instanceof Error ? error.message : '无法连接接收端') }
  }
  return <>
    <button type="button" className="mobile-connect-button" onClick={() => void open()} title="连接手机 App" aria-label="连接手机 App"><Smartphone size={13} />连接 App</button>
    <dialog ref={dialog} className="mobile-connection-dialog" onClick={(event) => { if (event.target === dialog.current) dialog.current.close() }}>
      <header><strong>手机接收端</strong><button type="button" title="关闭" aria-label="关闭手机连接" onClick={() => dialog.current?.close()}><X size={16} /></button></header>
      {connection && <>
        <div className="mobile-pairing-code"><QRCodeCanvas value={JSON.stringify({ endpoint: connection.endpoint, token: connection.token })} size={220} marginSize={2} title="手机接收端连接二维码" /></div>
        <label>接收地址<select value={connection.endpoint} onChange={(event) => { setConnection({ ...connection, endpoint: event.target.value }); setCopied(false) }}>{[...new Set([connection.endpoint, ...connection.endpoints])].map((endpoint) => <option key={endpoint} value={endpoint}>{endpoint}</option>)}</select></label>
        <label>上传令牌<input type="password" readOnly value={connection.token} autoComplete="off" /></label>
        <button className="copy-mobile-connection" type="button" onClick={() => {
          void navigator.clipboard.writeText(JSON.stringify({ endpoint: connection.endpoint, token: connection.token })).then(() => setCopied(true)).catch(() => onToast('剪贴板不可用'))
        }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制连接信息'}</button>
      </>}
    </dialog>
  </>
}
