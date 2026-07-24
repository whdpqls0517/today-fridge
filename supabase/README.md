# 오늘의 냉장고 Supabase 설정

## 1. 테이블 만들기

1. Supabase 프로젝트를 엽니다.
2. 왼쪽 메뉴에서 **SQL Editor**를 누릅니다.
3. **New query**를 누릅니다.
4. 이 폴더의 `schema.sql` 내용을 전부 복사해 붙여 넣습니다.
5. 오른쪽 아래 **Run**을 누릅니다.
6. `Success. No rows returned`가 보이면 완료입니다.

## 2. 제대로 만들어졌는지 확인

왼쪽 **Table Editor**에 아래 10개 테이블이 보이면 정상입니다.

- `profiles`
- `products`
- `bundles`
- `bundle_items`
- `orders`
- `no_show_events`
- `favorites`
- `inquiries`
- `notifications`
- `web_push_subscriptions`

Supabase가 관리하는 `auth.users`는 별도의 인증용 회원 테이블이며 직접 만들지 않습니다.

## 3. 첫 관리자 지정

카카오 로그인을 한 번 완료한 다음 SQL Editor에서 아래 SQL을 실행합니다.
이메일 부분은 실제 사장님 로그인 이메일로 바꿉니다.

```sql
update public.profiles
set role = 'admin'
where id = (
  select id
  from auth.users
  where email = '사장님이메일@example.com'
);
```

관리자 권한은 브라우저에서 직접 바꾸게 만들면 안 됩니다.

## 4. 기존 테스트 API 수정 필요

현재 `server.js`의 `/api/test`는 존재하지 않는 `items` 테이블을 조회합니다.
테이블 생성 뒤에는 실제 API를 `products`, `bundles`, `orders` 등에 맞춰 연결해야 합니다.

## 5. 중요한 보안 규칙

- `SUPABASE_SERVICE_ROLE_KEY`는 `.env`와 백엔드 서버에만 둡니다.
- HTML이나 브라우저용 JS에 service role 키를 넣지 않습니다.
- 브라우저에는 Supabase의 publishable key만 사용할 수 있습니다.
- 회원별 데이터에는 RLS를 항상 켜둡니다.
