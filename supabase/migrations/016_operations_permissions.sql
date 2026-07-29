begin;

grant select, insert on public.admin_audit_logs to service_role;
grant usage, select on sequence public.admin_audit_logs_id_seq to service_role;
grant select, insert on public.order_change_logs to service_role;
grant usage, select on sequence public.order_change_logs_id_seq to service_role;

commit;
