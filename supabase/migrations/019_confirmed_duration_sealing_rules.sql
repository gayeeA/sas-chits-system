-- Apply the confirmed ticket-count and sealing-period rules to future group activity.
-- Existing auction, instalment, receipt, payout, and allocation rows are not rewritten.

create or replace function public.chit_groups_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.member_count is distinct from new.months then
    raise exception 'Total ticket count must equal the group duration in months';
  end if;

  if coalesce((new.rule_config->>'sealing_period_months')::integer, 0)
      is distinct from coalesce((old.rule_config->>'sealing_period_months')::integer, 0)
      and exists (select 1 from public.auctions where group_id = old.id) then
    raise exception 'Sealing period cannot change after the first group month is recorded';
  end if;

  if new.start_date is distinct from old.start_date
      and exists (select 1 from public.auctions where group_id = old.id) then
    raise exception 'Group start date cannot change after the first group month is recorded';
  end if;

  if (new.chit_value, new.months, new.gross_installment)
      is distinct from (old.chit_value, old.months, old.gross_installment)
      and exists (select 1 from public.auctions where group_id = old.id) then
    raise exception 'Chit amount, duration, and monthly contribution cannot change after the first auction';
  end if;

  return new;
end
$$;

do $$
begin
  if exists (
    select 1
    from public.chit_groups g
    where coalesce((g.rule_config->>'sealing_period_months')::integer, 0) < 0
      or coalesce((g.rule_config->>'sealing_period_months')::integer, 0) > g.months
  ) then
    raise exception 'An existing sealing period is outside its group duration; review it before applying this migration';
  end if;
  if exists (
    select 1
    from public.memberships m
    join public.chit_groups g on g.id = m.group_id
    where m.ticket_no > g.months
  ) then
    raise exception 'Some existing ticket numbers exceed their group duration; review those records before applying the duration-based ticket rule';
  end if;
end
$$;

update public.chit_groups
set member_count = months,
    rule_config = coalesce(rule_config, '{}'::jsonb)
      || jsonb_build_object('commission_from', 'discount')
      || jsonb_build_object(
        'sealing_period_months',
        coalesce((rule_config->>'sealing_period_months')::integer, 0)
      );

alter table public.chit_groups
  alter column member_count set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chit_groups'::regclass
      and conname = 'chit_groups_member_count_matches_duration'
  ) then
    alter table public.chit_groups
      add constraint chit_groups_member_count_matches_duration
      check (member_count = months);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chit_groups'::regclass
      and conname = 'chit_groups_confirmed_rule_config'
  ) then
    alter table public.chit_groups
      add constraint chit_groups_confirmed_rule_config
      check (
        coalesce(rule_config->>'commission_from', '') = 'discount'
        and coalesce((rule_config->>'sealing_period_months')::integer, 0) between 0 and months
      );
  end if;
end
$$;

create or replace function public.guard_confirmed_sealing_month()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  g public.chit_groups%rowtype;
  start_month date;
  auction_month date;
  month_number integer;
  sealing_months integer;
begin
  if tg_op = 'UPDATE'
      and (new.group_id, new.month_label, new.winner_membership)
        is not distinct from (old.group_id, old.month_label, old.winner_membership) then
    return new;
  end if;

  select * into strict g from public.chit_groups where id = new.group_id;
  if new.month_label !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Auction month must use YYYY-MM format';
  end if;
  if g.start_date is null then
    if coalesce((g.rule_config->>'sealing_period_months')::integer, 0) > 0 then
      raise exception 'Set the group start date before recording a sealing-period month';
    end if;
    return new;
  end if;

  start_month := date_trunc('month', g.start_date)::date;
  auction_month := to_date(new.month_label || '-01', 'YYYY-MM-DD');
  month_number := (extract(year from auction_month)::integer - extract(year from start_month)::integer) * 12
    + extract(month from auction_month)::integer - extract(month from start_month)::integer + 1;
  sealing_months := coalesce((g.rule_config->>'sealing_period_months')::integer, 0);

  if month_number < 1 or month_number > g.months then
    raise exception 'Auction month must fall within the group duration';
  end if;
  if month_number <= sealing_months and new.winner_membership is not null then
    raise exception 'No auction winner may be recorded during the sealing period';
  end if;
  if month_number > sealing_months and new.winner_membership is null then
    raise exception 'Record a winning ticket; a draw may be used when there is no bidder';
  end if;
  return new;
end
$$;

drop trigger if exists auctions_confirmed_sealing_month on public.auctions;
create trigger auctions_confirmed_sealing_month
before insert or update on public.auctions
for each row execute function public.guard_confirmed_sealing_month();
