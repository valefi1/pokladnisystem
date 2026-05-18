-- ONE-TIME PRICE FIX FOR EXISTING PRODUCTS
-- Use this only if your current product prices are WITHOUT VAT, but the app displays them as prices WITH VAT.
-- It converts existing product prices from net to gross and stores both values:
--   price_without_vat = old price
--   price_with_vat    = old price * (1 + vat_rate / 100)
--   price              = price_with_vat
-- The JSON payload is updated too, because the app loads products from payload.
--
-- Run once in Supabase SQL Editor. Do not run it repeatedly.

update public.pos_products
set
  price_without_vat = round(coalesce(nullif(price_without_vat, 0), price)::numeric, 2),
  price_with_vat = round((coalesce(nullif(price_without_vat, 0), price) * (1 + coalesce(nullif(vat_rate, 0), 12) / 100.0))::numeric, 2),
  price = round((coalesce(nullif(price_without_vat, 0), price) * (1 + coalesce(nullif(vat_rate, 0), 12) / 100.0))::numeric, 2),
  payload = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(coalesce(payload, '{}'::jsonb), '{priceWithoutVat}', to_jsonb(round(coalesce(nullif(price_without_vat, 0), price)::numeric, 2)), true),
          '{priceWithVat}', to_jsonb(round((coalesce(nullif(price_without_vat, 0), price) * (1 + coalesce(nullif(vat_rate, 0), 12) / 100.0))::numeric, 2)), true
        ),
        '{price}', to_jsonb(round((coalesce(nullif(price_without_vat, 0), price) * (1 + coalesce(nullif(vat_rate, 0), 12) / 100.0))::numeric, 2)), true
      ),
      '{vatRate}', to_jsonb(coalesce(nullif(vat_rate, 0), 12)), true
    ),
    '{vatPricingMigratedFromNet}', 'true'::jsonb, true
  ),
  updated_at = now()
where coalesce((payload->>'vatPricingMigratedFromNet')::boolean, false) = false;
