-- Idempotent payment recording for mobile retries and offline queue replay.
create table if not exists public.payment_requests (
  request_id uuid primary key,
  submitted_by uuid not null references public.profiles(id),
  receipt_id uuid not null unique references public.receipts(id),
  created_at timestamptz not null default now()
);
alter table public.payment_requests enable row level security;
grant select on public.payment_requests to authenticated;
revoke insert, update, delete on public.payment_requests from anon, authenticated;
drop policy if exists payment_requests_read on public.payment_requests;
create policy payment_requests_read on public.payment_requests for select to authenticated using (submitted_by=auth.uid() or public.is_manager());

create or replace function public.record_payment_idempotent(
  p_request_id uuid, p_membership_id uuid, p_month_label text, p_amount bigint,
  p_mode text default 'Cash', p_bank text default null, p_ref_no text default null,
  p_ref_date date default null, p_received_by text default null, p_notes text default null,
  p_receipt_date date default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_receipt_id uuid; v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'Sign in is required'; end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select receipt_id into v_receipt_id from public.payment_requests
    where request_id=p_request_id and submitted_by=v_owner;
  if found then return v_receipt_id; end if;
  if exists(select 1 from public.payment_requests where request_id=p_request_id) then
    raise exception 'This request ID belongs to another user';
  end if;
  v_receipt_id := public.record_payment(p_membership_id,p_month_label,p_amount,p_mode,p_bank,
    p_ref_no,p_ref_date,p_received_by,p_notes,p_receipt_date);
  insert into public.payment_requests(request_id,submitted_by,receipt_id)
  values(p_request_id,v_owner,v_receipt_id);
  return v_receipt_id;
end $$;
revoke all on function public.record_payment_idempotent(uuid,uuid,text,bigint,text,text,text,date,text,text,date) from public, anon;
grant execute on function public.record_payment_idempotent(uuid,uuid,text,bigint,text,text,text,date,text,text,date) to authenticated;
notify pgrst, 'reload schema';
