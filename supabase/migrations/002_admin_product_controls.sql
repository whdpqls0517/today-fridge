begin;

alter table public.products
  add column if not exists show_original_price boolean not null default false;

create table if not exists public.restock_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  is_active boolean not null default true,
  request_type text not null default 'restock'
    check (request_type in ('restock', 'waitlist')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  content text not null,
  photo_urls text[] not null default '{}',
  is_visible boolean not null default true,
  admin_reply text,
  replied_by uuid references auth.users(id) on delete set null,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists restock_subscriptions_product_idx
  on public.restock_subscriptions(product_id, request_type, is_active);
create index if not exists reviews_product_idx
  on public.reviews(product_id, is_visible, created_at desc);

alter table public.restock_subscriptions enable row level security;
alter table public.reviews enable row level security;

drop policy if exists "restock_own_or_admin" on public.restock_subscriptions;
create policy "restock_own_or_admin"
on public.restock_subscriptions for all to authenticated
using ((select auth.uid()) = user_id or public.is_admin())
with check ((select auth.uid()) = user_id or public.is_admin());

drop policy if exists "reviews_read_visible" on public.reviews;
create policy "reviews_read_visible"
on public.reviews for select to anon, authenticated
using (is_visible = true or (select auth.uid()) = user_id or public.is_admin());

drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own"
on public.reviews for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "reviews_admin_all" on public.reviews;
create policy "reviews_admin_all"
on public.reviews for all to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.reviews to anon;
grant select, insert, update, delete on public.restock_subscriptions to authenticated;
grant select, insert on public.reviews to authenticated;
grant all privileges on public.restock_subscriptions, public.reviews to service_role;

commit;
