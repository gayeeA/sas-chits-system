import { toBlob } from 'html-to-image'
import { whatsappLink } from '../chit'

export async function shareElementAsImage({
  element, fileName, title, phone, message,
}: { element: HTMLElement; fileName: string; title: string; phone?: string | null; message: string }) {
  // Ensure the element is fully rendered before capturing
  await new Promise(r => requestAnimationFrame(r));

  const testFile = new File(['image'], `${fileName}.png`, { type: 'image/png' })
  const canShareFile = typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [testFile] })
  const chatWindow = !canShareFile && phone ? window.open('about:blank', '_blank') : null
  // Clone the element into a visible container for rendering
  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.position = 'fixed';
  clone.style.top = '0';
  clone.style.left = '0';
  clone.style.opacity = '1';
  clone.style.pointerEvents = 'none';
  // Append temporarily to body
  document.body.appendChild(clone);

  const blob = await toBlob(clone, { pixelRatio: 2, backgroundColor: '#fff', cacheBust: true });
  // Clean up the temporary clone
  document.body.removeChild(clone);

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
