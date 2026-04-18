-- Run this in Supabase Dashboard → SQL Editor as part of the clean-slate
-- migration before shipping Supabase Auth. welcome_discounts rows are keyed
-- on Square customer_id; every Square customer is being deleted so the
-- rows are going to be dangling references. We TRUNCATE rather than DELETE
-- so the audit state is obviously "wiped on purpose", not partial.

truncate table public.welcome_discounts;
