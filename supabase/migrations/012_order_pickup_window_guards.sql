begin;

create or replace function public.create_customer_order_v2(
  p_user_id uuid,
  p_bundle_item_id uuid,
  p_quantity integer,
  p_payment_type text,
  p_pickup_date date,
  p_pickup_time_label text,
  p_depositor_name text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.bundle_items;
  v_bundle public.bundles;
  v_product public.products;
  v_order public.orders;
  v_no_show_count integer;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception '신청 수량을 확인해 주세요.';
  end if;
  if p_payment_type not in ('onsite', 'transfer') then
    raise exception '결제 방식을 확인해 주세요.';
  end if;
  if p_pickup_time_label is null or length(trim(p_pickup_time_label)) = 0 then
    raise exception '수령 시간을 확인해 주세요.';
  end if;

  select * into v_item
  from public.bundle_items
  where id = p_bundle_item_id
  for update;
  if not found then raise exception '상품을 찾지 못했습니다.'; end if;

  select * into v_bundle from public.bundles where id = v_item.bundle_id;
  select * into v_product from public.products where id = v_item.product_id;

  if v_bundle.status <> 'recruiting' or now() > v_bundle.order_deadline then
    raise exception '신청이 마감된 보따리입니다.';
  end if;
  if p_pickup_date < v_bundle.default_pickup_date
    or p_pickup_date > v_bundle.default_pickup_date + 6 then
    raise exception '수령일은 지정 수령일부터 7일 안에서 선택해 주세요.';
  end if;
  if v_product.prepayment_only and p_payment_type <> 'transfer' then
    raise exception '이 상품은 선결제만 가능합니다.';
  end if;
  if v_item.stock_quantity < p_quantity then
    raise exception '남은 수량이 부족합니다.';
  end if;
  if p_quantity > v_item.max_quantity_per_user then
    raise exception '1인 최대 신청 수량을 초과했습니다.';
  end if;

  select coalesce(no_show_count, 0)
  into v_no_show_count
  from public.profiles
  where id = p_user_id;
  if p_payment_type = 'onsite' and coalesce(v_no_show_count, 0) >= 3 then
    raise exception '노쇼 누적으로 현장결제를 신청할 수 없습니다.';
  end if;

  update public.bundle_items
  set stock_quantity = stock_quantity - p_quantity
  where id = p_bundle_item_id;

  insert into public.orders (
    order_number, user_id, bundle_item_id, quantity, unit_price, total_amount,
    payment_type, payment_status, status, pickup_date, pickup_time_label, depositor_name
  ) values (
    'TF-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    p_user_id,
    p_bundle_item_id,
    p_quantity,
    v_item.sale_price,
    v_item.sale_price * p_quantity,
    p_payment_type,
    'pending',
    case
      when p_payment_type = 'onsite' and v_item.arrival_status = 'arrived' then 'ready'
      else 'applied'
    end,
    p_pickup_date,
    p_pickup_time_label,
    case when p_payment_type = 'transfer' then nullif(trim(p_depositor_name), '') else null end
  )
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
  v_default_pickup_date date;
begin
  select o.*
  into v_order
  from public.orders o
  where o.id = p_order_id
    and o.user_id = p_user_id
  for update of o;

  if not found or v_order.status not in ('applied', 'ready') then
    raise exception '수령일을 변경할 수 없는 주문입니다.';
  end if;

  select b.default_pickup_date
  into v_default_pickup_date
  from public.bundle_items bi
  join public.bundles b on b.id = bi.bundle_id
  where bi.id = v_order.bundle_item_id;

  if v_default_pickup_date is null then
    raise exception '보따리 수령 기준일을 찾지 못했습니다.';
  end if;

  if p_pickup_date < v_default_pickup_date
    or p_pickup_date > v_default_pickup_date + 6 then
    raise exception '수령일은 지정 수령일부터 7일 안에서 변경해 주세요.';
  end if;

  update public.orders
  set pickup_date = p_pickup_date,
      pickup_postponed_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

grant execute on function public.create_customer_order_v2(uuid, uuid, integer, text, date, text, text)
  to service_role;
grant execute on function public.change_order_pickup_date(uuid, uuid, date)
  to service_role;

commit;
