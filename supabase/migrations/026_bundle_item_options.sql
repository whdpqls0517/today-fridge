begin;

create table if not exists public.bundle_item_options (
  id uuid primary key default gen_random_uuid(),
  bundle_item_id uuid not null references public.bundle_items(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  sale_price integer not null check (sale_price >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  initial_stock_quantity integer not null default 1
    check (initial_stock_quantity > 0 and stock_quantity <= initial_stock_quantity),
  max_quantity_per_user integer not null default 10 check (max_quantity_per_user > 0),
  barcode_value text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bundle_item_id, name)
);

create index if not exists bundle_item_options_item_idx
  on public.bundle_item_options(bundle_item_id, is_active, display_order);

alter table public.orders
  add column if not exists bundle_item_option_id uuid
    references public.bundle_item_options(id) on delete restrict,
  add column if not exists option_name text;

create index if not exists orders_bundle_item_option_idx
  on public.orders(bundle_item_option_id);

drop trigger if exists bundle_item_options_set_updated_at on public.bundle_item_options;
create trigger bundle_item_options_set_updated_at
  before update on public.bundle_item_options
  for each row execute procedure public.set_updated_at();

alter table public.bundle_item_options enable row level security;
revoke all on public.bundle_item_options from anon, authenticated;
grant all on public.bundle_item_options to service_role;

create or replace function public.create_customer_bundle_order_v4(
  p_user_id uuid,
  p_bundle_item_id uuid,
  p_items jsonb,
  p_payment_type text,
  p_pickup_date date,
  p_pickup_time_label text,
  p_depositor_name text,
  p_request_key text
)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry jsonb;
  v_option public.bundle_item_options;
  v_order public.orders;
  v_quantity integer;
  v_item_key text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '신청할 옵션을 선택해 주세요.';
  end if;
  if nullif(trim(p_request_key), '') is null then
    raise exception '주문 요청 식별값이 필요합니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || trim(p_request_key), 0));

  for v_entry in select value from jsonb_array_elements(p_items) loop
    v_quantity := greatest(1, coalesce((v_entry->>'quantity')::integer, 1));
    v_item_key := left(trim(p_request_key), 75) || ':' || (v_entry->>'optionId');

    select * into v_order
    from public.orders
    where user_id = p_user_id and request_key = v_item_key
    limit 1;
    if found then
      return next v_order;
      continue;
    end if;

    select * into v_option
    from public.bundle_item_options
    where id = (v_entry->>'optionId')::uuid
      and bundle_item_id = p_bundle_item_id
      and is_active = true
    for update;
    if not found then raise exception '선택한 옵션을 찾지 못했습니다.'; end if;
    if v_quantity > v_option.max_quantity_per_user then
      raise exception '% 옵션의 1인 최대 신청 수량을 초과했습니다.', v_option.name;
    end if;
    if v_option.stock_quantity < v_quantity then
      raise exception '% 옵션의 남은 수량이 부족합니다.', v_option.name;
    end if;

    v_order := public.create_customer_order_v2(
      p_user_id, p_bundle_item_id, v_quantity, p_payment_type,
      p_pickup_date, p_pickup_time_label, p_depositor_name
    );

    update public.bundle_item_options
    set stock_quantity = stock_quantity - v_quantity
    where id = v_option.id;

    update public.orders
    set bundle_item_option_id = v_option.id,
        option_name = v_option.name,
        unit_price = v_option.sale_price,
        total_amount = v_option.sale_price * v_quantity,
        request_key = v_item_key
    where id = v_order.id
    returning * into v_order;

    return next v_order;
  end loop;
end;
$$;

create or replace function public.restore_cancelled_bundle_option_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('applied', 'ready')
     and new.status = 'cancelled'
     and new.bundle_item_option_id is not null then
    update public.bundle_item_options
    set stock_quantity = least(initial_stock_quantity, stock_quantity + old.quantity)
    where id = new.bundle_item_option_id;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_restore_bundle_option_stock on public.orders;
create trigger orders_restore_bundle_option_stock
  after update of status on public.orders
  for each row execute procedure public.restore_cancelled_bundle_option_stock();

grant execute on function public.create_customer_bundle_order_v4(
  uuid, uuid, jsonb, text, date, text, text, text
) to service_role;

commit;
