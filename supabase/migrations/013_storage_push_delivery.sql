begin;

alter table public.profiles
  alter column notification_settings
  set default '{"arrival":true,"inquiry":true,"important":true}'::jsonb;

update public.profiles
set notification_settings =
  '{"arrival":true,"inquiry":true,"important":true}'::jsonb
  || coalesce(notification_settings, '{}'::jsonb)
where not (coalesce(notification_settings, '{}'::jsonb) ? 'important');

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

-- 브라우저의 익명/인증 키로는 직접 접근하지 못하고,
-- 서비스 롤을 사용하는 백엔드 API에서만 관리합니다.
alter table public.web_push_subscriptions enable row level security;

alter table public.notifications
  add column if not exists push_attempt_count integer not null default 0
    check (push_attempt_count >= 0),
  add column if not exists push_last_error text,
  add column if not exists push_next_retry_at timestamptz;

create index if not exists notifications_push_retry_idx
  on public.notifications(push_next_retry_at)
  where push_sent_at is null and push_next_retry_at is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-images',
  'review-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
