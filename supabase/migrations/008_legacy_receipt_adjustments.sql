-- Keep the two values written on paper receipts as auditable source details.
-- They are recorded in paise and do not change the member payment allocation.
alter table public.legacy_receipt_sources
  add column if not exists bp_adjustment bigint not null default 0 check (bp_adjustment >= 0),
  add column if not exists agent_commission_adjustment bigint not null default 0 check (agent_commission_adjustment >= 0);

drop function if exists public.record_legacy_payment(uuid,text,bigint,date,text,text,text,date,text,text,text,text,text);

create function public.record_legacy_payment(
  p_membership_id uuid,
  p_month_label text,
  p_amount bigint,
  p_receipt_date date,
  p_mode text default 'Cash',
  p_bank text default null,
  p_ref_no text default null,
  p_ref_date date default null,
  p_received_by text default null,
  p_notes text default null,
  p_paper_receipt_no text default null,
  p_paper_book text default null,
  p_source_file text default null,
  p_bp_adjustment bigint default 0,
  p_agent_commission_adjustment bigint default 0
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_receipt_id uuid;
begin
  if not public.is_manager() then raise exception 'Only an owner or manager can enter historical receipts'; end if;
  if p_receipt_date is null or p_receipt_date > current_date then
    raise exception 'Enter a valid past or current receipt date';
  end if;
  if coalesce(p_bp_adjustment, 0) < 0 or coalesce(p_agent_commission_adjustment, 0) < 0 then
    raise exception 'Receipt adjustments cannot be negative';
  end if;
  if p_paper_receipt_no is not null and exists (
    select 1 from public.legacy_receipt_sources s
    where trim(s.paper_receipt_no) = trim(p_paper_receipt_no)
      and coalesce(nullif(trim(s.paper_book), ''), '') = coalesce(nullif(trim(p_paper_book), ''), '')
  ) then raise exception 'This paper receipt number is already recorded for this receipt book'; end if;

  v_receipt_id := public.record_payment(p_membership_id, p_month_label, p_amount, p_mode, p_bank,
    p_ref_no, p_ref_date, p_received_by, p_notes, p_receipt_date);
  insert into public.legacy_receipt_sources(
    receipt_id, paper_receipt_no, paper_book, source_file, bp_adjustment, agent_commission_adjustment
  ) values (
    v_receipt_id, nullif(trim(p_paper_receipt_no), ''), nullif(trim(p_paper_book), ''),
    nullif(trim(p_source_file), ''), coalesce(p_bp_adjustment, 0), coalesce(p_agent_commission_adjustment, 0)
  );
  return v_receipt_id;
end $$;

revoke all on function public.record_legacy_payment(uuid,text,bigint,date,text,text,text,date,text,text,text,text,text,bigint,bigint) from public;
grant execute on function public.record_legacy_payment(uuid,text,bigint,date,text,text,text,date,text,text,text,text,text,bigint,bigint) to authenticated;

notify pgrst, 'reload schema';
