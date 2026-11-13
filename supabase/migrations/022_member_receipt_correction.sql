-- Receipt corrections retain the original as a cancelled audit record, reverse
-- its allocations, and issue a replacement in one transaction.

create or replace function public.reverse_cancelled_receipt_allocations()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  a public.payment_allocations%rowtype;
begin
  if old.status = 'ACTIVE' and new.status = 'CANCELLED' then
    for a in select * from public.payment_allocations
      where receipt_id = new.id and allocation_type <> 'REVERSAL'
    loop
      insert into public.payment_allocations(
        receipt_id, installment_id, amount, allocation_type, reverses_allocation_id
      ) values (new.id, a.installment_id, -a.amount, 'REVERSAL', a.id);

      if a.installment_id is not null then
        update public.installments i
        set paid = greatest(i.paid - a.amount, 0),
            status = case
              when greatest(i.paid - a.amount, 0) >= i.net then 'PAID'
              when greatest(i.paid - a.amount, 0) > 0 then 'PARTIAL'
              when i.due_date < current_date then 'OVERDUE'
              else 'OPEN'
            end
        where i.id = a.installment_id;
      end if;
    end loop;
  end if;
  return new;
end
$$;

create or replace function public.correct_receipt_amount(
  p_receipt_id uuid,
  p_new_amount bigint,
  p_reason text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  old_receipt public.receipts%rowtype;
  replacement_id uuid;
  correction_note text;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception 'Only an owner or manager can correct a receipt';
  end if;
  if p_new_amount is null or p_new_amount <= 0 then
    raise exception 'Corrected amount must be positive';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Enter why this receipt is being corrected';
  end if;

  select * into strict old_receipt from public.receipts
  where id = p_receipt_id for update;
  if old_receipt.status <> 'ACTIVE' then
    raise exception 'Only an active receipt can be corrected';
  end if;
  if exists (select 1 from public.legacy_receipt_sources s where s.receipt_id = old_receipt.id) then
    raise exception 'Imported paper receipts must be corrected from the historical receipt workflow';
  end if;
  if old_receipt.mode = 'Cheque' and exists (
    select 1 from public.cheque_tracking c
    where c.receipt_id = old_receipt.id and c.clearance_status <> 'PENDING'
  ) then
    raise exception 'A cleared or bounced cheque receipt cannot be amount-corrected here';
  end if;
  if p_new_amount = old_receipt.total then
    raise exception 'The corrected amount is unchanged';
  end if;

  correction_note := concat_ws(E'\n', nullif(trim(old_receipt.notes), ''),
    format('Corrected from receipt #%s. Reason: %s', old_receipt.receipt_no, trim(p_reason)));

  update public.receipts
  set status = 'CANCELLED',
      cancelled_reason = 'Amount corrected: ' || trim(p_reason)
  where id = old_receipt.id;

  replacement_id := public.record_payment(
    old_receipt.membership_id,
    old_receipt.month_label,
    p_new_amount,
    old_receipt.mode,
    old_receipt.bank,
    old_receipt.ref_no,
    old_receipt.ref_date,
    old_receipt.received_by,
    correction_note,
    old_receipt.receipt_date
  );
  return replacement_id;
end
$$;

revoke all on function public.correct_receipt_amount(uuid, bigint, text) from public, anon;
grant execute on function public.correct_receipt_amount(uuid, bigint, text) to authenticated;

notify pgrst, 'reload schema';
