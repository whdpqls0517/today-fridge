-- 보따리 품절 대기 신청 정보와 취소 수량 자동 승급 처리

alter table public.bundle_items
  add column if not exists waitlist_reserved_quantity integer not null default 0
    check (waitlist_reserved_quantity >= 0);

alter table public.restock_subscriptions
  add column if not exists bundle_item_id uuid references public.bundle_items(id) on delete cascade,
  add column if not exists quantity integer check (quantity is null or quantity > 0),
  add column if not exists payment_type text
    check (payment_type is null or payment_type in ('onsite', 'transfer')),
  add column if not exists pickup_date date,
  add column if not exists pickup_time_label text,
  add column if not exists depositor_name text,
  add column if not exists promoted_order_id uuid references public.orders(id) on delete set null,
  add column if not exists promoted_at timestamptz;

create index if not exists restock_waitlist_fifo_idx
  on public.restock_subscriptions(product_id, created_at)
  where request_type = 'waitlist' and is_active = true;

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'arrival', 'inquiry_answer', 'order_cancelled', 'pickup',
    'payment_reminder', 'payment_confirmed', 'restock', 'contact_request',
    'waitlist_promoted'
  ));

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
  v_waiter public.restock_subscriptions;
  v_promoted_order public.orders;
  v_reserved integer;
  v_allocated integer;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then raise exception '주문을 찾지 못했습니다.'; end if;
  if p_actor_role = 'customer' and v_order.user_id <> p_actor_id then
    raise exception '본인의 주문만 취소할 수 있습니다.';
  end if;
  if v_order.status not in ('applied', 'ready') then
    raise exception '현재 취소할 수 없는 주문입니다.';
  end if;

  select * into v_item
  from public.bundle_items
  where id = v_order.bundle_item_id
  for update;

  select * into v_bundle
  from public.bundles
  where id = v_item.bundle_id;

  if p_actor_role = 'customer' and now() > v_bundle.order_deadline then
    raise exception '신청 마감 후에는 고객이 직접 취소할 수 없습니다.';
  end if;

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

  -- 활성 대기자가 없으면 기존처럼 바로 일반 재고로 복구합니다.
  if not exists (
    select 1
    from public.restock_subscriptions
    where product_id = v_item.product_id
      and request_type = 'waitlist'
      and is_active = true
      and promoted_at is null
  ) then
    update public.bundle_items
    set stock_quantity = least(initial_stock_quantity, stock_quantity + v_order.quantity)
    where id = v_item.id;
    return v_order;
  end if;

  -- 대기자가 있으면 취소 수량을 일반 재고에 노출하지 않고 대기 승급용으로 보관합니다.
  v_reserved := coalesce(v_item.waitlist_reserved_quantity, 0) + v_order.quantity;

  while v_reserved > 0 loop
    select * into v_waiter
    from public.restock_subscriptions
    where product_id = v_item.product_id
      and request_type = 'waitlist'
      and is_active = true
      and promoted_at is null
    order by created_at asc
    limit 1
    for update skip locked;

    if not found then
      update public.bundle_items
      set stock_quantity = least(initial_stock_quantity, stock_quantity + v_reserved),
          waitlist_reserved_quantity = 0
      where id = v_item.id;
      exit;
    end if;

    -- 확보된 수량이 신청 수량보다 적어도 첫 대기자에게 먼저 부분 배정합니다.
    v_allocated := least(coalesce(v_waiter.quantity, 1), v_reserved);

    insert into public.orders (
      order_number, user_id, bundle_item_id, quantity,
      unit_price, total_amount, payment_type, payment_status, status,
      pickup_date, pickup_time_label, depositor_name
    )
    values (
      'WAIT-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text, 1, 6),
      v_waiter.user_id,
      v_item.id,
      v_allocated,
      v_item.sale_price,
      v_item.sale_price * v_allocated,
      coalesce(v_waiter.payment_type, 'onsite'),
      'pending',
      'applied',
      coalesce(v_waiter.pickup_date, v_bundle.default_pickup_date),
      coalesce(v_waiter.pickup_time_label, '오후 7시 이후'),
      nullif(trim(v_waiter.depositor_name), '')
    )
    returning * into v_promoted_order;

    if v_allocated < coalesce(v_waiter.quantity, 1) then
      -- 일부만 확보된 경우 남은 수량으로 같은 선착순 자리를 유지합니다.
      update public.restock_subscriptions
      set quantity = coalesce(v_waiter.quantity, 1) - v_allocated,
          updated_at = now()
      where id = v_waiter.id;
    else
      update public.restock_subscriptions
      set is_active = false,
          promoted_at = now(),
          promoted_order_id = v_promoted_order.id,
          updated_at = now()
      where id = v_waiter.id;
    end if;

    insert into public.notifications (
      user_id, type, title, body, link, dedupe_key
    )
    values (
      v_waiter.user_id,
      'waitlist_promoted',
      case
        when v_allocated < coalesce(v_waiter.quantity, 1)
          then '대기 수량 일부가 먼저 배정되었어요'
        else '대기 신청이 주문으로 전환되었어요'
      end,
      case
        when v_allocated < coalesce(v_waiter.quantity, 1) and v_waiter.payment_type = 'transfer'
          then coalesce(v_waiter.quantity, 1) || '개 대기 중 ' || v_allocated || '개가 우선 배정되었습니다. 남은 '
            || (coalesce(v_waiter.quantity, 1) - v_allocated) || '개는 같은 순번으로 계속 대기합니다. 주문 내역에서 입금 정보를 확인해 주세요.'
        when v_allocated < coalesce(v_waiter.quantity, 1)
          then coalesce(v_waiter.quantity, 1) || '개 대기 중 ' || v_allocated || '개가 우선 배정되었습니다. 남은 '
            || (coalesce(v_waiter.quantity, 1) - v_allocated) || '개는 같은 순번으로 계속 대기합니다. 주문 내역을 확인해 주세요.'
        when v_waiter.payment_type = 'transfer'
          then v_allocated || '개가 모두 배정되었습니다. 주문 내역에서 입금 정보를 확인해 주세요.'
        else v_allocated || '개가 모두 배정되었습니다. 주문 내역을 확인해 주세요.'
      end,
      './order-history.html',
      'waitlist-promoted:' || v_promoted_order.id
    )
    on conflict (user_id, dedupe_key) do nothing;

    v_reserved := v_reserved - v_allocated;
  end loop;

  update public.bundle_items
  set waitlist_reserved_quantity = v_reserved
  where id = v_item.id;

  return v_order;
end;
$$;

grant execute on function public.cancel_customer_order(uuid, uuid, text, text)
  to service_role;
