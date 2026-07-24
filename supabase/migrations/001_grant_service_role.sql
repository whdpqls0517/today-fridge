-- 이미 schema.sql을 실행한 프로젝트에서 발생하는
-- "permission denied for table profiles" 오류 수정

begin;

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

commit;
