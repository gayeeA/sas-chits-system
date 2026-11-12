create table public.member_interest_charges (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id),
  installment_id uuid not null references public.installments(id),
  principal bigint not null check (principal > 0),
  annual_rate numeric(7,4) not null check (annual_rate > 0 and annual_rate <= 100),
  period_start date not null,
  period_end date not null,
  day_count_basis smallint not null default 360 check (day_count_basis = 360),
  days integer not null check (days > 0),
  amount bigint not null check (amount > 0),
  confirmed_by text not null check (length(trim(confirmed_by)) > 0),
  notes text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index member_interest_charges_membership_idx
  on public.member_interest_charges(membership_id, created_at desc);
create index member_interest_charges_installment_idx
  on public.member_interest_charges(installment_id, period_start, period_end);

create table public.member_interest_charge_reversals (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null unique references public.member_interest_charges(id),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.member_interest_charges enable row level security;
alter table public.member_interest_charge_reversals enable row level security;
revoke all on public.member_interest_charges, public.member_interest_charge_reversals from public, anon, authenticated;
grant select on public.member_interest_charges, public.member_interest_charge_reversals to authenticated;

create policy member_interest_charges_read on public.member_interest_charges
for select to authenticated
using (
  public.is_manager()
  or exists (
    select 1 from public.memberships m
    where m.id = member_interest_charges.membership_id
      and m.assigned_agent = auth.uid()
  )
);

create policy member_interest_reversals_read on public.member_interest_charge_reversals
for select to authenticated
using (
  public.is_manager()
  or exists (
    select 1
    from public.member_interest_charges c
    join public.memberships m on m.id = c.membership_id
    where c.id = member_interest_charge_reversals.charge_id
      and m.assigned_agent = auth.uid()
  )
);

create or replace function public.record_member_interest_charge(
  p_membership_id uuid,
  p_installment_id uuid,
  p_principal bigint,
  p_annual_rate numeric,
  p_period_start date,
  p_period_end date,
  p_confirmed_by text,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due_date date;
  v_balance bigint;
  v_days integer;
  v_amount bigint;
  v_rate numeric(7,4);
  v_charge_id uuid;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception 'Only an owner or manager can apply an interest charge';
  end if;
  if p_principal is null or p_principal <= 0 then
    raise exception 'Interest principal must be positive';
  end if;
  if p_annual_rate is null or p_annual_rate <= 0 or p_annual_rate > 100 then
    raise exception 'Annual interest rate must be greater than 0 and no more than 100 percent';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start
      or p_period_end > current_date then
    raise exception 'Interest period must be valid and cannot end in the future';
  end if;
  if nullif(trim(p_confirmed_by), '') is null then
    raise exception 'Record who confirmed the interest terms';
  end if;

  select i.due_date,
    greatest(
      case
        when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean, false)
          and i.due_date < current_date then i.gross
        else i.net
      end - i.paid,
      0
    )
  into v_due_date, v_balance
  from public.installments i
  where i.id = p_installment_id
    and i.membership_id = p_membership_id
    and i.status <> 'CANCELLED'
  for update;

  if not found then
    raise exception 'Choose an existing instalment for this member';
  end if;
  if p_period_start <= v_due_date then
    raise exception 'Interest period must start after the instalment due date';
  end if;
  if p_principal > v_balance then
    raise exception 'Interest principal cannot exceed the current outstanding instalment balance';
  end if;

  if exists (
    select 1
    from public.member_interest_charges c
    left join public.member_interest_charge_reversals r on r.charge_id = c.id
    where c.installment_id = p_installment_id
      and r.id is null
      and daterange(c.period_start, c.period_end + 1, '[)')
          && daterange(p_period_start, p_period_end + 1, '[)')
  ) then
    raise exception 'This interest period overlaps an existing active charge; reverse it or choose a non-overlapping period';
  end if;

  v_days := p_period_end - p_period_start + 1;
  v_rate := round(p_annual_rate, 4);
  v_amount := round(p_principal::numeric * v_rate * v_days / 36000)::bigint;
  if v_amount <= 0 then
    raise exception 'Calculated interest rounds to zero; no charge was recorded';
  end if;

  insert into public.member_interest_charges(
    membership_id, installment_id, principal, annual_rate,
    period_start, period_end, day_count_basis, days, amount,
    confirmed_by, notes
  )
  values (
    p_membership_id, p_installment_id, p_principal, v_rate,
    p_period_start, p_period_end, 360, v_days, v_amount,
    trim(p_confirmed_by), nullif(trim(p_notes), '')
  )
  returning id into v_charge_id;

  return v_charge_id;
end
$$;

create or replace function public.reverse_member_interest_charge(
  p_charge_id uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reversal_id uuid;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception 'Only an owner or manager can reverse an interest charge';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required to reverse an interest charge';
  end if;
  if not exists (
    select 1 from public.member_interest_charges c
    where c.id = p_charge_id
  ) then
    raise exception 'Interest charge not found';
  end if;

  insert into public.member_interest_charge_reversals(charge_id, reason)
  values (p_charge_id, trim(p_reason))
  returning id into v_reversal_id;

  return v_reversal_id;
end
$$;

revoke all on function public.record_member_interest_charge(uuid, uuid, bigint, numeric, date, date, text, text) from public, anon;
revoke all on function public.reverse_member_interest_charge(uuid, text) from public, anon;
grant execute on function public.record_member_interest_charge(uuid, uuid, bigint, numeric, date, date, text, text) to authenticated;
grant execute on function public.reverse_member_interest_charge(uuid, text) to authenticated;

create or replace view public.member_outstanding with (security_invoker = true) as
select
  m.id membership_id,
  m.customer_id,
  m.ticket_no,
  m.prized,
  m.status membership_status,
  c.name,
  c.member_code,
  c.phone,
  c.status member_status,
  g.id group_id,
  g.series,
  g.name group_name,
  g.status group_status,
  g.current_month,
  g.current_dividend dividend,
  coalesce(sum(s.amount_due) filter (where s.month_label = g.current_month), 0)::bigint due,
  coalesce(sum(s.paid) filter (where s.month_label = g.current_month), 0)::bigint paid,
  coalesce(sum(s.balance) filter (where s.month_label < g.current_month), 0)::bigint arrears,
  coalesce(sum(s.balance) filter (where s.month_label = g.current_month), 0)::bigint current_balance,
  coalesce(sum(s.balance) filter (where s.month_label <= g.current_month), 0)::bigint total_outstanding,
  coalesce(sum(s.balance) filter (where s.due_date < current_date), 0)::bigint overdue,
  count(*) filter (where s.due_date < current_date and s.balance > 0) overdue_months,
  min(s.due_date) filter (where s.balance > 0) oldest_due_date,
  coalesce((
    select sum(r.total)
    from public.receipts r
    where r.membership_id = m.id and r.status = 'ACTIVE'
  ), 0)::bigint total_paid,
  m.assigned_agent,
  coalesce(sum(s.gross) filter (where s.month_label = g.current_month), 0)::bigint current_gross,
  coalesce(sum(s.dividend) filter (where s.month_label = g.current_month), 0)::bigint current_dividend,
  coalesce((
    select sum(a.amount)
    from public.payment_allocations a
    join public.receipts r on r.id = a.receipt_id
    where r.membership_id = m.id
      and r.status = 'ACTIVE'
      and a.allocation_type = 'ADVANCE'
  ), 0)::bigint advance_credit,
  coalesce((
    select sum(a.amount)
    from public.payment_allocations a
    join public.receipts r on r.id = a.receipt_id
    where r.membership_id = m.id
      and r.status = 'ACTIVE'
      and a.allocation_type in ('CURRENT', 'ARREARS')
  ), 0)::bigint subscription_paid,
  coalesce((
    select sum(c.amount)
    from public.member_interest_charges c
    left join public.member_interest_charge_reversals r on r.charge_id = c.id
    where c.membership_id = m.id and r.id is null
  ), 0)::bigint interest_due
from public.memberships m
join public.customers c on c.id = m.customer_id
join public.chit_groups g on g.id = m.group_id
left join public.installment_status s on s.membership_id = m.id
where public.is_manager() or m.assigned_agent = auth.uid()
group by m.id, c.id, g.id;

notify pgrst, 'reload schema';
