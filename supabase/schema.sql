-- Run in Supabase: SQL Editor > New query > paste > Run. All money is stored in paise (bigint).
create extension if not exists pgcrypto;
create type user_role as enum ('owner','clerk','agent');

create table profiles(id uuid primary key references auth.users on delete cascade, full_name text, role user_role not null default 'clerk');
create table customers(id uuid primary key default gen_random_uuid(), name text not null, phone text, address text, created_at timestamptz default now());
create table chit_groups(id uuid primary key default gen_random_uuid(), series text unique not null, chit_value bigint not null, months int not null,
  gross_installment bigint not null, commission_pct numeric, due_day int default 27, current_month text, current_dividend bigint default 0,
  rule_config jsonb not null default '{"grace_days": 0, "penalty_mode": "none", "penalty_value": 0, "forfeit_dividend_after_due": false, "prized_member_instalment": "unset"}'::jsonb,
  check (jsonb_typeof(rule_config)='object'),
  check (coalesce(rule_config->>'penalty_mode','none') in ('none','per_day','percent')),
  check (coalesce(rule_config->>'prized_member_instalment','unset') in ('unset','net','full_gross')),
  check (coalesce((rule_config->>'grace_days')::int,0)>=0),
  check (coalesce((rule_config->>'penalty_value')::numeric,0)>=0),
  check (chit_value>0 and months>0 and gross_installment>0 and due_day between 1 and 31),
  created_at timestamptz default now());
create table memberships(id uuid primary key default gen_random_uuid(), customer_id uuid not null references customers, group_id uuid not null references chit_groups,
  ticket_no int not null check (ticket_no>0), prized boolean default false, unique(group_id,ticket_no));
create table auctions(id uuid primary key default gen_random_uuid(), group_id uuid not null references chit_groups, month_label text not null,
  winner_membership uuid references memberships, discount_bid bigint not null check (discount_bid>=0), dividend bigint not null check (dividend>=0), created_at timestamptz default now(),
  unique(group_id, month_label));
create unique index auctions_group_winner_unique on auctions(group_id, winner_membership) where winner_membership is not null;

create table installments(
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references memberships,
  group_id uuid not null references chit_groups,
  month_label text not null,
  gross bigint not null default 0,
  dividend bigint not null default 0,
  net bigint not null default 0,
  rule_config jsonb not null,
  due_date date not null,
  paid bigint not null default 0,
  status text not null default 'OPEN' check (status in ('OPEN','PARTIAL','PAID','OVERDUE','CANCELLED')),
  check (gross>=0 and dividend>=0 and net>=0 and paid>=0),
  unique(membership_id, month_label)
);

create sequence receipt_seq start 15118;  -- continues after paper receipt 15117
create table receipts(id uuid primary key default gen_random_uuid(), receipt_no bigint unique not null default nextval('receipt_seq'),
  receipt_date date not null default current_date, membership_id uuid not null references memberships, month_label text,
  cur bigint not null default 0 check (cur>=0), arrears bigint not null default 0 check (arrears>=0),
  future bigint not null default 0 check (future>=0), penalty bigint not null default 0 check (penalty>=0), others bigint not null default 0 check (others>=0),
  total bigint generated always as (cur+arrears+future+penalty+others) stored,
  dividend_allowed bigint not null default 0 check (dividend_allowed>=0), dividend_forfeited bigint not null default 0 check (dividend_forfeited>=0),
  mode text not null default 'Cash' check (mode in ('Cash','Cheque','UPI')), bank text, ref_no text, ref_date date,
  received_by text, status text not null default 'ACTIVE' check (status in ('ACTIVE','CANCELLED')), cancelled_reason text,
  created_by uuid default auth.uid(), created_at timestamptz default now(), check (cur+arrears+future+penalty+others > 0));

create table payment_allocations(
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts,
  installment_id uuid references installments,
  amount bigint not null default 0,
  allocation_type text not null check (allocation_type in ('ARREARS','CURRENT','FUTURE','PENALTY','OTHER','REVERSAL')),
  reverses_allocation_id uuid references payment_allocations,
  created_at timestamptz default now(),
  check ((allocation_type = 'REVERSAL' and amount < 0 and reverses_allocation_id is not null) or
         (allocation_type <> 'REVERSAL' and amount > 0 and reverses_allocation_id is null)),
  check ((allocation_type in ('PENALTY','OTHER') and installment_id is null) or
         (allocation_type = 'REVERSAL') or
         (allocation_type not in ('PENALTY','OTHER') and installment_id is not null))
);
create index installments_member_due_idx on installments(membership_id,due_date);
create index allocations_receipt_idx on payment_allocations(receipt_id);

create function financial_rows_guard() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Financial history cannot be deleted'; end if;
  if tg_table_name='installments' and
     (to_jsonb(new)-'paid'-'status') <> (to_jsonb(old)-'paid'-'status') then
    raise exception 'Installment terms are immutable';
  end if;
  if tg_table_name='payment_allocations' then raise exception 'Payment allocations are immutable'; end if;
  return new;
end $$;
create trigger installments_guard before update or delete on installments for each row execute function financial_rows_guard();
create trigger payment_allocations_guard before update or delete on payment_allocations for each row execute function financial_rows_guard();

-- Receipts can never be deleted or edited; only cancelled.
create function receipts_guard() returns trigger language plpgsql as $$ begin
  if tg_op='DELETE' then raise exception 'Receipts cannot be deleted; cancel instead'; end if;
  if (to_jsonb(new)-'status'-'cancelled_reason') <> (to_jsonb(old)-'status'-'cancelled_reason') then raise exception 'Receipts are immutable; cancel instead'; end if;
  if old.status='CANCELLED' then raise exception 'Cancelled receipts cannot be changed'; end if;
  if new.status='ACTIVE' and new.cancelled_reason is distinct from old.cancelled_reason then raise exception 'Cancellation reason is only set while cancelling'; end if;
  if new.status='CANCELLED' and nullif(trim(new.cancelled_reason),'') is null then raise exception 'A cancellation reason is required'; end if;
  return new; end $$;
create trigger receipts_guard before update or delete on receipts for each row execute function receipts_guard();

create function reverse_cancelled_receipt_allocations() returns trigger language plpgsql security definer set search_path=public as $$
declare a payment_allocations%rowtype; begin
  if old.status='ACTIVE' and new.status='CANCELLED' then
    for a in select * from payment_allocations where receipt_id=new.id and allocation_type<>'REVERSAL' loop
      insert into payment_allocations(receipt_id,installment_id,amount,allocation_type,reverses_allocation_id)
      values(new.id,a.installment_id,-a.amount,'REVERSAL',a.id);
      if a.installment_id is not null then
        update installments i set paid=greatest(i.paid-a.amount,0),
          status=case when greatest(i.paid-a.amount,0)>=(case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) and i.due_date<current_date then i.gross else i.net end) then 'PAID'
            when greatest(i.paid-a.amount,0)>0 then 'PARTIAL'
            when i.due_date<current_date then 'OVERDUE' else 'OPEN' end
        from memberships m join chit_groups g on g.id=m.group_id
        where i.id=a.installment_id and i.membership_id=m.id;
      end if;
    end loop;
  end if;
  return new;
end $$;
create trigger receipt_cancel_reversal after update of status on receipts
for each row execute function reverse_cancelled_receipt_allocations();

-- First user to sign up becomes owner, the rest are clerks.
create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin
  insert into profiles(id,full_name,role) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',new.email),
  case when (select count(*) from profiles)=0 then 'owner'::user_role else 'clerk'::user_role end); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create function is_owner() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role='owner') $$;

-- Monthly dues: also served as REST API at /rest/v1/member_dues (see README)
create view member_dues with (security_invoker=true) as
select m.id membership_id, c.name, c.phone, g.series, g.current_month, g.current_dividend dividend,
  coalesce((select sum(case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) and i.due_date<current_date then i.gross else i.net end)
    from installments i where i.membership_id=m.id and i.month_label=g.current_month),0) due,
  coalesce((select sum(i.paid) from installments i where i.membership_id=m.id and i.month_label=g.current_month),0) paid,
  coalesce((select sum(greatest(case when coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) then i.gross else i.net end-i.paid,0))
    from installments i where i.membership_id=m.id and i.due_date < current_date),0) arrears
from memberships m join customers c on c.id=m.customer_id join chit_groups g on g.id=m.group_id;

create function installment_due_date(p_month text, p_due_day int) returns date language plpgsql immutable as $$
declare month_start date; month_end date; begin
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Month must use YYYY-MM format'; end if;
  month_start := to_date(p_month || '-01','YYYY-MM-DD');
  month_end := (month_start + interval '1 month - 1 day')::date;
  return make_date(extract(year from month_start)::int, extract(month from month_start)::int, least(p_due_day, extract(day from month_end)::int));
end $$;

create function generate_installments_for_group(p_group uuid,p_month text,p_winner uuid default null) returns void language plpgsql as $$
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
  from memberships m where m.group_id=p_group;
end $$;

create function record_auction(p_group uuid,p_month text,p_winner uuid,p_bid bigint,p_div bigint) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not is_owner() then raise exception 'Only the owner can record an auction'; end if;
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
  update memberships set prized=false where group_id=p_group;
  update memberships set prized=true where id=p_winner and group_id=p_group;
  update chit_groups set current_month=p_month,current_dividend=p_div where id=p_group;
  perform generate_installments_for_group(p_group,p_month,p_winner);
end $$;

create function payment_quote(p_membership_id uuid, p_month_label text)
returns table(current_due bigint, arrears_due bigint, future_due bigint, penalty_due bigint, dividend_allowed bigint, dividend_forfeited bigint)
language plpgsql stable security definer set search_path=public as $$
declare g chit_groups%rowtype; today date := current_date; v_current_due date; begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  select cg.* into strict g from chit_groups cg join memberships m on m.group_id=cg.id where m.id=p_membership_id;
  perform installment_due_date(p_month_label,g.due_day);
  select i.due_date into v_current_due from installments i where i.membership_id=p_membership_id and i.month_label=p_month_label;
  if not found then raise exception 'No installment exists for this membership and month'; end if;
  return query
  select
    coalesce(sum(case when i.month_label=p_month_label then greatest(e.effective_net-i.paid,0) else 0 end),0)::bigint,
    coalesce(sum(case when i.due_date < today and i.month_label<>p_month_label then greatest(e.effective_net-i.paid,0) else 0 end),0)::bigint,
    coalesce(sum(case when i.due_date > v_current_due then greatest(e.effective_net-i.paid,0) else 0 end),0)::bigint,
    greatest(coalesce(sum(case when i.due_date < today then e.penalty_due else 0 end),0) -
      coalesce((select sum(a.amount) from payment_allocations a join receipts r on r.id=a.receipt_id
        where r.membership_id=p_membership_id and r.status='ACTIVE' and a.allocation_type='PENALTY'),0),0)::bigint,
    coalesce(sum(case when i.month_label=p_month_label and (not coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) or i.due_date>=today) then i.dividend else 0 end),0)::bigint,
    coalesce(sum(case when i.month_label=p_month_label and coalesce((i.rule_config->>'forfeit_dividend_after_due')::boolean,false) and i.due_date<today then i.dividend else 0 end),0)::bigint
  from installments i
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

create function record_payment(p_membership_id uuid,p_month_label text,p_amount bigint,p_mode text default 'Cash',p_bank text default null,
  p_ref_no text default null,p_ref_date date default null,p_received_by text default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_receipt receipts%rowtype; v_installment installments%rowtype; g chit_groups%rowtype;
  remaining_amount bigint := p_amount; alloc_amount bigint; alloc_type text;
  v_cur bigint := 0; v_arr bigint := 0; v_fut bigint := 0; v_pen bigint := 0; v_other bigint := 0;
  v_div_allowed bigint := 0; v_div_forfeited bigint := 0;
  v_current_due date;
  current_alloc_remaining bigint; arrears_alloc_remaining bigint; future_alloc_remaining bigint;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be positive'; end if;
  if p_mode is null or p_mode not in ('Cash','Cheque','UPI') then raise exception 'Unsupported payment mode'; end if;
  if p_month_label is null then raise exception 'Payment month is required'; end if;
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

  insert into receipts(membership_id,month_label,cur,arrears,future,penalty,others,dividend_allowed,dividend_forfeited,mode,bank,ref_no,ref_date,received_by)
  values(p_membership_id,p_month_label,v_cur,v_arr,v_fut,v_pen,v_other,v_div_allowed,v_div_forfeited,p_mode,p_bank,p_ref_no,p_ref_date,p_received_by)
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

-- Row level security
do $$ declare t text; begin
  foreach t in array array['profiles','customers','chit_groups','memberships','auctions','receipts','installments','payment_allocations'] loop
    execute format('alter table %I enable row level security',t);
    execute format('create policy read_%1$s on %1$I for select to authenticated using (true)',t);
  end loop; end $$;
create policy ins_cust on customers for insert to authenticated with check (true);
create policy upd_cust on customers for update to authenticated using (is_owner());
create policy upd_rcpt on receipts for update to authenticated using (is_owner());
create policy own_group on chit_groups for all to authenticated using (is_owner()) with check (is_owner());
create policy own_mem on memberships for all to authenticated using (is_owner()) with check (is_owner());
create policy own_prof on profiles for update to authenticated using (is_owner());

revoke all on function record_auction(uuid,text,uuid,bigint,bigint) from public;
revoke all on function generate_installments_for_group(uuid,text,uuid) from public;
revoke all on function payment_quote(uuid,text) from public;
revoke all on function record_payment(uuid,text,bigint,text,text,text,date,text) from public;
grant execute on function record_auction(uuid,text,uuid,bigint,bigint) to authenticated;
grant execute on function payment_quote(uuid,text) to authenticated;
grant execute on function record_payment(uuid,text,bigint,text,text,text,date,text) to authenticated;
