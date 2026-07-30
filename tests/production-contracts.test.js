"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("운영 주문 함수에는 동시 주문 잠금과 중복 요청 방지가 있다", () => {
  const migration = read("supabase/migrations/015_operations_safety.sql");
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /request_key/i);
  assert.match(migration, /unique/i);
});

test("대기 승격 SQL은 첫 순번 부분 배정과 잔여 수량 유지를 지원한다", () => {
  const migration = read("supabase/migrations/014_partial_waitlist_promotion.sql");
  assert.match(migration, /least\s*\(\s*coalesce\s*\(\s*v_waiter\.quantity\s*,\s*1\s*\)\s*,\s*v_reserved\s*\)/i);
  assert.match(migration, /quantity\s*=\s*coalesce\s*\(\s*v_waiter\.quantity\s*,\s*1\s*\)\s*-\s*v_allocated/i);
  assert.match(migration, /while\s+v_reserved\s*>\s*0/i);
});

test("실제 수령증 코드가 취소 주문을 제외하고 미입금 대기와 현장결제 우선을 처리한다", () => {
  const receipt = read("public/js/receipt.js");
  assert.match(receipt, /\["cancelled",\s*"canceled"\]/);
  assert.match(receipt, /String\s*\(\s*order\.paymentStatus[\s\S]*?toLowerCase\(\)\s*!==\s*"cancelled"/);
  assert.match(receipt, /isAwaitingPayment[\s\S]*?transferApproved\s*!==\s*true/);
  assert.match(receipt, /!isAwaitingPayment/);
  assert.match(receipt, /currentOrder\.paymentType\s*===\s*"onsite"/);
  assert.match(receipt, /lifecycleGroup[\s\S]*?"completed"[\s\S]*?"active"/);
  assert.match(receipt, /complete\/undo/);
});

test("서버의 오늘 통계는 한국 시간 변환 함수를 사용한다", () => {
  const server = read("server.js");
  assert.match(server, /function\s+kstDateTimeParts/);
  assert.match(server, /kstDateTimeParts\s*\(\s*new Date\(\)\s*\)/);
  assert.match(server, /\+09:00/);
});

test("수령 완료 되돌리기는 본인의 직전 완료 주문만 서버에서 복구한다", () => {
  const server = read("server.js");
  assert.match(server, /\/api\/orders\/:id\/complete\/undo/);
  assert.match(server, /\.eq\('user_id',\s*req\.user\.id\)/);
  assert.match(server, /\.gte\('received_at',\s*undoDeadline\)/);
  assert.match(server, /customer_receipt_completion_undone/);
});

test("새 보따리는 최초 공개 시에만 전체 회원 알림을 예약한다", () => {
  const server = read("server.js");
  const form = read("public/js/admin-product-form.js");
  const migration = read("supabase/migrations/022_bundle_publish_notifications.sql");
  assert.match(server, /async function\s+notifyCustomersOfNewBundle/);
  assert.match(server, /dedupe_key:\s*`bundle-opened:\$\{product\.id\}`/);
  assert.match(server, /const delivered = await upsertNotifications\(rows\)/);
  assert.match(server, /\.in\('role', \['customer', 'admin'\]\)/);
  assert.match(server, /beforeProduct\?\.isActive\s*===\s*false/);
  assert.match(server, /ignoreDuplicates:\s*true/);
  assert.match(form, /sendPublishNotification/);
  assert.match(migration, /bundle_opened/);
});

test("관리자 수동 알림은 권한 보호·대상 재계산·중복 방지를 적용한다", () => {
  const server = read("server.js");
  const migration = read("supabase/migrations/023_admin_manual_notifications.sql");
  assert.match(server, /app\.post\('\/api\/admin\/notifications\/preview', \.\.\.adminOnly/);
  assert.match(server, /app\.post\('\/api\/admin\/notifications\/send', \.\.\.adminOnly/);
  assert.match(server, /resolveAdminNotificationAudience/);
  assert.match(server, /dedupe_key:\s*`admin-notice:\$\{requestKey\}`/);
  assert.match(server, /action:\s*'manual_notification_sent'/);
  assert.match(migration, /admin_notice/);
});

test("푸시 구독이 알림보다 늦게 완료돼도 최근 미전송 알림을 다시 보낸다", () => {
  const server = read("server.js");
  assert.match(server, /recentSince/);
  assert.match(server, /\.is\('push_sent_at', null\)/);
  assert.match(server, /recentNotifications\.map\(deliverPushNotification\)/);
});

test("계좌번호와 송금 링크는 프론트엔드에 하드코딩하지 않는다", () => {
  const server = read("server.js");
  const complete = read("public/js/bundle-apply-complete.js");
  const history = read("public/js/order-history.js");
  assert.doesNotMatch(complete, /\b3333011234567\b|supertoss:\/\/send|kakaotalk:\/\/kakaopay/);
  assert.doesNotMatch(history, /\b3333011234567\b|supertoss:\/\/send|kakaotalk:\/\/kakaopay/);
  assert.match(server, /app\.get\('\/api\/payment-info', requireAuth/);
  assert.match(server, /PAYMENT_ACCOUNT_NUMBER/);
});
