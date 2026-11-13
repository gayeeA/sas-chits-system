-- Derive net due from the immutable gross and dividend columns. This avoids
-- trusting a stale stored `net` value in dues, quotes, payment allocations,
-- receipt corrections, or receipt-cancellation reversals.

create or replace view public.installment_status with (security_invoker = true) as
select i.id installment_id, i.membership_id, i.group_id, i.month_label, i.due_date,
  i.gross, i.dividend, greatest(i.gross - i.dividend, 0) amount_due,
  least(i.paid, greatest(i.gross - i.dividend, 0)) paid,
  greatest(greatest(i.gross - i.dividend, 0) - i.paid, 0) balance,
  case when i.paid >= greatest(i.gross - i.dividend, 0) then 'PAID'
       when i.due_date < current_date then 'OVERDUE'
       when i.paid > 0 then 'PARTIAL' else 'PENDING' end status,
  (least(i.paid, greatest(i.gross - i.dividend, 0)) > 0
    and least(i.paid, greatest(i.gross - i.dividend, 0)) < greatest(i.gross - i.dividend, 0)) is_partial,
  m.ticket_no, m.customer_id, m.prized, c.name member_name, c.member_code, c.phone,
  g.series, g.name group_name
from public.installments i
join public.memberships m on m.id = i.membership_id
join public.customers c on c.id = m.customer_id
join public.chit_groups g on g.id = i.group_id
where i.status <> 'CANCELLED';

-- Patch the already-installed payment and reversal functions without copying
-- their full bodies, replacing any stored-net references with gross-dividend.
do $$
declare
  target_oid oid;
  function_definition text;
  corrected_definition text;
begin
  foreach target_oid in array array[
    'public.payment_quote(uuid,text)'::regprocedure::oid,
    'public.record_payment(uuid,text,bigint,text,text,text,date,text,text,date)'::regprocedure::oid,
    'public.reverse_cancelled_receipt_allocations()'::regprocedure::oid,
    'public.correct_receipt_amount(uuid,bigint,text)'::regprocedure::oid
  ] loop
    function_definition := pg_get_functiondef(target_oid);
    corrected_definition := replace(function_definition,
      'v_installment.net', 'greatest(v_installment.gross - v_installment.dividend, 0)');
    corrected_definition := replace(corrected_definition,
      'i.net', 'greatest(i.gross - i.dividend, 0)');
    corrected_definition := replace(corrected_definition,
      $old$  if p_new_amount = old_receipt.total then
    raise exception 'The corrected amount is unchanged';
  end if;
$old$, '');
    if corrected_definition = function_definition then
      raise exception 'No stored net references were found in function %', target_oid::regprocedure;
    end if;
    execute corrected_definition;
  end loop;
end
$$;

notify pgrst, 'reload schema';
