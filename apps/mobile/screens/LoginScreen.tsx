import { useState } from 'react'
import { Alert, Image, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase } from '../supabase'
import { styles as st } from '../styles'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const signIn = async () => {
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) Alert.alert('Sign in failed', error.message)
  }

  return <View style={[st.page, { justifyContent: 'center' }]}>
    <Image source={require('../assets/logo.jpg')} style={{ width: 96, height: 86, alignSelf: 'center', borderRadius: 43, marginBottom: 12 }} />
    <Text style={[st.title, { textAlign: 'center', color: '#2B1A6B' }]}>Sri AndeSivaiah Chits</Text>
    <TextInput style={st.in} placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
    <TextInput style={st.in} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
    <TouchableOpacity style={st.btn} disabled={busy} onPress={signIn}><Text style={st.bt}>{busy ? 'Signing in…' : 'Sign in'}</Text></TouchableOpacity>
  </View>
}
