begin;

-- 현재 프론트 상품 카드·상세·관리자 화면에서 사용하는 공통 필드
alter table public.profiles
  add column if not exists no_show_count integer not null default 0
    check (no_show_count >= 0),
  add column if not exists notification_settings jsonb not null
    default '{"arrival":true,"inquiry":true,"important":true}'::jsonb;

alter table public.products
  add column if not exists external_key text unique,
  add column if not exists product_category text not null default 'etc',
  add column if not exists detail_description text,
  add column if not exists detail_specs jsonb not null default '[]'::jsonb,
  add column if not exists market_guide text,
  add column if not exists stock_quantity integer not null default 0
    check (stock_quantity >= 0),
  add column if not exists initial_stock_quantity integer not null default 1
    check (initial_stock_quantity > 0),
  add column if not exists sales_count integer not null default 0
    check (sales_count >= 0),
  add column if not exists rating numeric(2,1) not null default 0
    check (rating between 0 and 5),
  add column if not exists reviews_count integer not null default 0
    check (reviews_count >= 0),
  add column if not exists is_recommended boolean not null default false;

alter table public.bundle_items
  add column if not exists arrival_expected_text text;

alter table public.orders
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_by text
    check (cancelled_by is null or cancelled_by in ('customer', 'admin')),
  add column if not exists barcode_locked boolean not null default false;

-- 보따리 주문 생성과 재고 차감을 하나의 트랜잭션으로 처리
create or replace function public.create_customer_order(
  p_user_id uuid,
  p_bundle_item_id uuid,
  p_quantity integer,
  p_payment_type text,
  p_pickup_date date
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.bundle_items;
  v_bundle public.bundles;
  v_order public.orders;
  v_no_show_count integer;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception '신청 수량은 1개 이상이어야 합니다.';
  end if;
  if p_payment_type not in ('onsite', 'transfer') then
    raise exception '지원하지 않는 결제 방식입니다.';
  end if;

  select * into v_item
  from public.bundle_items
  where id = p_bundle_item_id
  for update;
  if not found then raise exception '상품을 찾지 못했습니다.'; end if;

  select * into v_bundle
  from public.bundles
  where id = v_item.bundle_id;
  if not found or v_bundle.status <> 'recruiting' or now() > v_bundle.order_deadline then
    raise exception '신청이 마감된 보따리입니다.';
  end if;
  if v_item.arrival_status = 'cancelled' then
    raise exception '판매가 취소된 상품입니다.';
  end if;
  if p_quantity > v_item.max_quantity_per_user then
    raise exception '1인 최대 신청 수량을 초과했습니다.';
  end if;
  if v_item.stock_quantity < p_quantity then
    raise exception '남은 수량이 부족합니다.';
  end if;
  if p_pickup_date < current_date then
    raise exception '지난 날짜는 수령일로 지정할 수 없습니다.';
  end if;

  select coalesce(no_show_count, 0) into v_no_show_count
  from public.profiles where id = p_user_id;
  if p_payment_type = 'onsite' and coalesce(v_no_show_count, 0) >= 3 then
    raise exception '노쇼 누적으로 현장결제를 신청할 수 없습니다.';
  end if;

  update public.bundle_items
  set stock_quantity = stock_quantity - p_quantity
  where id = p_bundle_item_id;

  insert into public.orders (
    order_number, user_id, bundle_item_id, quantity,
    unit_price, total_amount, payment_type, payment_status,
    status, pickup_date, pickup_time_label
  )
  values (
    'TF-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    p_user_id, p_bundle_item_id, p_quantity,
    v_item.sale_price, v_item.sale_price * p_quantity,
    p_payment_type,
    case when p_payment_type = 'onsite' then 'pending' else 'pending' end,
    case when v_item.arrival_status = 'arrived' then 'ready' else 'applied' end,
    p_pickup_date, '오후 7시 이후'
  )
  returning * into v_order;

  return v_order;
end;
$$;

-- 고객/관리자 취소와 재고 복구를 하나의 트랜잭션으로 처리
create or replace function public.cancel_customer_order(
  p_order_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_item public.bundle_items;
  v_bundle public.bundles;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception '주문을 찾지 못했습니다.'; end if;
  if p_actor_role = 'customer' and v_order.user_id <> p_actor_id then
    raise exception '본인의 주문만 취소할 수 있습니다.';
  end if;
  if v_order.status not in ('applied', 'ready') then
    raise exception '현재 취소할 수 없는 주문입니다.';
  end if;

  select * into v_item from public.bundle_items where id = v_order.bundle_item_id for update;
  select * into v_bundle from public.bundles where id = v_item.bundle_id;
  if p_actor_role = 'customer' and now() > v_bundle.order_deadline then
    raise exception '신청 마감 후에는 고객이 직접 취소할 수 없습니다.';
  end if;

  update public.bundle_items
  set stock_quantity = least(initial_stock_quantity, stock_quantity + v_order.quantity)
  where id = v_order.bundle_item_id;

  update public.orders
  set status = 'cancelled',
      payment_status = case
        when payment_status = 'confirmed' then 'refunded'
        else 'cancelled'
      end,
      cancelled_at = now(),
      cancellation_reason = nullif(trim(p_reason), ''),
      cancelled_by = p_actor_role,
      barcode_locked = true
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.change_order_pickup_date(
  p_order_id uuid,
  p_user_id uuid,
  p_pickup_date date
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if p_pickup_date < current_date then
    raise exception '지난 날짜는 수령일로 지정할 수 없습니다.';
  end if;
  update public.orders
  set pickup_date = p_pickup_date,
      pickup_postponed_at = now()
  where id = p_order_id
    and user_id = p_user_id
    and status in ('applied', 'ready')
  returning * into v_order;
  if not found then raise exception '수령일을 변경할 수 없는 주문입니다.'; end if;
  return v_order;
end;
$$;

create or replace function public.complete_customer_order(
  p_order_id uuid,
  p_user_id uuid
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  update public.orders
  set status = 'completed', received_at = now(), barcode_locked = true
  where id = p_order_id
    and user_id = p_user_id
    and status = 'ready'
    and (payment_type = 'onsite' or payment_status = 'confirmed')
  returning * into v_order;
  if not found then raise exception '현재 수령 완료 처리할 수 없는 주문입니다.'; end if;
  return v_order;
end;
$$;

grant execute on function public.create_customer_order(uuid, uuid, integer, text, date) to service_role;
grant execute on function public.cancel_customer_order(uuid, uuid, text, text) to service_role;
grant execute on function public.change_order_pickup_date(uuid, uuid, date) to service_role;
grant execute on function public.complete_customer_order(uuid, uuid) to service_role;

commit;
