create table if not exists public.pickup_guides (
  id uuid primary key default gen_random_uuid(),
  pickup_date date not null unique,
  title text not null default '보따리 수령 안내',
  content text not null default '',
  image_urls text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pickup_guides_date_idx
  on public.pickup_guides(pickup_date desc, is_active);

drop trigger if exists pickup_guides_set_updated_at on public.pickup_guides;
create trigger pickup_guides_set_updated_at
  before update on public.pickup_guides
  for each row execute procedure public.set_updated_at();

alter table public.pickup_guides enable row level security;
revoke all on public.pickup_guides from anon, authenticated;
grant all on public.pickup_guides to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pickup-guide-images',
  'pickup-guide-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
