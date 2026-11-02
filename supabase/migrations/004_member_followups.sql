-- Shared call/visit/reminder log for the field app and office website.
create table if not exists public.member_followups (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id),
  activity_type text not null check (activity_type in ('Call','Visit','WhatsApp','Other')),
  notes text not null check (length(trim(notes)) > 0),
  promised_date date,
  next_followup_date date,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists member_followups_membership_date_idx
  on public.member_followups(membership_id, created_at desc);
alter table public.member_followups enable row level security;
grant select, insert on public.member_followups to authenticated;
revoke update, delete on public.member_followups from anon, authenticated;
drop policy if exists member_followups_read on public.member_followups;
create policy member_followups_read on public.member_followups
  for select to authenticated using (auth.uid() is not null);
drop policy if exists member_followups_add on public.member_followups;
create policy member_followups_add on public.member_followups
  for insert to authenticated with check (auth.uid() is not null and created_by = auth.uid());
notify pgrst, 'reload schema';
