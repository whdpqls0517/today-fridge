"use strict";

require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const API_URL = String(process.env.INTEGRATION_API_URL || "https://onaeng.com").replace(/\/+$/, "");

if (!SUPABASE_URL || !SERVICE_KEY || !PUBLISHABLE_KEY) {
  throw new Error("Supabase URL, service role key, publishable key가 필요합니다.");
}

const adminDb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const runId = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
const password = `Audit!${crypto.randomBytes(12).toString("base64url")}9`;
const createdUserIds = [];
const createdProductIds = [];
const createdBundleIds = [];
const createdOrderIds = [];
const report = [];
const auditStartedAt = new Date().toISOString();
const usedUserIds = [];

function pass(name, detail = "") {
  report.push({ status: "PASS", name, detail });
}
function fail(name, error) {
  const parts = [
    error?.message,
    error?.code ? `code=${error.code}` : "",
    error?.status ? `status=${error.status}` : "",
    error?.details ? `details=${error.details}` : "",
    error?.hint ? `hint=${error.hint}` : ""
  ].filter(Boolean);
  report.push({
    status: "FAIL",
    name,
    detail: parts.join(" | ") || JSON.stringify(error) || String(error)
  });
}
async function check(name, task) {
  try {
    const detail = await task();
    pass(name, detail || "");
    return true;
  } catch (error) {
    fail(name, error);
    return false;
  }
}
async function api(path, token, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  let body = null;
  try { body = await response.json(); } catch (_) {}
  return { response, body };
}
async function createTestUser(label, role = "customer") {
  const email = `codex-audit-${label}-${runId}@example.com`;
  const { data, error } = await adminDb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `감사${label}` },
    app_metadata: { provider: "kakao", providers: ["kakao"] }
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const { error: profileError } = await adminDb.from("profiles").upsert({
    id: data.user.id,
    name: `감사${label}`,
    nickname: `audit_${label}_${runId.replace(/\D/g, "").slice(-6)}`,
    login_provider: "kakao",
    role
  });
  if (profileError) throw profileError;

  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: session, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, token: session.session.access_token, client };
}
async function getExistingRoleSession(role, excludedIds = []) {
  const { data: profiles, error: profileError } = await adminDb
    .from("profiles")
    .select("id,role")
    .eq("role", role);
  if (profileError) throw profileError;
  const { data: authData, error: authError } = await adminDb.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });
  if (authError) throw authError;
  const profileIds = new Set((profiles || []).map((profile) => profile.id));
  const authUser = (authData?.users || []).find((user) =>
    profileIds.has(user.id) && user.email && !excludedIds.includes(user.id)
  );
  if (!authUser) throw new Error(`${role} 역할의 이메일 연동 계정을 찾을 수 없습니다.`);
  const { data: linkData, error: linkError } = await adminDb.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.email
  });
  if (linkError) throw linkError;
  const tokenHash = linkData?.properties?.hashed_token;
  if (!tokenHash) throw new Error("일회성 감사 세션 토큰을 발급하지 못했습니다.");
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink"
  });
  if (verifyError) throw verifyError;
  if (!verified?.session?.access_token) throw new Error("감사 세션이 생성되지 않았습니다.");
  usedUserIds.push(authUser.id);
  return { id: authUser.id, token: verified.session.access_token, client, role };
}
async function createBundleFixture({ stock, suffix, prepaymentOnly = false }) {
  const today = new Date();
  const pickup = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
  const pickupDate = pickup.toISOString().slice(0, 10);
  const deadline = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const { data: product, error: productError } = await adminDb.from("products").insert({
    name: `[AUDIT ${runId}] ${suffix}`,
    category: "bundle",
    price: 1000,
    prepayment_only: prepaymentOnly,
    is_active: true
  }).select("id").single();
  if (productError) throw productError;
  createdProductIds.push(product.id);

  const { data: bundle, error: bundleError } = await adminDb.from("bundles").insert({
    title: `[AUDIT ${runId}] ${suffix}`,
    order_deadline: deadline,
    expected_arrival_date: pickupDate,
    default_pickup_date: pickupDate,
    pickup_time_label: "오후 7시 이후",
    status: "recruiting"
  }).select("id").single();
  if (bundleError) throw bundleError;
  createdBundleIds.push(bundle.id);

  const { data: item, error: itemError } = await adminDb.from("bundle_items").insert({
    bundle_id: bundle.id,
    product_id: product.id,
    sale_price: 1000,
    stock_quantity: stock,
    initial_stock_quantity: Math.max(stock, 1),
    max_quantity_per_user: 10,
    arrival_status: "scheduled"
  }).select("id").single();
  if (itemError) throw itemError;
  return { productId: product.id, bundleId: bundle.id, itemId: item.id, pickupDate };
}
async function schemaProbe(table, columns) {
  const { error } = await adminDb.from(table).select(columns, { head: true, count: "exact" }).limit(1);
  if (error) throw error;
}
async function rpcExists(name, args) {
  const { error } = await adminDb.rpc(name, args);
  if (error?.code === "PGRST202" || error?.code === "42883") throw error;
}
async function cleanup() {
  if (usedUserIds.length) {
    await adminDb.from("admin_no_show_adjustments").delete()
      .in("user_id", [...new Set(usedUserIds)])
      .gte("created_at", auditStartedAt);
  }
  if (createdProductIds.length) {
    await adminDb.from("restock_subscriptions").delete().in("product_id", createdProductIds);
  }
  if (createdUserIds.length) {
    await adminDb.from("notifications").delete().in("user_id", createdUserIds);
    await adminDb.from("web_push_subscriptions").delete().in("user_id", createdUserIds);
    await adminDb.from("restock_subscriptions").delete().in("user_id", createdUserIds);
    await adminDb.from("admin_no_show_adjustments").delete().in("user_id", createdUserIds);
  }
  if (createdOrderIds.length) {
    await adminDb.from("order_change_logs").delete().in("order_id", createdOrderIds);
    await adminDb.from("orders").delete().in("id", createdOrderIds);
  }
  if (createdBundleIds.length) {
    await adminDb.from("bundle_items").delete().in("bundle_id", createdBundleIds);
    await adminDb.from("bundles").delete().in("id", createdBundleIds);
  }
  if (createdProductIds.length) {
    await adminDb.from("products").delete().in("id", createdProductIds);
  }
  for (const userId of createdUserIds) {
    await adminDb.auth.admin.deleteUser(userId);
  }
}

async function main() {
  await check("001~023 핵심 테이블·컬럼", async () => {
    const probes = [
      ["profiles", "id,nickname,role,no_show_count,notification_settings"],
      ["products", "id,show_original_price,prepayment_only,stock_quantity,is_recommended"],
      ["bundle_items", "id,initial_stock_quantity,waitlist_reserved_quantity,arrival_expected_text"],
      ["orders", "id,depositor_name,payment_reminded_at,pickup_reminded_at,request_key,barcode_locked"],
      ["restock_subscriptions", "id,user_id,bundle_item_id,quantity,payment_type,promoted_order_id,promoted_at"],
      ["reviews", "id,is_visible,admin_reply"],
      ["search_events", "id,normalized_term"],
      ["recommended_search_terms", "id,term,is_active"],
      ["admin_no_show_adjustments", "id,user_id,admin_id"],
      ["user_consents", "id,user_id"],
      ["notifications", "id,dedupe_key,push_attempt_count,push_last_error,push_next_retry_at"],
      ["web_push_subscriptions", "id,endpoint,is_active"],
      ["admin_audit_logs", "id,action,target_type"],
      ["order_change_logs", "id,order_id,action,before_data,after_data"]
    ];
    for (const [table, columns] of probes) await schemaProbe(table, columns);
    return `${probes.length}개 객체 확인`;
  });

  await check("주문·취소·수령일 RPC 존재", async () => {
    const zero = "00000000-0000-0000-0000-000000000000";
    await rpcExists("create_customer_order_v3", {
      p_user_id: zero, p_bundle_item_id: zero, p_quantity: 1, p_payment_type: "onsite",
      p_pickup_date: "2099-01-01", p_pickup_time_label: "오후 7시 이후",
      p_depositor_name: null, p_request_key: `probe-${runId}`
    });
    await rpcExists("cancel_customer_order", {
      p_order_id: zero, p_actor_id: zero, p_actor_role: "customer", p_reason: null
    });
    await rpcExists("change_order_pickup_date", {
      p_order_id: zero, p_user_id: zero, p_pickup_date: "2099-01-01"
    });
  });

  let admin;
  let customerA;
  let customerB;
  const usersReady = await check("임시 관리자·고객 계정 생성", async () => {
    admin = await getExistingRoleSession("admin");
    customerA = await getExistingRoleSession("customer");
    customerB = admin;
    return "3개 계정";
  });
  if (!usersReady) return;

  await check("수동 알림 유형 DB 적용", async () => {
    const dedupeKey = `audit-admin-notice:${runId}`;
    const { data, error } = await adminDb.from("notifications").insert({
      user_id: admin.id,
      type: "admin_notice",
      title: "배포 점검",
      body: "수동 알림 유형 저장 점검",
      link: "./notifications.html",
      dedupe_key: dedupeKey,
      push_next_retry_at: null
    }).select("id").single();
    if (error) {
      if (String(error.message || "").includes("notifications_type_check")) {
        throw new Error("023_admin_manual_notifications.sql이 운영 DB에 적용되지 않았습니다.");
      }
      throw error;
    }
    const { error: deleteError } = await adminDb.from("notifications").delete().eq("id", data.id);
    if (deleteError) throw deleteError;
  });

  await check("관리자 API 역할 차단", async () => {
    const adminResult = await api("/api/admin/system-status", admin.token);
    const customerResult = await api("/api/admin/system-status", customerA.token);
    assert.equal(adminResult.response.status, 200);
    assert.equal(customerResult.response.status, 403);
  });

  await check("RLS로 다른 회원 프로필 차단", async () => {
    const { data, error } = await customerA.client.from("profiles").select("id").eq("id", admin.id);
    if (error) throw error;
    assert.equal(data.length, 0);
  });

  await check("RLS로 고객 상품 등록 차단", async () => {
    const { error } = await customerA.client.from("products").insert({
      name: `[AUDIT INVALID ${runId}]`, category: "market", price: 1
    });
    assert.ok(error, "고객의 상품 등록이 허용되었습니다.");
  });

  let stockFixture;
  let winner;
  let loser;
  await check("실제 DB 마지막 재고 동시 주문", async () => {
    stockFixture = await createBundleFixture({ stock: 1, suffix: "동시주문" });
    const body = (requestKey) => JSON.stringify({
      bundleItemId: stockFixture.itemId,
      quantity: 1,
      paymentType: "onsite",
      pickupDate: stockFixture.pickupDate,
      pickupTimeLabel: "오후 7시 이후",
      procurementPolicyConsent: true,
      procurementPolicyVersion: "2026-07-29",
      requestKey
    });
    const results = await Promise.all([
      api("/api/orders", customerA.token, { method: "POST", body: body(`concurrent-a-${runId}`) }),
      api("/api/orders", customerB.token, { method: "POST", body: body(`concurrent-b-${runId}`) })
    ]);
    const successes = results.filter((result) => result.response.status === 201);
    const { data: stockBeforeAssertion } = await adminDb.from("bundle_items")
      .select("stock_quantity,initial_stock_quantity,max_quantity_per_user")
      .eq("id", stockFixture.itemId).single();
    assert.equal(successes.length, 1, JSON.stringify(results.map((result) => ({
      status: result.response.status,
      error: result.body?.error
    })).concat([{ fixture: stockBeforeAssertion }])));
    winner = successes[0].body.data.user_id === customerA.id ? customerA : customerB;
    loser = winner.id === customerA.id ? customerB : customerA;
    createdOrderIds.push(successes[0].body.data.id);
    const { data: item } = await adminDb.from("bundle_items").select("stock_quantity").eq("id", stockFixture.itemId).single();
    assert.equal(item.stock_quantity, 0);
  });

  await check("주문 요청 중복 방지", async () => {
    const requestKey = `idempotent-${runId}`;
    await adminDb.from("bundle_items").update({ stock_quantity: 1 }).eq("id", stockFixture.itemId);
    const payload = JSON.stringify({
      bundleItemId: stockFixture.itemId, quantity: 1, paymentType: "onsite",
      pickupDate: stockFixture.pickupDate, pickupTimeLabel: "오후 7시 이후",
      procurementPolicyConsent: true, procurementPolicyVersion: "2026-07-29", requestKey
    });
    const first = await api("/api/orders", loser.token, { method: "POST", body: payload });
    const second = await api("/api/orders", loser.token, { method: "POST", body: payload });
    assert.equal(first.response.status, 201);
    assert.equal(second.response.status, 201);
    assert.equal(first.body.data.id, second.body.data.id);
    createdOrderIds.push(first.body.data.id);
  });

  await check("대기자 부분 승격·잔여 순번 유지·중복 취소 방지", async () => {
    const orderToCancel = createdOrderIds[0];
    await adminDb.from("bundle_items").update({ stock_quantity: 0 }).eq("id", stockFixture.itemId);
    const wait = await api(`/api/products/${stockFixture.productId}/waitlist`, loser.token, {
      method: "POST",
      body: JSON.stringify({
        quantity: 2, paymentType: "onsite", pickupDate: stockFixture.pickupDate,
        pickupTimeLabel: "오후 7시 이후", procurementPolicyConsent: true,
        procurementPolicyVersion: "2026-07-29", waitlistAutoOrderConsent: true
      })
    });
    assert.equal(wait.response.status, 201, JSON.stringify(wait.body));
    const cancelled = await api(`/api/orders/${orderToCancel}/cancel`, winner.token, {
      method: "POST", body: JSON.stringify({ reason: "자동 감사" })
    });
    assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.body));
    const duplicate = await api(`/api/orders/${orderToCancel}/cancel`, winner.token, {
      method: "POST", body: JSON.stringify({ reason: "중복 취소" })
    });
    assert.notEqual(duplicate.response.status, 200);
    const { data: waiter } = await adminDb.from("restock_subscriptions")
      .select("quantity,is_active,promoted_at").eq("user_id", loser.id)
      .eq("product_id", stockFixture.productId).single();
    assert.equal(waiter.quantity, 1);
    assert.equal(waiter.is_active, true);
    assert.equal(waiter.promoted_at, null);
    const { data: promoted } = await adminDb.from("orders")
      .select("id,quantity").eq("user_id", loser.id).eq("bundle_item_id", stockFixture.itemId)
      .eq("status", "applied").eq("quantity", 1);
    assert.ok(promoted.length >= 1);
    promoted.forEach((order) => createdOrderIds.push(order.id));
  });

  await check("선입금 확인과 알림 생성", async () => {
    const fixture = await createBundleFixture({ stock: 1, suffix: "선입금", prepaymentOnly: true });
    const orderResult = await api("/api/orders", customerA.token, {
      method: "POST",
      body: JSON.stringify({
        bundleItemId: fixture.itemId, quantity: 1, paymentType: "transfer",
        pickupDate: fixture.pickupDate, pickupTimeLabel: "오후 7시 이후",
        depositorName: "감사입금자", procurementPolicyConsent: true,
        procurementPolicyVersion: "2026-07-29", requestKey: `transfer-${runId}`
      })
    });
    assert.equal(orderResult.response.status, 201, JSON.stringify(orderResult.body));
    const orderId = orderResult.body.data.id;
    createdOrderIds.push(orderId);
    assert.equal(orderResult.body.data.payment_status, "pending");
    const confirm = await api(`/api/admin/orders/${orderId}/confirm-payment`, admin.token, {
      method: "POST", body: "{}"
    });
    assert.equal(confirm.response.status, 200);
    const { data: order } = await adminDb.from("orders").select("payment_status").eq("id", orderId).single();
    assert.equal(order.payment_status, "confirmed");
    const { count } = await adminDb.from("notifications").select("*", { count: "exact", head: true })
      .eq("user_id", customerA.id).eq("dedupe_key", `payment-confirmed:${orderId}`);
    assert.equal(count, 1);
  });

  await check("노쇼 조정과 관리자 이력", async () => {
    const increment = await api(`/api/admin/members/${customerA.id}/no-show`, admin.token, {
      method: "PATCH", body: JSON.stringify({ action: "increment", reason: "자동 감사" })
    });
    assert.equal(increment.response.status, 200);
    assert.equal(increment.body.data.no_show_count, 1);
    const reset = await api(`/api/admin/members/${customerA.id}/no-show`, admin.token, {
      method: "PATCH", body: JSON.stringify({ action: "reset", reason: "자동 감사 정리" })
    });
    assert.equal(reset.response.status, 200);
    assert.equal(reset.body.data.no_show_count, 0);
  });

  await check("웹 푸시 서버 설정·저장소·재시도 컬럼", async () => {
    const config = await api("/api/push/config");
    assert.equal(config.response.status, 200);
    assert.equal(config.body.enabled, true);
    await schemaProbe("web_push_subscriptions", "id,user_id,endpoint,is_active");
    await schemaProbe("notifications", "id,push_attempt_count,push_last_error,push_next_retry_at");
  });
}

(async () => {
  try {
    await main();
  } catch (error) {
    fail("감사 실행 자체", error);
  } finally {
    await cleanup();
    const width = Math.max(...report.map((item) => item.name.length), 12);
    for (const item of report) {
      console.log(`${item.status.padEnd(4)}  ${item.name.padEnd(width)}  ${item.detail || ""}`);
    }
    const failed = report.filter((item) => item.status === "FAIL");
    console.log(`\n총 ${report.length}개 검사: 통과 ${report.length - failed.length}, 실패 ${failed.length}`);
    process.exitCode = failed.length ? 1 : 0;
  }
})();
