alter table public.member_interest_charges
  add column if not exists notice_date date,
  add column if not exists notice_method text,
  add column if not exists notice_reference text;

alter table public.member_interest_charges
  drop constraint if exists member_interest_charges_notice_method_check,
  add constraint member_interest_charges_notice_method_check
    check (notice_method is null or notice_method in ('WhatsApp', 'SMS', 'Phone', 'In person', 'Written', 'Email'));

drop function if exists public.record_member_interest_charge(uuid, uuid, bigint, numeric, date, date, text, text);

create function public.record_member_interest_charge(
  p_membership_id uuid,
  p_installment_id uuid,
  p_principal bigint,
  p_annual_rate numeric,
  p_period_start date,
  p_period_end date,
  p_notice_date date,
  p_notice_method text,
  p_notice_reference text,
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
  if auth.uid() is null or not public.is_owner() then
    raise exception 'Only the owner can apply an interest charge';
  end if;
  if p_principal is null or p_principal <= 0 then
    raise exception 'Interest principal must be positive';
  end if;
  if p_annual_rate is null or p_annual_rate not in (15, 18) then
    raise exception 'Choose the agreement rate confirmed by the owner: 15% or 18% per annum';
  end if;
  if p_membership_id is null or p_installment_id is null then
    raise exception 'Choose a member and overdue instalment';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start
      or p_period_end > current_date then
    raise exception 'Interest period must be valid and cannot end in the future';
  end if;
  if nullif(trim(p_confirmed_by), '') is null then
    raise exception 'Record who confirmed the interest terms';
  end if;
  if p_notice_date is null or p_notice_date > current_date then
    raise exception 'Record the date the member was notified before applying interest';
  end if;
  if p_notice_method is null or p_notice_method not in ('WhatsApp', 'SMS', 'Phone', 'In person', 'Written', 'Email') then
    raise exception 'Choose how the member was notified';
  end if;
  if nullif(trim(p_notice_reference), '') is null then
    raise exception 'Record the notice reference or delivery details';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_installment_id::text, 0));

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
    notice_date, notice_method, notice_reference, confirmed_by, notes
  )
  values (
    p_membership_id, p_installment_id, p_principal, v_rate,
    p_period_start, p_period_end, 360, v_days, v_amount,
    p_notice_date, p_notice_method, trim(p_notice_reference), trim(p_confirmed_by), nullif(trim(p_notes), '')
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
  if auth.uid() is null or not public.is_owner() then
    raise exception 'Only the owner can reverse an interest charge';
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

revoke all on function public.record_member_interest_charge(uuid, uuid, bigint, numeric, date, date, date, text, text, text, text) from public, anon;
revoke all on function public.reverse_member_interest_charge(uuid, text) from public, anon;
grant execute on function public.record_member_interest_charge(uuid, uuid, bigint, numeric, date, date, date, text, text, text, text) to authenticated;
grant execute on function public.reverse_member_interest_charge(uuid, text) to authenticated;

notify pgrst, 'reload schema';
