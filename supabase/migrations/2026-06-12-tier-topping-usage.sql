-- Diamond-tier monthly free-topping quota. One row per (customer, Brisbane
-- month). Monthly reset is implicit: a new month_key starts at used_count 0.
CREATE TABLE IF NOT EXISTS tier_topping_usage (
  customer_id   TEXT NOT NULL,
  month_key     TEXT NOT NULL CHECK (month_key ~ '^\d{4}-\d{2}$'),
  -- 10 = keep in sync with DIAMOND_MONTHLY_FREE_TOPPINGS in src/lib/membership-tier.ts
  used_count    INT  NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= 10),
  last_order_id TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, month_key)
);

-- Service-role only (server routes). RLS on + no policies blocks anon/authed.
ALTER TABLE tier_topping_usage ENABLE ROW LEVEL SECURITY;

-- Atomic consume: row-locked, capped at 10/month. Returns what was actually
-- consumed (may be less than requested) + the new used_count.
CREATE OR REPLACE FUNCTION consume_topping_allowance(
  p_customer_id TEXT,
  p_month_key   TEXT,
  p_count       INT,
  p_order_id    TEXT
) RETURNS TABLE (consumed_count INT, used_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_used INT;
  v_take INT;
BEGIN
  INSERT INTO tier_topping_usage AS t (customer_id, month_key, used_count, last_order_id)
  VALUES (p_customer_id, p_month_key, 0, p_order_id)
  ON CONFLICT (customer_id, month_key) DO NOTHING;

  SELECT t.used_count INTO v_used
  FROM tier_topping_usage t
  WHERE t.customer_id = p_customer_id AND t.month_key = p_month_key
  FOR UPDATE;

  -- 10 = keep in sync with DIAMOND_MONTHLY_FREE_TOPPINGS in src/lib/membership-tier.ts
  v_take := LEAST(GREATEST(COALESCE(p_count, 0), 0), 10 - v_used);

  IF v_take > 0 THEN
    UPDATE tier_topping_usage
    SET used_count    = used_count + v_take,
        last_order_id = p_order_id,
        updated_at    = now()
    WHERE customer_id = p_customer_id AND month_key = p_month_key;
  END IF;

  RETURN QUERY SELECT v_take, v_used + GREATEST(v_take, 0);
END;
$$;

-- REVOKE FROM PUBLIC, not just anon/authenticated — default PUBLIC grant
-- otherwise leaks execute.
REVOKE ALL ON FUNCTION consume_topping_allowance(TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_topping_allowance(TEXT, TEXT, INT, TEXT) TO service_role;
