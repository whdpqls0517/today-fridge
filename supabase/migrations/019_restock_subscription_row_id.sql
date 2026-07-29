begin;

alter table public.restock_subscriptions
  add column if not exists id uuid default gen_random_uuid();

update public.restock_subscriptions
set id = gen_random_uuid()
where id is null;

alter table public.restock_subscriptions
  alter column id set default gen_random_uuid(),
  alter column id set not null;

create unique index if not exists restock_subscriptions_id_uidx
  on public.restock_subscriptions(id);

commit;
