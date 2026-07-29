-- 관리자 회원별 노쇼 스택 수동 조정 이력

create table if not exists public.admin_no_show_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  admin_id uuid not null references auth.users(id) on delete restrict,
  previous_count integer not null check (previous_count >= 0),
  next_count integer not null check (next_count >= 0),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists admin_no_show_adjustments_user_created_idx
  on public.admin_no_show_adjustments(user_id, created_at desc);

alter table public.admin_no_show_adjustments enable row level security;

drop policy if exists "admin_no_show_adjustments_admin_only"
  on public.admin_no_show_adjustments;

create policy "admin_no_show_adjustments_admin_only"
on public.admin_no_show_adjustments for select to authenticated
using (public.is_admin());

grant select on public.admin_no_show_adjustments to authenticated;
grant all privileges on public.admin_no_show_adjustments to service_role;
