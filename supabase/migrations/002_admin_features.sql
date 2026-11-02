-- 002: Admin/owner features. Run ONCE in Supabase SQL Editor on a project that already ran supabase/schema.sql.
-- Additive only: no existing rows are deleted or rewritten except back-filling new columns (member codes, group member count).
-- All money is integer paise, as in schema.sql.

-- ============ Roles ============
-- OWNER = owner, MANAGER = manager, STAFF = clerk/agent. Role checks compare role::text so the new enum value
-- is never cast inside this same transaction.
alter type user_role add value if not exists 'manager';

create or replace function is_manager() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role::text in ('owner','manager')) $$;

-- ============ Members (customers) ============
create sequence if not exists member_code_seq start 1;
alter table customers
  add column if not exists member_code text,
  add column if not exists alt_phone text,
  add column if not exists email text,
  add column if not exists pan text,
  add column if not exists id_proof_ref text,
  add column if not exists nominee_name text,
  add column if not exists nominee_relation text,
  add column if not exists nominee_phone text,
  add column if not exists joining_date date default current_date,
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists notes text;

update customers c set member_code='M'||lpad((o.base+o.rn)::text,4,'0')
from (select id, row_number() over (order by created_at, id) rn,
        (select coalesce(max(substring(member_code from 2)::int),0) from customers where member_code ~ '^M[0-9]+$') base
      from customers where member_code is null) o
where c.id=o.id;
select setval('member_code_seq', (select coalesce(max(substring(member_code from 2)::int),0)+1 from customers where member_code ~ '^M[0-9]+$'), false);
alter table customers alter column member_code set default 'M'||lpad(nextval('member_code_seq')::text,4,'0');
create unique index if not exists customers_member_code_unique on customers(member_code);

-- ============ Chit groups ============
alter table chit_groups
  add column if not exists name text,
  add column if not exists member_count int,
  add column if not exists start_date date,
  add column if not exists auction_day int,
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists notes text;
update chit_groups set member_count=months where member_count is null;

-- ============ Memberships ============
alter table memberships
  add column if not exists joined_on date default current_date,
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists created_at timestamptz default now();

-- ============ Auctions / lifts ============
alter table auctions
  add column if not exists auction_date date,
  add column if not exists commission bigint not null default 0,
  add column if not exists prize_amount bigint,
  add column if not exists notes text,
  add column if not exists created_by uuid default auth.uid();
update auctions set auction_date=created_at::date where auction_date is null;

create table if not exists auction_bids(
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references auctions,
  membership_id uuid not null references memberships,
  bid_amount bigint not null check (bid_amount>=0),
  created_at timestamptz default now(),
  unique(auction_id, membership_id));

-- ============ Receipts: Bank Transfer mode, notes, balance after payment ============
alter table receipts
  add column if not exists notes text,
  add column if not exists balance_after bigint;

-- ============ Check constraints (added only if missing) ============
do $$ begin
  alter table receipts drop constraint if exists receipts_mode_check;
  alter table receipts add constraint receipts_mode_check check (mode in ('Cash','Cheque','UPI','Bank Transfer'));
  if not exists (select 1 from pg_constraint where conname='customers_status_check') then
    alter table customers add constraint customers_status_check check (status in ('ACTIVE','INACTIVE'));
  end if;
  if not exists (select 1 from pg_constraint where conname='chit_groups_status_check') then
    alter table chit_groups add constraint chit_groups_status_check check (status in ('ACTIVE','PAUSED','COMPLETED'));
  end if;
  if not exists (select 1 from pg_constraint where conname='chit_groups_member_count_check') then
    alter table chit_groups add constraint chit_groups_member_count_check check (member_count is null or member_count>0);
  end if;
  if not exists (select 1 from pg_constraint where conname='chit_groups_auction_day_check') then
    alter table chit_groups add constraint chit_groups_auction_day_check check (auction_day is null or auction_day between 1 and 31);
  end if;
  if not exists (select 1 from pg_constraint where conname='chit_groups_commission_from_check') then
    alter table chit_groups add constraint chit_groups_commission_from_check
      check (coalesce(rule_config->>'commission_from','discount') in ('discount','payout'));
  end if;
  if not exists (select 1 from pg_constraint where conname='memberships_status_check') then
    alter table memberships add constraint memberships_status_check check (status in ('ACTIVE','WITHDRAWN'));
  end if;
  if not exists (select 1 from pg_constraint where conname='auctions_amounts_check') then
    alter table auctions add constraint auctions_amounts_check check (commission>=0 and (prize_amount is null or prize_amount>=0));
  end if;
end $$;

-- ============ Payouts ============
create sequence if not exists payout_seq start 1;
create table if not exists payouts(
  id uuid primary key default gen_random_uuid(),
  voucher_no bigint unique not null default nextval('payout_seq'),
  auction_id uuid not null references auctions,
  membership_id uuid not null references memberships,
  group_id uuid not null references chit_groups,
  payout_date date not null default current_date,
  gross_amount bigint not null check (gross_amount>=0),
  bid_discount bigint not null default 0 check (bid_discount>=0),
  commission bigint not null default 0 check (commission>=0),
  other_deductions bigint not null default 0 check (other_deductions>=0),
  deduction_notes text,
  net_payout bigint generated always as (gross_amount-bid_discount-commission-other_deductions) stored,
  mode text not null check (mode in ('Cash','Cheque','UPI','Bank Transfer')),
  bank text, ref_no text, notes text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CANCELLED')),
  cancelled_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz default now(),
  check (gross_amount-bid_discount-commission-other_deductions >= 0));
create unique index if not exists payouts_one_active_per_auction on payouts(auction_id) where status='ACTIVE';

-- Winner and group always come from the auction, never from the client.
create or replace function payouts_fill() returns trigger language plpgsql security definer set search_path=public as $$
declare a auctions%rowtype; begin
  select * into a from auctions where id=new.auction_id;
  if not found then raise exception 'Auction not found'; end if;
  if a.winner_membership is null then raise exception 'This auction has no winner to pay'; end if;
  new.membership_id := a.winner_membership;
  new.group_id := a.group_id;
  if new.payout_date > current_date then raise exception 'Payout date cannot be in the future'; end if;
  return new;
end $$;
drop trigger if exists payouts_fill on payouts;
create trigger payouts_fill before insert on payouts for each row execute function payouts_fill();

-- ============ Expenses & other business income ============
create table if not exists business_transactions(
  id uuid primary key default gen_random_uuid(),
  txn_date date not null default current_date,
  kind text not null default 'EXPENSE' check (kind in ('EXPENSE','INCOME')),
  category text not null,
  amount bigint not null check (amount>0),
  mode text not null default 'Cash' check (mode in ('Cash','Cheque','UPI','Bank Transfer')),
  party text, ref_no text, notes text,
  group_id uuid references chit_groups,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CANCELLED')),
  cancelled_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz default now());

-- Payouts and business transactions: never deleted or edited; only cancelled with a reason.
-- Generated columns (net_payout) are not yet computed in BEFORE triggers, so they are excluded from the comparison.
create or replace function cancel_only_guard() returns trigger language plpgsql as $$ begin
  if tg_op='DELETE' then raise exception 'Financial records cannot be deleted; cancel instead'; end if;
  if (to_jsonb(new)-'status'-'cancelled_reason'-'net_payout') <> (to_jsonb(old)-'status'-'cancelled_reason'-'net_payout') then raise exception 'Financial records cannot be edited; cancel and record again'; end if;
  if old.status='CANCELLED' then raise exception 'Cancelled records cannot be changed'; end if;
  if new.status='CANCELLED' and nullif(trim(new.cancelled_reason),'') is null then raise exception 'A cancellation reason is required'; end if;
  return new; end $$;
drop trigger if exists payouts_guard on payouts;
create trigger payouts_guard before update or delete on payouts for each row execute function cancel_only_guard();
drop trigger if exists business_transactions_guard on business_transactions;
create trigger business_transactions_guard before update or delete on business_transactions for each row execute function cancel_only_guard();

-- FIX for schema.sql: receipts.total is a generated column and is NULL inside BEFORE triggers, so the original guard
-- rejected every cancellation. Compare without it (total is derived from the compared columns anyway).
create or replace function receipts_guard() returns trigger language plpgsql as $$ begin
  if tg_op='DELETE' then raise exception 'Receipts cannot be deleted; cancel instead'; end if;
  if (to_jsonb(new)-'status'-'cancelled_reason'-'total') <> (to_jsonb(old)-'status'-'cancelled_reason'-'total') then raise exception 'Receipts are immutable; cancel instead'; end if;
  if old.status='CANCELLED' then raise exception 'Cancelled receipts cannot be changed'; end if;
  if new.status='ACTIVE' and new.cancelled_reason is distinct from old.cancelled_reason then raise exception 'Cancellation reason is only set while cancelling'; end if;
  if new.status='CANCELLED' and nullif(trim(new.cancelled_reason),'') is null then raise exception 'A cancellation reason is required'; end if;
  return new; end $$;

-- Auctions: the financial terms cannot change once recorded (installments were generated from them).
create or replace function auctions_guard() returns trigger language plpgsql as $$ begin
  if tg_op='DELETE' then raise exception 'Auctions cannot be deleted'; end if;
  if (new.group_id,new.month_label,new.winner_membership,new.discount_bid,new.dividend)
     is distinct from (old.group_id,old.month_label,old.winner_membership,old.discount_bid,old.dividend) then
    raise exception 'Auction winner, bid and dividend cannot be changed after recording';
  end if;
  return new; end $$;
drop trigger if exists auctions_guard on auctions;
create trigger auctions_guard before update or delete on auctions for each row execute function auctions_guard();

-- Groups: the money terms are locked after the first auction.
create or replace function chit_groups_guard() returns trigger language plpgsql as $$ begin
  if (new.chit_value,new.months,new.gross_installment) is distinct from (old.chit_value,old.months,old.gross_installment)
     and exists(select 1 from auctions where group_id=old.id) then
    raise exception 'Chit value, duration and monthly contribution cannot change after the first auction';
  end if;
  return new; end $$;
drop trigger if exists chit_groups_guard on chit_groups;
create trigger chit_groups_guard before update on chit_groups for each row execute function chit_groups_guard();

-- ============ Audit log ============
create table if not exists audit_log(
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,  -- no FK: audit rows must survive user removal unchanged
  changed_at timestamptz not null default now());
create index if not exists audit_log_changed_at_idx on audit_log(changed_at desc);

create or replace function audit_row() returns trigger language plpgsql security definer set search_path=public as $$
declare actor uuid := auth.uid(); begin
  insert into audit_log(table_name,record_id,action,old_data,new_data,changed_by)
  values(tg_table_name,
    case when tg_op='DELETE' then to_jsonb(old)->>'id' else to_jsonb(new)->>'id' end,
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    actor);
  return coalesce(new, old);
end $$;

create or replace function audit_log_guard() returns trigger language plpgsql as $$ begin
  raise exception 'Audit history cannot be changed'; end $$;
drop trigger if exists audit_log_guard on audit_log;
create trigger audit_log_guard before update or delete on audit_log for each row execute function audit_log_guard();

do $$ declare t text; begin
  foreach t in array array['customers','chit_groups','memberships','auctions','receipts','payouts','business_transactions','profiles'] loop
    execute format('drop trigger if exists audit_%1$s on %1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function audit_row()', t);
  end loop; end $$;

-- ============ Installment generation: only active memberships ============
create or replace function generate_installments_for_group(p_group uuid,p_month text,p_winner uuid default null) returns void language plpgsql as $$
declare g chit_groups%rowtype; winner_rule text; due_on date; begin
  select * into strict g from chit_groups where id=p_group for update;
  due_on := installment_due_date(p_month, g.due_day);
  winner_rule := coalesce(g.rule_config->>'prized_member_instalment','unset');
  if winner_rule not in ('full_gross','net') then raise exception 'Configure the prized-member instalment rule before recording an auction'; end if;
  if p_winner is not null and not exists(select 1 from memberships where id=p_winner and group_id=p_group) then
    raise exception 'Auction winner must be a member of this group';
  end if;
  insert into installments(membership_id,group_id,month_label,gross,dividend,net,rule_config,due_date,status)
  select m.id, g.id, p_month, g.gross_installment,
         case when p_winner is not null and m.id=p_winner and winner_rule='full_gross' then 0 else g.current_dividend end,
         case when p_winner is not null and m.id=p_winner and winner_rule='full_gross' then g.gross_installment else greatest(g.gross_installment-g.current_dividend,0) end,
         g.rule_config, due_on, case when due_on<current_date then 'OVERDUE' else 'OPEN' end
  from memberships m where m.group_id=p_group and coalesce(m.status,'ACTIVE')='ACTIVE';
end $$;

-- Owner or manager may record auctions (was owner only).
create or replace function record_auction(p_group uuid,p_month text,p_winner uuid,p_bid bigint,p_div bigint) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Only the owner or a manager can record an auction'; end if;
  if p_month is null or p_bid is null or p_div is null or p_bid < 0 or p_div < 0 then
    raise exception 'Month, bid, and dividend are required; amounts cannot be negative';
  end if;
  perform 1 from chit_groups where id=p_group for update;
  if not found then raise exception 'Chit group not found'; end if;
  if p_winner is not null and exists(select 1 from auctions where group_id=p_group and winner_membership=p_winner) then
    raise exception 'This member has already won an auction in this group';
  end if;
  insert into auctions(group_id,month_label,winner_membership,discount_bid,dividend)
  values(p_group,p_month,p_winner,p_bid,p_div);
  -- prized stays true for every past winner (schema.sql reset earlier winners; no calculation reads this flag).
  update memberships set prized=true where id=p_winner and group_id=p_group;
  update chit_groups set current_month=p_month,current_dividend=p_div where id=p_group;
  perform generate_installments_for_group(p_group,p_month,p_winner);
end $$;

update memberships m set prized=exists(select 1 from auctions a where a.winner_membership=m.id)
where prized is distinct from exists(select 1 from auctions a where a.winner_membership=m.id);

-- Full auction entry: auction date, commission, prize amount, all bids and notes in one transaction.
-- p_bids: [{"membership_id": "...", "bid": 12345}, ...] (paise)
create or replace function record_auction_full(p_group uuid, p_month text, p_winner uuid, p_bid bigint, p_div bigint,
  p_auction_date date default null, p_commission bigint default 0, p_prize bigint default null,
  p_bids jsonb default '[]'::jsonb, p_notes text default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid; b jsonb; g chit_groups%rowtype; begin
  if not is_manager() then raise exception 'Only the owner or a manager can record an auction'; end if;
  select * into g from chit_groups where id=p_group;
  if not found then raise exception 'Chit group not found'; end if;
  if coalesce(g.status,'ACTIVE')<>'ACTIVE' then raise exception 'This group is % — set it to Active before recording an auction', g.status; end if;
  if (select count(*) from auctions where group_id=p_group) >= g.months then raise exception 'All % months of this group already have auctions', g.months; end if;
  if coalesce(p_commission,0)<0 or coalesce(p_prize,0)<0 then raise exception 'Amounts cannot be negative'; end if;
  if p_bid > g.chit_value then raise exception 'Bid/discount cannot exceed the chit value'; end if;
  perform record_auction(p_group,p_month,p_winner,p_bid,p_div);
  select id into strict v_id from auctions where group_id=p_group and month_label=p_month;
  update auctions set auction_date=coalesce(p_auction_date,current_date), commission=coalesce(p_commission,0),
    prize_amount=coalesce(p_prize, case when p_winner is null then null else g.chit_value-p_bid end), notes=nullif(trim(p_notes),'')
  where id=v_id;
  for b in select * from jsonb_array_elements(coalesce(p_bids,'[]'::jsonb)) loop
    if not exists(select 1 from memberships where id=(b->>'membership_id')::uuid and group_id=p_group) then
      raise exception 'Every bidder must be a member of this group';
    end if;
    insert into auction_bids(auction_id,membership_id,bid_amount) values(v_id,(b->>'membership_id')::uuid,(b->>'bid')::bigint);
  end loop;
  return v_id;
end $$;

-- ============ record_payment: Bank Transfer, notes, payment date, balance after payment ============
drop function if exists record_payment(uuid,text,bigint,text,text,text,date,text);
create or replace function record_payment(p_membership_id uuid,p_month_label text,p_amount bigint,p_mode text default 'Cash',p_bank text default null,
  p_ref_no text default null,p_ref_date date default null,p_received_by text default null,
  p_notes text default null,p_receipt_date date default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_receipt receipts%rowtype; v_installment installments%rowtype; g chit_groups%rowtype;
  remaining_amount bigint := p_amount; alloc_amount bigint; alloc_type text;
  v_cur bigint := 0; v_arr bigint := 0; v_fut bigint := 0; v_pen bigint := 0; v_other bigint := 0;
  v_div_allowed bigint := 0; v_div_forfeited bigint := 0;
  v_current_due date; v_outstanding_before bigint := 0;
  current_alloc_remaining bigint; arrears_alloc_remaining bigint; future_alloc_remaining bigint;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be positive'; end if;
  if p_mode is null or p_mode not in ('Cash','Cheque','UPI','Bank Transfer') then raise exception 'Unsupported payment mode'; end if;
  if p_month_label is null then raise exception 'Payment month is required'; end if;
  if p_receipt_date is not null and p_receipt_date > current_date then raise exception 'Payment date cannot be in the future'; end if;
  select cg.* into strict g from chit_groups cg join memberships m on m.group_id=cg.id where m.id=p_membership_id;
  perform installment_due_date(p_month_label,g.due_day);
  perform 1 from installments where membership_id=p_membership_id order by due_date for update;
  select i.due_date into v_current_due from installments i where i.membership_id=p_membership_id and i.month_label=p_month_label;
  if not found then raise exception 'No installment exists for this membership and month; record the monthly auction first'; end if;

  -- Determine the principal allocation in due-date order: overdue, selected month, then future.
  for v_installment in
    select i.* from installments i where i.membership_id=p_membership_id
    order by i.due_date, i.id for update
  loop
    exit when remaining_amount=0;
    if v_installment.due_date < current_date and v_installment.month_label<>p_month_label then
      alloc_type := 'ARREARS';
    elsif v_installment.month_label=p_month_label then
      alloc_type := 'CURRENT';
    elsif v_installment.due_date > v_current_due then
      alloc_type := 'FUTURE';
    else
      continue;
    end if;

    alloc_amount := least(remaining_amount,greatest(
      case when coalesce((v_installment.rule_config->>'forfeit_dividend_after_due')::boolean,false) and v_installment.due_date<current_date
           then v_installment.gross else v_installment.net end-v_installment.paid,0));
    if alloc_amount>0 then
      remaining_amount := remaining_amount-alloc_amount;
      if alloc_type='ARREARS' then v_arr:=v_arr+alloc_amount;
      elsif alloc_type='CURRENT' then v_cur:=v_cur+alloc_amount;
      else v_fut:=v_fut+alloc_amount; end if;
    end if;
  end loop;

  if remaining_amount>0 then
    select greatest(coalesce(sum(case when coalesce(i.rule_config->>'penalty_mode','none')='per_day' and
      (case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) then i.gross else i.net end)>i.paid
      then greatest(current_date-i.due_date-coalesce((i.rule_config->>'grace_days')::int,0),0)*coalesce((i.rule_config->>'penalty_value')::bigint,0)
      when coalesce(i.rule_config->>'penalty_mode','none')='percent' and
        i.due_date+coalesce((i.rule_config->>'grace_days')::int,0)<current_date
      then round(greatest((case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) then i.gross else i.net end)-i.paid,0)
        *coalesce((i.rule_config->>'penalty_value')::numeric,0)/100)::bigint
      else 0 end),0) - coalesce((select sum(a.amount) from payment_allocations a join receipts r on r.id=a.receipt_id
        where r.membership_id=p_membership_id and r.status='ACTIVE' and a.allocation_type='PENALTY'),0),0)
    into v_pen from installments i where i.membership_id=p_membership_id and i.due_date<current_date;
    v_pen := least(v_pen,remaining_amount);
    remaining_amount:=remaining_amount-v_pen;
  end if;
  v_other:=remaining_amount;

  select coalesce(sum(case when i.month_label=p_month_label and (not coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) or i.due_date>=current_date) then i.dividend else 0 end),0),
         coalesce(sum(case when i.month_label=p_month_label and coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) and i.due_date<current_date then i.dividend else 0 end),0)
  into v_div_allowed,v_div_forfeited from installments i where i.membership_id=p_membership_id;

  -- Outstanding (overdue + selected month) before this payment, for the receipt's "balance after" line.
  select coalesce(sum(greatest(case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) and i.due_date<current_date
           then i.gross else i.net end-i.paid,0)),0)
  into v_outstanding_before from installments i
  where i.membership_id=p_membership_id and (i.due_date<current_date or i.month_label=p_month_label);

  insert into receipts(membership_id,month_label,cur,arrears,future,penalty,others,dividend_allowed,dividend_forfeited,mode,bank,ref_no,ref_date,received_by,
    notes,receipt_date,balance_after)
  values(p_membership_id,p_month_label,v_cur,v_arr,v_fut,v_pen,v_other,v_div_allowed,v_div_forfeited,p_mode,p_bank,p_ref_no,p_ref_date,p_received_by,
    nullif(trim(p_notes),''),coalesce(p_receipt_date,current_date),greatest(v_outstanding_before-v_arr-v_cur,0))
  returning * into v_receipt;

  arrears_alloc_remaining:=v_arr; current_alloc_remaining:=v_cur; future_alloc_remaining:=v_fut;
  for v_installment in
    select i.* from installments i where i.membership_id=p_membership_id
    order by i.due_date, i.id for update
  loop
    if v_installment.due_date<current_date and v_installment.month_label<>p_month_label then
      alloc_type:='ARREARS'; alloc_amount:=least(arrears_alloc_remaining,greatest(
        case when coalesce((v_installment.rule_config->>'forfeit_dividend_after_due')::boolean,false) then v_installment.gross else v_installment.net end-v_installment.paid,0));
      arrears_alloc_remaining:=arrears_alloc_remaining-alloc_amount;
    elsif v_installment.month_label=p_month_label then
      alloc_type:='CURRENT'; alloc_amount:=least(current_alloc_remaining,greatest(
        case when coalesce((v_installment.rule_config->>'forfeit_dividend_after_due')::boolean,false) and v_installment.due_date<current_date then v_installment.gross else v_installment.net end-v_installment.paid,0));
      current_alloc_remaining:=current_alloc_remaining-alloc_amount;
    elsif v_installment.due_date>v_current_due then
      alloc_type:='FUTURE'; alloc_amount:=least(future_alloc_remaining,greatest(v_installment.net-v_installment.paid,0));
      future_alloc_remaining:=future_alloc_remaining-alloc_amount;
    else
      continue;
    end if;
    if alloc_amount>0 then
      insert into payment_allocations(receipt_id,installment_id,amount,allocation_type)
      values(v_receipt.id,v_installment.id,alloc_amount,alloc_type);
      update installments i set paid=i.paid+alloc_amount,
        status=case when i.paid+alloc_amount>=(case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) and i.due_date<current_date then i.gross else i.net end)
          then 'PAID' when i.paid+alloc_amount>0 then 'PARTIAL' else 'OPEN' end
      where i.id=v_installment.id;
    end if;
  end loop;
  if v_pen>0 then
    insert into payment_allocations(receipt_id,installment_id,amount,allocation_type) values(v_receipt.id,null,v_pen,'PENALTY');
  end if;
  if v_other>0 then
    insert into payment_allocations(receipt_id,installment_id,amount,allocation_type) values(v_receipt.id,null,v_other,'OTHER');
  end if;
  return v_receipt.id;
end $$;

-- ============ Views for dues, dashboard and reports ============
-- One row per instalment with the amount due today (dividend forfeiture applied), balance and a display status.
create or replace view installment_status with (security_invoker=true) as
select i.id installment_id, i.membership_id, i.group_id, i.month_label, i.due_date, i.gross, i.dividend,
  e.amount_due, i.paid, greatest(e.amount_due-i.paid,0) balance,
  case when i.paid>=e.amount_due then 'PAID'
       when i.due_date<current_date then 'OVERDUE'
       when i.paid>0 then 'PARTIAL' else 'PENDING' end status,
  (i.paid>0 and i.paid<e.amount_due) is_partial,
  m.ticket_no, m.customer_id, m.prized, c.name member_name, c.member_code, c.phone, g.series, g.name group_name
from installments i
cross join lateral (select case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) and i.due_date<current_date
                           then i.gross else i.net end amount_due) e
join memberships m on m.id=i.membership_id
join customers c on c.id=m.customer_id
join chit_groups g on g.id=i.group_id
where i.status<>'CANCELLED';

-- One row per ticket: previous outstanding + current month = total outstanding.
create or replace view member_outstanding with (security_invoker=true) as
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
  coalesce(sum(s.paid),0)::bigint total_paid
from memberships m
join customers c on c.id=m.customer_id
join chit_groups g on g.id=m.group_id
left join installment_status s on s.membership_id=m.id
group by m.id, c.id, g.id;

create or replace function dashboard_summary(p_month text default null) returns jsonb
language sql stable security invoker set search_path=public as $$
with mon as (select coalesce(p_month, to_char(current_date,'YYYY-MM')) m),
s as (select * from installment_status),
r as (select * from receipts where status='ACTIVE')
select jsonb_build_object(
  'month', (select m from mon),
  'active_groups', (select count(*) from chit_groups where status='ACTIVE'),
  'total_groups', (select count(*) from chit_groups),
  'total_members', (select count(*) from customers where status='ACTIVE'),
  'active_tickets', (select count(*) from memberships where status='ACTIVE'),
  'expected_month', (select coalesce(sum(amount_due),0) from s, mon where s.month_label=mon.m),
  'paid_month', (select coalesce(sum(least(paid,amount_due)),0) from s, mon where s.month_label=mon.m),
  'pending_month', (select coalesce(sum(balance),0) from s, mon where s.month_label=mon.m),
  'members_paid', (select count(*) from s, mon where s.month_label=mon.m and balance=0),
  'members_partial', (select count(*) from s, mon where s.month_label=mon.m and balance>0 and paid>0),
  'members_pending', (select count(*) from s, mon where s.month_label=mon.m and balance>0),
  'overdue_total', (select coalesce(sum(balance),0) from s where due_date<current_date),
  'overdue_members', (select count(distinct membership_id) from s where due_date<current_date and balance>0),
  'outstanding_total', (select coalesce(sum(balance),0) from s, mon where s.month_label<=mon.m),
  'received_month', (select coalesce(sum(total),0) from r, mon where to_char(receipt_date,'YYYY-MM')=mon.m),
  'received_today', (select coalesce(sum(total),0) from r where receipt_date=current_date),
  'receipts_today', (select count(*) from r where receipt_date=current_date),
  'today_by_mode', (select coalesce(jsonb_object_agg(mode,amt),'{}'::jsonb) from (select mode, sum(total) amt from r where receipt_date=current_date group by mode) x),
  'month_by_mode', (select coalesce(jsonb_object_agg(mode,amt),'{}'::jsonb) from (select mode, sum(total) amt from r, mon where to_char(receipt_date,'YYYY-MM')=mon.m group by mode) x),
  'payouts_month', (select coalesce(sum(net_payout),0) from payouts, mon where status='ACTIVE' and to_char(payout_date,'YYYY-MM')=mon.m),
  'pending_payouts', (select count(*) from auctions a where a.winner_membership is not null
      and not exists(select 1 from payouts p where p.auction_id=a.id and p.status='ACTIVE')),
  'expenses_month', (select coalesce(sum(amount),0) from business_transactions, mon where status='ACTIVE' and kind='EXPENSE' and to_char(txn_date,'YYYY-MM')=mon.m),
  'other_income_month', (select coalesce(sum(amount),0) from business_transactions, mon where status='ACTIVE' and kind='INCOME' and to_char(txn_date,'YYYY-MM')=mon.m)
) $$;

-- ============ Row level security ============
alter table auction_bids enable row level security;
alter table payouts enable row level security;
alter table business_transactions enable row level security;
alter table audit_log enable row level security;

drop policy if exists read_auction_bids on auction_bids;
create policy read_auction_bids on auction_bids for select to authenticated using (true);
drop policy if exists read_payouts on payouts;
create policy read_payouts on payouts for select to authenticated using (true);
drop policy if exists ins_payouts on payouts;
create policy ins_payouts on payouts for insert to authenticated with check (is_manager());
drop policy if exists upd_payouts on payouts;
create policy upd_payouts on payouts for update to authenticated using (is_owner());
drop policy if exists read_btx on business_transactions;
create policy read_btx on business_transactions for select to authenticated using (is_manager());
drop policy if exists ins_btx on business_transactions;
create policy ins_btx on business_transactions for insert to authenticated with check (is_manager());
drop policy if exists upd_btx on business_transactions;
create policy upd_btx on business_transactions for update to authenticated using (is_owner());
drop policy if exists read_audit on audit_log;
create policy read_audit on audit_log for select to authenticated using (is_manager());

-- Managers can now manage members, groups and memberships; only the owner deletes a member record.
drop policy if exists upd_cust on customers;
create policy upd_cust on customers for update to authenticated using (is_manager());
drop policy if exists del_cust on customers;
create policy del_cust on customers for delete to authenticated using (is_owner());
drop policy if exists own_group on chit_groups;
create policy own_group on chit_groups for all to authenticated using (is_manager()) with check (is_manager());
drop policy if exists own_mem on memberships;
create policy own_mem on memberships for all to authenticated using (is_manager()) with check (is_manager());

revoke all on function record_payment(uuid,text,bigint,text,text,text,date,text,text,date) from public;
grant execute on function record_payment(uuid,text,bigint,text,text,text,date,text,text,date) to authenticated;
revoke all on function record_auction_full(uuid,text,uuid,bigint,bigint,date,bigint,bigint,jsonb,text) from public;
grant execute on function record_auction_full(uuid,text,uuid,bigint,bigint,date,bigint,bigint,jsonb,text) to authenticated;
revoke all on function generate_installments_for_group(uuid,text,uuid) from public;
grant execute on function dashboard_summary(text) to authenticated;

notify pgrst, 'reload schema';
