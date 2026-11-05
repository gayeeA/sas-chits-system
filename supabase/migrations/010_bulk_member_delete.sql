-- Allow owners to delete multiple unlinked members atomically.
create or replace function public.delete_customers_if_unlinked(p_customer_ids uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  unique_ids uuid[];
  requested_count bigint;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can delete members';
  end if;

  select array_agg(distinct customer_id), count(distinct customer_id)
    into unique_ids, requested_count
  from unnest(p_customer_ids) as input(customer_id);

  if requested_count is null or requested_count = 0 then
    raise exception 'Select at least one member';
  end if;

  perform 1
  from public.customers
  where id = any(unique_ids)
  order by id
  for update;

  if (select count(*) from public.customers where id = any(unique_ids)) <> requested_count then
    raise exception 'One or more selected members no longer exist';
  end if;

  if exists (select 1 from public.memberships where customer_id = any(unique_ids)) then
    raise exception 'Selected members with group-ticket history cannot be deleted. Mark them inactive instead';
  end if;

  delete from public.customers where id = any(unique_ids);
end
$$;

revoke all on function public.delete_customers_if_unlinked(uuid[]) from public, anon;
grant execute on function public.delete_customers_if_unlinked(uuid[]) to authenticated;

create or replace function public.guard_membership_ticket_range()
returns trigger
language plpgsql set search_path = '' as $$
declare
  ticket_limit integer;
begin
  select coalesce(member_count, months) into ticket_limit
  from public.chit_groups
  where id = new.group_id;

  if ticket_limit is null or new.ticket_no > ticket_limit then
    raise exception 'Ticket number must be between 1 and the group ticket limit (%)', coalesce(ticket_limit, 0);
  end if;
  return new;
end
$$;

drop trigger if exists guard_membership_ticket_range on public.memberships;
create trigger guard_membership_ticket_range
before insert or update of group_id, ticket_no on public.memberships
for each row execute function public.guard_membership_ticket_range();

notify pgrst, 'reload schema';
