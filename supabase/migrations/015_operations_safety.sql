begin;

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs(created_at desc);
create index if not exists admin_audit_logs_target_idx
  on public.admin_audit_logs(target_type, target_id, created_at desc);
alter table public.admin_audit_logs enable row level security;
grant select, insert on public.admin_audit_logs to service_role;
grant usage, select on sequence public.admin_audit_logs_id_seq to service_role;

create table if not exists public.order_change_logs (
  id bigint generated always as identity primary key,
  order_id uuid,
  actor_id uuid,
  actor_role text,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_change_logs_order_idx
  on public.order_change_logs(order_id, created_at desc);
alter table public.order_change_logs enable row level security;
grant select, insert on public.order_change_logs to service_role;
grant usage, select on sequence public.order_change_logs_id_seq to service_role;

create or replace function public.log_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.order_change_logs (
    order_id, actor_id, actor_role, action, before_data, after_data
  ) values (
    coalesce(new.id, old.id),
    auth.uid(),
    case when auth.uid() is null then 'server' else 'authenticated' end,
    tg_op,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists orders_change_audit on public.orders;
create trigger orders_change_audit
after insert or update or delete on public.orders
for each row execute function public.log_order_change();

alter table public.orders
  add column if not exists request_key text;

-- 회원탈퇴 시 결제·재고 증빙용 주문은 익명 상태로 보존합니다.
alter table public.orders alter column user_id drop not null;
alter table public.orders drop constraint if exists orders_user_id_fkey;
alter table public.orders
  add constraint orders_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

create unique index if not exists orders_user_request_key_unique
  on public.orders(user_id, request_key)
  where request_key is not null;

create unique index if not exists orders_order_number_unique
  on public.orders(order_number);

create index if not exists orders_pending_transfer_idx
  on public.orders(payment_status, status, created_at)
  where payment_type = 'transfer' and payment_status = 'pending';

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

  select * into v_order
  from public.orders
  where user_id = p_user_id and request_key = v_key
  limit 1;

  if found then
    return v_order;
  end if;

  select public.create_customer_order_v2(
    p_user_id,
    p_bundle_item_id,
    p_quantity,
    p_payment_type,
    p_pickup_date,
    p_pickup_time_label,
    p_depositor_name
  ) into v_order;

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
