import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { supabase } from './supabase'
import { RootStackParamList } from './navigation'
import CollectScreen from './screens/CollectScreen'
import DuesScreen from './screens/DuesScreen'
import HomeScreen from './screens/HomeScreen'
import TodayScreen from './screens/TodayScreen'
import LoginScreen from './screens/LoginScreen'
import LegacyReceiptScreen from './screens/LegacyReceiptScreen'
import FollowupsScreen from './screens/FollowupsScreen'

const Stack = createNativeStackNavigator<RootStackParamList>()

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error('Could not restore session', error)
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator color="#E10F17" />
  </View>

  return <NavigationContainer>
    <Stack.Navigator id="RootStack" key={session ? 'authenticated' : 'guest'} screenOptions={{ headerShown: false }}>
      {session
        ? <>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Dues" component={DuesScreen} />
          <Stack.Screen name="Collect" component={CollectScreen} />
          <Stack.Screen name="Today" component={TodayScreen} />
          <Stack.Screen name="LegacyReceipt" component={LegacyReceiptScreen} />
          <Stack.Screen name="Followups" component={FollowupsScreen} />
        </>
        : <Stack.Screen name="Login" component={LoginScreen} />}
    </Stack.Navigator>
  </NavigationContainer>
}
