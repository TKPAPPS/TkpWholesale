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
