import { toBlob } from 'html-to-image'
import { whatsappLink } from '../chit'

export async function shareElementAsImage({
  element, fileName, title, phone, message,
}: { element: HTMLElement; fileName: string; title: string; phone?: string | null; message: string }) {
  const testFile = new File(['image'], `${fileName}.png`, { type: 'image/png' })
  const canShareFile = typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [testFile] })
  const chatWindow = !canShareFile && phone ? window.open('about:blank', '_blank') : null
  const blob = await toBlob(element, { pixelRatio: 2, backgroundColor: '#fff', cacheBust: true })
  if (!blob) { chatWindow?.close(); throw new Error('Could not render the share image.') }
  const file = new File([blob], `${fileName}.png`, { type: 'image/png' })
  if (canShareFile) {
    await navigator.share({ files: [file], title, text: message })
    return 'shared'
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = `${fileName}.png`; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  if (chatWindow && phone) chatWindow.location.href = whatsappLink(phone, message)
  else if (phone) window.open(whatsappLink(phone, message), '_blank', 'noopener,noreferrer')
  window.alert('The PNG image was downloaded. Attach it to the chat that opened.')
  return 'downloaded'
}
