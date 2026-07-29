-- 보따리 사입 확정 및 대기 자동 주문에 대한 고객의 전자적 동의 기록
alter table public.orders
  add column if not exists procurement_policy_consent_at timestamptz,
  add column if not exists procurement_policy_version text;

alter table public.restock_subscriptions
  add column if not exists procurement_policy_consent_at timestamptz,
  add column if not exists procurement_policy_version text,
  add column if not exists waitlist_auto_order_consent_at timestamptz;

comment on column public.orders.procurement_policy_consent_at is
  '신청 마감 후 사입 확정에 따른 취소·청약철회 제한을 고객이 확인한 시각';
comment on column public.orders.procurement_policy_version is
  '고객이 확인한 사입·취소 정책 문구 버전';
comment on column public.restock_subscriptions.waitlist_auto_order_consent_at is
  '대기 수량 배정 시 자동 주문 접수에 동의한 시각';
