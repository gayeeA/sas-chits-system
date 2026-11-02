import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import * as FileSystem from 'expo-file-system/legacy'
import * as MediaLibrary from 'expo-media-library/legacy'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform, TurboModuleRegistry } from 'react-native'
import type { ShareSingleOptions } from 'react-native-share'
import { phoneDigits, receiptHtml, receiptWhatsAppText } from './chit'
import { LOGO } from './logoData'

export const RECEIPT_SELECT = '*, memberships(ticket_no, customers(name,phone,member_code), chit_groups(series)), payment_allocations(id,amount,allocation_type,installments(month_label)), receipt_scan_attachments(id,object_path)'
export const receiptImageSavedLocation = () => Platform.OS === 'android' ? 'your selected folder (usually Downloads)' : 'Photos'

/** Render the company-format receipt to PDF and open the share sheet (Chat, print, save). */
export async function shareReceipt(receipt: any) {
  const { uri } = await Print.printToFileAsync({ html: `<body style="padding:16px">${receiptHtml(receipt, LOGO)}</body>`, width: 595, height: 460 })
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Receipt ${receipt.receipt_no}` })
}

export async function saveReceiptImageToDevice(uri: string, receiptNo?: string | number) {
  if (Platform.OS === 'android') {
    const { StorageAccessFramework } = FileSystem
    let directoryUri = await AsyncStorage.getItem('receipt-download-directory')
    const writeToDirectory = async (targetDirectory: string) => {
      const imageData = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
      const suffix = new Date().toISOString().replace(/[:.]/g, '-')
      const label = receiptNo == null ? 'Receipt' : `Receipt-${String(receiptNo).replace(/[^a-zA-Z0-9-]/g, '-')}`
      const destination = await StorageAccessFramework.createFileAsync(targetDirectory, `${label}-${suffix}`, 'image/png')
      await FileSystem.writeAsStringAsync(destination, imageData, { encoding: FileSystem.EncodingType.Base64 })
    }

    if (directoryUri) {
      try {
        await writeToDirectory(directoryUri)
        return
      } catch {
        await AsyncStorage.removeItem('receipt-download-directory')
      }
    }

    const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync()
    if (!permission.granted || !permission.directoryUri) throw new Error('Choose a folder, such as Downloads, to save the receipt image.')
    directoryUri = permission.directoryUri
    await AsyncStorage.setItem('receipt-download-directory', directoryUri)
    await writeToDirectory(directoryUri)
    return
  }

  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo'])
  if (!permission.granted) throw new Error('Photo access is needed to save the receipt image to this phone.')
  await MediaLibrary.saveToLibraryAsync(uri)
}

export async function shareReceiptImageToWhatsApp(uris: string[], receipt: any, phone?: string | null): Promise<boolean> {
  const number = phoneDigits(phone)
  if (!number) throw new Error('This member has no valid phone number saved.')

  if (Platform.OS === 'android') {
    // Expo Go does not include RNShare's native module. Keep the app usable there
    // with the platform share sheet; installed builds use direct WhatsApp sharing.
    if (!TurboModuleRegistry.get('RNShare')) {
      await Sharing.shareAsync(uris[0], { mimeType: 'image/png', dialogTitle: `Receipt ${receipt?.receipt_no} image` })
      return false
    }
    let Share: typeof import('react-native-share').default
    try {
      Share = require('react-native-share').default
    } catch {
      await Sharing.shareAsync(uris[0], { mimeType: 'image/png', dialogTitle: `Receipt ${receipt?.receipt_no} image` })
      return false
    }
    const { isInstalled } = await Share.isPackageInstalled('com.whatsapp')
    if (!isInstalled) throw new Error('WhatsApp is not installed on this phone.')
    await Share.shareSingle({
      social: Share.Social.WHATSAPP,
      whatsAppNumber: number,
      urls: uris,
      type: 'image/png',
      message: receiptWhatsAppText(receipt),
    } as ShareSingleOptions & { whatsAppNumber: string })
    return true
  }

  await Sharing.shareAsync(uris[0], { mimeType: 'image/png', UTI: 'public.png', dialogTitle: `Receipt ${receipt?.receipt_no} image` })
  return false
}
