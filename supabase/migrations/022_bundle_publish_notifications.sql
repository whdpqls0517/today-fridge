begin;

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'arrival', 'inquiry_answer', 'order_cancelled', 'pickup',
    'payment_reminder', 'payment_confirmed', 'restock', 'contact_request',
    'waitlist_promoted', 'bundle_opened'
  ));

commit;
