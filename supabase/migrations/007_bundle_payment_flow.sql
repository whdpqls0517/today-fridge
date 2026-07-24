begin;

alter table public.products
  add column if not exists prepayment_only boolean not null default false;

alter table public.orders
  add column if not exists depositor_name text,
  add column if not exists payment_reminded_at timestamptz,
  add column if not exists pickup_reminded_at timestamptz;

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
  if p_quantity is null or p_quantity < 1 then raise exception '신청 수량을 확인해 주세요.'; end if;
  if p_payment_type not in ('onsite', 'transfer') then raise exception '결제 방식을 확인해 주세요.'; end if;
  if p_pickup_time_label not in ('오후 7시 이전', '오후 7시 이후') then raise exception '수령 시간을 확인해 주세요.'; end if;

  select * into v_item from public.bundle_items where id = p_bundle_item_id for update;
  if not found then raise exception '상품을 찾지 못했습니다.'; end if;
  select * into v_bundle from public.bundles where id = v_item.bundle_id;
  select * into v_product from public.products where id = v_item.product_id;

  if v_bundle.status <> 'recruiting' or now() > v_bundle.order_deadline then raise exception '신청이 마감된 보따리입니다.'; end if;
  if v_product.prepayment_only and p_payment_type <> 'transfer' then raise exception '이 상품은 선결제만 가능합니다.'; end if;
  if v_item.stock_quantity < p_quantity then raise exception '남은 수량이 부족합니다.'; end if;
  if p_quantity > v_item.max_quantity_per_user then raise exception '1인 최대 신청 수량을 초과했습니다.'; end if;

  select coalesce(no_show_count, 0) into v_no_show_count from public.profiles where id = p_user_id;
  if p_payment_type = 'onsite' and coalesce(v_no_show_count, 0) >= 3 then raise exception '노쇼 누적으로 현장결제를 신청할 수 없습니다.'; end if;

  update public.bundle_items set stock_quantity = stock_quantity - p_quantity where id = p_bundle_item_id;
  insert into public.orders (
    order_number, user_id, bundle_item_id, quantity, unit_price, total_amount,
    payment_type, payment_status, status, pickup_date, pickup_time_label, depositor_name
  ) values (
    'TF-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), p_user_id, p_bundle_item_id,
    p_quantity, v_item.sale_price, v_item.sale_price * p_quantity, p_payment_type,
    case when p_payment_type = 'onsite' then 'pending' else 'pending' end,
    case when p_payment_type = 'onsite' and v_item.arrival_status = 'arrived' then 'ready' else 'applied' end,
    p_pickup_date, p_pickup_time_label, nullif(trim(p_depositor_name), '')
  ) returning * into v_order;
  return v_order;
end;
$$;

grant execute on function public.create_customer_order_v2(uuid, uuid, integer, text, date, text, text) to service_role;

commit;
