-- READ-ONLY: instalment.paid_amount vs SUM(active posted allocations)
SELECT *
FROM public.skyline_payment_allocation_mismatches
ORDER BY ABS(difference) DESC, assignment_id, installment_number;
