# 관리자 계정과 카카오 로그인 설정

아래 작업은 Supabase/Kakao 계정 소유자만 할 수 있으므로 직접 설정해야 합니다.

## 1. 데이터베이스 테이블 생성

아직 실행하지 않았다면 Supabase SQL Editor에서 `schema.sql` 전체를 실행합니다.

## 2. Supabase에서 카카오 로그인 켜기

1. Supabase Dashboard에서 **Authentication**을 엽니다.
2. **Sign In / Providers**에서 **Kakao**를 선택합니다.
3. 화면에 표시되는 Callback URL을 복사합니다.
4. Kakao Developers에서 애플리케이션을 생성합니다.
5. 카카오 로그인과 OpenID Connect를 활성화합니다.
6. 복사한 Supabase Callback URL을 Kakao Redirect URI에 등록합니다.
7. 카카오 REST API 키와 Client Secret을 Supabase Kakao Provider에 입력합니다.

## 3. 웹사이트 Redirect URL 등록

Supabase Dashboard의 **Authentication > URL Configuration**에서:

- Site URL: `https://onaeng.com`
- Redirect URLs:
  - `https://onaeng.com/login.html`
  - `https://onaeng.com/login.html?next=my-page`
  - `https://onaeng.com/login.html?next=admin`

운영 배포 후에는 localhost 주소 대신 실제 HTTPS 도메인도 추가해야 합니다.

Google 로그인을 함께 사용할 경우 Google Cloud의 OAuth 클라이언트에도
Supabase Dashboard의 Google Provider 화면에 표시되는 Callback URL을
**승인된 리디렉션 URI**로 등록해야 합니다.

## 4. Publishable key 추가

Supabase Dashboard의 프로젝트 API 설정에서 Publishable key를 복사합니다.
프로젝트 `.env`에 다음 한 줄을 추가합니다.

```env
SUPABASE_PUBLISHABLE_KEY=복사한_publishable_key
```

`SUPABASE_SERVICE_ROLE_KEY`와 혼동하면 안 됩니다. service role 키는 브라우저에 절대 넣지 않습니다.
이전 Supabase 프로젝트에서 `anon key`라는 이름만 보인다면 아래 이름으로 넣어도 서버가 인식합니다.

```env
SUPABASE_ANON_KEY=복사한_anon_key
```

선택 사항으로 `.env`에 허용 주소도 지정할 수 있습니다.

```env
ALLOWED_ORIGINS=https://onaeng.com,https://www.onaeng.com
```

## 5. 서버 재시작

`.env`를 바꾼 뒤 실행 중인 서버를 종료하고 다시 실행합니다.

```powershell
npm start
```

이제 페이지는 `file://`가 아니라 아래 주소로 엽니다.

```text
https://onaeng.com/index.html
```

## 6. 최초 관리자 지정

1. `https://onaeng.com/login.html`에서 사장님 카카오 계정으로 한 번 로그인합니다.
2. Supabase Dashboard의 Authentication > Users에서 생성된 회원을 확인합니다.
3. SQL Editor에서 아래 SQL을 실행합니다.

```sql
update public.profiles
set role = 'admin'
where id = (
  select id
  from auth.users
  where email = '사장님 카카오 계정 이메일'
);
```

카카오에서 이메일 제공에 동의하지 않아 이메일이 없다면 Authentication > Users에서 UUID를 복사해 실행합니다.

```sql
update public.profiles
set role = 'admin'
where id = '복사한-회원-UUID';
```

## 7. 확인

- 일반 회원: 마이페이지에 관리자 센터가 보이지 않아야 합니다.
- 일반 회원이 `admin.html`을 직접 입력: 고객 화면으로 이동해야 합니다.
- 관리자: 마이페이지에 관리자 센터가 표시되어야 합니다.
- 로그인하지 않은 사용자: 로그인 페이지로 이동해야 합니다.
- 관리자 API를 토큰 없이 호출: HTTP 401
- 일반 회원 토큰으로 호출: HTTP 403
