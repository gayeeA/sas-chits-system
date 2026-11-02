-- Private photo attachments for paper receipts. Images are never public URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('receipt-scans','receipt-scans',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];

create table if not exists public.receipt_scan_attachments (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id),
  object_path text not null unique,
  recognized_text text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.receipt_scan_attachments enable row level security;
grant select, insert on public.receipt_scan_attachments to authenticated;
revoke update, delete on public.receipt_scan_attachments from anon, authenticated;
drop policy if exists receipt_scan_metadata_read on public.receipt_scan_attachments;
create policy receipt_scan_metadata_read on public.receipt_scan_attachments
  for select to authenticated using (auth.uid() is not null);
drop policy if exists receipt_scan_metadata_add on public.receipt_scan_attachments;
create policy receipt_scan_metadata_add on public.receipt_scan_attachments
  for insert to authenticated with check (public.is_manager() and created_by=auth.uid());

drop policy if exists receipt_scans_read on storage.objects;
create policy receipt_scans_read on storage.objects for select to authenticated
  using (bucket_id='receipt-scans');
drop policy if exists receipt_scans_add on storage.objects;
create policy receipt_scans_add on storage.objects for insert to authenticated
  with check (bucket_id='receipt-scans' and public.is_manager());
drop policy if exists receipt_scans_remove on storage.objects;
create policy receipt_scans_remove on storage.objects for delete to authenticated
  using (bucket_id='receipt-scans' and public.is_manager());

create or replace function public.save_receipt_scan_text(p_attachment_id uuid, p_text text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_manager() then raise exception 'Only an owner or manager can save OCR text'; end if;
  update public.receipt_scan_attachments set recognized_text=nullif(left(trim(p_text),12000),'')
    where id=p_attachment_id;
  if not found then raise exception 'Receipt scan not found'; end if;
end $$;
revoke all on function public.save_receipt_scan_text(uuid,text) from public, anon;
grant execute on function public.save_receipt_scan_text(uuid,text) to authenticated;
notify pgrst, 'reload schema';
