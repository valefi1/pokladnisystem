-- v1.17 repair migration
-- Safe to run repeatedly. It does not delete data.

create extension if not exists pgcrypto;

alter table public.pos_products
  add column if not exists price_with_vat numeric not null default 0,
  add column if not exists price_without_vat numeric not null default 0,
  add column if not exists vat_rate numeric not null default 12,
  add column if not exists stock numeric not null default 0,
  add column if not exists hidden boolean not null default false,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.pos_sales
  add column if not exists total_without_vat numeric not null default 0,
  add column if not exists vat_total numeric not null default 0,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.pos_settings (
  owner_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  payload jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

-- Early builds sometimes used pos_setting singular. Copy its content if it exists.
do $$
begin
  if to_regclass('public.pos_setting') is not null then
    insert into public.pos_settings(owner_id, key, payload, updated_at)
    select owner_id, key, payload, coalesce(updated_at, now())
    from public.pos_setting
    on conflict (owner_id, key) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at;
  end if;
end $$;

alter table public.pos_settings enable row level security;

drop policy if exists "pos_settings owner select" on public.pos_settings;
drop policy if exists "pos_settings owner insert" on public.pos_settings;
drop policy if exists "pos_settings owner update" on public.pos_settings;
drop policy if exists "pos_settings owner delete" on public.pos_settings;
create policy "pos_settings owner select" on public.pos_settings for select using (auth.uid() = owner_id);
create policy "pos_settings owner insert" on public.pos_settings for insert with check (auth.uid() = owner_id);
create policy "pos_settings owner update" on public.pos_settings for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "pos_settings owner delete" on public.pos_settings for delete using (auth.uid() = owner_id);

-- Fill VAT columns for rows where only old price exists. This does NOT increase prices; it only backfills missing derived values.
update public.pos_products
set
  vat_rate = coalesce(nullif(vat_rate, 0), 12),
  price_with_vat = case when coalesce(price_with_vat, 0) = 0 then coalesce(price, 0) else price_with_vat end,
  price_without_vat = case
    when coalesce(price_without_vat, 0) = 0 and coalesce(price_with_vat, 0) <> 0 then round((price_with_vat / (1 + coalesce(nullif(vat_rate, 0), 12) / 100.0))::numeric, 2)
    when coalesce(price_without_vat, 0) = 0 and coalesce(price, 0) <> 0 then round((price / (1 + coalesce(nullif(vat_rate, 0), 12) / 100.0))::numeric, 2)
    else price_without_vat
  end,
  updated_at = now()
where coalesce(price, 0) <> 0
  and (coalesce(price_with_vat, 0) = 0 or coalesce(price_without_vat, 0) = 0 or coalesce(vat_rate, 0) = 0);

select 'v1.17 repair finished' as status;
