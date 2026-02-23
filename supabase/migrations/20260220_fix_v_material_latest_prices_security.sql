-- Fix SECURITY DEFINER issue: recreate view as SECURITY INVOKER (default)
-- This will ensure RLS and user permissions are respected

DROP VIEW IF EXISTS public.v_material_latest_prices;
CREATE VIEW public.v_material_latest_prices AS
SELECT DISTINCT ON (q.org_id, q.material_id)
  q.org_id,
  q.material_id,
  q.unit_price,
  q.currency,
  q.vendor,
  q.price_date,
  q.source_url,
  q.updated_at
FROM public.material_price_quotes q
ORDER BY q.org_id, q.material_id, q.price_date DESC, q.updated_at DESC;
-- No SECURITY DEFINER clause, so SECURITY INVOKER is used by default;
