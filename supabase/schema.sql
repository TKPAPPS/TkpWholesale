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
