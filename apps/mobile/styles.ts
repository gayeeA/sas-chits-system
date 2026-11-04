import { StyleSheet } from 'react-native'

export const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, paddingTop: 52, backgroundColor: '#f6f5fa' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#E10F17', marginBottom: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#101224', padding: 10, borderRadius: 12, marginBottom: 12, borderBottomWidth: 3, borderBottomColor: '#E8B43C' },
  topt: { flex: 1, color: '#fff', fontWeight: '700' },
  name: { fontSize: 17, fontWeight: '600', marginVertical: 6 },
  in: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 8, color: '#222' },
  lb: { fontSize: 12, color: '#666' },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e5e5e5' },
  btn: { backgroundColor: '#E10F17', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  bt: { color: '#fff', fontWeight: '600' },
  chip: { flex: 1, padding: 10, borderRadius: 20, borderWidth: 1, borderColor: '#ccc', alignItems: 'center', marginVertical: 8 },
  chipOn: { backgroundColor: '#2B1A6B', borderColor: '#2B1A6B' },
  smallBtn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', marginRight: 6 },
  homeBtn: { alignSelf: 'flex-start', marginBottom: 8, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: '#E10F17', backgroundColor: '#E10F17' },
  homeBtnText: { color: '#fff', fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: { width: '48.5%', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e5e5e5', borderLeftWidth: 4 },
  tileValue: { fontSize: 20, fontWeight: '700', marginVertical: 2 },
  hint: { fontSize: 12, color: '#777' },
})
