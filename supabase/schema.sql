-- 오늘의 냉장고: Supabase 최초 데이터베이스 구성
-- Supabase Dashboard > SQL Editor > New query에 전체 붙여넣고 Run 하세요.

begin;

create extension if not exists pgcrypto;

-- 공통 updated_at 자동 갱신 함수
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1. 회원: 로그인 자체는 auth.users, 서비스용 정보만 profiles에 저장
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  phone text,
  login_provider text not null default 'kakao'
    check (login_provider = 'kakao'),
  role text not null default 'customer'
    check (role in ('customer', 'admin')),
  notification_settings jsonb not null
    default '{"arrival":true,"inquiry":true,"important":true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_phone_unique
  on public.profiles(phone)
  where phone is not null and phone <> '';

-- 카카오로 처음 로그인하면 profiles 행 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, name, phone, login_provider)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name'
    ),
    new.phone,
    coalesce(new.raw_app_meta_data ->> 'provider', 'kakao')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- 관리자 여부를 정책에서 확인하는 함수
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

-- 2. 상품 원본: 상품명/설명/가격/이미지 등 반복해서 사용할 정보
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null
    check (category in ('bundle', 'fruit', 'market')),
  category_label text,
  description text,
  price integer not null check (price >= 0),
  original_price integer check (original_price is null or original_price >= price),
  show_original_price boolean not null default false,
  unit text,
  images text[] not null default '{}',
  tags text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute procedure public.set_updated_at();

-- 3. 보따리 회차: 관리자가 정하는 모집/입고/수령 날짜 묶음
create table if not exists public.bundles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  order_deadline timestamptz not null,
  expected_arrival_date date not null,
  default_pickup_date date not null,
  pickup_time_label text not null default '오후 7시 이후',
  status text not null default 'recruiting'
    check (status in ('draft', 'recruiting', 'closed', 'arrived', 'finished', 'cancelled')),
  notice text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bundles_arrival_date_idx
  on public.bundles(expected_arrival_date desc);

drop trigger if exists bundles_set_updated_at on public.bundles;
create trigger bundles_set_updated_at
  before update on public.bundles
  for each row execute procedure public.set_updated_at();

-- 4. 보따리 등록 상품: 특정 회차에 어떤 상품을 몇 개 파는지
create table if not exists public.bundle_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.bundles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  sale_price integer not null check (sale_price >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  initial_stock_quantity integer not null default 1
    check (initial_stock_quantity > 0 and stock_quantity <= initial_stock_quantity),
  max_quantity_per_user integer not null default 10 check (max_quantity_per_user > 0),
  arrival_status text not null default 'scheduled'
    check (arrival_status in ('scheduled', 'arrived', 'cancelled')),
  arrived_at timestamptz,
  barcode_value text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bundle_id, product_id)
);

create index if not exists bundle_items_bundle_idx on public.bundle_items(bundle_id);
create index if not exists bundle_items_product_idx on public.bundle_items(product_id);

drop trigger if exists bundle_items_set_updated_at on public.bundle_items;
create trigger bundle_items_set_updated_at
  before update on public.bundle_items
  for each row execute procedure public.set_updated_at();

-- 5. 주문/신청: 고객이 실제로 신청한 내역과 수령 상태
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  bundle_item_id uuid not null references public.bundle_items(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  unit_price integer not null check (unit_price >= 0),
  total_amount integer not null check (total_amount >= 0),
  payment_type text not null
    check (payment_type in ('onsite', 'transfer')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'confirmed', 'cancelled', 'refunded')),
  status text not null default 'applied'
    check (status in ('applied', 'ready', 'completed', 'expired', 'cancelled')),
  pickup_date date not null,
  pickup_time_label text not null default '오후 7시 이후',
  pickup_postponed_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_user_created_idx
  on public.orders(user_id, created_at desc);
create index if not exists orders_user_status_idx
  on public.orders(user_id, status);
create index if not exists orders_pickup_date_idx
  on public.orders(pickup_date);
create index if not exists orders_bundle_item_idx
  on public.orders(bundle_item_id);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute procedure public.set_updated_at();

-- 재입고 알림 신청: 품절 상품별 수요와 신청자 명단
create table if not exists public.restock_subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  is_active boolean not null default true,
  request_type text not null default 'restock'
    check (request_type in ('restock', 'waitlist')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create unique index if not exists restock_subscriptions_id_uidx
  on public.restock_subscriptions(id);
create index if not exists restock_subscriptions_product_idx
  on public.restock_subscriptions(product_id, request_type, is_active);

-- 검색 랭킹 원본 이벤트: 백엔드에서만 기록하고 집계합니다.
create table if not exists public.search_events (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_term text not null
    check (char_length(normalized_term) between 2 and 40),
  created_at timestamptz not null default now()
);

create index if not exists search_events_created_at_idx
  on public.search_events(created_at desc);
create index if not exists search_events_term_created_idx
  on public.search_events(normalized_term, created_at desc);
create index if not exists search_events_user_term_created_idx
  on public.search_events(user_id, normalized_term, created_at desc);

create table if not exists public.recommended_search_terms (
  id bigint generated by default as identity primary key,
  term text not null unique
    check (char_length(term) between 2 and 40),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recommended_search_terms_active_order_idx
  on public.recommended_search_terms(is_active, sort_order, created_at);

-- 실구매 후기와 관리자 답글/블라인드 상태
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

create index if not exists reviews_product_idx
  on public.reviews(product_id, is_visible, created_at desc);

-- 6. 노쇼 기록: 횟수만 덮어쓰지 않고 어떤 주문에서 발생했는지 보존
create table if not exists public.no_show_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists no_show_events_user_idx
  on public.no_show_events(user_id, created_at desc);

-- 7. 찜
create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index if not exists favorites_user_created_idx
  on public.favorites(user_id, created_at desc);

-- 8. 문의/답변: 현재 기획처럼 문의당 관리자 답변 1개
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  content text not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'answered', 'closed')),
  answer text,
  answered_by uuid references auth.users(id) on delete set null,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inquiries_user_created_idx
  on public.inquiries(user_id, created_at desc);
create index if not exists inquiries_status_idx
  on public.inquiries(status, created_at);

drop trigger if exists inquiries_set_updated_at on public.inquiries;
create trigger inquiries_set_updated_at
  before update on public.inquiries
  for each row execute procedure public.set_updated_at();

-- 9. 사이트 안 알림: dedupe_key로 같은 이벤트 중복 발송 방지
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null
    check (type in (
      'arrival', 'inquiry_answer', 'order_cancelled', 'pickup',
      'payment_reminder', 'payment_confirmed', 'restock', 'contact_request',
      'waitlist_promoted', 'bundle_opened', 'admin_notice'
    )),
  title text not null,
  body text not null,
  link text,
  dedupe_key text not null,
  read_at timestamptz,
  push_sent_at timestamptz,
  push_attempt_count integer not null default 0 check (push_attempt_count >= 0),
  push_last_error text,
  push_next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications(user_id, read_at)
  where read_at is null;

-- 10. 웹 푸시 기기: 한 회원이 여러 기기를 쓸 수 있음
create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists web_push_subscriptions_user_idx
  on public.web_push_subscriptions(user_id, is_active);

drop trigger if exists web_push_subscriptions_set_updated_at on public.web_push_subscriptions;
create trigger web_push_subscriptions_set_updated_at
  before update on public.web_push_subscriptions
  for each row execute procedure public.set_updated_at();

-- ------------------------------------------------------------
-- 권한과 RLS
-- ------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.bundles enable row level security;
alter table public.bundle_items enable row level security;
alter table public.orders enable row level security;
alter table public.no_show_events enable row level security;
alter table public.favorites enable row level security;
alter table public.inquiries enable row level security;
alter table public.notifications enable row level security;
alter table public.web_push_subscriptions enable row level security;
alter table public.search_events enable row level security;
alter table public.recommended_search_terms enable row level security;
alter table public.restock_subscriptions enable row level security;
alter table public.reviews enable row level security;

-- 기존 정책이 있으면 재실행 가능하도록 삭제
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_update_own_or_admin" on public.profiles;
drop policy if exists "products_read_active" on public.products;
drop policy if exists "products_admin_all" on public.products;
drop policy if exists "bundles_read_visible" on public.bundles;
drop policy if exists "bundles_admin_all" on public.bundles;
drop policy if exists "bundle_items_read_visible" on public.bundle_items;
drop policy if exists "bundle_items_admin_all" on public.bundle_items;
drop policy if exists "orders_select_own_or_admin" on public.orders;
drop policy if exists "orders_insert_own" on public.orders;
drop policy if exists "orders_admin_all" on public.orders;
drop policy if exists "no_show_select_own_or_admin" on public.no_show_events;
drop policy if exists "no_show_admin_all" on public.no_show_events;
drop policy if exists "favorites_own_all" on public.favorites;
drop policy if exists "inquiries_select_own_or_admin" on public.inquiries;
drop policy if exists "inquiries_insert_own" on public.inquiries;
drop policy if exists "inquiries_admin_all" on public.inquiries;
drop policy if exists "notifications_select_own" on public.notifications;
drop policy if exists "notifications_update_own" on public.notifications;
drop policy if exists "notifications_admin_all" on public.notifications;
drop policy if exists "push_subscriptions_own_all" on public.web_push_subscriptions;
drop policy if exists "restock_own_or_admin" on public.restock_subscriptions;
drop policy if exists "reviews_read_visible" on public.reviews;
drop policy if exists "reviews_insert_own" on public.reviews;
drop policy if exists "reviews_admin_all" on public.reviews;

create policy "profiles_select_own_or_admin"
on public.profiles for select to authenticated
using ((select auth.uid()) = id or public.is_admin());

create policy "profiles_update_own_or_admin"
on public.profiles for update to authenticated
using ((select auth.uid()) = id or public.is_admin())
with check ((select auth.uid()) = id or public.is_admin());

create policy "products_read_active"
on public.products for select to anon, authenticated
using (is_active = true or public.is_admin());

create policy "products_admin_all"
on public.products for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "bundles_read_visible"
on public.bundles for select to anon, authenticated
using (status <> 'draft' or public.is_admin());

create policy "bundles_admin_all"
on public.bundles for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "bundle_items_read_visible"
on public.bundle_items for select to anon, authenticated
using (
  exists (
    select 1 from public.bundles b
    where b.id = bundle_id and b.status <> 'draft'
  )
  or public.is_admin()
);

create policy "bundle_items_admin_all"
on public.bundle_items for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "orders_select_own_or_admin"
on public.orders for select to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

create policy "orders_insert_own"
on public.orders for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "orders_admin_all"
on public.orders for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "no_show_select_own_or_admin"
on public.no_show_events for select to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

create policy "no_show_admin_all"
on public.no_show_events for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "favorites_own_all"
on public.favorites for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "inquiries_select_own_or_admin"
on public.inquiries for select to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

create policy "inquiries_insert_own"
on public.inquiries for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "inquiries_admin_all"
on public.inquiries for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "notifications_select_own"
on public.notifications for select to authenticated
using ((select auth.uid()) = user_id);

create policy "notifications_update_own"
on public.notifications for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "notifications_admin_all"
on public.notifications for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "push_subscriptions_own_all"
on public.web_push_subscriptions for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "restock_own_or_admin"
on public.restock_subscriptions for all to authenticated
using ((select auth.uid()) = user_id or public.is_admin())
with check ((select auth.uid()) = user_id or public.is_admin());

create policy "reviews_read_visible"
on public.reviews for select to anon, authenticated
using (is_visible = true or (select auth.uid()) = user_id or public.is_admin());

create policy "reviews_insert_own"
on public.reviews for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "reviews_admin_all"
on public.reviews for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- 기본 권한: 실제 행 접근 가능 여부는 위 RLS가 최종 판단
grant usage on schema public to anon, authenticated;
grant select on public.products, public.bundles, public.bundle_items to anon;
grant select on public.reviews to anon;
grant select on public.products, public.bundles, public.bundle_items to authenticated;
grant select on public.profiles, public.orders, public.no_show_events,
  public.favorites, public.inquiries, public.notifications,
  public.web_push_subscriptions to authenticated;
grant select on public.restock_subscriptions, public.reviews to authenticated;
grant insert on public.orders, public.favorites, public.inquiries,
  public.web_push_subscriptions to authenticated;
grant insert, update, delete on public.restock_subscriptions to authenticated;
grant insert on public.reviews to authenticated;
grant delete on public.favorites, public.web_push_subscriptions to authenticated;

revoke all on public.search_events from anon, authenticated;
grant all privileges on public.search_events to service_role;
grant usage, select on sequence public.search_events_id_seq to service_role;
revoke all on public.recommended_search_terms from anon, authenticated;
grant all privileges on public.recommended_search_terms to service_role;
grant usage, select on sequence public.recommended_search_terms_id_seq to service_role;
grant update (name, phone) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (endpoint, p256dh, auth_key, user_agent, is_active)
  on public.web_push_subscriptions to authenticated;

-- 백엔드 Secret key가 사용하는 service_role 권한
-- service_role은 RLS를 우회하지만 PostgreSQL 테이블 권한은 별도로 필요합니다.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- 고객 화면에 표시되는 운영 문구를 관리자가 수정할 수 있도록 저장합니다.
create table if not exists public.site_content (
  key text primary key,
  content jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_content enable row level security;
revoke all on table public.site_content from anon, authenticated;
grant all on table public.site_content to service_role;

insert into public.site_content (key, content)
values (
  'fruit_hero',
  jsonb_build_object(
    'title', '오늘 매장에 들어온 과일',
    'description', '오늘 매장에 준비된 신선 과일을 한눈에 확인해 보세요.'
  )
)
on conflict (key) do nothing;

commit;
