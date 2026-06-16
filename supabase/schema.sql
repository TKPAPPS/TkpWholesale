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
