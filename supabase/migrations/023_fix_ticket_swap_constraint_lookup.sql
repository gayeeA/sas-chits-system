-- Resolve the deferred ticket uniqueness constraint explicitly because the
-- security-definer function uses an empty search_path.
alter table public.memberships drop constraint if exists memberships_group_id_ticket_no_key;
alter table public.memberships add constraint memberships_group_id_ticket_no_key
  unique (group_id, ticket_no) deferrable initially immediate;

create or replace function public.swap_membership_tickets(
  p_first_membership_id uuid,
  p_second_membership_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  first_row public.memberships%rowtype;
  second_row public.memberships%rowtype;
  ticket_limit integer;
begin
  if not public.is_owner() then raise exception 'Only the owner can swap ticket numbers'; end if;
  if p_first_membership_id is null or p_second_membership_id is null
      or p_first_membership_id = p_second_membership_id then
    raise exception 'Choose two different tickets';
  end if;
  select * into first_row from public.memberships where id = p_first_membership_id;
  if not found then raise exception 'First ticket not found'; end if;
  perform 1 from public.chit_groups where id = first_row.group_id for update;
  select * into first_row from public.memberships where id = p_first_membership_id for update;
  select * into second_row from public.memberships where id = p_second_membership_id for update;
  if not found then raise exception 'Second ticket not found'; end if;
  if first_row.group_id <> second_row.group_id then
    raise exception 'Tickets can only be swapped within the same group';
  end if;
  select coalesce(member_count, months) into ticket_limit
    from public.chit_groups where id = first_row.group_id;
  if first_row.ticket_no not between 1 and ticket_limit
      or second_row.ticket_no not between 1 and ticket_limit then
    raise exception 'A ticket number is outside this group duration';
  end if;
  if first_row.status <> 'ACTIVE' or second_row.status <> 'ACTIVE' then
    raise exception 'Only active tickets can be swapped';
  end if;
  set constraints public.memberships_group_id_ticket_no_key deferred;
  update public.memberships set ticket_no = second_row.ticket_no where id = first_row.id;
  update public.memberships set ticket_no = first_row.ticket_no where id = second_row.id;
end
$$;

notify pgrst, 'reload schema';
