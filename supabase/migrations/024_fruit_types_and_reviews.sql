-- 오늘의 과일 판매 글과 영구 보존되는 과일 종류/후기를 분리합니다.
create table if not exists public.fruit_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (
    lower(regexp_replace(trim(name), '[[:space:]]+', '', 'g'))
  ) stored,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_name)
);

alter table public.products
  add column if not exists fruit_type_id uuid references public.fruit_types(id) on delete set null;

alter table public.reviews
  add column if not exists fruit_type_id uuid references public.fruit_types(id) on delete restrict;

alter table public.reviews alter column product_id drop not null;

alter table public.reviews drop constraint if exists reviews_target_check;
alter table public.reviews add constraint reviews_target_check check (
  product_id is not null or fruit_type_id is not null
);

create index if not exists products_fruit_type_idx on public.products(fruit_type_id);
create index if not exists reviews_fruit_type_idx
  on public.reviews(fruit_type_id, is_visible, created_at desc);

alter table public.fruit_types enable row level security;

drop policy if exists "fruit_types_read_active" on public.fruit_types;
create policy "fruit_types_read_active"
on public.fruit_types for select to anon, authenticated
using (is_active = true or public.is_admin());

drop policy if exists "fruit_types_admin_all" on public.fruit_types;
create policy "fruit_types_admin_all"
on public.fruit_types for all to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.fruit_types to anon, authenticated;
grant all privileges on public.fruit_types to service_role;

-- 기존 오늘의 과일 상품명별로 종류를 만들고 연결합니다.
insert into public.fruit_types (name)
select distinct trim(name)
from public.products
where category = 'fruit' and trim(coalesce(name, '')) <> ''
on conflict (normalized_name) do nothing;

update public.products p
set fruit_type_id = ft.id
from public.fruit_types ft
where p.category = 'fruit'
  and p.fruit_type_id is null
  and lower(regexp_replace(trim(p.name), '[[:space:]]+', '', 'g')) = ft.normalized_name;

-- 기존 과일 후기도 판매 글이 사라져도 종류 기준으로 남도록 연결합니다.
update public.reviews r
set fruit_type_id = p.fruit_type_id
from public.products p
where r.product_id = p.id
  and p.category = 'fruit'
  and r.fruit_type_id is null;
