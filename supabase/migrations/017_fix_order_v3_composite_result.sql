begin;

create or replace function public.create_customer_order_v3(
  p_user_id uuid,
  p_bundle_item_id uuid,
  p_quantity integer,
  p_payment_type text,
  p_pickup_date date,
  p_pickup_time_label text,
  p_depositor_name text,
  p_request_key text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_key text := nullif(trim(p_request_key), '');
begin
  if v_key is null then
    raise exception '주문 요청 식별값이 필요합니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_key, 0));

  select *
  into v_order
  from public.orders
  where user_id = p_user_id
    and request_key = v_key
  limit 1;

  if found then
    return v_order;
  end if;

  v_order := public.create_customer_order_v2(
    p_user_id,
    p_bundle_item_id,
    p_quantity,
    p_payment_type,
    p_pickup_date,
    p_pickup_time_label,
    p_depositor_name
  );

  update public.orders
  set request_key = v_key
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

grant execute on function public.create_customer_order_v3(
  uuid, uuid, integer, text, date, text, text, text
) to service_role;

commit;
