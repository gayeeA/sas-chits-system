-- Expose the exact current-month instalment components for each membership.
-- These values come from the generated instalment, so prized-member rules are preserved.
create or replace view public.member_outstanding with (security_invoker=true) as
select m.id membership_id, m.customer_id, m.ticket_no, m.prized, m.status membership_status,
  c.name, c.member_code, c.phone, c.status member_status,
  g.id group_id, g.series, g.name group_name, g.status group_status, g.current_month, g.current_dividend dividend,
  coalesce(sum(s.amount_due) filter (where s.month_label=g.current_month),0)::bigint due,
  coalesce(sum(s.paid) filter (where s.month_label=g.current_month),0)::bigint paid,
  coalesce(sum(s.balance) filter (where s.month_label<g.current_month),0)::bigint arrears,
  coalesce(sum(s.balance) filter (where s.month_label=g.current_month),0)::bigint current_balance,
  coalesce(sum(s.balance) filter (where s.month_label<=g.current_month),0)::bigint total_outstanding,
  coalesce(sum(s.balance) filter (where s.due_date<current_date),0)::bigint overdue,
  count(*) filter (where s.due_date<current_date and s.balance>0) overdue_months,
  min(s.due_date) filter (where s.balance>0) oldest_due_date,
  coalesce(sum(s.paid),0)::bigint total_paid,
  m.assigned_agent,
  coalesce(sum(s.gross) filter (where s.month_label=g.current_month),0)::bigint current_gross,
  coalesce(sum(s.dividend) filter (where s.month_label=g.current_month),0)::bigint current_dividend
from public.memberships m
join public.customers c on c.id=m.customer_id
join public.chit_groups g on g.id=m.group_id
left join public.installment_status s on s.membership_id=m.id
where public.is_manager() or m.assigned_agent=auth.uid()
group by m.id, c.id, g.id;
