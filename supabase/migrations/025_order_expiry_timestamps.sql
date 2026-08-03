alter table public.orders
  add column if not exists expired_at timestamptz,
  add column if not exists restored_at timestamptz;

update public.orders as orders
set expired_at = coalesce(
  (
    select min(events.created_at)
    from public.no_show_events as events
    where events.order_id = orders.id
  ),
  orders.updated_at
)
where orders.status = 'expired'
  and orders.expired_at is null;

create index if not exists orders_expired_at_idx
  on public.orders(expired_at desc)
  where expired_at is not null;

create index if not exists orders_restored_at_idx
  on public.orders(restored_at desc)
  where restored_at is not null;
