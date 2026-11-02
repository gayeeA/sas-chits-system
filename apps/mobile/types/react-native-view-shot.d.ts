declare module 'react-native-view-shot' {
  import type React from 'react'
  import type { StyleProp, View, ViewStyle } from 'react-native'

  export type ViewShotRef = React.ComponentRef<typeof View> & { capture: () => Promise<string> }
  export type CaptureOptions = { format?: 'jpg' | 'png' | 'webp'; quality?: number; result?: 'tmpfile' | 'base64' | 'data-uri' }
  export type ViewShotProperties = { options?: CaptureOptions; style?: StyleProp<ViewStyle>; children?: React.ReactNode }
  const ViewShot: React.ForwardRefExoticComponent<ViewShotProperties & React.RefAttributes<ViewShotRef>>
  export default ViewShot
}
