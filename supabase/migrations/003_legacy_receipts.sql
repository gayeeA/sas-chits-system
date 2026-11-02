-- Historical paper and spreadsheet receipts. Payments still go through the same
-- allocation function as current collections; this table preserves their source.
create table if not exists legacy_receipt_sources (
  receipt_id uuid primary key references receipts(id),
  paper_receipt_no text,
  paper_book text,
  source_file text,
  entered_by uuid not null default auth.uid(),
  entered_at timestamptz not null default now(),
  check (paper_receipt_no is null or length(trim(paper_receipt_no)) > 0)
);

create unique index if not exists legacy_receipt_source_number_unique
  on legacy_receipt_sources (coalesce(nullif(trim(paper_book), ''), ''), trim(paper_receipt_no))
  where paper_receipt_no is not null;

alter table legacy_receipt_sources enable row level security;
grant select on legacy_receipt_sources to authenticated;
revoke insert, update, delete on legacy_receipt_sources from anon, authenticated;
drop policy if exists legacy_receipt_sources_read on legacy_receipt_sources;
create policy legacy_receipt_sources_read on legacy_receipt_sources
  for select to authenticated using (is_manager());

create or replace function record_legacy_payment(
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
  p_source_file text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_receipt_id uuid;
begin
  if not public.is_manager() then raise exception 'Only an owner or manager can enter historical receipts'; end if;
  if p_receipt_date is null or p_receipt_date > current_date then
    raise exception 'Enter a valid past or current receipt date';
  end if;
  if p_paper_receipt_no is not null and exists (
    select 1 from public.legacy_receipt_sources s
    where trim(s.paper_receipt_no) = trim(p_paper_receipt_no)
      and coalesce(nullif(trim(s.paper_book), ''), '') = coalesce(nullif(trim(p_paper_book), ''), '')
  ) then raise exception 'This paper receipt number is already recorded for this receipt book'; end if;

  v_receipt_id := public.record_payment(p_membership_id, p_month_label, p_amount, p_mode, p_bank,
    p_ref_no, p_ref_date, p_received_by, p_notes, p_receipt_date);
  insert into public.legacy_receipt_sources(receipt_id, paper_receipt_no, paper_book, source_file)
  values (v_receipt_id, nullif(trim(p_paper_receipt_no), ''), nullif(trim(p_paper_book), ''), nullif(trim(p_source_file), ''));
  return v_receipt_id;
end $$;

revoke all on function record_legacy_payment(uuid,text,bigint,date,text,text,text,date,text,text,text,text,text) from public;
grant execute on function record_legacy_payment(uuid,text,bigint,date,text,text,text,date,text,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
