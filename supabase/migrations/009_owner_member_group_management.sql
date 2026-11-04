-- Owner-only member/group administration with financial-history safeguards.

create or replace function public.replace_membership_assignment(
  p_membership_id uuid,
  p_customer_id uuid,
  p_ticket_no integer
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ticket public.memberships%rowtype;
  ticket_group uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change a ticket assignment';
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
  perform 1 from public.chit_groups where id = ticket_group for update;
  select * into ticket
  from public.memberships
  where id = p_membership_id and group_id = ticket_group
  for update;
  if not found then
    raise exception 'Ticket changed while reassignment was being prepared';
  end if;

  if not exists (
    select 1 from public.customers
    where id = p_customer_id and status = 'ACTIVE'
  ) then
    raise exception 'Choose an active member';
  end if;

  if exists (select 1 from public.installments where membership_id = ticket.id)
    or exists (select 1 from public.receipts where membership_id = ticket.id)
    or exists (select 1 from public.auctions where winner_membership = ticket.id)
    or exists (select 1 from public.auction_bids where membership_id = ticket.id)
    or exists (select 1 from public.payouts where membership_id = ticket.id)
    or exists (select 1 from public.member_followups where membership_id = ticket.id) then
    raise exception 'This ticket has history and cannot be reassigned. Keep the history and add the replacement member to another ticket';
  end if;

  if exists (
    select 1 from public.memberships
    where group_id = ticket.group_id
      and customer_id = p_customer_id
      and id <> ticket.id
      and status = 'ACTIVE'
  ) then
    raise exception 'This member already has an active ticket in this group';
  end if;

  update public.memberships
  set customer_id = p_customer_id,
      ticket_no = p_ticket_no,
      status = 'ACTIVE',
      prized = false,
      assigned_agent = case when ticket.customer_id is distinct from p_customer_id then null else ticket.assigned_agent end
  where id = ticket.id;
end
$$;

create or replace function public.delete_customer_if_unlinked(p_customer_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can delete a member';
  end if;
  if exists (select 1 from public.memberships where customer_id = p_customer_id) then
    raise exception 'This member has group-ticket history. Mark them inactive instead';
  end if;

  delete from public.customers where id = p_customer_id;
  if not found then
    raise exception 'Member not found';
  end if;
end
$$;

create or replace function public.delete_group_if_empty(p_group_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can delete a group';
  end if;
  if exists (select 1 from public.memberships where group_id = p_group_id)
    or exists (select 1 from public.auctions where group_id = p_group_id)
    or exists (select 1 from public.installments where group_id = p_group_id)
    or exists (select 1 from public.payouts where group_id = p_group_id)
    or exists (select 1 from public.business_transactions where group_id = p_group_id) then
    raise exception 'This group has records. Pause or complete it instead of deleting it';
  end if;

  delete from public.chit_groups where id = p_group_id;
  if not found then
    raise exception 'Group not found';
  end if;
end
$$;

revoke all on function public.replace_membership_assignment(uuid, uuid, integer) from public, anon;
revoke all on function public.delete_customer_if_unlinked(uuid) from public, anon;
revoke all on function public.delete_group_if_empty(uuid) from public, anon;
grant execute on function public.replace_membership_assignment(uuid, uuid, integer) to authenticated;
grant execute on function public.delete_customer_if_unlinked(uuid) to authenticated;
grant execute on function public.delete_group_if_empty(uuid) to authenticated;

-- Managers may still change ticket status, but only the owner may change its identity or number.
create or replace function public.guard_membership_assignment_change()
returns trigger language plpgsql set search_path = '' as $$
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
      raise exception 'Choose an active member';
    end if;
    if exists (select 1 from public.installments where membership_id = old.id)
      or exists (select 1 from public.receipts where membership_id = old.id)
      or exists (select 1 from public.auctions where winner_membership = old.id)
      or exists (select 1 from public.auction_bids where membership_id = old.id)
      or exists (select 1 from public.payouts where membership_id = old.id)
      or exists (select 1 from public.member_followups where membership_id = old.id) then
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
    if (new.customer_id, new.group_id) is distinct from (old.customer_id, old.group_id) then
      new.assigned_agent := null;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists guard_membership_assignment_change on public.memberships;
create trigger guard_membership_assignment_change
before update on public.memberships
for each row execute function public.guard_membership_assignment_change();

-- Member creation and group-ticket assignment are owner-only.
drop policy if exists ins_cust on public.customers;
create policy ins_cust on public.customers
  for insert to authenticated with check (public.is_owner());

-- Restrict hard deletion of groups to the owner; retain manager create/edit permissions.
drop policy if exists own_group on public.chit_groups;
drop policy if exists ins_group on public.chit_groups;
drop policy if exists upd_group on public.chit_groups;
drop policy if exists del_group on public.chit_groups;
create policy ins_group on public.chit_groups
  for insert to authenticated with check (public.is_manager());
create policy upd_group on public.chit_groups
  for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy del_group on public.chit_groups
  for delete to authenticated using (public.is_owner());

-- Keep manager status changes, but reserve membership creation and deletion for the owner.
drop policy if exists own_mem on public.memberships;
drop policy if exists ins_mem on public.memberships;
drop policy if exists upd_mem on public.memberships;
drop policy if exists del_mem on public.memberships;
create policy ins_mem on public.memberships
  for insert to authenticated with check (public.is_owner());
create policy upd_mem on public.memberships
  for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy del_mem on public.memberships
  for delete to authenticated using (public.is_owner());

notify pgrst, 'reload schema';
