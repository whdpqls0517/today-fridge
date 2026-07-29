-- 소셜 로그인 회원의 서비스용 고유 닉네임

alter table public.profiles
  add column if not exists nickname text;

create unique index if not exists profiles_nickname_unique
  on public.profiles(lower(nickname))
  where nickname is not null and trim(nickname) <> '';

alter table public.profiles
  drop constraint if exists profiles_nickname_format_check;

alter table public.profiles
  add constraint profiles_nickname_format_check
  check (
    nickname is null
    or nickname ~ '^[가-힣A-Za-z0-9_]{2,12}$'
  );

grant update (nickname, name) on public.profiles to authenticated;
