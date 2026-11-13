-- Report subscription payments against net instalment dues, while preserving
-- the separate cash-received figure. Also support an atomic same-group ticket swap.

create or replace view public.member_outstanding with (security_invoker = true) as
select
  m.id membership_id, m.customer_id, m.ticket_no, m.prized, m.status membership_status,
  c.name, c.member_code, c.phone, c.status member_status,
  g.id group_id, g.series, g.name group_name, g.status group_status,
  g.current_month, g.current_dividend dividend,
  coalesce(sum(s.amount_due) filter (where s.month_label = g.current_month), 0)::bigint due,
  coalesce(sum(least(s.paid, s.amount_due)) filter (where s.month_label = g.current_month), 0)::bigint paid,
  coalesce(sum(s.balance) filter (where s.month_label < g.current_month), 0)::bigint arrears,
  coalesce(sum(s.balance) filter (where s.month_label = g.current_month), 0)::bigint current_balance,
  coalesce(sum(s.balance) filter (where s.month_label <= g.current_month), 0)::bigint total_outstanding,
  coalesce(sum(s.balance) filter (where s.due_date < current_date), 0)::bigint overdue,
  count(*) filter (where s.due_date < current_date and s.balance > 0) overdue_months,
  min(s.due_date) filter (where s.balance > 0) oldest_due_date,
  coalesce(sum(least(s.paid, s.amount_due)), 0)::bigint total_paid,
  m.assigned_agent,
  coalesce(sum(s.gross) filter (where s.month_label = g.current_month), 0)::bigint current_gross,
  coalesce(sum(s.dividend) filter (where s.month_label = g.current_month), 0)::bigint current_dividend,
  coalesce((select sum(a.amount) from public.payment_allocations a
    join public.receipts r on r.id = a.receipt_id
    where r.membership_id = m.id and r.status = 'ACTIVE' and a.allocation_type = 'ADVANCE'), 0)::bigint advance_credit,
  coalesce(sum(least(s.paid, s.amount_due)), 0)::bigint subscription_paid,
  coalesce((select sum(ch.amount) from public.member_interest_charges ch
    left join public.member_interest_charge_reversals rev on rev.charge_id = ch.id
    where ch.membership_id = m.id and rev.id is null), 0)::bigint interest_due,
  coalesce((select sum(r.total) from public.receipts r
    where r.membership_id = m.id and r.status = 'ACTIVE'), 0)::bigint total_received
from public.memberships m
join public.customers c on c.id = m.customer_id
join public.chit_groups g on g.id = m.group_id
left join public.installment_status s on s.membership_id = m.id
where public.is_manager() or m.assigned_agent = auth.uid()
group by m.id, c.id, g.id;

-- Defer the existing ticket uniqueness check within the swap transaction only.
alter table public.memberships drop constraint if exists memberships_group_id_ticket_no_key;
alter table public.memberships add constraint memberships_group_id_ticket_no_key
  unique (group_id, ticket_no) deferrable initially immediate;

create or replace function public.swap_membership_tickets(
  p_first_membership_id uuid,
  p_second_membership_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  first_row public.memberships%rowtype;
  second_row public.memberships%rowtype;
  ticket_limit integer;
begin
  if not public.is_owner() then raise exception 'Only the owner can swap ticket numbers'; end if;
  if p_first_membership_id is null or p_second_membership_id is null
      or p_first_membership_id = p_second_membership_id then
    raise exception 'Choose two different tickets';
  end if;
  select * into first_row from public.memberships where id = p_first_membership_id;
  if not found then raise exception 'First ticket not found'; end if;
  perform 1 from public.chit_groups where id = first_row.group_id for update;
  select * into first_row from public.memberships where id = p_first_membership_id for update;
  select * into second_row from public.memberships where id = p_second_membership_id for update;
  if not found then raise exception 'Second ticket not found'; end if;
  if first_row.group_id <> second_row.group_id then
    raise exception 'Tickets can only be swapped within the same group';
  end if;
  select coalesce(member_count, months) into ticket_limit
    from public.chit_groups where id = first_row.group_id;
  if first_row.ticket_no not between 1 and ticket_limit
      or second_row.ticket_no not between 1 and ticket_limit then
    raise exception 'A ticket number is outside this group duration';
  end if;
  if first_row.status <> 'ACTIVE' or second_row.status <> 'ACTIVE' then
    raise exception 'Only active tickets can be swapped';
  end if;
  set constraints public.memberships_group_id_ticket_no_key deferred;
  update public.memberships set ticket_no = second_row.ticket_no where id = first_row.id;
  update public.memberships set ticket_no = first_row.ticket_no where id = second_row.id;
end
$$;

revoke all on function public.swap_membership_tickets(uuid, uuid) from public, anon;
grant execute on function public.swap_membership_tickets(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
