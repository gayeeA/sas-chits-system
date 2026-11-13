import { NativeStackScreenProps } from '@react-navigation/native-stack'

/** Row of the member_outstanding view. */
export type MemberDue = {
  membership_id: string
  customer_id: string
  name: string
  member_code: string | null
  phone: string | null
  series: string
  ticket_no: number
  current_month: string | null
  due: number
  paid: number
  total_paid: number
  total_received: number
  subscription_paid: number
  interest_due: number
  arrears: number
  current_balance: number
  current_gross: number
  current_dividend: number
  total_outstanding: number
  advance_credit: number
  overdue: number
  overdue_months: number
  dividend: number
}

export type RootStackParamList = {
  Login: undefined
  Home: undefined
  Dues: undefined
  Today: undefined
  Collect: { due: MemberDue }
  LegacyReceipt: undefined
  Followups: { due: MemberDue }
  Management: undefined
}

export type ScreenProps<Route extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Route>
