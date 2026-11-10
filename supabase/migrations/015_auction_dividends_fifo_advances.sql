-- Validate auction dividends against the configured agreement terms and retain
-- subscription overpayments as explicit, reversible advance credits.

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.payment_allocations'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) like '%allocation_type%'
        or pg_get_constraintdef(oid) like '%installment_id%'
      )
  loop
    execute format('alter table public.payment_allocations drop constraint %I', constraint_row.conname);
  end loop;
end
$$;

alter table public.payment_allocations
  add constraint payment_allocations_type_check
    check (allocation_type in ('ARREARS','CURRENT','FUTURE','PENALTY','OTHER','ADVANCE','REVERSAL')),
  add constraint payment_allocations_amount_check
    check (
      (allocation_type = 'REVERSAL' and amount < 0 and reverses_allocation_id is not null)
      or (allocation_type <> 'REVERSAL' and amount > 0 and reverses_allocation_id is null)
    ),
  add constraint payment_allocations_installment_check
    check (
      (allocation_type in ('PENALTY','OTHER','ADVANCE') and installment_id is null)
      or allocation_type = 'REVERSAL'
      or (allocation_type not in ('PENALTY','OTHER','ADVANCE') and installment_id is not null)
    );

create or replace function public.record_auction_full(
  p_group uuid,
  p_month text,
  p_winner uuid,
  p_bid bigint,
  p_div bigint,
  p_auction_date date default null,
  p_commission bigint default 0,
  p_prize bigint default null,
  p_bids jsonb default '[]'::jsonb,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  b jsonb;
  g public.chit_groups%rowtype;
  v_expected_commission bigint;
  v_dividend_pool bigint;
  v_expected_dividend bigint;
  v_expected_prize bigint;
begin
  if not public.is_manager() then
    raise exception 'Only the owner or a manager can record an auction';
  end if;
  select * into strict g from public.chit_groups where id = p_group for update;
  if coalesce(g.status, 'ACTIVE') <> 'ACTIVE' then
    raise exception 'This group is % — set it to Active before recording an auction', g.status;
  end if;
  if p_month is null or p_bid is null or p_bid < 0 or p_div is null or p_div < 0
      or p_commission is null or p_commission < 0 or (p_prize is not null and p_prize < 0) then
    raise exception 'Month and auction amounts are required and cannot be negative';
  end if;
  if coalesce(g.member_count, 0) <= 0 then
    raise exception 'Configure the registered total ticket count before recording an auction';
  end if;
  if g.commission_pct is null or g.commission_pct < 0 then
    raise exception 'Configure the foreman commission from the registered agreement before recording an auction';
  end if;
  if p_bid > g.chit_value then
    raise exception 'Bid/discount cannot exceed the chit value';
  end if;
  if (select count(*) from public.auctions where group_id = p_group) >= g.months then
    raise exception 'All % months of this group already have auctions', g.months;
  end if;
  if p_bids is null or jsonb_typeof(p_bids) <> 'array' then
    raise exception 'Auction bids must be a list';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_bids) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or coalesce(item.value->>'membership_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(item.value->>'bid', '') !~ '^[0-9]+$'
  ) then
    raise exception 'Each bid must include a valid member and a non-negative amount';
  end if;
  if (select count(*) from jsonb_array_elements(p_bids))
      <> (select count(distinct ((item.value->>'membership_id')::uuid))
          from jsonb_array_elements(p_bids) as item(value)) then
    raise exception 'A member cannot have more than one bid';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_bids) as item(value)
    where not exists (
      select 1 from public.memberships m
      where m.id = (item.value->>'membership_id')::uuid
        and m.group_id = p_group
        and m.status = 'ACTIVE'
    )
  ) then
    raise exception 'Every bidder must hold an active ticket in this group';
  end if;
  if p_winner is not null and not exists (
    select 1 from public.memberships m
    where m.id = p_winner and m.group_id = p_group and m.status = 'ACTIVE'
  ) then
    raise exception 'Choose an active ticket in this group as the winner';
  end if;
  if p_winner is not null and exists (
    select 1 from public.auctions where group_id = p_group and winner_membership = p_winner
  ) then
    raise exception 'This member has already won an auction in this group';
  end if;
  if p_winner is null and (p_bid <> 0 or p_commission <> 0 or p_div <> 0 or p_prize is not null) then
    raise exception 'An auction without a winner cannot have a bid, commission, dividend, or prize amount';
  end if;
  if p_winner is null and jsonb_array_length(p_bids) > 0 then
    raise exception 'An auction without a winner cannot have bids';
  end if;

  v_expected_commission := round(g.chit_value::numeric * g.commission_pct / 100)::bigint;
  if p_winner is not null and p_commission <> v_expected_commission then
    raise exception 'Commission must match the configured agreement rate of % percent', g.commission_pct;
  end if;
  v_dividend_pool := greatest(p_bid - case
    when coalesce(g.rule_config->>'commission_from', 'discount') = 'discount'
      then v_expected_commission else 0 end, 0);
  v_expected_dividend := floor(v_dividend_pool::numeric / g.member_count / 100) * 100;
  if p_div <> (case when p_winner is null then 0 else v_expected_dividend end) then
    raise exception 'Dividend must equal the agreement calculation per ticket: discount less applicable commission, divided by the registered ticket count and rounded down to whole rupees';
  end if;
  v_expected_prize := greatest(g.chit_value - p_bid - case
    when coalesce(g.rule_config->>'commission_from', 'discount') = 'payout'
      then v_expected_commission else 0 end, 0);
  if p_winner is not null and p_prize is not null and p_prize <> v_expected_prize then
    raise exception 'Prize amount must match the configured agreement calculation';
  end if;

  perform public.record_auction(p_group, p_month, p_winner, p_bid, p_div);
  select id into strict v_id
  from public.auctions
  where group_id = p_group and month_label = p_month;
  update public.auctions
  set auction_date = coalesce(p_auction_date, current_date),
      commission = coalesce(p_commission, 0),
      prize_amount = case
        when p_winner is null then null
        else v_expected_prize
      end,
      notes = nullif(trim(p_notes), '')
  where id = v_id;

  for b in select * from jsonb_array_elements(coalesce(p_bids, '[]'::jsonb))
  loop
    if not exists (
      select 1 from public.memberships
      where id = (b->>'membership_id')::uuid and group_id = p_group and status = 'ACTIVE'
    ) then
      raise exception 'Every bidder must hold an active ticket in this group';
    end if;
    if coalesce((b->>'bid')::bigint, 0) > g.chit_value then
      raise exception 'A bid cannot exceed the chit value';
    end if;
    insert into public.auction_bids(auction_id, membership_id, bid_amount)
    values (v_id, (b->>'membership_id')::uuid, (b->>'bid')::bigint);
  end loop;
  return v_id;
end
$$;

revoke all on function public.record_auction(uuid,text,uuid,bigint,bigint) from public, anon, authenticated;
revoke all on function public.record_auction_full(uuid,text,uuid,bigint,bigint,date,bigint,bigint,jsonb,text) from public, anon;
grant execute on function public.record_auction_full(uuid,text,uuid,bigint,bigint,date,bigint,bigint,jsonb,text) to authenticated;

create or replace function public.chit_groups_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (new.chit_value, new.months, new.gross_installment, new.member_count)
      is distinct from (old.chit_value, old.months, old.gross_installment, old.member_count)
      and exists (select 1 from public.auctions where group_id = old.id) then
    raise exception 'Chit amount, duration, monthly contribution, and registered ticket count cannot change after the first auction';
  end if;
  return new;
end
$$;

create or replace function public.guard_membership_ticket_range()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  ticket_limit integer;
begin
  select member_count into ticket_limit
  from public.chit_groups
  where id = new.group_id;
  if ticket_limit is null or ticket_limit <= 0 then
    raise exception 'Set the registered total ticket count before assigning tickets';
  end if;
  if new.ticket_no is null or new.ticket_no < 1 or new.ticket_no > ticket_limit then
    raise exception 'Ticket number must be between 1 and the registered ticket count (%)', ticket_limit;
  end if;
  return new;
end
$$;

create or replace function public.change_membership_ticket_number(
  p_membership_id uuid,
  p_ticket_no integer
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ticket_group uuid;
  ticket_limit integer;
  current_ticket_no integer;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change a ticket number';
  end if;
  if p_ticket_no is null or p_ticket_no <= 0 then
    raise exception 'Ticket number must be greater than zero';
  end if;
  select group_id into ticket_group
  from public.memberships
  where id = p_membership_id;
  if not found then
    raise exception 'Ticket not found';
  end if;
  select member_count into ticket_limit
  from public.chit_groups
  where id = ticket_group
  for update;
  if not found then
    raise exception 'Chit group not found';
  end if;
  if ticket_limit is null or ticket_limit <= 0 then
    raise exception 'Set the registered total ticket count before changing ticket numbers';
  end if;
  if p_ticket_no > ticket_limit then
    raise exception 'Ticket number must be between 1 and %', ticket_limit;
  end if;
  select ticket_no into current_ticket_no
  from public.memberships
  where id = p_membership_id and group_id = ticket_group
  for update;
  if not found then
    raise exception 'Ticket changed while the number was being updated';
  end if;
  if current_ticket_no = p_ticket_no then
    return;
  end if;
  update public.memberships
  set ticket_no = p_ticket_no
  where id = p_membership_id;
end
$$;

create or replace function public.auction_terms_config_guard()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  g public.chit_groups%rowtype;
  expected_commission bigint;
  expected_dividend bigint;
  expected_prize bigint;
begin
  if (new.group_id, new.winner_membership, new.discount_bid, new.dividend, new.commission, new.prize_amount)
      is not distinct from
     (old.group_id, old.winner_membership, old.discount_bid, old.dividend, old.commission, old.prize_amount) then
    return new;
  end if;
  select * into strict g from public.chit_groups where id = new.group_id;
  if g.commission_pct is null or coalesce(g.member_count, 0) <= 0 then
    raise exception 'Configure the registered commission rate and ticket count before changing auction terms';
  end if;
  if new.winner_membership is null then
    if new.discount_bid <> 0 or new.dividend <> 0 or new.commission <> 0 or new.prize_amount is not null then
      raise exception 'An auction without a winner cannot have financial terms';
    end if;
    return new;
  end if;
  expected_commission := round(g.chit_value::numeric * g.commission_pct / 100)::bigint;
  if new.commission <> expected_commission then
    raise exception 'Commission must match the configured agreement rate of % percent', g.commission_pct;
  end if;
  if new.discount_bid > g.chit_value then
    raise exception 'Bid/discount cannot exceed the chit value';
  end if;
  expected_dividend := floor(
    greatest(new.discount_bid - case
      when coalesce(g.rule_config->>'commission_from', 'discount') = 'discount'
        then expected_commission else 0 end, 0)::numeric / g.member_count / 100
  ) * 100;
  if new.dividend <> expected_dividend then
    raise exception 'Dividend must match the configured agreement calculation per ticket';
  end if;
  expected_prize := greatest(g.chit_value - new.discount_bid - case
    when coalesce(g.rule_config->>'commission_from', 'discount') = 'payout'
      then expected_commission else 0 end, 0);
  if new.prize_amount is distinct from expected_prize then
    raise exception 'Prize amount must match the configured agreement calculation';
  end if;
  return new;
end
$$;

drop trigger if exists auction_terms_config_guard on public.auctions;
create trigger auction_terms_config_guard
before update of group_id, winner_membership, discount_bid, dividend, commission, prize_amount
on public.auctions
for each row execute function public.auction_terms_config_guard();

create or replace function public.record_payment(
  p_membership_id uuid,
  p_month_label text,
  p_amount bigint,
  p_mode text default 'Cash',
  p_bank text default null,
  p_ref_no text default null,
  p_ref_date date default null,
  p_received_by text default null,
  p_notes text default null,
  p_receipt_date date default null
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
  v_other bigint := 0;
  v_div_allowed bigint := 0;
  v_div_forfeited bigint := 0;
  v_outstanding_before bigint := 0;
  current_alloc_remaining bigint;
  arrears_alloc_remaining bigint;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be positive'; end if;
  if p_mode is null or p_mode not in ('Cash','Cheque','UPI','Bank Transfer') then raise exception 'Unsupported payment mode'; end if;
  if p_month_label is null then raise exception 'Payment month is required'; end if;
  if p_receipt_date is not null and p_receipt_date > current_date then raise exception 'Payment date cannot be in the future'; end if;

  select cg.* into strict g
  from public.chit_groups cg
  join public.memberships m on m.group_id = cg.id
  where m.id = p_membership_id;
  if g.current_month is not null and p_month_label > g.current_month then
    raise exception 'Payments cannot be assigned to an instalment after the group current month; record excess as advance credit';
  end if;
  perform public.installment_due_date(p_month_label, g.due_day);
  perform 1
  from public.installments
  where membership_id = p_membership_id
  order by due_date, month_label, id
  for update;
  if not exists (
    select 1 from public.installments i
    where i.membership_id = p_membership_id and i.month_label = p_month_label
  ) then
    raise exception 'No installment exists for this membership and month; record the monthly auction first';
  end if;

  -- Allocate only currently due instalments, in due-date order; future dues
  -- are not prepaid against installment rows.
  for v_installment in
    select i.*
    from public.installments i
    where i.membership_id = p_membership_id
    order by i.due_date, i.month_label, i.id
    for update
  loop
    exit when remaining_amount = 0;
    if v_installment.due_date <= current_date and v_installment.month_label <> p_month_label then
      alloc_type := 'ARREARS';
    elsif v_installment.month_label = p_month_label then
      alloc_type := 'CURRENT';
    else
      continue;
    end if;

    alloc_amount := least(remaining_amount, greatest(
      case
        when coalesce((v_installment.rule_config->>'forfeit_dividend_after_due')::boolean, false)
          and v_installment.due_date < current_date then v_installment.gross
        else v_installment.net
      end - v_installment.paid, 0
    ));
    if alloc_amount > 0 then
      remaining_amount := remaining_amount - alloc_amount;
      if alloc_type = 'ARREARS' then v_arr := v_arr + alloc_amount;
      else v_cur := v_cur + alloc_amount;
      end if;
    end if;
  end loop;

  if remaining_amount > 0 then
    select greatest(coalesce(sum(case
      when coalesce(i.rule_config->>'penalty_mode', 'none') = 'per_day'
        and (case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean, false)
          then i.gross else i.net end) > i.paid
      then greatest(current_date - i.due_date - coalesce((i.rule_config->>'grace_days')::int, 0), 0)
        * coalesce((i.rule_config->>'penalty_value')::bigint, 0)
      when coalesce(i.rule_config->>'penalty_mode', 'none') = 'percent'
        and i.due_date + coalesce((i.rule_config->>'grace_days')::int, 0) < current_date
      then round(greatest((case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean, false)
          then i.gross else i.net end) - i.paid, 0)
        * coalesce((i.rule_config->>'penalty_value')::numeric, 0) / 100)::bigint
      else 0
    end), 0) - coalesce((
      select sum(a.amount)
      from public.payment_allocations a
      join public.receipts r on r.id = a.receipt_id
      where r.membership_id = p_membership_id
        and r.status = 'ACTIVE'
        and a.allocation_type = 'PENALTY'
    ), 0), 0)
    into v_pen
    from public.installments i
    where i.membership_id = p_membership_id and i.due_date < current_date;
    v_pen := least(v_pen, remaining_amount);
    remaining_amount := remaining_amount - v_pen;
  end if;
  v_advance := remaining_amount;

  select
    coalesce(sum(case
      when i.month_label = p_month_label
        and (not coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean, false)
          or i.due_date >= current_date) then i.dividend else 0 end), 0),
    coalesce(sum(case
      when i.month_label = p_month_label
        and coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean, false)
        and i.due_date < current_date then i.dividend else 0 end), 0)
  into v_div_allowed, v_div_forfeited
  from public.installments i
  where i.membership_id = p_membership_id;

  select coalesce(sum(greatest(
    case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean, false)
      and i.due_date < current_date then i.gross else i.net end - i.paid, 0
  )), 0)
  into v_outstanding_before
  from public.installments i
  where i.membership_id = p_membership_id
    and (i.due_date <= current_date or i.month_label = p_month_label);

  insert into public.receipts(
    membership_id, month_label, cur, arrears, future, penalty, others,
    dividend_allowed, dividend_forfeited, mode, bank, ref_no, ref_date, received_by,
    notes, receipt_date, balance_after
  )
  values (
    p_membership_id, p_month_label, v_cur, v_arr, v_advance, v_pen, v_other,
    v_div_allowed, v_div_forfeited, p_mode, p_bank, p_ref_no, p_ref_date, p_received_by,
    nullif(trim(p_notes), ''), coalesce(p_receipt_date, current_date),
    greatest(v_outstanding_before - v_arr - v_cur, 0)
  )
  returning * into v_receipt;

  arrears_alloc_remaining := v_arr;
  current_alloc_remaining := v_cur;
  for v_installment in
    select i.*
    from public.installments i
    where i.membership_id = p_membership_id
    order by i.due_date, i.month_label, i.id
    for update
  loop
    if v_installment.due_date <= current_date and v_installment.month_label <> p_month_label then
      alloc_type := 'ARREARS';
      alloc_amount := least(arrears_alloc_remaining, greatest(
        case when coalesce((v_installment.rule_config->>'forfeit_dividend_after_due')::boolean, false)
          then v_installment.gross else v_installment.net end - v_installment.paid, 0
      ));
      arrears_alloc_remaining := arrears_alloc_remaining - alloc_amount;
    elsif v_installment.month_label = p_month_label then
      alloc_type := 'CURRENT';
      alloc_amount := least(current_alloc_remaining, greatest(
        case when coalesce((v_installment.rule_config->>'forfeit_dividend_after_due')::boolean, false)
          and v_installment.due_date < current_date then v_installment.gross
          else v_installment.net end - v_installment.paid, 0
      ));
      current_alloc_remaining := current_alloc_remaining - alloc_amount;
    else
      continue;
    end if;

    if alloc_amount > 0 then
      insert into public.payment_allocations(receipt_id, installment_id, amount, allocation_type)
      values (v_receipt.id, v_installment.id, alloc_amount, alloc_type);
      update public.installments i
      set paid = i.paid + alloc_amount,
          status = case
            when i.paid + alloc_amount >= (
              case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean, false)
                and i.due_date < current_date then i.gross else i.net end
            ) then 'PAID'
            when i.paid + alloc_amount > 0 then 'PARTIAL'
            else 'OPEN'
          end
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
  ), 0)::bigint advance_credit
from public.memberships m
join public.customers c on c.id = m.customer_id
join public.chit_groups g on g.id = m.group_id
left join public.installment_status s on s.membership_id = m.id
where public.is_manager() or m.assigned_agent = auth.uid()
group by m.id, c.id, g.id;

notify pgrst, 'reload schema';
