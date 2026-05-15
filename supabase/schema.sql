-- Supabase schema for the POS MVP.
-- Run this in Supabase SQL Editor before deploying with VITE_SUPABASE_* variables.

create extension if not exists pgcrypto;

create table if not exists public.pos_products (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null default '',
  category text not null default '',
  barcode text not null default '',
  plu text not null default '',
  price numeric not null default 0,
  stock numeric not null default 0,
  hidden boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.pos_sales (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  document_number text not null,
  created_at timestamptz not null default now(),
  payment_method text not null default '',
  total numeric not null default 0,
  tip_amount numeric not null default 0,
  unpaid boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.pos_stock_movements (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  product_id text not null default '',
  movement_type text not null default '',
  quantity numeric not null default 0,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.pos_movement_history (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  product_id text not null default '',
  movement_type text not null default '',
  quantity numeric not null default 0,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.pos_suppliers (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null default '',
  vat_no text not null default '',
  vat_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.pos_stock_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  supplier_name text not null default '',
  document_number text not null default '',
  stocked_at timestamptz not null default now(),
  total_cost numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.pos_audit_log (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  action text not null default '',
  entity_type text not null default '',
  entity_id text not null default '',
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.pos_day_closures (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  business_date date not null default current_date,
  closed_at timestamptz not null default now(),
  total_cash numeric not null default 0,
  total_card numeric not null default 0,
  total_revenue numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);


create table if not exists public.pos_cash_sessions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  business_date date not null default current_date,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash numeric not null default 0,
  counted_cash numeric,
  expected_cash numeric,
  cash_difference numeric,
  status text not null default 'open',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create unique index if not exists pos_cash_sessions_one_open_idx
  on public.pos_cash_sessions(owner_id)
  where closed_at is null;

create index if not exists pos_cash_sessions_owner_opened_idx
  on public.pos_cash_sessions(owner_id, opened_at desc);

create table if not exists public.pos_settings (
  owner_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  payload jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

create index if not exists pos_products_owner_search_idx on public.pos_products(owner_id, category, name);
create index if not exists pos_sales_owner_created_idx on public.pos_sales(owner_id, created_at desc);
create index if not exists pos_movements_owner_created_idx on public.pos_stock_movements(owner_id, created_at desc);
create index if not exists pos_receipts_owner_stocked_idx on public.pos_stock_receipts(owner_id, stocked_at desc);

alter table public.pos_products enable row level security;
alter table public.pos_sales enable row level security;
alter table public.pos_stock_movements enable row level security;
alter table public.pos_movement_history enable row level security;
alter table public.pos_suppliers enable row level security;
alter table public.pos_stock_receipts enable row level security;
alter table public.pos_audit_log enable row level security;
alter table public.pos_day_closures enable row level security;
alter table public.pos_cash_sessions enable row level security;
alter table public.pos_settings enable row level security;

-- Owner-only policies. For more staff accounts, add an organization table and policies by organization membership.
do $$
declare
  t text;
begin
  foreach t in array array[
    'pos_products','pos_sales','pos_stock_movements','pos_movement_history','pos_suppliers',
    'pos_stock_receipts','pos_audit_log','pos_day_closures','pos_cash_sessions','pos_settings'
  ] loop
    execute format('drop policy if exists "%1$s owner select" on public.%1$I', t);
    execute format('drop policy if exists "%1$s owner insert" on public.%1$I', t);
    execute format('drop policy if exists "%1$s owner update" on public.%1$I', t);
    execute format('drop policy if exists "%1$s owner delete" on public.%1$I', t);
    execute format('create policy "%1$s owner select" on public.%1$I for select using (auth.uid() = owner_id)', t);
    execute format('create policy "%1$s owner insert" on public.%1$I for insert with check (auth.uid() = owner_id)', t);
    execute format('create policy "%1$s owner update" on public.%1$I for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id)', t);
    execute format('create policy "%1$s owner delete" on public.%1$I for delete using (auth.uid() = owner_id)', t);
  end loop;
end $$;
