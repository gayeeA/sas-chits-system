-- Merge duplicate customer records while preserving membership and financial-history IDs.
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
  if (new.customer_id, new.group_id, new.ticket_no)
      is distinct from (old.customer_id, old.group_id, old.ticket_no) then
    if not exists (
      select 1 from public.customers
      where id = new.customer_id and status = 'ACTIVE'
    ) then
      raise exception 'Choose an active member as the merge destination';
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
    if exists (
      select 1 from public.memberships
      where group_id = new.group_id
        and customer_id = new.customer_id
        and id <> old.id
        and status = 'ACTIVE'
    ) then
      raise exception 'This member already has an active ticket in this group';
    end if;
    if not merging_members and (new.customer_id, new.group_id) is distinct from (old.customer_id, old.group_id) then
      new.assigned_agent := null;
    end if;
  end if;
  return new;
end
$$;

create or replace function public.merge_customer_records(
  p_target_customer_id uuid,
  p_source_customer_ids uuid[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  source_ids uuid[];
  expected_count bigint;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can merge member records';
  end if;
  if p_target_customer_id is null or coalesce(cardinality(p_source_customer_ids), 0) = 0 then
    raise exception 'Choose one member to keep and at least one member to merge';
  end if;
  if p_target_customer_id = any(p_source_customer_ids) or exists (
    select 1 from unnest(p_source_customer_ids) as source(customer_id)
    where source.customer_id is null
  ) then
    raise exception 'The kept member cannot also be selected as a member to merge';
  end if;

  select array_agg(customer_id order by customer_id), count(*)
    into source_ids, expected_count
  from (select distinct customer_id from unnest(p_source_customer_ids) as source(customer_id)) selected;

  if expected_count <> cardinality(p_source_customer_ids) then
    raise exception 'A member was selected more than once';
  end if;

  perform 1
  from public.customers
  where id = p_target_customer_id or id = any(source_ids)
  order by id
  for update;

  if (select count(*) from public.customers where id = p_target_customer_id or id = any(source_ids)) <> expected_count + 1 then
    raise exception 'One or more selected member records no longer exist';
  end if;
  if not exists (
    select 1 from public.customers
    where id = p_target_customer_id and status = 'ACTIVE'
  ) then
    raise exception 'Choose an active member record to keep';
  end if;

  perform 1
  from public.memberships
  where customer_id = p_target_customer_id or customer_id = any(source_ids)
  order by group_id, id
  for update;

  if exists (
    select 1
    from public.memberships
    where (customer_id = p_target_customer_id or customer_id = any(source_ids))
      and status = 'ACTIVE'
    group by group_id
    having count(*) > 1
  ) then
    raise exception 'The selected records have multiple active tickets in the same group. Resolve that group conflict before merging';
  end if;

  if exists (
    select 1
    from (
      select count(distinct phone) phone_count,
             count(distinct alt_phone) alt_phone_count,
             count(distinct email) email_count,
             count(distinct address) address_count,
             count(distinct pan) pan_count,
             count(distinct id_proof_ref) id_proof_count,
             count(distinct nominee_name) nominee_name_count,
             count(distinct nominee_relation) nominee_relation_count,
             count(distinct nominee_phone) nominee_phone_count,
             count(distinct joining_date) joining_date_count
      from public.customers
      where id = p_target_customer_id or id = any(source_ids)
    ) profile
    where phone_count > 1 or alt_phone_count > 1 or email_count > 1
      or address_count > 1 or pan_count > 1 or id_proof_count > 1
      or nominee_name_count > 1 or nominee_relation_count > 1
      or nominee_phone_count > 1 or joining_date_count > 1
  ) then
    raise exception 'Selected members have conflicting profile details. Edit the records to resolve conflicts before merging';
  end if;

  update public.customers target
  set phone = coalesce(target.phone, source.phone),
      alt_phone = coalesce(target.alt_phone, source.alt_phone),
      email = coalesce(target.email, source.email),
      address = coalesce(target.address, source.address),
      pan = coalesce(target.pan, source.pan),
      id_proof_ref = coalesce(target.id_proof_ref, source.id_proof_ref),
      nominee_name = coalesce(target.nominee_name, source.nominee_name),
      nominee_relation = coalesce(target.nominee_relation, source.nominee_relation),
      nominee_phone = coalesce(target.nominee_phone, source.nominee_phone),
      joining_date = coalesce(target.joining_date, source.joining_date),
      notes = source.notes
  from (
    select
      (select c.phone from public.customers c where c.id = any(source_ids) and c.phone is not null order by c.created_at, c.id limit 1) phone,
      (select c.alt_phone from public.customers c where c.id = any(source_ids) and c.alt_phone is not null order by c.created_at, c.id limit 1) alt_phone,
      (select c.email from public.customers c where c.id = any(source_ids) and c.email is not null order by c.created_at, c.id limit 1) email,
      (select c.address from public.customers c where c.id = any(source_ids) and c.address is not null order by c.created_at, c.id limit 1) address,
      (select c.pan from public.customers c where c.id = any(source_ids) and c.pan is not null order by c.created_at, c.id limit 1) pan,
      (select c.id_proof_ref from public.customers c where c.id = any(source_ids) and c.id_proof_ref is not null order by c.created_at, c.id limit 1) id_proof_ref,
      (select c.nominee_name from public.customers c where c.id = any(source_ids) and c.nominee_name is not null order by c.created_at, c.id limit 1) nominee_name,
      (select c.nominee_relation from public.customers c where c.id = any(source_ids) and c.nominee_relation is not null order by c.created_at, c.id limit 1) nominee_relation,
      (select c.nominee_phone from public.customers c where c.id = any(source_ids) and c.nominee_phone is not null order by c.created_at, c.id limit 1) nominee_phone,
      (select min(c.joining_date) from public.customers c where c.id = any(source_ids)) joining_date,
      (select string_agg(note, E'\n' order by note)
       from (select distinct c.notes note
             from public.customers c
             where (c.id = p_target_customer_id or c.id = any(source_ids))
               and nullif(trim(c.notes), '') is not null) all_notes) notes
  ) source
  where target.id = p_target_customer_id;

  perform set_config('app.member_merge', 'on', true);
  update public.memberships
  set customer_id = p_target_customer_id
  where customer_id = any(source_ids);
  perform set_config('app.member_merge', 'off', true);

  delete from public.customers where id = any(source_ids);
end
$$;

revoke all on function public.merge_customer_records(uuid, uuid[]) from public, anon;
grant execute on function public.merge_customer_records(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
