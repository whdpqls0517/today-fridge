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
