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
  assert.match(server, /const queued = await upsertNotifications\(rows\)/);
  assert.match(server, /resolveAdminNotificationProduct/);
  assert.match(server, /action:\s*'manual_notification_sent'/);
  const admin = read("public/js/admin.js");
  assert.match(admin, /async function verifyNotificationRecipients/);
  assert.match(admin, /const verifiedPreview = await verifyNotificationRecipients\(\)/);
  assert.match(admin, /notificationLink\?\.addEventListener\("change", syncNotificationAudienceFields\)/);
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

test("웹 푸시는 권한 허용 후 서버 구독 누락을 자동 복구하고 실제 등록 상태를 확인한다", () => {
  const server = read("server.js");
  const onboarding = read("public/js/push-onboarding.js");
  const myPage = read("public/js/my-page.js");
  assert.match(server, /\/api\/push\/subscriptions\/status/);
  assert.match(onboarding, /Notification\.permission\s*===\s*"granted"[\s\S]*?subscribe\(token\)/);
  assert.match(onboarding, /applicationServerKey[\s\S]*?unsubscribe\(\)/);
  assert.match(myPage, /pushRegistered/);
  assert.match(myPage, /알림 연결 필요/);
});

test("고객 알림 설정은 개별 항목 없이 전체 알림 토글 하나만 사용한다", () => {
  const server = read("server.js");
  const myPage = read("public/js/my-page.js");
  assert.match(myPage, /data-all-notifications/);
  assert.doesNotMatch(myPage, /data-setting=/);
  assert.match(server, /notificationSettings\.enabled/);
  assert.match(server, /arrival:\s*enabled[\s\S]*inquiry:\s*enabled[\s\S]*important:\s*enabled/);
});

test("오늘의 과일 후기는 판매 글이 아닌 과일 종류에 누적된다", () => {
  const server = read("server.js");
  const migration = read("supabase/migrations/024_fruit_types_and_reviews.sql");
  const form = read("public/js/admin-product-form.js");
  const reviewWrite = read("public/js/review-write.js");
  assert.match(migration, /create table if not exists public\.fruit_types/);
  assert.match(migration, /add column if not exists fruit_type_id/);
  assert.match(server, /app\.post\('\/api\/admin\/fruit-types'/);
  assert.match(server, /fruit_type_id:\s*fruitTypeId/);
  assert.match(server, /todayStartedAt/);
  assert.match(form, /fruitTypeId/);
  assert.match(reviewWrite, /openReviewMode/);
});

test("매장 상품 후기는 주문 없이 작성하고 보따리는 완료 주문을 요구한다", () => {
  const server = read("server.js");
  const reviewWrite = read("public/js/review-write.js");
  const home = read("public/index.html");
  assert.match(server, /if \(productId && !orderId\)/);
  assert.match(server, /\.eq\('category', 'market'\)/);
  assert.match(server, /order\.status !== 'completed'/);
  assert.match(reviewWrite, /api\/catalog\?category=market/);
  assert.match(reviewWrite, /productId: fruitSelect\.value\.slice\(7\)/);
  assert.match(home, /후기 작성/);
});

test("보따리는 선택한 과일 종류의 후기와 연결되고 오늘의 과일 가격은 단일·다중 입력을 모두 지원한다", () => {
  const server = read("server.js");
  const form = read("public/js/admin-product-form.js");
  const detail = read("public/product-detail.html");
  assert.match(server, /\['fruit', 'bundle'\]\.includes\(body\.category\)/);
  assert.match(server, /bundle_items\(product_id, products\(fruit_type_id\)\)/);
  assert.match(server, /fruit_type_id:\s*order\.bundle_items\.products\?\.fruit_type_id/);
  assert.match(form, /\["fruit", "bundle"\]\.includes\(category\)/);
  assert.match(form, /enteredPrice\s*\|\|\s*Number\(configuredFruitPrices\[0\]/);
  assert.match(detail, /if \(currentProduct\?\.fruitTypeId\)/);
});

test("오늘의 과일 일괄 등록 가격 구성은 상세·목록에서 인식되는 가격 형식으로 저장한다", () => {
  const bulkFruitScript = read("public/js/admin-fruit-bulk.js");
  assert.match(bulkFruitScript, /return\s*\{\s*type:\s*["']price["'],\s*title,\s*price\s*\}/);
  assert.match(bulkFruitScript, /const\s+enteredPrice\s*=\s*Number\(value\(["']price["']\)\)\s*\|\|\s*0/);
  assert.match(bulkFruitScript, /const\s+price\s*=\s*enteredPrice\s*\|\|\s*Number\(priceOptions\[0\]\?\.price\s*\|\|\s*0\)/);
});

test("찜은 상세·목록·찜 페이지에서 동일한 서버 저장소를 사용한다", () => {
  const server = read("server.js");
  const detail = read("public/product-detail.html");
  const favorites = read("public/js/favorites.js");
  assert.match(server, /app\.put\('\/api\/favorites\/:productId'/);
  assert.match(server, /app\.delete\('\/api\/favorites\/:productId'/);
  assert.match(detail, /js\/favorites\.js/);
  assert.match(detail, /await window\.Favorites\.toggle\(currentProduct\.id\)/);
  assert.doesNotMatch(detail, /localStorage\.getItem\("fridge_favorites"\)/);
  assert.match(favorites, /\/api\/favorites\/\$\{encodeURIComponent\(productId\)\}/);
});

test("인기상품은 실제 차감된 보따리 수량까지 반영하고 목록에서 원형 배지로 표시한다", () => {
  const server = read("server.js");
  const rules = read("public/js/product-rules.js");
  const cardCss = read("public/css/product-card.css");
  assert.match(server, /reservedQuantity\s*=\s*bundleItem\s*\?\s*Math\.max\(0, initialStock - currentStock\)/);
  assert.match(server, /salesCount\s*=\s*Math\.max\(Number\(product\.sales_count \|\| 0\), reservedQuantity\)/);
  assert.match(rules, /if \(sales >= 3\)/);
  assert.match(cardCss, /\.popular-badge\.popular[\s\S]*?width:\s*36px\s*!important[\s\S]*?border-radius:\s*50%\s*!important/);
});

test("옵션형 보따리는 옵션별 가격·재고를 잠그고 선택 목록으로 주문한다", () => {
  const migration = read("supabase/migrations/026_bundle_item_options.sql");
  const server = read("server.js");
  const adminForm = read("public/js/admin-product-form.js");
  const detail = read("public/product-detail.html");
  const apply = read("public/js/bundle-apply.js");
  assert.match(migration, /create table if not exists public\.bundle_item_options/);
  assert.match(migration, /from public\.bundle_item_options[\s\S]*?for update/);
  assert.match(migration, /restore_cancelled_bundle_option_stock/);
  assert.match(server, /create_customer_bundle_order_v4/);
  assert.match(server, /Math\.min\(\.\.\.options\.map\(\(option\) => option\.price\)\)/);
  assert.match(adminForm, /여러 옵션으로 판매|bundleOptionName/);
  assert.match(detail, /bundle-option-sheet/);
  assert.match(apply, /items: selectedItems\.map/);
});
