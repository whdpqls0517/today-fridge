begin;

alter table public.bundle_items
  add column if not exists initial_stock_quantity integer;

update public.bundle_items
set initial_stock_quantity = greatest(stock_quantity, 1)
where initial_stock_quantity is null;

alter table public.bundle_items
  alter column initial_stock_quantity set not null,
  alter column initial_stock_quantity set default 1;

alter table public.bundle_items
  drop constraint if exists bundle_items_initial_stock_quantity_check;
alter table public.bundle_items
  add constraint bundle_items_initial_stock_quantity_check
  check (initial_stock_quantity > 0 and stock_quantity <= initial_stock_quantity);

alter table public.restock_subscriptions
  add column if not exists request_type text not null default 'restock';

alter table public.restock_subscriptions
  drop constraint if exists restock_subscriptions_request_type_check;
alter table public.restock_subscriptions
  add constraint restock_subscriptions_request_type_check
  check (request_type in ('restock', 'waitlist'));

drop index if exists public.restock_subscriptions_product_idx;
create index restock_subscriptions_product_idx
  on public.restock_subscriptions(product_id, request_type, is_active);

commit;
