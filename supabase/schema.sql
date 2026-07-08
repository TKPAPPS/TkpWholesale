-- B2B Portal – Supabase schema
-- Run this in the Supabase SQL Editor before going live.

-- Favorites: one row per (customer, product template).
-- partner_id matches res.partner.id in Odoo.
-- template_id matches product.template.id in Odoo.
create table if not exists favorites (
  partner_id  bigint not null,
  template_id bigint not null,
  created_at  timestamptz not null default now(),
  primary key (partner_id, template_id)
);

-- Only the service-role key (used server-side) can access this table.
-- Disable RLS so anon/authenticated Supabase users cannot read it directly.
alter table favorites disable row level security;

-- Announcements: site-wide banner messages shown to customers.
-- Managed from the admin dashboard (/api/admin/announcements). The public
-- /api/announcements route shows the most recent active announcement whose
-- [starts_at, expires_at] window contains "now".
create table if not exists announcements (
  id          bigint generated always as identity primary key,
  message     text not null,
  type        text not null default 'info' check (type in ('info', 'warning', 'success')),
  active      boolean not null default true,
  starts_at   timestamptz,                       -- null = visible immediately
  expires_at  timestamptz,                       -- null = never expires
  created_at  timestamptz not null default now()
);

-- Idempotent patch: add the scheduling column to tables created before it existed.
alter table announcements add column if not exists starts_at timestamptz;

-- Server-side (service-role) access only, same as favorites.
alter table announcements disable row level security;

-- Rate limiting: a sliding-window counter keyed by e.g. "login:<ip>". Used to throttle
-- the login endpoints. Accessed only by the service-role key (server-side).
create table if not exists rate_limits (
  key       text primary key,
  hits      integer not null default 0,
  reset_at  timestamptz not null
);
alter table rate_limits enable row level security;  -- service-role only; no policies

-- Atomic increment + window check. Returns true if within the limit, false to block.
create or replace function check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
as $$
declare
  v_hits integer;
begin
  insert into rate_limits (key, hits, reset_at)
    values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    hits = case when rate_limits.reset_at < now() then 1 else rate_limits.hits + 1 end,
    reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => p_window_seconds) else rate_limits.reset_at end
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

-- Scheduled / repeating orders. Created at checkout; executed daily by the cron
-- route /api/cron/scheduled-orders (service-role only). All dates are Asia/Bangkok
-- calendar dates. `items` is a snapshot of what to order (never prices — Odoo
-- computes the live pricelist price at placement).
create table if not exists scheduled_orders (
  id                    uuid primary key default gen_random_uuid(),
  partner_id            bigint not null,            -- ordering contact (session.partner_id)
  commercial_partner_id bigint not null,            -- ownership scope (like the orders list)
  shipping_address_id   bigint not null,
  po_ref                text not null default '',
  note                  text not null default '',
  lang                  text not null default 'en' check (lang in ('en','he')),
  items                 jsonb not null,             -- [{product_id,name,name_he,sku,uom_qty,packaging_id,packaging_qty}]
  frequency             text not null check (frequency in ('daily','weekly')),
  interval_weeks        integer not null default 1 check (interval_weeks between 1 and 8),
  excluded_weekdays     smallint[] not null default '{}',  -- 0=Sun..6=Sat, daily only
  anchor_date           date not null,              -- Bangkok date of checkout
  end_date              date,                       -- inclusive; null = forever
  next_run_date         date not null,              -- Bangkok date
  status                text not null default 'active'
                          check (status in ('active','paused','ended','cancelled')),
  paused_reason         text,
  consecutive_failures  integer not null default 0,
  last_run_date         date,                       -- claim / idempotency stamp
  last_run_at           timestamptz,
  last_order_id         bigint,
  last_order_name       text,
  last_status           text,                       -- 'success' | 'failed'
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists scheduled_orders_due_idx
  on scheduled_orders (next_run_date) where status = 'active';
create index if not exists scheduled_orders_owner_idx
  on scheduled_orders (commercial_partner_id);
alter table scheduled_orders disable row level security;

-- Atomic per-schedule claim. Stamps last_run_date = today and returns the row
-- ONLY if it is active, due, and not already claimed today. An empty result means
-- another cron run already claimed it (double fire / overlap) so it is skipped.
-- Stamping at claim time (before any Odoo call) means a mid-run timeout can never
-- double-place on the same day.
create or replace function claim_scheduled_order(p_id uuid, p_today date)
returns setof scheduled_orders
language sql
as $$
  update scheduled_orders
     set last_run_date = p_today, last_run_at = now(), updated_at = now()
   where id = p_id
     and status = 'active'
     and next_run_date <= p_today
     and (last_run_date is null or last_run_date < p_today)
  returning *;
$$;
