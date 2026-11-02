-- Assign collection tickets to field staff, and track incoming cheque clearance.
alter table public.memberships
  add column if not exists assigned_agent uuid references public.profiles(id);
create index if not exists memberships_assigned_agent_idx on public.memberships(assigned_agent)
  where assigned_agent is not null;
drop policy if exists read_memberships on public.memberships;
create policy read_memberships on public.memberships for select to authenticated
  using (public.is_manager() or assigned_agent=auth.uid());
drop policy if exists read_installments on public.installments;
create policy read_installments on public.installments for select to authenticated
  using (public.is_manager() or exists (
    select 1 from public.memberships m where m.id=installments.membership_id and m.assigned_agent=auth.uid()
  ));

-- Security-definer payment RPCs must not let a collector submit a ticket outside their assignment.
create or replace function public.guard_assigned_payment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_manager() and not exists (
    select 1 from public.memberships m
    where m.id=new.membership_id and m.assigned_agent=auth.uid()
  ) then
    raise exception 'This ticket is not assigned to your account';
  end if;
  return new;
end $$;
drop trigger if exists guard_assigned_payment on public.receipts;
create trigger guard_assigned_payment before insert on public.receipts
for each row execute function public.guard_assigned_payment();

-- The quote RPC is SECURITY DEFINER in the base schema, so explicitly scope it to the collector too.
create or replace function public.payment_quote(p_membership_id uuid, p_month_label text)
returns table(current_due bigint, arrears_due bigint, future_due bigint, penalty_due bigint, dividend_allowed bigint, dividend_forfeited bigint)
language plpgsql stable security definer set search_path='' as $$
declare g public.chit_groups%rowtype; today date := current_date; v_current_due date;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if not public.is_manager() and not exists (
    select 1 from public.memberships m where m.id=p_membership_id and m.assigned_agent=auth.uid()
  ) then raise exception 'This ticket is not assigned to your account'; end if;
  select cg.* into strict g from public.chit_groups cg join public.memberships m on m.group_id=cg.id where m.id=p_membership_id;
  perform public.installment_due_date(p_month_label,g.due_day);
  select i.due_date into v_current_due from public.installments i where i.membership_id=p_membership_id and i.month_label=p_month_label;
  if not found then raise exception 'No installment exists for this membership and month'; end if;
  return query
  select
    coalesce(sum(case when i.month_label=p_month_label then greatest(e.effective_net-i.paid,0) else 0 end),0)::bigint,
    coalesce(sum(case when i.due_date < today and i.month_label<>p_month_label then greatest(e.effective_net-i.paid,0) else 0 end),0)::bigint,
    coalesce(sum(case when i.due_date > v_current_due then greatest(e.effective_net-i.paid,0) else 0 end),0)::bigint,
    greatest(coalesce(sum(case when i.due_date < today then e.penalty_due else 0 end),0) -
      coalesce((select sum(a.amount) from public.payment_allocations a join public.receipts r on r.id=a.receipt_id
        where r.membership_id=p_membership_id and r.status='ACTIVE' and a.allocation_type='PENALTY'),0),0)::bigint,
    coalesce(sum(case when i.month_label=p_month_label and (not coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) or i.due_date>=today) then i.dividend else 0 end),0)::bigint,
    coalesce(sum(case when i.month_label=p_month_label and coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) and i.due_date<today then i.dividend else 0 end),0)::bigint
  from public.installments i
  cross join lateral (
    select case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) and i.due_date<today then i.gross else i.net end effective_net,
      case
        when coalesce(i.rule_config->>'penalty_mode','none')='per_day' and
          (case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) then i.gross else i.net end)>i.paid then
          greatest(today-i.due_date-coalesce((i.rule_config->>'grace_days')::int,0),0)*coalesce((i.rule_config->>'penalty_value')::bigint,0)
        when coalesce(i.rule_config->>'penalty_mode','none')='percent' and
          i.due_date+coalesce((i.rule_config->>'grace_days')::int,0)<today then
          round(greatest((case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) then i.gross else i.net end)-i.paid,0)
            *coalesce((i.rule_config->>'penalty_value')::numeric,0)/100)::bigint
        else 0 end penalty_due
  ) e
  where i.membership_id=p_membership_id;
end $$;
revoke all on function public.payment_quote(uuid,text) from public, anon;
grant execute on function public.payment_quote(uuid,text) to authenticated;

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
  m.assigned_agent
from public.memberships m
join public.customers c on c.id=m.customer_id
join public.chit_groups g on g.id=m.group_id
left join public.installment_status s on s.membership_id=m.id
where public.is_manager() or m.assigned_agent=auth.uid()
group by m.id, c.id, g.id;

create table if not exists public.cheque_tracking (
  receipt_id uuid primary key references public.receipts(id),
  clearance_status text not null default 'PENDING' check (clearance_status in ('PENDING','CLEARED','BOUNCED')),
  notes text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.cheque_tracking enable row level security;
grant select on public.cheque_tracking to authenticated;
revoke insert, update, delete on public.cheque_tracking from anon, authenticated;
drop policy if exists cheque_tracking_read on public.cheque_tracking;
create policy cheque_tracking_read on public.cheque_tracking for select to authenticated using (auth.uid() is not null);

create or replace function public.track_incoming_cheque() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.mode='Cheque' then
    insert into public.cheque_tracking(receipt_id) values(new.id) on conflict(receipt_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists track_incoming_cheque on public.receipts;
create trigger track_incoming_cheque after insert on public.receipts
for each row execute function public.track_incoming_cheque();
insert into public.cheque_tracking(receipt_id)
select r.id from public.receipts r where r.mode='Cheque'
on conflict(receipt_id) do nothing;

create or replace function public.set_cheque_clearance(p_receipt_id uuid, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_status text;
begin
  if not public.is_manager() then raise exception 'Only an owner or manager can update cheque clearance'; end if;
  if p_status not in ('CLEARED','BOUNCED') then raise exception 'Choose Cleared or Bounced'; end if;
  select clearance_status into strict v_status from public.cheque_tracking where receipt_id=p_receipt_id for update;
  if v_status<> 'PENDING' then raise exception 'This cheque is already marked %', v_status; end if;
  if p_status='BOUNCED' then
    update public.receipts set status='CANCELLED',
      cancelled_reason='Cheque bounced: '||coalesce(nullif(trim(p_notes),''),'no additional note')
    where id=p_receipt_id and status='ACTIVE';
  end if;
  update public.cheque_tracking set clearance_status=p_status, notes=nullif(trim(p_notes),''),
    updated_by=auth.uid(), updated_at=now() where receipt_id=p_receipt_id;
end $$;
revoke all on function public.set_cheque_clearance(uuid,text,text) from public, anon;
grant execute on function public.set_cheque_clearance(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
