-- Safe auction corrections and ticket-number-only changes.

create or replace function public.guard_membership_assignment_change()
returns trigger language plpgsql set search_path = '' as $$
declare
  merging_members boolean := coalesce(current_setting('app.member_merge', true), 'off') = 'on';
begin
  if (new.customer_id, new.group_id, new.ticket_no)
      is distinct from (old.customer_id, old.group_id, old.ticket_no)
      and not public.is_owner() then
    raise exception 'Only the owner can change a ticket assignment';
  end if;

  if (new.customer_id, new.group_id) is distinct from (old.customer_id, old.group_id) then
    if not exists (
      select 1 from public.customers
      where id = new.customer_id and status = 'ACTIVE'
    ) then
      raise exception 'Choose an active member as the assignment destination';
    end if;
    if not merging_members and (
      exists (select 1 from public.installments where membership_id = old.id)
      or exists (select 1 from public.receipts where membership_id = old.id)
      or exists (select 1 from public.auctions where winner_membership = old.id)
      or exists (select 1 from public.auction_bids where membership_id = old.id)
      or exists (select 1 from public.payouts where membership_id = old.id)
      or exists (select 1 from public.member_followups where membership_id = old.id)
    ) then
      raise exception 'This ticket has history and cannot be reassigned. Keep the history and add the replacement member to another ticket';
    end if;
    if not merging_members then
      new.assigned_agent := null;
    end if;
  end if;
  return new;
end
$$;

create or replace function public.change_membership_ticket_number(
  p_membership_id uuid,
  p_ticket_no integer
) returns void
language plpgsql security definer set search_path = '' as $$
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

  select coalesce(member_count, months) into ticket_limit
  from public.chit_groups
  where id = ticket_group
  for update;
  if not found then
    raise exception 'Chit group not found';
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

create or replace function public.auctions_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_manager() then
    raise exception 'Only the owner or a manager can change an auction';
  end if;

  if tg_op = 'DELETE' then
    if exists (select 1 from public.payouts where auction_id = old.id)
      or exists (
        select 1
        from public.installments i
        where i.group_id = old.group_id and i.month_label = old.month_label
          and (i.paid > 0 or exists (
            select 1 from public.payment_allocations a where a.installment_id = i.id
          ))
      ) then
      raise exception 'This auction has linked payout or payment history and cannot be deleted';
    end if;
    return old;
  end if;

  if (new.group_id, new.month_label, new.winner_membership, new.discount_bid, new.dividend, new.commission, new.prize_amount)
      is distinct from (old.group_id, old.month_label, old.winner_membership, old.discount_bid, old.dividend, old.commission, old.prize_amount)
    and (
      exists (select 1 from public.payouts where auction_id = old.id)
      or exists (
        select 1
        from public.installments i
        where i.group_id = old.group_id and i.month_label = old.month_label
          and (i.paid > 0 or exists (
            select 1 from public.payment_allocations a where a.installment_id = i.id
          ))
      )
    ) then
    raise exception 'Auction financial details cannot change after a payout or payment is recorded';
  end if;
  return new;
end
$$;

drop trigger if exists auctions_guard on public.auctions;
create trigger auctions_guard before update or delete on public.auctions
for each row execute function public.auctions_guard();

create or replace function public.payouts_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  auction public.auctions%rowtype;
begin
  select * into auction
  from public.auctions
  where id = new.auction_id
  for update;
  if not found then
    raise exception 'Auction not found';
  end if;
  if auction.winner_membership is null then
    raise exception 'This auction has no winner to pay';
  end if;
  new.membership_id := auction.winner_membership;
  new.group_id := auction.group_id;
  if new.payout_date > current_date then
    raise exception 'Payout date cannot be in the future';
  end if;
  return new;
end
$$;

create or replace function public.update_auction_full(
  p_auction_id uuid,
  p_winner uuid,
  p_bid bigint,
  p_div bigint,
  p_auction_date date,
  p_commission bigint,
  p_prize bigint,
  p_bids jsonb,
  p_notes text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_auction public.auctions%rowtype;
  v_group public.chit_groups%rowtype;
  v_group_id uuid;
  v_old_bids jsonb;
  v_new_bids jsonb;
  v_prize bigint;
  v_terms_changed boolean;
  v_has_history boolean;
begin
  if not public.is_manager() then
    raise exception 'Only the owner or a manager can edit an auction';
  end if;
  if p_bid is null or p_bid < 0 or p_div is null or p_div < 0
      or coalesce(p_commission, 0) < 0 or coalesce(p_prize, 0) < 0 then
    raise exception 'Auction amounts are required and cannot be negative';
  end if;
  if p_bids is null or jsonb_typeof(p_bids) <> 'array' then
    raise exception 'Auction bids must be a list';
  end if;

  select group_id into v_group_id
  from public.auctions where id = p_auction_id;
  if not found then
    raise exception 'Auction not found';
  end if;
  select * into strict v_group
  from public.chit_groups where id = v_group_id for update;
  select * into strict v_auction
  from public.auctions where id = p_auction_id for update;
  perform i.id
  from public.installments i
  where i.group_id = v_group_id and i.month_label = v_auction.month_label
  order by i.membership_id
  for update;

  if p_bid > v_group.chit_value then
    raise exception 'Bid/discount cannot exceed the chit value';
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
      <> (select count(distinct (item.value->>'membership_id')::uuid) from jsonb_array_elements(p_bids) as item(value)) then
    raise exception 'A member cannot have more than one bid';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_bids) as item(value)
    where not exists (
      select 1 from public.memberships m
      where m.id = (item.value->>'membership_id')::uuid and m.group_id = v_group_id
    )
  ) then
    raise exception 'Every bidder must be a member of this group';
  end if;
  if p_winner is not null and not exists (
    select 1 from public.memberships m
    where m.id = p_winner and m.group_id = v_group_id
      and (m.status = 'ACTIVE' or p_winner = v_auction.winner_membership)
  ) then
    raise exception 'Choose an active member of this group as the winner';
  end if;
  if p_winner is null and p_bid <> 0 then
    raise exception 'An auction without a winner cannot have a bid';
  end if;
  if p_winner is null and p_prize is not null then
    raise exception 'An auction without a winner cannot have a prize amount';
  end if;
  if p_winner is null and jsonb_array_length(p_bids) > 0 then
    raise exception 'An auction without a winner cannot have bids';
  end if;
  if p_winner is not null and exists (
    select 1 from public.auctions a
    where a.group_id = v_group_id and a.winner_membership = p_winner and a.id <> p_auction_id
  ) then
    raise exception 'This member has already won an auction in this group';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('membership_id', a.membership_id, 'bid', a.bid_amount) order by a.membership_id), '[]'::jsonb)
  into v_old_bids from public.auction_bids a where a.auction_id = p_auction_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'membership_id', (item.value->>'membership_id')::uuid,
      'bid', (item.value->>'bid')::bigint
    ) order by (item.value->>'membership_id')::uuid), '[]'::jsonb)
  into v_new_bids from jsonb_array_elements(p_bids) as item(value);

  v_prize := case when p_winner is null then null
    else coalesce(p_prize, greatest(v_group.chit_value - p_bid
      - case when coalesce(v_group.rule_config->>'commission_from', 'discount') = 'payout'
        then coalesce(p_commission, 0) else 0 end, 0)) end;
  v_terms_changed :=
    (v_auction.winner_membership, v_auction.discount_bid, v_auction.dividend, v_auction.commission, v_auction.prize_amount)
      is distinct from (p_winner, p_bid, p_div, coalesce(p_commission, 0), v_prize)
    or v_old_bids is distinct from v_new_bids;
  select exists (select 1 from public.payouts p where p.auction_id = p_auction_id)
    or exists (
      select 1
      from public.installments i
      where i.group_id = v_group_id and i.month_label = v_auction.month_label
        and (i.paid > 0 or exists (
          select 1 from public.payment_allocations a where a.installment_id = i.id
        ))
    ) into v_has_history;
  if v_terms_changed and v_has_history then
    raise exception 'Winner, bids, and financial amounts cannot change after a payout or payment is recorded. Date and notes may still be edited';
  end if;

  update public.auctions
  set winner_membership = p_winner,
      discount_bid = p_bid,
      dividend = p_div,
      auction_date = coalesce(p_auction_date, v_auction.auction_date),
      commission = coalesce(p_commission, 0),
      prize_amount = v_prize,
      notes = nullif(trim(p_notes), '')
  where id = p_auction_id;

  delete from public.auction_bids where auction_id = p_auction_id;
  insert into public.auction_bids(auction_id, membership_id, bid_amount)
  select p_auction_id, (item.value->>'membership_id')::uuid, (item.value->>'bid')::bigint
  from jsonb_array_elements(p_bids) as item(value);

  if v_terms_changed then
    update public.installments i
    set dividend = p_div,
        net = case when p_winner is not null and i.membership_id = p_winner
              and coalesce(i.rule_config->>'prized_member_instalment', 'unset') = 'full_gross'
          then i.gross else greatest(i.gross - p_div, 0) end
    where i.group_id = v_group_id and i.month_label = v_auction.month_label
      and i.status <> 'CANCELLED';

    update public.memberships m
    set prized = exists (
      select 1 from public.auctions a
      where a.group_id = v_group_id and a.winner_membership = m.id
    )
    where m.group_id = v_group_id;

    update public.chit_groups
    set current_dividend = p_div
    where id = v_group_id and current_month = v_auction.month_label;
  end if;
end
$$;

create or replace function public.delete_auction(p_auction_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_auction public.auctions%rowtype;
  v_group_id uuid;
  v_current_month text;
  v_current_dividend bigint;
begin
  if not public.is_manager() then
    raise exception 'Only the owner or a manager can delete an auction';
  end if;

  select group_id into v_group_id
  from public.auctions where id = p_auction_id;
  if not found then
    raise exception 'Auction not found';
  end if;
  perform 1 from public.chit_groups where id = v_group_id for update;
  select * into strict v_auction
  from public.auctions where id = p_auction_id for update;
  perform i.id
  from public.installments i
  where i.group_id = v_group_id and i.month_label = v_auction.month_label
  order by i.membership_id
  for update;

  if exists (select 1 from public.payouts where auction_id = p_auction_id) then
    raise exception 'This auction has a payout record and cannot be deleted';
  end if;
  if exists (
    select 1
    from public.installments i
    where i.group_id = v_group_id and i.month_label = v_auction.month_label
      and (i.paid > 0 or exists (
        select 1 from public.payment_allocations a where a.installment_id = i.id
      ))
  ) then
    raise exception 'This auction has payment history and cannot be deleted';
  end if;

  delete from public.auction_bids where auction_id = p_auction_id;
  delete from public.installments
  where group_id = v_group_id and month_label = v_auction.month_label;
  delete from public.auctions where id = p_auction_id;

  select month_label, dividend into v_current_month, v_current_dividend
  from public.auctions
  where group_id = v_group_id
  order by month_label desc
  limit 1;
  update public.chit_groups
  set current_month = v_current_month, current_dividend = coalesce(v_current_dividend, 0)
  where id = v_group_id;

  update public.memberships m
  set prized = exists (
    select 1 from public.auctions a
    where a.group_id = v_group_id and a.winner_membership = m.id
  )
  where m.group_id = v_group_id;
end
$$;

revoke all on function public.change_membership_ticket_number(uuid, integer) from public;
grant execute on function public.change_membership_ticket_number(uuid, integer) to authenticated;
revoke all on function public.update_auction_full(uuid, uuid, bigint, bigint, date, bigint, bigint, jsonb, text) from public;
grant execute on function public.update_auction_full(uuid, uuid, bigint, bigint, date, bigint, bigint, jsonb, text) to authenticated;
revoke all on function public.delete_auction(uuid) from public;
grant execute on function public.delete_auction(uuid) to authenticated;

notify pgrst, 'reload schema';
