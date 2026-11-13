-- Keep each instalment's recorded net amount due after it becomes overdue.
-- Dividends are not forfeited by age; payment quotes, allocations and balances
-- must use the same net amount shown in the member ledger.

create or replace view public.installment_status with (security_invoker = true) as
select i.id installment_id, i.membership_id, i.group_id, i.month_label, i.due_date,
  i.gross, i.dividend, i.net amount_due, least(i.paid, i.net) paid,
  greatest(i.net - i.paid, 0) balance,
  case when i.paid >= i.net then 'PAID'
       when i.due_date < current_date then 'OVERDUE'
       when i.paid > 0 then 'PARTIAL' else 'PENDING' end status,
  (least(i.paid, i.net) > 0 and least(i.paid, i.net) < i.net) is_partial,
  m.ticket_no, m.customer_id, m.prized, c.name member_name, c.member_code, c.phone,
  g.series, g.name group_name
from public.installments i
join public.memberships m on m.id = i.membership_id
join public.customers c on c.id = m.customer_id
join public.chit_groups g on g.id = i.group_id
where i.status <> 'CANCELLED';

create or replace function public.payment_quote(p_membership_id uuid, p_month_label text)
returns table(current_due bigint, arrears_due bigint, future_due bigint, penalty_due bigint,
  dividend_allowed bigint, dividend_forfeited bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  g public.chit_groups%rowtype;
  today date := current_date;
  v_current_due date;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  select cg.* into strict g
  from public.chit_groups cg join public.memberships m on m.group_id = cg.id
  where m.id = p_membership_id;
  perform public.installment_due_date(p_month_label, g.due_day);
  select i.due_date into v_current_due from public.installments i
  where i.membership_id = p_membership_id and i.month_label = p_month_label;
  if not found then raise exception 'No installment exists for this membership and month'; end if;

  return query
  select
    coalesce(sum(case when i.month_label = p_month_label then greatest(i.net - i.paid, 0) else 0 end), 0)::bigint,
    coalesce(sum(case when i.due_date < today and i.month_label <> p_month_label then greatest(i.net - i.paid, 0) else 0 end), 0)::bigint,
    coalesce(sum(case when i.due_date > v_current_due then greatest(i.net - i.paid, 0) else 0 end), 0)::bigint,
    greatest(coalesce(sum(case
      when i.due_date < today and coalesce(i.rule_config->>'penalty_mode', 'none') = 'per_day'
        and i.net > i.paid
        then greatest(today - i.due_date - coalesce((i.rule_config->>'grace_days')::int, 0), 0)
          * coalesce((i.rule_config->>'penalty_value')::bigint, 0)
      when i.due_date + coalesce((i.rule_config->>'grace_days')::int, 0) < today
        and coalesce(i.rule_config->>'penalty_mode', 'none') = 'percent'
        then round(greatest(i.net - i.paid, 0) * coalesce((i.rule_config->>'penalty_value')::numeric, 0) / 100)::bigint
      else 0 end), 0) - coalesce((
        select sum(a.amount) from public.payment_allocations a
        join public.receipts r on r.id = a.receipt_id
        where r.membership_id = p_membership_id and r.status = 'ACTIVE'
          and a.allocation_type = 'PENALTY'
      ), 0), 0)::bigint,
    coalesce(sum(case when i.month_label = p_month_label then i.dividend else 0 end), 0)::bigint,
    0::bigint
  from public.installments i where i.membership_id = p_membership_id;
end
$$;

create or replace function public.record_payment(
  p_membership_id uuid, p_month_label text, p_amount bigint,
  p_mode text default 'Cash', p_bank text default null, p_ref_no text default null,
  p_ref_date date default null, p_received_by text default null,
  p_notes text default null, p_receipt_date date default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_receipt public.receipts%rowtype;
  v_installment public.installments%rowtype;
  g public.chit_groups%rowtype;
  remaining_amount bigint := p_amount;
  alloc_amount bigint;
  alloc_type text;
  v_cur bigint := 0;
  v_arr bigint := 0;
  v_advance bigint := 0;
  v_pen bigint := 0;
  v_div_allowed bigint := 0;
  v_outstanding_before bigint := 0;
  current_alloc_remaining bigint;
  arrears_alloc_remaining bigint;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be positive'; end if;
  if p_mode is null or p_mode not in ('Cash', 'Cheque', 'UPI', 'Bank Transfer') then raise exception 'Unsupported payment mode'; end if;
  if p_month_label is null then raise exception 'Payment month is required'; end if;
  if p_receipt_date is not null and p_receipt_date > current_date then raise exception 'Payment date cannot be in the future'; end if;

  select cg.* into strict g from public.chit_groups cg
  join public.memberships m on m.group_id = cg.id where m.id = p_membership_id;
  if g.current_month is not null and p_month_label > g.current_month then
    raise exception 'Payments cannot be assigned to an instalment after the group current month; record excess as advance credit';
  end if;
  perform public.installment_due_date(p_month_label, g.due_day);
  perform 1 from public.installments i where i.membership_id = p_membership_id
  order by i.due_date, i.month_label, i.id for update;
  if not exists (select 1 from public.installments i
    where i.membership_id = p_membership_id and i.month_label = p_month_label) then
    raise exception 'No installment exists for this membership and month; record the monthly auction first';
  end if;

  -- Apply cash oldest-due-first, using each instalment's stored net amount.
  for v_installment in
    select i.* from public.installments i where i.membership_id = p_membership_id
    order by i.due_date, i.month_label, i.id for update
  loop
    exit when remaining_amount = 0;
    if v_installment.due_date <= current_date and v_installment.month_label <> p_month_label then
      alloc_type := 'ARREARS';
    elsif v_installment.month_label = p_month_label then
      alloc_type := 'CURRENT';
    else
      continue;
    end if;
    alloc_amount := least(remaining_amount, greatest(v_installment.net - v_installment.paid, 0));
    if alloc_amount > 0 then
      remaining_amount := remaining_amount - alloc_amount;
      if alloc_type = 'ARREARS' then v_arr := v_arr + alloc_amount;
      else v_cur := v_cur + alloc_amount; end if;
    end if;
  end loop;

  if remaining_amount > 0 then
    select greatest(coalesce(sum(case
      when coalesce(i.rule_config->>'penalty_mode', 'none') = 'per_day' and i.net > i.paid
        then greatest(current_date - i.due_date - coalesce((i.rule_config->>'grace_days')::int, 0), 0)
          * coalesce((i.rule_config->>'penalty_value')::bigint, 0)
      when coalesce(i.rule_config->>'penalty_mode', 'none') = 'percent'
        and i.due_date + coalesce((i.rule_config->>'grace_days')::int, 0) < current_date
        then round(greatest(i.net - i.paid, 0) * coalesce((i.rule_config->>'penalty_value')::numeric, 0) / 100)::bigint
      else 0 end), 0) - coalesce((
        select sum(a.amount) from public.payment_allocations a
        join public.receipts r on r.id = a.receipt_id
        where r.membership_id = p_membership_id and r.status = 'ACTIVE'
          and a.allocation_type = 'PENALTY'
      ), 0), 0)
    into v_pen from public.installments i
    where i.membership_id = p_membership_id and i.due_date < current_date;
    v_pen := least(v_pen, remaining_amount);
    remaining_amount := remaining_amount - v_pen;
  end if;
  v_advance := remaining_amount;

  select coalesce(sum(i.dividend) filter (where i.month_label = p_month_label), 0),
    coalesce(sum(greatest(i.net - i.paid, 0)) filter (where i.due_date <= current_date or i.month_label = p_month_label), 0)
  into v_div_allowed, v_outstanding_before
  from public.installments i where i.membership_id = p_membership_id;

  insert into public.receipts(
    membership_id, month_label, cur, arrears, future, penalty, others,
    dividend_allowed, dividend_forfeited, mode, bank, ref_no, ref_date, received_by,
    notes, receipt_date, balance_after
  ) values (
    p_membership_id, p_month_label, v_cur, v_arr, v_advance, v_pen, 0,
    v_div_allowed, 0, p_mode, p_bank, p_ref_no, p_ref_date, p_received_by,
    nullif(trim(p_notes), ''), coalesce(p_receipt_date, current_date),
    greatest(v_outstanding_before - v_arr - v_cur, 0)
  ) returning * into v_receipt;

  arrears_alloc_remaining := v_arr;
  current_alloc_remaining := v_cur;
  for v_installment in
    select i.* from public.installments i where i.membership_id = p_membership_id
    order by i.due_date, i.month_label, i.id for update
  loop
    if v_installment.due_date <= current_date and v_installment.month_label <> p_month_label then
      alloc_type := 'ARREARS';
      alloc_amount := least(arrears_alloc_remaining, greatest(v_installment.net - v_installment.paid, 0));
      arrears_alloc_remaining := arrears_alloc_remaining - alloc_amount;
    elsif v_installment.month_label = p_month_label then
      alloc_type := 'CURRENT';
      alloc_amount := least(current_alloc_remaining, greatest(v_installment.net - v_installment.paid, 0));
      current_alloc_remaining := current_alloc_remaining - alloc_amount;
    else
      continue;
    end if;
    if alloc_amount > 0 then
      insert into public.payment_allocations(receipt_id, installment_id, amount, allocation_type)
      values (v_receipt.id, v_installment.id, alloc_amount, alloc_type);
      update public.installments i set paid = i.paid + alloc_amount,
        status = case when i.paid + alloc_amount >= i.net then 'PAID'
          when i.paid + alloc_amount > 0 then 'PARTIAL'
          else 'OPEN' end
      where i.id = v_installment.id;
    end if;
  end loop;
  if v_pen > 0 then
    insert into public.payment_allocations(receipt_id, installment_id, amount, allocation_type)
    values (v_receipt.id, null, v_pen, 'PENALTY');
  end if;
  if v_advance > 0 then
    insert into public.payment_allocations(receipt_id, installment_id, amount, allocation_type)
    values (v_receipt.id, null, v_advance, 'ADVANCE');
  end if;
  return v_receipt.id;
end
$$;

revoke all on function public.record_payment(uuid,text,bigint,text,text,text,date,text,text,date) from public, anon;
grant execute on function public.record_payment(uuid,text,bigint,text,text,text,date,text,text,date) to authenticated;
revoke all on function public.payment_quote(uuid,text) from public, anon;
grant execute on function public.payment_quote(uuid,text) to authenticated;

notify pgrst, 'reload schema';
