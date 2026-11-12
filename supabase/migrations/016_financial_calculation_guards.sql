-- Keep payout entries aligned with the auction and group agreement terms.
create or replace function public.payouts_terms_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  auction_discount bigint;
  auction_commission bigint;
  auction_prize bigint;
  group_chit_value bigint;
  commission_from_payout boolean;
  expected_commission bigint;
  expected_prize bigint;
begin
  select a.discount_bid, a.commission, a.prize_amount, g.chit_value,
    coalesce(g.rule_config->>'commission_from', 'discount') = 'payout'
  into auction_discount, auction_commission, auction_prize, group_chit_value, commission_from_payout
  from public.auctions a
  join public.chit_groups g on g.id = a.group_id
  where a.id = new.auction_id
  for key share of a, g;

  if not found then
    raise exception 'Auction or chit group not found';
  end if;

  expected_commission := case when commission_from_payout then auction_commission else 0 end;
  expected_prize := coalesce(
    auction_prize,
    greatest(group_chit_value - auction_discount - expected_commission, 0)
  );

  if new.gross_amount <> group_chit_value then
    raise exception 'Payout gross amount must match the group chit value';
  end if;
  if new.bid_discount <> auction_discount then
    raise exception 'Payout discount must match the auction discount';
  end if;
  if new.commission <> expected_commission then
    raise exception 'Payout commission must match the configured commission treatment';
  end if;
  if new.other_deductions > expected_prize then
    raise exception 'Other deductions cannot exceed the agreement-calculated prize amount';
  end if;

  return new;
end
$$;

drop trigger if exists payouts_terms_guard on public.payouts;
create trigger payouts_terms_guard
before insert on public.payouts
for each row execute function public.payouts_terms_guard();

-- Fix the second FIFO allocation pass so dividend forfeiture starts only
-- after the due date, matching the first allocation pass.
do $$
declare
  function_definition text;
  old_expression text := $old$case when coalesce((v_installment.rule_config->>'forfeit_dividend_after_due')::boolean, false)
          then v_installment.gross else v_installment.net end - v_installment.paid, 0$old$;
  new_expression text := $new$case when coalesce((v_installment.rule_config->>'forfeit_dividend_after_due')::boolean, false)
          and v_installment.due_date < current_date then v_installment.gross else v_installment.net end - v_installment.paid, 0$new$;
begin
  function_definition := pg_get_functiondef(
    'public.record_payment(uuid,text,bigint,text,text,text,date,text,text,date)'::regprocedure
  );
  if position(old_expression in function_definition) = 0 then
    raise exception 'Expected FIFO allocation expression was not found; payment function was not changed';
  end if;
  execute replace(function_definition, old_expression, new_expression);
end
$$;

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
  ), 0)::bigint subscription_paid
from public.memberships m
join public.customers c on c.id = m.customer_id
join public.chit_groups g on g.id = m.group_id
left join public.installment_status s on s.membership_id = m.id
where public.is_manager() or m.assigned_agent = auth.uid()
group by m.id, c.id, g.id;

notify pgrst, 'reload schema';
