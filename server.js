require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_CLOUDFLARE_WORKER = process.env.CLOUDFLARE_WORKER === 'true';
const PUBLIC_DIR = IS_CLOUDFLARE_WORKER
  ? '.'
  : process.env.NODE_ENV === 'production'
  ? path.join(__dirname, '.production-public')
  : path.join(__dirname, 'public');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT_INPUT = String(process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();
const VAPID_SUBJECT = VAPID_SUBJECT_INPUT.includes('@') && !VAPID_SUBJECT_INPUT.includes(':')
  ? `mailto:${VAPID_SUBJECT_INPUT}`
  : VAPID_SUBJECT_INPUT;
const PAYMENT_EXPIRY_GRACE_MINUTES = Math.max(0, Number(process.env.PAYMENT_EXPIRY_GRACE_MINUTES) || 0);
const PUBLIC_APP_URL = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
const PAYMENT_BANK_NAME = decodeBase64Korean(process.env.PAYMENT_BANK_NAME);
const PAYMENT_ACCOUNT_NUMBER = String(process.env.PAYMENT_ACCOUNT_NUMBER || '').replace(/[^\d]/g, '');
const PAYMENT_ACCOUNT_HOLDER = decodeBase64Korean(process.env.PAYMENT_ACCOUNT_HOLDER);
const PAYMENT_TOSS_DEEP_LINK = String(process.env.PAYMENT_TOSS_DEEP_LINK || '').trim();
const PAYMENT_KAKAOPAY_DEEP_LINK = String(process.env.PAYMENT_KAKAOPAY_DEEP_LINK || '').trim();
const KAKAO_REQUIRED_TERMS_TAGS = (process.env.KAKAO_REQUIRED_TERMS_TAGS || '')
  .split(',')
  .map((tag) => tag.trim())
  .filter(Boolean);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Supabase 서버 설정이 비어 있습니다. 설정을 복구할 때까지 데이터 API가 제한됩니다.');
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://onaeng.com,https://www.onaeng.com')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('허용되지 않은 요청 출처입니다.'));
  }
}));
app.use(express.json({ limit: '25mb' }));

const supabaseAdmin = createClient(
  SUPABASE_URL || 'https://configuration-required.invalid',
  SERVICE_ROLE_KEY || 'configuration-required',
  {
    auth: { autoRefreshToken: false, persistSession: false }
  }
);

let pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (error) {
    pushEnabled = false;
    console.error('웹 푸시 키 형식이 올바르지 않아 푸시 전송을 비활성화했습니다:', error.message);
  }
}

function pushSettingKey(type) {
  if (['arrival', 'restock', 'waitlist_promoted', 'pickup'].includes(type)) return 'arrival';
  if (['inquiry_answer', 'contact_request'].includes(type)) return 'inquiry';
  if (['payment_confirmed', 'payment_reminder', 'order_cancelled'].includes(type)) return 'important';
  return 'important';
}

async function deliverPushNotification(notification) {
  if (!pushEnabled || !notification?.id || !notification?.user_id || notification.push_sent_at) return;
  const settingKey = pushSettingKey(notification.type);
  if (settingKey) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('notification_settings')
      .eq('id', notification.user_id)
      .maybeSingle();
    const notificationSettings = profile?.notification_settings || {};
    const notificationsDisabled = typeof notificationSettings.enabled === 'boolean'
      ? notificationSettings.enabled === false
      : notificationSettings.all === false || notificationSettings[settingKey] === false;
    if (notificationsDisabled) {
      await supabaseAdmin.from('notifications')
        .update({ push_next_retry_at: null })
        .eq('id', notification.id);
      return;
    }
  }

  const { data: subscriptions, error } = await supabaseAdmin
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth_key')
    .eq('user_id', notification.user_id)
    .eq('is_active', true);
  if (error) throw error;
  if (!subscriptions?.length) {
    await supabaseAdmin.from('notifications')
      .update({ push_next_retry_at: null })
      .eq('id', notification.id);
    return;
  }

  const payload = JSON.stringify({
    notificationId: notification.id,
    title: notification.title,
    body: notification.body,
    link: notification.link || './notifications.html',
    type: notification.type
  });
  let sent = false;
  const errors = [];
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_key }
      }, payload, { TTL: 60 * 60 * 12 });
      sent = true;
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        await supabaseAdmin.from('web_push_subscriptions')
          .update({ is_active: false })
          .eq('id', subscription.id);
      } else {
        errors.push(error.message);
      }
    }
  }

  const attemptCount = (Number(notification.push_attempt_count) || 0) + 1;
  const updates = sent
    ? {
        push_sent_at: new Date().toISOString(),
        push_attempt_count: attemptCount,
        push_last_error: null,
        push_next_retry_at: null
      }
    : {
        push_attempt_count: attemptCount,
        push_last_error: errors.join(' | ').slice(0, 1000) || '활성화된 푸시 구독으로 전송하지 못했습니다.',
        push_next_retry_at: attemptCount < 5
          ? new Date(Date.now() + Math.min(60, 2 ** attemptCount) * 60 * 1000).toISOString()
          : null
      };
  await supabaseAdmin.from('notifications').update(updates).eq('id', notification.id);
}

async function upsertNotifications(rows) {
  const notifications = (Array.isArray(rows) ? rows : [rows]).filter((row) => row?.user_id);
  if (!notifications.length) return [];
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .upsert(notifications, { onConflict: 'user_id,dedupe_key' })
    .select('id, user_id, type, title, body, link, push_sent_at, push_attempt_count');
  if (error) throw error;
  await Promise.allSettled((data || []).map(deliverPushNotification));
  return data || [];
}

async function queueNotifications(rows) {
  const notifications = (Array.isArray(rows) ? rows : [rows]).filter((row) => row?.user_id);
  if (!notifications.length) return [];
  const queuedAt = new Date().toISOString();
  const inserted = [];
  for (let index = 0; index < notifications.length; index += 500) {
    const batch = notifications.slice(index, index + 500).map((row) => ({
      ...row,
      push_next_retry_at: queuedAt
    }));
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .upsert(batch, {
        onConflict: 'user_id,dedupe_key',
        ignoreDuplicates: true
      })
      .select('id, user_id');
    if (error) throw error;
    inserted.push(...(data || []));
  }
  return inserted;
}

async function notifyCustomersOfNewBundle(product) {
  if (!product?.id || product.category !== 'bundle' || product.is_active === false) return 0;
  const customerIds = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('role', 'customer')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    customerIds.push(...(data || []).map((profile) => profile.id));
    if (!data || data.length < pageSize) break;
  }

  const rows = customerIds.map((userId) => ({
    user_id: userId,
    type: 'bundle_opened',
    title: '새 보따리가 열렸어요',
    body: `${product.name} 신청을 확인해 보세요.`,
    link: `./product-detail.html?id=${encodeURIComponent(product.id)}`,
    dedupe_key: `bundle-opened:${product.id}`
  }));
  // 새 상품 공개 알림은 등록 직후 바로 푸시를 시도하고, 실패 건만 기존 재시도 대기열로 넘깁니다.
  const delivered = await upsertNotifications(rows);
  return delivered.length;
}

const ADMIN_NOTIFICATION_AUDIENCES = new Set([
  'all',
  'bundle_applicants',
  'bundle_unreceived',
  'bundle_unpaid',
  'member'
]);

async function listCustomerProfileIds() {
  const ids = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .in('role', ['customer', 'admin'])
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    ids.push(...(data || []).map((profile) => profile.id));
    if (!data || data.length < pageSize) break;
  }
  return ids;
}

async function resolveAdminNotificationAudience({ audience, bundleItemId, memberId }) {
  if (!ADMIN_NOTIFICATION_AUDIENCES.has(audience)) {
    const error = new Error('알림을 받을 고객 범위를 확인해 주세요.');
    error.status = 400;
    throw error;
  }

  if (audience === 'all') {
    return { userIds: await listCustomerProfileIds(), productId: null, productName: null };
  }

  if (audience === 'member') {
    if (!memberId) {
      const error = new Error('알림을 받을 회원을 선택해 주세요.');
      error.status = 400;
      throw error;
    }
    const { data: member, error: memberError } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', memberId)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member || member.role !== 'customer') {
      const error = new Error('알림을 받을 고객 회원을 찾지 못했습니다.');
      error.status = 404;
      throw error;
    }
    return { userIds: [member.id], productId: null, productName: null };
  }

  if (!bundleItemId) {
    const error = new Error('알림을 보낼 보따리를 선택해 주세요.');
    error.status = 400;
    throw error;
  }
  const { data: bundleItem, error: bundleError } = await supabaseAdmin
    .from('bundle_items')
    .select('id, product_id, products(id, name, category)')
    .eq('id', bundleItemId)
    .maybeSingle();
  if (bundleError) throw bundleError;
  if (!bundleItem || bundleItem.products?.category !== 'bundle') {
    const error = new Error('선택한 보따리 정보를 찾지 못했습니다.');
    error.status = 404;
    throw error;
  }

  const orders = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('user_id, status, payment_type, payment_status, received_at')
      .eq('bundle_item_id', bundleItemId)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    orders.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  const cancelledStatuses = new Set(['cancelled', 'canceled', 'refunded']);
  const activePickupStatuses = new Set(['applied', 'ready', 'pending']);
  const userIds = [...new Set(orders.filter((order) => {
    const status = String(order.status || '').toLowerCase();
    if (!order.user_id || cancelledStatuses.has(status) || order.payment_status === 'cancelled' || order.payment_status === 'refunded') {
      return false;
    }
    if (audience === 'bundle_unreceived') {
      return !order.received_at && activePickupStatuses.has(status);
    }
    if (audience === 'bundle_unpaid') {
      return order.payment_type === 'transfer' && order.payment_status === 'pending' && activePickupStatuses.has(status);
    }
    return true;
  }).map((order) => order.user_id))];

  return {
    userIds,
    productId: bundleItem.product_id,
    productName: bundleItem.products?.name || null
  };
}

function adminNotificationLink(linkTarget, productId) {
  if (linkTarget === 'bundle_detail') {
    if (!productId) {
      const error = new Error('보따리 상세로 이동하려면 보따리를 선택해 주세요.');
      error.status = 400;
      throw error;
    }
    return `./product-detail.html?id=${encodeURIComponent(productId)}`;
  }
  if (linkTarget === 'receipt') return './index.html#receipt';
  if (linkTarget === 'orders') return './order-history.html';
  if (linkTarget === 'home') return './index.html';
  return './notifications.html';
}

async function recordAdminAudit({ adminId, action, targetType, targetId, before, after, metadata }) {
  const { error } = await supabaseAdmin.from('admin_audit_logs').insert({
    admin_id: adminId || null,
    action,
    target_type: targetType,
    target_id: targetId ? String(targetId) : null,
    before_data: before || null,
    after_data: after || null,
    metadata: metadata || {}
  });
  if (error) console.error('관리자 작업 이력 저장 실패:', error.message);
}

function seoulDateISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function expireOverduePickupOrders({ userId = null, limit = 500 } = {}) {
  const today = seoulDateISO();
  let query = supabaseAdmin
    .from('orders')
    .select('id, user_id, status, payment_type, payment_status, pickup_date, received_at')
    .in('status', ['applied', 'ready', 'pending'])
    .is('received_at', null)
    .lt('pickup_date', today)
    .order('pickup_date', { ascending: true })
    .limit(limit);
  if (userId) query = query.eq('user_id', userId);

  const { data: orders, error } = await query;
  if (error) throw error;

  let expiredCount = 0;
  for (const order of orders || []) {
    if (order.payment_type === 'transfer' && order.payment_status !== 'confirmed') continue;

    const { data: expiredOrder, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ status: 'expired', barcode_locked: true })
      .eq('id', order.id)
      .in('status', ['applied', 'ready', 'pending'])
      .is('received_at', null)
      .select('id')
      .maybeSingle();
    if (updateError) {
      console.error('수령일 경과 주문 만료 처리 실패:', order.id, updateError.message);
      continue;
    }
    if (!expiredOrder) continue;
    expiredCount += 1;

    if (order.payment_type === 'onsite') {
      const { error: eventError } = await supabaseAdmin
        .from('no_show_events')
        .insert({
          order_id: order.id,
          user_id: order.user_id,
          reason: `지정 수령일(${order.pickup_date}) 경과 자동 처리`
        });

      if (!eventError) {
        const { data: profile, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('no_show_count')
          .eq('id', order.user_id)
          .maybeSingle();
        if (!profileError && profile) {
          const { error: countError } = await supabaseAdmin
            .from('profiles')
            .update({ no_show_count: (Number(profile.no_show_count) || 0) + 1 })
            .eq('id', order.user_id);
          if (countError) console.error('자동 노쇼 횟수 반영 실패:', order.user_id, countError.message);
        } else if (profileError) {
          console.error('자동 노쇼 회원 조회 실패:', order.user_id, profileError.message);
        }
      } else if (eventError.code !== '23505') {
        console.error('자동 노쇼 기록 생성 실패:', order.id, eventError.message);
      }
    }
  }
  return expiredCount;
}

async function deliverWaitlistPromotionPushesSince(since) {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('id, user_id, type, title, body, link, push_sent_at, push_attempt_count')
    .eq('type', 'waitlist_promoted')
    .is('push_sent_at', null)
    .gte('created_at', since);
  if (error) throw error;
  await Promise.allSettled((data || []).map(deliverPushNotification));
  return data || [];
}

async function notifyRestockSubscribers(productId, productName) {
  const { data: subscriptions, error } = await supabaseAdmin
    .from('restock_subscriptions')
    .select('user_id, updated_at')
    .eq('product_id', productId)
    .eq('request_type', 'restock')
    .eq('is_active', true);
  if (error) throw error;
  const rows = (subscriptions || []).map((subscription) => ({
    user_id: subscription.user_id,
    type: 'restock',
    title: `${productName} 재입고 소식`,
    body: '기다리던 상품이 다시 준비됐어요. 품절되기 전에 확인해 주세요.',
    link: `./product-detail.html?id=${encodeURIComponent(productId)}`,
    dedupe_key: `restock:${productId}:${subscription.user_id}:${subscription.updated_at}`
  }));
  await upsertNotifications(rows);
  if (subscriptions?.length) {
    const { error: deactivateError } = await supabaseAdmin
      .from('restock_subscriptions')
      .update({ is_active: false })
      .eq('product_id', productId)
      .eq('request_type', 'restock')
      .eq('is_active', true);
    if (deactivateError) throw deactivateError;
  }
  return rows.length;
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

async function requireAuth(req, res, next) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ success: false, error: '로그인이 필요합니다.' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ success: false, error: '로그인이 만료되었거나 유효하지 않습니다.' });
  }

  req.authToken = token;
  req.user = data.user;
  next();
}

async function ensureUserProfile(user) {
  const metadata = user?.user_metadata || {};
  const fallbackName = String(
    metadata.name || metadata.full_name || metadata.preferred_username || ''
  ).trim() || null;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .upsert({
      id: user.id,
      name: fallbackName,
      login_provider: 'kakao'
    }, {
      onConflict: 'id',
      ignoreDuplicates: true
    })
    .select('id, name, nickname, phone, role, login_provider, notification_settings, no_show_count')
    .single();
  if (error) throw error;
  return data;
}

async function requireAdmin(req, res, next) {
  const { data: existingProfile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, phone, role, login_provider')
    .eq('id', req.user.id)
    .maybeSingle();

  let profile = existingProfile;
  if (!error && !profile) {
    try {
      profile = await ensureUserProfile(req.user);
    } catch (profileError) {
      return res.status(500).json({ success: false, error: profileError.message || '회원 정보를 생성하지 못했습니다.' });
    }
  }

  if (error) return res.status(500).json({ success: false, error: '회원 권한을 확인하지 못했습니다.' });
  if (!profile || profile.role !== 'admin') {
    return res.status(403).json({ success: false, error: '관리자만 접근할 수 있습니다.' });
  }

  req.profile = profile;
  next();
}

const adminOnly = [requireAuth, requireAdmin];
const SEARCH_CACHE_MS = 12 * 60 * 60 * 1000;
const SEARCH_DEDUP_MS = 30 * 60 * 1000;
const SEARCH_WINDOW_DAYS = 30;
const SEARCH_MIN_USERS = Math.max(2, Number(process.env.SEARCH_RANK_MIN_USERS || 2));
const SEARCH_BLOCKED_TERMS = new Set(
  (process.env.SEARCH_BLOCKED_TERMS || '테스트,test,관리자')
    .split(',')
    .map((term) => term.trim().toLocaleLowerCase('ko-KR'))
    .filter(Boolean)
);
let searchRankingCache = null;

function normalizeSearchTerm(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}

function isSafeSearchTerm(term) {
  if (term.length < 2 || SEARCH_BLOCKED_TERMS.has(term)) return false;
  if (/https?:\/\/|www\.|@/.test(term)) return false;
  if (/(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(term)) return false;
  if (/\d{6,}/.test(term)) return false;
  if (/(?:무인\s*수령|계좌\s*이체|현장\s*결제|수령증|수령\s*확인|주문\s*취소|환불|로그인|회원\s*가입|문의\s*(?:하기|내역)?)/.test(term)) return false;
  return true;
}

app.get('/api/health', async (_req, res) => {
  const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
  if (error) {
    return res.status(503).json({
      success: false,
      error: 'Supabase 테이블 연결을 확인해 주세요.',
      detail: error.message
    });
  }
  res.json({
    success: true,
    data: {
      server: 'ok',
      database: 'ok',
      push: pushEnabled ? 'ready' : 'configuration_required',
      checkedAt: new Date().toISOString()
    }
  });
});

app.get('/api/admin/system-status', ...adminOnly, async (_req, res) => {
  const checks = await Promise.allSettled([
    supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('notifications').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('web_push_subscriptions').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabaseAdmin.from('admin_audit_logs').select('*', { count: 'exact', head: true })
  ]);
  const names = ['orders', 'notifications', 'pushSubscriptions', 'auditLogs'];
  const data = Object.fromEntries(checks.map((result, index) => [
    names[index],
    result.status === 'fulfilled' && !result.value.error
      ? { status: 'ok', count: result.value.count || 0 }
      : { status: 'error', message: result.reason?.message || result.value?.error?.message || '확인 실패' }
  ]));
  res.json({
    success: !Object.values(data).some((item) => item.status === 'error'),
    data: { ...data, pushConfigured: pushEnabled, checkedAt: new Date().toISOString() }
  });
});

app.get('/api/admin/audit-logs', ...adminOnly, async (req, res) => {
  const limit = Math.min(200, Math.max(20, Number(req.query.limit) || 100));
  let query = supabaseAdmin
    .from('admin_audit_logs')
    .select('id, admin_id, action, target_type, target_id, before_data, after_data, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (req.query.action) query = query.eq('action', String(req.query.action));
  const { data: logs, error } = await query;
  if (error) return res.status(400).json({ success: false, error: error.message });
  const adminIds = [...new Set((logs || []).map((log) => log.admin_id).filter(Boolean))];
  let admins = new Map();
  if (adminIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, nickname, name')
      .in('id', adminIds);
    admins = new Map((profiles || []).map((profile) => [
      profile.id,
      profile.nickname || profile.name || '관리자'
    ]));
  }
  res.json({
    success: true,
    data: (logs || []).map((log) => ({
      ...log,
      admin_name: log.admin_id ? (admins.get(log.admin_id) || '관리자') : '자동 처리'
    }))
  });
});

app.delete('/api/profile', requireAuth, async (req, res) => {
  const confirmation = String(req.body?.confirmation || '').normalize('NFKC').trim();
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('nickname, name')
    .eq('id', req.user.id)
    .maybeSingle();
  if (profileError) return res.status(400).json({ success: false, error: profileError.message });
  const expected = String(profile?.nickname || profile?.name || '').normalize('NFKC').trim();
  if (!expected || confirmation !== expected) {
    return res.status(400).json({ success: false, error: '현재 닉네임을 정확히 입력해 주세요.' });
  }
  const { error } = await supabaseAdmin.auth.admin.deleteUser(req.user.id);
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true });
});

app.get('/api/config', (_req, res) => {
  res.json({
    success: true,
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: PUBLISHABLE_KEY || null,
    authReady: Boolean(PUBLISHABLE_KEY),
    appUrl: PUBLIC_APP_URL || null
  });
});

function formatAccountNumber(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (digits.length === 14) return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
  if (digits.length === 13) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  return digits;
}

function buildPaymentDeepLink(template, amount) {
  if (!template) return null;
  const replacements = {
    amount: String(Math.max(0, Math.floor(Number(amount) || 0))),
    bankName: PAYMENT_BANK_NAME,
    accountNumber: PAYMENT_ACCOUNT_NUMBER
  };
  let link = template.replace(/\{(amount|bankName|accountNumber)\}/g, (_match, key) =>
    encodeURIComponent(replacements[key])
  );
  try {
    const protocol = new URL(link).protocol;
    if (!['https:', 'supertoss:', 'kakaotalk:'].includes(protocol)) return null;
  } catch (_) {
    return null;
  }
  return link;
}

app.get('/api/payment-info', requireAuth, (req, res) => {
  const configured = Boolean(PAYMENT_BANK_NAME && PAYMENT_ACCOUNT_NUMBER && PAYMENT_ACCOUNT_HOLDER);
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({
    success: true,
    configured,
    data: configured ? {
      bankName: PAYMENT_BANK_NAME,
      accountNumber: formatAccountNumber(PAYMENT_ACCOUNT_NUMBER),
      copyNumber: PAYMENT_ACCOUNT_NUMBER,
      accountHolder: PAYMENT_ACCOUNT_HOLDER,
      tossUrl: buildPaymentDeepLink(PAYMENT_TOSS_DEEP_LINK, req.query.amount),
      kakaoPayUrl: buildPaymentDeepLink(PAYMENT_KAKAOPAY_DEEP_LINK, req.query.amount)
    } : null
  });
});

app.post('/api/auth/kakao-sync', requireAuth, async (req, res) => {
  const providerToken = String(req.body?.providerToken || '').trim();
  if (!providerToken) {
    return res.status(400).json({ success: false, error: '카카오 동의 확인 토큰이 필요합니다.' });
  }

  try {
    const response = await fetch('https://kapi.kakao.com/v2/user/service_terms', {
      headers: { Authorization: `Bearer ${providerToken}` }
    });
    const result = await response.json();
    if (!response.ok) {
      return res.status(400).json({ success: false, error: result?.msg || '카카오 약관 동의 내역을 확인하지 못했습니다.' });
    }

    const agreedTerms = (result.service_terms || []).filter((term) => term.agreed !== false);
    const agreedTags = agreedTerms.map((term) => term.tag);
    const missingTags = KAKAO_REQUIRED_TERMS_TAGS.filter((tag) => !agreedTags.includes(tag));
    if (missingTags.length) {
      return res.status(403).json({ success: false, error: '필수 약관 동의가 완료되지 않았습니다.', missingTags });
    }

    const latestAgreedAt = agreedTerms
      .map((term) => term.agreed_at)
      .filter(Boolean)
      .sort()
      .at(-1) || new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('user_consents')
      .upsert({
        user_id: req.user.id,
        provider: 'kakao_sync',
        terms_version: 'kakao-sync',
        privacy_version: 'kakao-sync',
        terms_agreed: true,
        privacy_agreed: true,
        consent_details: agreedTerms,
        agreed_at: latestAgreedAt
      }, { onConflict: 'user_id,terms_version,privacy_version' });
    if (error) throw error;
    res.json({ success: true, agreedTags });
  } catch (error) {
    const setupRequired = error.code === '42P01' || error.code === 'PGRST205';
    res.status(setupRequired ? 503 : 500).json({
      success: false,
      setupRequired,
      error: setupRequired ? '카카오 Sync 동의 기록 테이블 설정이 필요합니다.' : error.message
    });
  }
});

app.post('/api/search/events', requireAuth, async (req, res) => {
  const term = normalizeSearchTerm(req.body?.term);
  if (!isSafeSearchTerm(term)) {
    return res.status(400).json({ success: false, error: '집계할 수 없는 검색어입니다.' });
  }

  const dedupSince = new Date(Date.now() - SEARCH_DEDUP_MS).toISOString();
  const { data: recent, error: recentError } = await supabaseAdmin
    .from('search_events')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('normalized_term', term)
    .gte('created_at', dedupSince)
    .limit(1);
  if (recentError) {
    if (recentError.code === '42P01' || recentError.code === 'PGRST205') {
      return res.status(503).json({ success: false, setupRequired: true });
    }
    return res.status(400).json({ success: false, error: recentError.message });
  }
  if (recent?.length) return res.json({ success: true, counted: false });

  const { error } = await supabaseAdmin.from('search_events').insert({
    user_id: req.user.id,
    normalized_term: term
  });
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, counted: true });
});

app.get('/api/search/rankings', async (_req, res) => {
  const now = Date.now();
  if (searchRankingCache && searchRankingCache.expiresAt > now) {
    return res.json({ success: true, ...searchRankingCache.payload });
  }

  const since = new Date(now - SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: events, error } = await supabaseAdmin
    .from('search_events')
    .select('normalized_term, user_id, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10000);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return res.json({ success: true, setupRequired: true, data: [], generatedAt: null });
    }
    return res.status(400).json({ success: false, error: error.message });
  }

  const aggregated = new Map();
  (events || []).forEach((event) => {
    const term = normalizeSearchTerm(event.normalized_term);
    if (!isSafeSearchTerm(term)) return;
    if (!aggregated.has(term)) aggregated.set(term, { term, count: 0, users: new Set() });
    const item = aggregated.get(term);
    item.count += 1;
    item.users.add(event.user_id);
  });

  const data = [...aggregated.values()]
    .filter((item) => item.users.size >= SEARCH_MIN_USERS)
    .sort((a, b) => (b.users.size - a.users.size) || (b.count - a.count) || a.term.localeCompare(b.term, 'ko'))
    .slice(0, 10)
    .map((item) => ({ term: item.term }));

  const generatedAt = new Date(now).toISOString();
  const nextRefreshAt = new Date(now + SEARCH_CACHE_MS).toISOString();
  searchRankingCache = {
    expiresAt: now + SEARCH_CACHE_MS,
    payload: { data, generatedAt, nextRefreshAt }
  };
  res.json({ success: true, ...searchRankingCache.payload });
});

app.get('/api/search/recommendations', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('recommended_search_terms')
    .select('id, term, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return res.json({ success: true, setupRequired: true, data: [] });
    }
    return res.status(400).json({ success: false, error: error.message });
  }
  res.json({ success: true, data: data || [] });
});

app.post('/api/admin/search/recommendations', ...adminOnly, async (req, res) => {
  const term = normalizeSearchTerm(req.body?.term);
  if (!isSafeSearchTerm(term)) {
    return res.status(400).json({ success: false, error: '상품 추천에 적합한 검색어를 입력해 주세요.' });
  }
  const { count, error: countError } = await supabaseAdmin
    .from('recommended_search_terms')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);
  if (countError) return res.status(400).json({ success: false, error: countError.message });
  if ((count || 0) >= 10) {
    return res.status(400).json({ success: false, error: '직접 지정 검색어는 최대 10개까지 등록할 수 있습니다.' });
  }
  const { data, error } = await supabaseAdmin
    .from('recommended_search_terms')
    .upsert({ term, sort_order: count || 0, is_active: true }, { onConflict: 'term' })
    .select('id, term, sort_order')
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.delete('/api/admin/search/recommendations/:id', ...adminOnly, async (req, res) => {
  const { error } = await supabaseAdmin
    .from('recommended_search_terms')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const { data: existingProfile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, nickname, phone, role, login_provider, notification_settings, no_show_count')
    .eq('id', req.user.id)
    .maybeSingle();

  let profile = existingProfile;
  if (!error && !profile) {
    try {
      profile = await ensureUserProfile(req.user);
    } catch (profileError) {
      return res.status(500).json({ success: false, error: profileError.message || '회원 정보를 생성하지 못했습니다.' });
    }
  }

  if (error) return res.status(500).json({ success: false, error: '회원 정보를 불러오지 못했습니다.' });
  res.json({
    success: true,
    user: { id: req.user.id, email: req.user.email || null },
    profile
  });
});

function normalizeNickname(value) {
  return String(value || '').normalize('NFKC').trim();
}

function isValidNickname(value) {
  return /^[가-힣A-Za-z0-9_]{2,12}$/.test(value);
}

app.get('/api/profile/nickname-availability', requireAuth, async (req, res) => {
  const nickname = normalizeNickname(req.query.nickname);
  if (!isValidNickname(nickname)) {
    return res.status(400).json({
      success: false,
      available: false,
      error: '닉네임은 한글·영문·숫자·밑줄로 2~12자까지 입력해 주세요.'
    });
  }
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .ilike('nickname', nickname)
    .neq('id', req.user.id)
    .limit(1);
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, available: !data?.length });
});

app.put('/api/profile/nickname', requireAuth, async (req, res) => {
  const nickname = normalizeNickname(req.body?.nickname);
  if (!isValidNickname(nickname)) {
    return res.status(400).json({
      success: false,
      error: '닉네임은 한글·영문·숫자·밑줄로 2~12자까지 입력해 주세요.'
    });
  }
  const { data: duplicate, error: duplicateError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .ilike('nickname', nickname)
    .neq('id', req.user.id)
    .limit(1);
  if (duplicateError) return res.status(400).json({ success: false, error: duplicateError.message });
  if (duplicate?.length) {
    return res.status(409).json({ success: false, error: '이미 사용 중인 닉네임입니다.' });
  }
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .upsert({
      id: req.user.id,
      nickname,
      name: nickname,
      login_provider: 'kakao'
    }, { onConflict: 'id' })
    .select('id, name, nickname, login_provider')
    .single();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: '이미 사용 중인 닉네임입니다.' });
    }
    return res.status(400).json({ success: false, error: error.message });
  }
  const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
    user_metadata: {
      ...(req.user.user_metadata || {}),
      name: nickname,
      full_name: nickname,
      preferred_username: nickname
    }
  });
  if (metadataError) {
    return res.status(500).json({ success: false, error: '닉네임은 저장됐지만 표시 이름을 갱신하지 못했습니다.' });
  }
  res.json({ success: true, data });
});

function kstDateTimeParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const kst = new Date(date.getTime() + (9 * 60 * 60 * 1000));
  return {
    date: `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`,
    time: `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`
  };
}

function hasKoreanFinalConsonant(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  const lastCharacter = text.at(-1);
  const codePoint = lastCharacter.codePointAt(0);
  if (codePoint >= 0xac00 && codePoint <= 0xd7a3) {
    return (codePoint - 0xac00) % 28 !== 0;
  }
  if (/\d/.test(lastCharacter)) {
    return ['0', '1', '3', '6', '7', '8'].includes(lastCharacter);
  }
  return false;
}

function subjectWithParticle(value) {
  const subject = String(value || '신청 상품').trim() || '신청 상품';
  return `${subject}${hasKoreanFinalConsonant(subject) ? '이' : '가'}`;
}

function mapCatalogItem(product, bundleItem = null, requestCounts = {}) {
  const bundle = bundleItem?.bundles || null;
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  const productTags = Array.isArray(product.tags) ? product.tags : [];

  let deadlineDate = null;
  let deadlineTime = "23:59";

  if (bundle?.order_deadline) {
    const parts = kstDateTimeParts(bundle.order_deadline);
    if (parts) {
      deadlineDate = parts.date;
      deadlineTime = parts.time;
    }
  }

  return {
    id: product.id,
    productId: product.id,
    externalKey: product.external_key || null,
    bundleItemId: bundleItem?.id || null,
    bundleId: bundle?.id || null,
    name: product.name,
    category: product.category,
    categoryLabel: product.category_label,
    purchaseMode: product.category === 'bundle' ? 'reservation' : 'store',
    description: product.description || '',
    productCategory: product.product_category || 'etc',
    detailDescription: product.detail_description || product.description || '',
    detailSpecs: product.detail_specs || [],
    marketGuide: product.market_guide || '',
    price: bundleItem?.sale_price ?? product.price,
    originalPrice: product.original_price || 0,
    showOriginalPrice: product.show_original_price === true,
    image: images[0] || '',
    images,
    tags: productTags.filter((tag) => !String(tag).startsWith('__')),
    stock: bundleItem?.stock_quantity ?? product.stock_quantity ?? 0,
    totalStock: bundleItem?.initial_stock_quantity ?? product.initial_stock_quantity ?? 1,
    salesCount: product.sales_count || 0,
    rating: Number(product.rating || 0),
    reviewsCount: product.reviews_count || 0,
    isRecommended: product.is_recommended === true,
    prepaymentOnly: product.prepayment_only === true,
    isActive: product.is_active !== false,
    deletedAt: (product.tags || []).includes('__deleted__') ? product.updated_at : null,
    deadline: deadlineDate,
    deadlineTime: deadlineTime,
    showDeadlineTime: !productTags.includes('__hide_deadline_time__'),
    order_deadline: bundle?.order_deadline || null,
    orderDeadline: bundle?.order_deadline || null,
    pickupDate: bundle?.default_pickup_date || null,
    maxQuantity: bundleItem?.max_quantity_per_user || null,
    barcodeValue: bundleItem?.barcode_value || null,
    arrivalStatus: bundleItem?.arrival_status || null,
    arrivalExpectedText: bundleItem?.arrival_expected_text || '',
    arrivedAt: bundleItem?.arrived_at || null,
    restockRequests: Number(requestCounts.restock || 0),
    waitlistRequests: Number(requestCounts.waitlist || 0),
    isClosed: bundle ? ['closed', 'finished', 'cancelled'].includes(bundle.status) : false,
    createdAt: product.created_at,
    updatedAt: product.updated_at
  };
}

async function readCatalog(includeInactive = false) {
  let productQuery = supabaseAdmin.from('products').select('*').order('created_at', { ascending: false });
  if (!includeInactive) productQuery = productQuery.eq('is_active', true);
  const [
    { data: products, error: productsError },
    { data: items, error: itemsError },
    { data: subscriptions, error: subscriptionsError }
  ] = await Promise.all([
    productQuery,
    supabaseAdmin.from('bundle_items').select('*, bundles(*)').order('created_at', { ascending: false }),
    supabaseAdmin.from('restock_subscriptions').select('product_id, request_type').eq('is_active', true)
  ]);
  if (productsError) throw productsError;
  if (itemsError) throw itemsError;
  if (subscriptionsError) throw subscriptionsError;
  const itemByProduct = new Map();
  const requestCountsByProduct = new Map();
  (items || []).forEach((item) => {
    if (!itemByProduct.has(item.product_id)) itemByProduct.set(item.product_id, item);
  });
  (subscriptions || []).forEach((item) => {
    const counts = requestCountsByProduct.get(item.product_id) || { restock: 0, waitlist: 0 };
    counts[item.request_type === 'waitlist' ? 'waitlist' : 'restock'] += 1;
    requestCountsByProduct.set(item.product_id, counts);
  });
  return (products || [])
    .filter((product) => !(product.tags || []).includes('__deleted__'))
    .map((product) => mapCatalogItem(
      product,
      itemByProduct.get(product.id),
      requestCountsByProduct.get(product.id)
    ));
}

let publicCatalogCache = { data: null, expiresAt: 0 };
const FRUIT_HERO_DEFAULT = {
  title: '오늘 매장에 들어온 과일',
  description: '오늘 매장에 준비된 신선 과일을 한눈에 확인해 보세요.'
};

function normalizedFruitHero(content) {
  return {
    title: String(content?.title || FRUIT_HERO_DEFAULT.title).trim().slice(0, 50),
    description: String(content?.description || FRUIT_HERO_DEFAULT.description).trim().slice(0, 120)
  };
}

app.get('/api/site-content/fruit-hero', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('site_content')
    .select('content, updated_at')
    .eq('key', 'fruit_hero')
    .maybeSingle();

  if (error) {
    console.error('오늘의 과일 문구 불러오기 실패:', error.message);
    return res.json({ success: true, data: FRUIT_HERO_DEFAULT, isDefault: true });
  }
  res.json({
    success: true,
    data: normalizedFruitHero(data?.content),
    updatedAt: data?.updated_at || null
  });
});

app.get('/api/admin/site-content/fruit-hero', ...adminOnly, async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('site_content')
    .select('content, updated_at')
    .eq('key', 'fruit_hero')
    .maybeSingle();
  if (error) {
    return res.status(503).json({
      success: false,
      error: '오늘의 과일 문구 저장소를 준비해 주세요.',
      setupRequired: true
    });
  }
  res.json({
    success: true,
    data: normalizedFruitHero(data?.content),
    updatedAt: data?.updated_at || null
  });
});

app.patch('/api/admin/site-content/fruit-hero', ...adminOnly, async (req, res) => {
  const content = normalizedFruitHero(req.body);
  if (!content.title || !content.description) {
    return res.status(400).json({ success: false, error: '제목과 소개 문구를 모두 입력해 주세요.' });
  }

  const { data: before } = await supabaseAdmin
    .from('site_content')
    .select('content')
    .eq('key', 'fruit_hero')
    .maybeSingle();
  const { data, error } = await supabaseAdmin
    .from('site_content')
    .upsert({
      key: 'fruit_hero',
      content,
      updated_by: req.user.id,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' })
    .select('content, updated_at')
    .single();
  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  await recordAdminAudit({
    adminId: req.user.id,
    action: 'site_content_updated',
    targetType: 'site_content',
    targetId: 'fruit_hero',
    before: before?.content || null,
    after: data.content,
    metadata: { section: 'today_fruit_hero' }
  });
  res.json({
    success: true,
    data: normalizedFruitHero(data.content),
    updatedAt: data.updated_at
  });
});

app.get('/api/catalog', async (req, res) => {
  try {
    const category = String(req.query.category || '').trim();
    const pickupDate = String(req.query.pickup_date || '').trim();
    if (pickupDate && !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
      return res.status(400).json({ success: false, error: '수령일 형식이 올바르지 않습니다.' });
    }

    let data;
    if (publicCatalogCache.data && publicCatalogCache.expiresAt > Date.now()) {
      data = publicCatalogCache.data;
    } else {
      data = await readCatalog(false);
      publicCatalogCache = { data, expiresAt: Date.now() + 5000 };
    }

    const filtered = data.filter((product) => {
      if (category && product.category !== category) return false;
      if (pickupDate && product.pickupDate !== pickupDate) return false;
      return true;
    });
    res.json({ success: true, data: filtered });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/catalog', ...adminOnly, async (_req, res) => {
  try {
    res.json({ success: true, data: await readCatalog(true) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function productPayload(body) {
  const publicTags = Array.isArray(body.tags)
    ? body.tags.filter((tag) => !String(tag).startsWith('__'))
    : [];
  const internalTags = body.category === 'bundle' && body.showDeadlineTime === false
    ? ['__hide_deadline_time__']
    : [];

  return {
    external_key: body.externalKey || null,
    name: String(body.name || '').trim(),
    category: body.category,
    category_label: body.categoryLabel || null,
    description: body.description || null,
    product_category: body.productCategory || 'etc',
    detail_description: body.detailDescription || null,
    detail_specs: Array.isArray(body.detailSpecs) ? body.detailSpecs : [],
    market_guide: body.marketGuide || null,
    price: Math.max(0, Number(body.price) || 0),
    original_price: Number(body.originalPrice) > 0 ? Number(body.originalPrice) : null,
    show_original_price: body.showOriginalPrice === true,
    images: Array.isArray(body.images) ? body.images.filter(Boolean).slice(0, 30) : [],
    tags: [...publicTags, ...internalTags],
    stock_quantity: Math.max(0, Number(body.stock) || 0),
    initial_stock_quantity: Math.max(1, Number(body.totalStock) || 1),
    is_recommended: body.isRecommended === true,
    prepayment_only: body.prepaymentOnly === true,
    is_active: body.isActive !== false
  };
}

// 🛠️ [수정 완료] KST 기준 타임존(+09:00) 강제 병합 및 저장 함수
async function upsertBundleForProduct(product, body, userId) {
  if (product.category !== 'bundle') return null;
  const deadlineDate = String(body.deadline || '').trim();
  const pickupDate = String(body.pickupDate || '').trim();
  if (!deadlineDate || !pickupDate) throw new Error('보따리 마감일과 수령일을 입력해 주세요.');

  const timeStr = body.deadlineTime || '23:59';

  // 한국 표준시(KST) 오프셋 (+09:00)을 명시하여 저장
  const orderDeadlineIso = `${deadlineDate}T${timeStr}:00+09:00`;

  const bundleValues = {
    title: product.name,
    order_deadline: orderDeadlineIso,
    expected_arrival_date: pickupDate,
    default_pickup_date: pickupDate,
    pickup_time_label: '오후 7시 이후',
    status: body.isActive === false ? 'draft' : (body.isClosed ? 'closed' : 'recruiting'),
    notice: body.arrivalExpectedText || null
  };

  let bundleId = body.bundleId || null;
  if (bundleId) {
    const { error } = await supabaseAdmin.from('bundles').update(bundleValues).eq('id', bundleId);
    if (error) throw error;
  } else {
    const { data, error } = await supabaseAdmin
      .from('bundles').insert({ ...bundleValues, created_by: userId }).select('id').single();
    if (error) throw error;
    bundleId = data.id;
  }

  let existingItem = null;
  if (bundleId) {
    const { data, error } = await supabaseAdmin
      .from('bundle_items')
      .select('arrival_status, arrival_expected_text, arrived_at')
      .eq('bundle_id', bundleId)
      .eq('product_id', product.id)
      .maybeSingle();
    if (error) throw error;
    existingItem = data;
  }

  const { error: itemError } = await supabaseAdmin.from('bundle_items').upsert({
    bundle_id: bundleId,
    product_id: product.id,
    sale_price: Math.max(0, Number(body.price) || 0),
    stock_quantity: Math.max(0, Number(body.stock) || 0),
    initial_stock_quantity: Math.max(1, Number(body.totalStock) || 1),
    max_quantity_per_user: Math.max(1, Number(body.maxQuantity) || 10),
    barcode_value: body.barcodeValue || null,
    arrival_status: existingItem?.arrival_status || 'scheduled',
    arrival_expected_text: existingItem?.arrival_expected_text || null,
    arrived_at: existingItem?.arrived_at || null
  }, { onConflict: 'bundle_id,product_id' });

  if (itemError) throw itemError;
  return bundleId;
}

app.post('/api/admin/products', ...adminOnly, async (req, res) => {
  try {
    const values = productPayload(req.body || {});
    if (!values.name || !['bundle', 'fruit', 'market'].includes(values.category)) {
      return res.status(400).json({ success: false, error: '상품명과 판매 위치를 확인해 주세요.' });
    }
    const { data: product, error } = await supabaseAdmin.from('products').insert(values).select().single();
    if (error) throw error;
    await upsertBundleForProduct(product, req.body || {}, req.user.id);
    const catalog = await readCatalog(true);
    const savedProduct = catalog.find((item) => item.id === product.id);
    let publishNotificationCount = 0;
    let notificationWarning = null;
    if (
      product.category === 'bundle'
      && product.is_active !== false
      && req.body?.sendPublishNotification === true
    ) {
      try {
        publishNotificationCount = await notifyCustomersOfNewBundle(product);
      } catch (notificationError) {
        notificationWarning = `상품은 등록됐지만 새 보따리 알림 생성에 실패했습니다: ${notificationError.message}`;
      }
    }
    await recordAdminAudit({
      adminId: req.user.id,
      action: 'product_created',
      targetType: 'product',
      targetId: product.id,
      after: savedProduct,
      metadata: { publishNotificationCount }
    });
    res.status(201).json({
      success: true,
      data: savedProduct,
      publishNotificationCount,
      warning: notificationWarning
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/dashboard', ...adminOnly, async (_req, res) => {
  const today = kstDateTimeParts(new Date())?.date;
  const todayStart = new Date(`${today}T00:00:00+09:00`);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
  const [ordersResult, pendingResult, expiredResult, inquiriesResult] = await Promise.all([
    supabaseAdmin.from('orders').select('*', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString())
      .lt('created_at', tomorrowStart.toISOString()),
    supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }).eq('payment_status', 'pending'),
    supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'expired'),
    supabaseAdmin.from('inquiries').select('*', { count: 'exact', head: true }).eq('status', 'waiting')
  ]);

  const firstError = [ordersResult, pendingResult, expiredResult, inquiriesResult].find((result) => result.error)?.error;
  if (firstError) return res.status(500).json({ success: false, error: firstError.message });

  res.json({
    success: true,
    data: {
      todayOrders: ordersResult.count || 0,
      pendingPayments: pendingResult.count || 0,
      expiredOrders: expiredResult.count || 0,
      waitingInquiries: inquiriesResult.count || 0
    }
  });
});

app.get('/api/admin/orders', ...adminOnly, async (req, res) => {
  let query = supabaseAdmin
    .from('orders')
    .select('*, bundle_items(*, products(*), bundles(*))')
    .order('created_at', { ascending: false })
    .limit(200);

  if (req.query.status) query = query.eq('status', req.query.status);
  const { data: orders, error } = await query;
  if (error) return res.status(500).json({ success: false, error: error.message });
  const userIds = [...new Set((orders || []).map((order) => order.user_id).filter(Boolean))];
  let profilesById = new Map();
  if (userIds.length) {
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, name, phone')
      .in('id', userIds);
    if (profilesError) return res.status(500).json({ success: false, error: profilesError.message });
    profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  }
  res.json({
    success: true,
    data: (orders || []).map((order) => ({
      ...order,
      profiles: profilesById.get(order.user_id) || null
    }))
  });
});

app.get('/api/admin/members', ...adminOnly, async (_req, res) => {
  const [{ data: profiles, error: profilesError }, { data: orders, error: ordersError }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, name, nickname, login_provider, role, no_show_count, created_at')
      .eq('role', 'customer')
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('orders')
      .select('user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(5000)
  ]);
  if (profilesError || ordersError) {
    return res.status(500).json({ success: false, error: profilesError?.message || ordersError?.message });
  }

  const orderStats = new Map();
  (orders || []).forEach((order) => {
    const current = orderStats.get(order.user_id) || { count: 0, lastOrderAt: null };
    current.count += 1;
    if (!current.lastOrderAt) current.lastOrderAt = order.created_at;
    orderStats.set(order.user_id, current);
  });
  res.json({
    success: true,
    data: (profiles || []).map((profile) => ({
      ...profile,
      name: profile.nickname || profile.name,
      order_count: orderStats.get(profile.id)?.count || 0,
      last_order_at: orderStats.get(profile.id)?.lastOrderAt || null
    }))
  });
});

app.post('/api/admin/notifications/preview', ...adminOnly, async (req, res) => {
  try {
    const audience = String(req.body?.audience || '').trim();
    const resolved = await resolveAdminNotificationAudience({
      audience,
      bundleItemId: String(req.body?.bundleItemId || '').trim() || null,
      memberId: String(req.body?.memberId || '').trim() || null
    });
    res.json({
      success: true,
      data: {
        count: resolved.userIds.length,
        productName: resolved.productName
      }
    });
  } catch (error) {
    res.status(error.status || 400).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/notifications/send', ...adminOnly, async (req, res) => {
  const audience = String(req.body?.audience || '').trim();
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  const requestKey = String(req.body?.requestKey || '').trim();
  const linkTarget = String(req.body?.linkTarget || 'notifications').trim();
  if (title.length < 2 || title.length > 40) {
    return res.status(400).json({ success: false, error: '알림 제목은 2~40자로 입력해 주세요.' });
  }
  if (body.length < 2 || body.length > 200) {
    return res.status(400).json({ success: false, error: '알림 내용은 2~200자로 입력해 주세요.' });
  }
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestKey)) {
    return res.status(400).json({ success: false, error: '발송 요청을 다시 확인해 주세요.' });
  }
  if (!['notifications', 'bundle_detail', 'receipt', 'orders', 'home'].includes(linkTarget)) {
    return res.status(400).json({ success: false, error: '알림에서 이동할 화면을 확인해 주세요.' });
  }

  try {
    const resolved = await resolveAdminNotificationAudience({
      audience,
      bundleItemId: String(req.body?.bundleItemId || '').trim() || null,
      memberId: String(req.body?.memberId || '').trim() || null
    });
    if (!resolved.userIds.length) {
      return res.status(400).json({ success: false, error: '조건에 맞는 고객이 없습니다. 대상을 다시 확인해 주세요.' });
    }
    const link = adminNotificationLink(linkTarget, resolved.productId);
    const rows = resolved.userIds.map((userId) => ({
      user_id: userId,
      type: 'admin_notice',
      title,
      body,
      link,
      dedupe_key: `admin-notice:${requestKey}`
    }));
    // 관리자 수동 알림은 예약 작업을 기다리지 않고 다른 운영 알림과
    // 동일하게 저장 직후 푸시까지 시도한다. 실패한 푸시는 기존 재시도
    // 스케줄러가 push_next_retry_at을 기준으로 다시 처리한다.
    const queued = await upsertNotifications(rows);
    await recordAdminAudit({
      adminId: req.user.id,
      action: 'manual_notification_sent',
      targetType: 'notification_audience',
      targetId: audience === 'member'
        ? String(req.body?.memberId || '')
        : String(req.body?.bundleItemId || audience),
      metadata: {
        audience,
        recipient_count: resolved.userIds.length,
        queued_count: queued.length,
        product_id: resolved.productId,
        product_name: resolved.productName,
        title,
        body,
        link,
        request_key: requestKey
      }
    });
    res.json({
      success: true,
      data: {
        count: resolved.userIds.length,
        newlyQueued: queued.length
      }
    });
  } catch (error) {
    const constraintMissing = String(error?.message || '').includes('notifications_type_check')
      || (String(error?.message || '').includes('violates check constraint') && String(error?.details || '').includes('admin_notice'));
    res.status(error.status || (constraintMissing ? 500 : 400)).json({
      success: false,
      error: constraintMissing
        ? '수동 알림 DB 설정이 아직 적용되지 않았습니다. Supabase에서 023_admin_manual_notifications.sql을 실행해 주세요.'
        : error.message,
      setupRequired: constraintMissing,
      migration: constraintMissing ? '023_admin_manual_notifications.sql' : undefined
    });
  }
});

app.patch('/api/admin/members/:id/no-show', ...adminOnly, async (req, res) => {
  const action = String(req.body?.action || '').trim();
  const reason = String(req.body?.reason || '').trim().slice(0, 300) || null;
  if (!['increment', 'decrement', 'reset'].includes(action)) {
    return res.status(400).json({ success: false, error: '노쇼 조정 방식을 확인해 주세요.' });
  }

  const { data: member, error: memberError } = await supabaseAdmin
    .from('profiles')
    .select('id, name, role, no_show_count')
    .eq('id', req.params.id)
    .maybeSingle();
  if (memberError) return res.status(400).json({ success: false, error: memberError.message });
  if (!member || member.role !== 'customer') {
    return res.status(404).json({ success: false, error: '노쇼를 조정할 고객 회원을 찾지 못했습니다.' });
  }

  const previousCount = Math.max(0, Number(member.no_show_count) || 0);
  const nextCount = action === 'reset'
    ? 0
    : action === 'increment'
      ? previousCount + 1
      : Math.max(0, previousCount - 1);

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ no_show_count: nextCount })
    .eq('id', member.id)
    .select('id, name, no_show_count')
    .single();
  if (updateError) return res.status(400).json({ success: false, error: updateError.message });

  const { error: auditError } = await supabaseAdmin
    .from('admin_no_show_adjustments')
    .insert({
      user_id: member.id,
      admin_id: req.user.id,
      previous_count: previousCount,
      next_count: nextCount,
      reason
    });
  if (auditError) {
    await supabaseAdmin
      .from('profiles')
      .update({ no_show_count: previousCount })
      .eq('id', member.id);
    return res.status(400).json({
      success: false,
      error: `조정 이력을 저장하지 못해 변경을 취소했습니다: ${auditError.message}`
    });
  }

  res.json({ success: true, data: updated });
});

app.post('/api/admin/members/:id/contact-request', ...adminOnly, async (req, res) => {
  const message = String(req.body?.message || '확인할 내용이 있습니다. 1:1 채팅으로 연락 부탁드립니다.').trim().slice(0, 160);
  const openChatUrl = String(req.body?.openChatUrl || '').trim();
  let parsedChatUrl;
  try {
    parsedChatUrl = new URL(openChatUrl);
  } catch (_) {
    return res.status(400).json({ success: false, error: '1:1 오픈채팅 주소를 확인해 주세요.' });
  }
  if (parsedChatUrl.protocol !== 'https:' || parsedChatUrl.hostname !== 'open.kakao.com') {
    return res.status(400).json({ success: false, error: '카카오 1:1 오픈채팅 주소만 사용할 수 있습니다.' });
  }
  const { data: member, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, role')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(400).json({ success: false, error: error.message });
  if (!member || member.role !== 'customer') {
    return res.status(404).json({ success: false, error: '알림을 보낼 회원을 찾지 못했습니다.' });
  }
  try {
    await upsertNotifications({
      user_id: member.id,
      type: 'contact_request',
      title: '매장에서 연락을 요청했어요',
      body: `${message}\n${parsedChatUrl.href}`,
      link: parsedChatUrl.href,
      dedupe_key: `contact-request:${member.id}:${Date.now()}`
    });
    res.json({ success: true });
  } catch (notifyError) {
    res.status(400).json({ success: false, error: notifyError.message });
  }
});

app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    await expireOverduePickupOrders({ userId: req.user.id, limit: 100 });
  } catch (expireError) {
    console.error('수령증 조회 전 미수령 자동 처리 실패:', expireError.message);
  }
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*, bundle_items(*, products(*), bundles(*))')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [] });
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('id, type, title, body, link, read_at, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [] });
});

app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
  const { error } = await supabaseAdmin.from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true });
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  const { error } = await supabaseAdmin.from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', req.user.id)
    .is('read_at', null);
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true });
});

app.get('/api/inquiries', requireAuth, async (req, res) => {
  let query = supabaseAdmin
    .from('inquiries')
    .select('id, product_id, order_id, content, status, answer, answered_at, created_at, products(name)')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (req.query.productId) query = query.eq('product_id', req.query.productId);
  const { data, error } = await query.limit(100);
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [] });
});

app.post('/api/inquiries', requireAuth, async (req, res) => {
  const productId = String(req.body?.productId || '').trim() || null;
  const orderId = String(req.body?.orderId || '').trim() || null;
  const content = String(req.body?.content || '').trim();
  if (!content) return res.status(400).json({ success: false, error: '문의 내용을 입력해 주세요.' });
  const { data, error } = await supabaseAdmin.from('inquiries').insert({
    user_id: req.user.id,
    product_id: productId,
    order_id: orderId,
    content
  }).select('id, product_id, order_id, content, status, answer, created_at').single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.status(201).json({ success: true, data });
});

app.post('/api/products/:id/restock-subscription', requireAuth, async (req, res) => {
  const requestType = req.body?.requestType === 'waitlist' ? 'waitlist' : 'restock';
  const { data, error } = await supabaseAdmin.from('restock_subscriptions').upsert({
    user_id: req.user.id,
    product_id: req.params.id,
    request_type: requestType,
    is_active: true,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,product_id' }).select().single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.status(201).json({ success: true, data });
});

app.get('/api/products/:id/subscriptions/me', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('restock_subscriptions')
    .select('request_type')
    .eq('user_id', req.user.id)
    .eq('product_id', req.params.id)
    .eq('is_active', true);
  if (error) return res.status(400).json({ success: false, error: error.message });
  const activeTypes = new Set((data || []).map((item) => item.request_type));
  res.json({
    success: true,
    data: {
      restock: activeTypes.has('restock'),
      waitlist: activeTypes.has('waitlist')
    }
  });
});

app.delete('/api/products/:id/restock-subscription', requireAuth, async (req, res) => {
  const { error } = await supabaseAdmin.from('restock_subscriptions')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', req.user.id)
    .eq('product_id', req.params.id);
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true });
});

app.post('/api/products/:id/waitlist', requireAuth, async (req, res) => {
  const productId = req.params.id;
  const {
    quantity,
    paymentType,
    pickupDate,
    pickupTimeLabel,
    depositorName,
    procurementPolicyConsent,
    procurementPolicyVersion,
    waitlistAutoOrderConsent
  } = req.body || {};

  if (procurementPolicyConsent !== true || waitlistAutoOrderConsent !== true) {
    return res.status(400).json({ success: false, error: '사입 확정 및 대기 자동 주문 안내에 동의해 주세요.' });
  }

  const [{ data: product, error: productError }, { data: item, error: itemError }] = await Promise.all([
    supabaseAdmin
      .from('products')
      .select('id, name, category, prepayment_only')
      .eq('id', productId)
      .single(),
    supabaseAdmin
      .from('bundle_items')
      .select('id, product_id, stock_quantity, max_quantity_per_user, bundles(default_pickup_date, order_deadline)')
      .eq('product_id', productId)
      .single()
  ]);

  if (productError || itemError || !product || !item) {
    return res.status(404).json({ success: false, error: '대기 신청 가능한 보따리 상품을 찾지 못했습니다.' });
  }
  if (product.category !== 'bundle') {
    return res.status(400).json({ success: false, error: '보따리 상품만 대기 신청할 수 있습니다.' });
  }
  if (Number(item.stock_quantity) > 0) {
    return res.status(409).json({ success: false, error: '현재 수량이 있어 바로 신청할 수 있습니다.' });
  }
  const todayInKorea = kstDateTimeParts(new Date())?.date;
  const defaultPickupDate = String(item.bundles?.default_pickup_date || '');
  if (!defaultPickupDate || !todayInKorea || todayInKorea > defaultPickupDate) {
    return res.status(400).json({ success: false, error: '수령일이 지나 대기 신청이 종료되었습니다.' });
  }

  const requestedQuantity = Math.max(1, Number(quantity) || 1);
  if (requestedQuantity > Number(item.max_quantity_per_user || 10)) {
    return res.status(400).json({ success: false, error: '1인 최대 신청 수량을 초과했습니다.' });
  }

  const defaultPickup = new Date(`${item.bundles.default_pickup_date}T00:00:00`);
  const requestedPickup = new Date(`${pickupDate}T00:00:00`);
  const lastPickup = new Date(defaultPickup);
  lastPickup.setDate(lastPickup.getDate() + 6);
  if (Number.isNaN(requestedPickup.getTime())
    || requestedPickup < defaultPickup
    || requestedPickup > lastPickup) {
    return res.status(400).json({ success: false, error: '선택 가능한 수령일을 확인해 주세요.' });
  }

  const normalizedPayment = product.prepayment_only
    ? 'transfer'
    : paymentType === 'transfer' ? 'transfer' : 'onsite';
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('restock_subscriptions')
    .upsert({
      user_id: req.user.id,
      product_id: productId,
      bundle_item_id: item.id,
      request_type: 'waitlist',
      is_active: true,
      quantity: requestedQuantity,
      payment_type: normalizedPayment,
      pickup_date: pickupDate,
      pickup_time_label: pickupTimeLabel === '오후 7시 이전' ? '오후 7시 이전' : '오후 7시 이후',
      depositor_name: normalizedPayment === 'transfer' ? depositorName || null : null,
      promoted_order_id: null,
      promoted_at: null,
      procurement_policy_consent_at: now,
      procurement_policy_version: String(procurementPolicyVersion || '').slice(0, 30),
      waitlist_auto_order_consent_at: now,
      created_at: now,
      updated_at: now
    }, { onConflict: 'user_id,product_id' })
    .select()
    .single();

  if (error) return res.status(400).json({ success: false, error: error.message });
  res.status(201).json({ success: true, data });
});

function pickupDateWithinBundleWindow(pickupDate, defaultPickupDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(pickupDate || ''))
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(defaultPickupDate || ''))) {
    return false;
  }
  const selected = new Date(`${pickupDate}T00:00:00+09:00`);
  const first = new Date(`${defaultPickupDate}T00:00:00+09:00`);
  const last = new Date(first);
  last.setUTCDate(last.getUTCDate() + 6);
  return selected >= first && selected <= last;
}

app.post('/api/orders', requireAuth, async (req, res) => {
  const {
    bundleItemId,
    quantity,
    paymentType,
    pickupDate,
    pickupTimeLabel,
    depositorName,
    requestKey,
    procurementPolicyConsent,
    procurementPolicyVersion
  } = req.body || {};
  if (!bundleItemId || !pickupDate) {
    return res.status(400).json({ success: false, error: '상품과 수령일을 확인해 주세요.' });
  }
  if (procurementPolicyConsent !== true) {
    return res.status(400).json({ success: false, error: '사입 확정과 신청 마감 후 취소 제한 안내에 동의해 주세요.' });
  }
  const { data: orderItem, error: itemError } = await supabaseAdmin
    .from('bundle_items')
    .select('id, bundles(default_pickup_date, order_deadline, status)')
    .eq('id', bundleItemId)
    .maybeSingle();
  if (itemError) return res.status(400).json({ success: false, error: itemError.message });
  if (!orderItem?.bundles || orderItem.bundles.status !== 'recruiting'
    || new Date(orderItem.bundles.order_deadline).getTime() <= Date.now()) {
    return res.status(400).json({ success: false, error: '신청 가능한 보따리가 아닙니다.' });
  }
  if (!pickupDateWithinBundleWindow(pickupDate, orderItem.bundles.default_pickup_date)) {
    return res.status(400).json({ success: false, error: '수령일은 관리자가 지정한 수령일부터 7일 안에서 선택해 주세요.' });
  }

  if (!String(requestKey || '').trim()) {
    return res.status(400).json({ success: false, error: '주문 요청 식별값이 없습니다. 페이지를 새로고침해 주세요.' });
  }
  const { data, error } = await supabaseAdmin.rpc('create_customer_order_v3', {
    p_user_id: req.user.id,
    p_bundle_item_id: bundleItemId,
    p_quantity: Math.max(1, Number(quantity) || 1),
    p_payment_type: paymentType === 'transfer' ? 'transfer' : 'onsite',
    p_pickup_date: pickupDate,
    p_pickup_time_label: pickupTimeLabel === '오후 7시 이전' ? '오후 7시 이전' : '오후 7시 이후',
    p_depositor_name: depositorName || null,
    p_request_key: String(requestKey).trim().slice(0, 120)
  });
  if (error) return res.status(400).json({ success: false, error: error.message });
  const createdOrderId = Array.isArray(data) ? data[0]?.id : data?.id;
  if (createdOrderId) {
    const { error: consentError } = await supabaseAdmin
      .from('orders')
      .update({
        procurement_policy_consent_at: new Date().toISOString(),
        procurement_policy_version: String(procurementPolicyVersion || '').slice(0, 30)
      })
      .eq('id', createdOrderId)
      .eq('user_id', req.user.id);
    if (consentError) {
      return res.status(500).json({
        success: false,
        orderCreated: true,
        error: '주문은 접수되었지만 필수 확인 기록 저장에 실패했습니다. 관리자에게 문의해 주세요.'
      });
    }
  }
  res.status(201).json({ success: true, data });
});

app.post('/api/orders/:id/cancel', requireAuth, async (req, res) => {
  const promotionCheckStartedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin.rpc('cancel_customer_order', {
    p_order_id: req.params.id,
    p_actor_id: req.user.id,
    p_actor_role: 'customer',
    p_reason: req.body?.reason || null
  });
  if (error) return res.status(400).json({ success: false, error: error.message });
  try {
    await deliverWaitlistPromotionPushesSince(promotionCheckStartedAt);
  } catch (notifyError) {
    return res.json({
      success: true,
      data,
      warning: `주문은 취소됐지만 대기자 푸시 알림 전송을 확인하지 못했습니다: ${notifyError.message}`
    });
  }
  res.json({ success: true, data });
});

app.patch('/api/orders/:id/pickup-date', requireAuth, async (req, res) => {
  const requestedPickupDate = req.body?.pickupDate;
  const { data: currentOrder, error: currentOrderError } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, status, bundle_items(bundles(default_pickup_date))')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (currentOrderError) return res.status(400).json({ success: false, error: currentOrderError.message });
  const defaultPickupDate = currentOrder?.bundle_items?.bundles?.default_pickup_date;
  if (!currentOrder || !['applied', 'ready'].includes(currentOrder.status)
    || !pickupDateWithinBundleWindow(requestedPickupDate, defaultPickupDate)) {
    return res.status(400).json({ success: false, error: '수령일은 관리자가 지정한 수령일부터 7일 안에서 변경해 주세요.' });
  }
  const { data, error } = await supabaseAdmin.rpc('change_order_pickup_date', {
    p_order_id: req.params.id,
    p_user_id: req.user.id,
    p_pickup_date: requestedPickupDate
  });
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.post('/api/orders/:id/complete', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc('complete_customer_order', {
    p_order_id: req.params.id,
    p_user_id: req.user.id
  });
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.post('/api/orders/:id/complete/undo', requireAuth, async (req, res) => {
  const undoDeadline = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: completedOrder, error: lookupError } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, status, received_at, barcode_locked')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .eq('status', 'completed')
    .gte('received_at', undoDeadline)
    .maybeSingle();
  if (lookupError) return res.status(400).json({ success: false, error: lookupError.message });
  if (!completedOrder) {
    return res.status(400).json({ success: false, error: '수령 완료 직후에만 되돌릴 수 있습니다.' });
  }

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update({
      status: 'ready',
      received_at: null,
      barcode_locked: false
    })
    .eq('id', completedOrder.id)
    .eq('user_id', req.user.id)
    .eq('status', 'completed')
    .select()
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });

  await recordAdminAudit({
    action: 'customer_receipt_completion_undone',
    targetType: 'order',
    targetId: data.id,
    before: completedOrder,
    after: data,
    metadata: { userId: req.user.id }
  });
  res.json({ success: true, data });
});

app.post('/api/admin/orders/:id/cancel', ...adminOnly, async (req, res) => {
  const { data: cancelTarget, error: cancelTargetError } = await supabaseAdmin
    .from('orders')
    .select('*, bundle_items(id, stock_quantity, initial_stock_quantity, bundles(order_deadline))')
    .eq('id', req.params.id)
    .maybeSingle();
  if (cancelTargetError) return res.status(400).json({ success: false, error: cancelTargetError.message });
  if (!cancelTarget) return res.status(404).json({ success: false, error: '주문을 찾지 못했습니다.' });

  if (new Date(cancelTarget.bundle_items?.bundles?.order_deadline).getTime() <= Date.now()) {
    if (!['applied', 'ready'].includes(cancelTarget.status)) {
      return res.status(400).json({ success: false, error: '현재 취소할 수 없는 주문입니다.' });
    }
    const { data: cancelled, error: cancelError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'cancelled',
        payment_status: cancelTarget.payment_status === 'confirmed' ? 'refunded' : 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: String(req.body?.reason || '').trim() || null,
        cancelled_by: 'admin',
        barcode_locked: true
      })
      .eq('id', cancelTarget.id)
      .select()
      .single();
    if (cancelError) return res.status(400).json({ success: false, error: cancelError.message });
    const restoredStock = Math.min(
      Number(cancelTarget.bundle_items.initial_stock_quantity) || 0,
      (Number(cancelTarget.bundle_items.stock_quantity) || 0) + Number(cancelTarget.quantity || 0)
    );
    const { error: stockError } = await supabaseAdmin
      .from('bundle_items')
      .update({ stock_quantity: restoredStock })
      .eq('id', cancelTarget.bundle_items.id);
    if (stockError) return res.status(400).json({ success: false, error: stockError.message });
    await recordAdminAudit({
      adminId: req.user.id,
      action: 'order_cancelled',
      targetType: 'order',
      targetId: cancelled.id,
      before: cancelTarget,
      after: cancelled,
      metadata: { reason: req.body?.reason || null, afterDeadline: true }
    });
    try {
      await upsertNotifications({
        user_id: cancelled.user_id,
        type: 'order_cancelled',
        title: '주문이 취소되었어요',
        body: req.body?.reason
          ? `관리자 취소 사유: ${String(req.body.reason).trim()}`
          : '관리자에 의해 주문이 취소되었습니다. 주문 내역을 확인해 주세요.',
        link: './order-history.html',
        dedupe_key: `admin-order-cancelled:${cancelled.id}`
      });
    } catch (notifyError) {
      return res.json({ success: true, data: cancelled, warning: `주문은 취소됐지만 알림 전송에 실패했습니다: ${notifyError.message}` });
    }
    return res.json({ success: true, data: cancelled });
  }

  const promotionCheckStartedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin.rpc('cancel_customer_order', {
    p_order_id: req.params.id,
    p_actor_id: req.user.id,
    p_actor_role: 'admin',
    p_reason: req.body?.reason || null
  });
  if (error) return res.status(400).json({ success: false, error: error.message });
  await recordAdminAudit({
    adminId: req.user.id,
    action: 'order_cancelled',
    targetType: 'order',
    targetId: data.id,
    before: cancelTarget,
    after: data,
    metadata: { reason: req.body?.reason || null, afterDeadline: false }
  });
  let promotionPushWarning = null;
  try {
    await deliverWaitlistPromotionPushesSince(promotionCheckStartedAt);
  } catch (notifyError) {
    promotionPushWarning = `대기자 푸시 알림 전송을 확인하지 못했습니다: ${notifyError.message}`;
  }
  try {
    await upsertNotifications({
      user_id: data.user_id,
      type: 'order_cancelled',
      title: '주문이 취소되었어요',
      body: req.body?.reason
        ? `관리자 취소 사유: ${String(req.body.reason).trim()}`
        : '관리자에 의해 주문이 취소되었습니다. 주문 내역을 확인해 주세요.',
      link: './order-history.html',
      dedupe_key: `admin-order-cancelled:${data.id}`
    });
  } catch (notifyError) {
    return res.json({ success: true, data, warning: `주문은 취소됐지만 알림 생성에 실패했습니다: ${notifyError.message}` });
  }
  res.json({ success: true, data, ...(promotionPushWarning ? { warning: promotionPushWarning } : {}) });
});

app.post('/api/admin/orders/:id/confirm-payment', ...adminOnly, async (req, res) => {
  const { data: order, error } = await supabaseAdmin
    .from('orders').update({ payment_status: 'confirmed' }).eq('id', req.params.id)
    .eq('payment_type', 'transfer').select('id, user_id, order_number').single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  await recordAdminAudit({
    adminId: req.user.id,
    action: 'payment_confirmed',
    targetType: 'order',
    targetId: order.id,
    after: order
  });
  try {
    await upsertNotifications({
      user_id: order.user_id,
      type: 'payment_confirmed',
      title: '입금 확인이 완료됐어요',
      body: '주문 내역과 수령 확인증에서 상태를 확인해 주세요.',
      link: './index.html#receipt',
      dedupe_key: `payment-confirmed:${order.id}`
    });
  } catch (notifyError) {
    return res.json({ success: true, data: order, warning: `입금 확인은 완료됐지만 알림 생성에 실패했습니다: ${notifyError.message}` });
  }
  res.json({ success: true, data: order });
});

app.post('/api/admin/orders/:id/payment-reminder', ...adminOnly, async (req, res) => {
  const { data: order, error } = await supabaseAdmin
    .from('orders').update({ payment_reminded_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('payment_type', 'transfer').eq('payment_status', 'pending')
    .select('id, user_id').single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  try {
    await upsertNotifications({
      user_id: order.user_id, type: 'payment_reminder', title: '입금 확인이 필요해요',
      body: '신청 마감 전까지 입금해 주세요. 입금 확인 후 수령 확인증이 활성화됩니다.',
      link: './order-history.html', dedupe_key: `payment-reminder:${order.id}:${kstDateTimeParts(new Date())?.date}`
    });
  } catch (notifyError) {
    return res.json({ success: true, warning: `입금 요청은 기록됐지만 알림 생성에 실패했습니다: ${notifyError.message}` });
  }
  res.json({ success: true });
});

app.post('/api/admin/bundle-items/:id/pickup-reminder', ...adminOnly, async (req, res) => {
  const { data: orders, error } = await supabaseAdmin.from('orders')
    .select('id, user_id').eq('bundle_item_id', req.params.id).in('status', ['applied', 'ready']);
  if (error) return res.status(400).json({ success: false, error: error.message });
  const today = kstDateTimeParts(new Date())?.date;
  const rows = (orders || []).map((order) => ({
    user_id: order.user_id, type: 'pickup', title: '아직 수령하지 않은 상품이 있어요',
    body: '지정한 수령일을 확인하고 매장에 방문해 주세요.', link: './index.html#receipt',
    dedupe_key: `pickup-reminder:${order.id}:${today}`
  }));
  if (rows.length) {
    await upsertNotifications(rows);
  }
  res.json({ success: true, count: rows.length });
});

app.post('/api/admin/products/:id/arrival', ...adminOnly, async (req, res) => {
  const arrivalStatus = req.body?.arrivalStatus === 'arrived' ? 'arrived' : 'scheduled';
  const arrivedAt = arrivalStatus === 'arrived' ? new Date().toISOString() : null;
  const { data: item, error } = await supabaseAdmin.from('bundle_items')
    .update({
      arrival_status: arrivalStatus,
      arrived_at: arrivedAt,
      arrival_expected_text: req.body?.arrivalExpectedText || null
    })
    .eq('product_id', req.params.id)
    .select('id, product_id, products(name)')
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });

  if (arrivalStatus === 'arrived') {
    const { data: orders, error: ordersError } = await supabaseAdmin.from('orders')
      .select('id, user_id, payment_type, payment_status, quantity')
      .eq('bundle_item_id', item.id)
      .in('status', ['applied', 'ready']);
    if (ordersError) return res.status(400).json({ success: false, error: ordersError.message });

    const readyIds = (orders || [])
      .filter((order) => order.payment_type === 'onsite' || order.payment_status === 'confirmed')
      .map((order) => order.id);
    if (readyIds.length) {
      const { error: readyError } = await supabaseAdmin.from('orders').update({ status: 'ready' }).in('id', readyIds);
      if (readyError) return res.status(400).json({ success: false, error: readyError.message });
    }
    try {
      const ordersByUser = new Map();
      (orders || []).forEach((order) => {
        const current = ordersByUser.get(order.user_id) || {
          userId: order.user_id,
          quantity: 0,
          hasPickupReadyOrder: false
        };
        current.quantity += Math.max(1, Number(order.quantity) || 1);
        current.hasPickupReadyOrder ||= order.payment_type === 'onsite'
          || order.payment_status === 'confirmed';
        ordersByUser.set(order.user_id, current);
      });
      const productName = item.products?.name || '신청 상품';
      await upsertNotifications(Array.from(ordersByUser.values()).map((entry) => ({
        user_id: entry.userId,
        type: 'arrival',
        title: `${subjectWithParticle(productName)} 입고되었어요`,
        body: entry.hasPickupReadyOrder
          ? `신청한 ${productName} 총 ${entry.quantity}개를 이제 수령할 수 있어요.`
          : `${productName} 입고가 완료되었어요. 입금 확인 후 수령 확인증이 활성화됩니다.`,
        link: entry.hasPickupReadyOrder ? './index.html#receipt' : './order-history.html',
        dedupe_key: `arrival:${item.id}:${entry.userId}`
      })));
    } catch (notifyError) {
      return res.json({ success: true, data: item, warning: `입고 처리는 완료됐지만 알림 생성에 실패했습니다: ${notifyError.message}` });
    }
  }
  res.json({ success: true, data: { ...item, arrival_status: arrivalStatus, arrived_at: arrivedAt } });
});

app.patch('/api/admin/orders/:id', ...adminOnly, async (req, res) => {
  const allowed = ['status', 'payment_status', 'pickup_date', 'pickup_time_label', 'received_at', 'cancelled_at'];
  const updates = Object.fromEntries(
    Object.entries(req.body || {}).filter(([key]) => allowed.includes(key))
  );
  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: '변경할 수 있는 주문 항목이 없습니다.' });
  }

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.post('/api/admin/orders/:id/complete', ...adminOnly, async (req, res) => {
  const { data: order, error: lookupError } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, status, payment_type, payment_status, received_at, barcode_locked, bundle_items(arrival_status)')
    .eq('id', req.params.id)
    .maybeSingle();
  if (lookupError) return res.status(400).json({ success: false, error: lookupError.message });
  if (!order) return res.status(404).json({ success: false, error: '주문을 찾지 못했습니다.' });
  if (order.status === 'completed') {
    return res.status(409).json({ success: false, error: '이미 수령 완료 처리된 주문입니다.' });
  }
  if (!['pending', 'applied', 'ready'].includes(order.status)) {
    return res.status(409).json({ success: false, error: '현재 수령 완료 처리할 수 없는 주문입니다.' });
  }
  if (order.bundle_items?.arrival_status !== 'arrived') {
    return res.status(409).json({ success: false, error: '입고 완료된 주문만 수령 완료 처리할 수 있습니다.' });
  }
  if (order.payment_type === 'transfer' && order.payment_status !== 'confirmed') {
    return res.status(409).json({ success: false, error: '입금 확인 후 수령 완료 처리해 주세요.' });
  }

  const completedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('orders')
    .update({
      status: 'completed',
      received_at: completedAt,
      barcode_locked: true
    })
    .eq('id', order.id)
    .in('status', ['pending', 'applied', 'ready'])
    .select()
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });

  await recordAdminAudit({
    adminId: req.user.id,
    action: 'order_received_by_admin',
    targetType: 'order',
    targetId: order.id,
    before: order,
    after: data,
    metadata: {
      customerId: order.user_id,
      completedAt,
      source: 'packing_order_list'
    }
  });
  res.json({ success: true, data });
});

app.post('/api/admin/orders/:id/no-show', ...adminOnly, async (req, res) => {
  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (orderError) return res.status(400).json({ success: false, error: orderError.message });
  if (!order) return res.status(404).json({ success: false, error: '주문을 찾지 못했습니다.' });
  if (order.status === 'expired') {
    return res.status(409).json({ success: false, error: '이미 미수령 만료 처리된 주문입니다.' });
  }

  const { error: eventError } = await supabaseAdmin
    .from('no_show_events')
    .insert({
      order_id: order.id,
      user_id: order.user_id,
      reason: String(req.body?.reason || '').trim() || null
    });
  if (eventError) return res.status(400).json({ success: false, error: eventError.message });

  const { error: orderUpdateError } = await supabaseAdmin
    .from('orders')
    .update({ status: 'expired', barcode_locked: true })
    .eq('id', order.id);
  if (orderUpdateError) return res.status(400).json({ success: false, error: orderUpdateError.message });

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('no_show_count')
    .eq('id', order.user_id)
    .single();
  if (profileError) return res.status(400).json({ success: false, error: profileError.message });
  const noShowCount = (Number(profile.no_show_count) || 0) + 1;
  const { error: countError } = await supabaseAdmin
    .from('profiles')
    .update({ no_show_count: noShowCount })
    .eq('id', order.user_id);
  if (countError) return res.status(400).json({ success: false, error: countError.message });

  res.status(201).json({ success: true, data: { orderId: order.id, noShowCount } });
});

app.delete('/api/admin/orders/:id/no-show', ...adminOnly, async (req, res) => {
  const { data: order, error: orderLookupError } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (orderLookupError) return res.status(400).json({ success: false, error: orderLookupError.message });
  if (!order) return res.status(404).json({ success: false, error: '원복할 주문을 찾지 못했습니다.' });
  if (order.status !== 'expired') {
    return res.status(409).json({ success: false, error: '미수령 만료 상태인 주문만 원복할 수 있습니다.' });
  }

  const { data: event, error: eventError } = await supabaseAdmin
    .from('no_show_events')
    .select('order_id, user_id')
    .eq('order_id', req.params.id)
    .maybeSingle();
  if (eventError) return res.status(400).json({ success: false, error: eventError.message });

  if (event) {
    const { error: deleteError } = await supabaseAdmin
      .from('no_show_events')
      .delete()
      .eq('order_id', req.params.id);
    if (deleteError) return res.status(400).json({ success: false, error: deleteError.message });
  }

  const { error: orderError } = await supabaseAdmin
    .from('orders')
    .update({
      status: 'ready',
      barcode_locked: false,
      pickup_date: seoulDateISO()
    })
    .eq('id', req.params.id);
  if (orderError) return res.status(400).json({ success: false, error: orderError.message });

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('no_show_count')
    .eq('id', order.user_id)
    .single();
  if (profileError) return res.status(400).json({ success: false, error: profileError.message });
  const noShowCount = event
    ? Math.max(0, (Number(profile.no_show_count) || 0) - 1)
    : Math.max(0, Number(profile.no_show_count) || 0);
  if (event) {
    const { error: countError } = await supabaseAdmin
      .from('profiles')
      .update({ no_show_count: noShowCount })
      .eq('id', order.user_id);
    if (countError) return res.status(400).json({ success: false, error: countError.message });
  }

  res.json({ success: true, data: { orderId: req.params.id, noShowCount } });
});

app.post('/api/admin/no-shows', ...adminOnly, async (req, res) => {
  const { orderId, reason } = req.body || {};
  if (!orderId) return res.status(400).json({ success: false, error: '주문 ID가 필요합니다.' });

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, status')
    .eq('id', orderId)
    .single();
  if (orderError) return res.status(404).json({ success: false, error: '주문을 찾지 못했습니다.' });

  const { error: eventError } = await supabaseAdmin
    .from('no_show_events')
    .insert({ order_id: order.id, user_id: order.user_id, reason: reason || null });
  if (eventError) return res.status(400).json({ success: false, error: eventError.message });

  const { error: updateError } = await supabaseAdmin
    .from('orders')
    .update({ status: 'expired' })
    .eq('id', order.id);
  if (updateError) return res.status(400).json({ success: false, error: updateError.message });

  res.status(201).json({ success: true });
});

app.delete('/api/admin/no-shows/:orderId', ...adminOnly, async (req, res) => {
  const { error } = await supabaseAdmin
    .from('no_show_events')
    .delete()
    .eq('order_id', req.params.orderId);
  if (error) return res.status(400).json({ success: false, error: error.message });

  await supabaseAdmin.from('orders').update({ status: 'ready' }).eq('id', req.params.orderId);
  res.json({ success: true });
});

app.get('/api/admin/inquiries', ...adminOnly, async (_req, res) => {
  const { data, error } = await supabaseAdmin.from('inquiries')
    .select('id, user_id, product_id, order_id, content, status, answer, answered_at, created_at, products(name)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [] });
});

app.patch('/api/admin/inquiries/:id/answer', ...adminOnly, async (req, res) => {
  const answer = String(req.body?.answer || '').trim();
  if (!answer) return res.status(400).json({ success: false, error: '답변 내용을 입력해 주세요.' });

  const { data, error } = await supabaseAdmin
    .from('inquiries')
    .update({
      answer,
      status: 'answered',
      answered_by: req.user.id,
      answered_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select('*, products(name)')
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  try {
    await upsertNotifications({
      user_id: data.user_id,
      type: 'inquiry_answer',
      title: '문의에 답변이 등록됐어요',
      body: `${data.products?.name || '문의한 상품'}에 남긴 문의 답변을 확인해 주세요.`,
      link: data.product_id
        ? `./product-detail.html?id=${encodeURIComponent(data.product_id)}#inquiry`
        : './my-page.html#inquiries',
      dedupe_key: `inquiry-answer:${data.id}`
    });
  } catch (notifyError) {
    return res.json({ success: true, data, warning: `답변은 저장됐지만 알림 생성에 실패했습니다: ${notifyError.message}` });
  }
  res.json({ success: true, data });
});

app.get('/api/admin/products/:id/restock-subscribers', ...adminOnly, async (req, res) => {
  let productId = req.params.id;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId);
  if (!isUuid) {
    const productName = String(req.query.name || '').trim();
    if (!productName) return res.json({ success: true, data: [] });
    const { data: matchedProduct, error: productError } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('name', productName)
      .maybeSingle();
    if (productError) return res.status(400).json({ success: false, error: productError.message });
    if (!matchedProduct) return res.json({ success: true, data: [] });
    productId = matchedProduct.id;
  }

  let query = supabaseAdmin
    .from('restock_subscriptions')
    .select('user_id, request_type, quantity, payment_type, pickup_date, pickup_time_label, depositor_name, promoted_at, created_at, updated_at')
    .eq('product_id', productId)
    .eq('is_active', true);
  if (req.query.type === 'waitlist' || req.query.type === 'restock') {
    query = query.eq('request_type', req.query.type);
  }
  query = query.order('created_at', { ascending: req.query.type === 'waitlist' });
  const { data: subscriptions, error } = await query;
  if (error) return res.status(400).json({ success: false, error: error.message });

  const userIds = [...new Set((subscriptions || []).map((item) => item.user_id).filter(Boolean))];
  let profilesById = new Map();
  if (userIds.length) {
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, name, phone')
      .in('id', userIds);
    if (profilesError) return res.status(400).json({ success: false, error: profilesError.message });
    profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  }

  const data = (subscriptions || []).map((item) => ({
    ...item,
    profiles: profilesById.get(item.user_id) || null
  }));
  res.json({ success: true, data });
});

app.post('/api/admin/products/:productId/waitlist/:userId/notify', ...adminOnly, async (req, res) => {
  const { productId, userId } = req.params;
  const { data: subscription, error } = await supabaseAdmin
    .from('restock_subscriptions')
    .select('user_id, product_id, updated_at, products(name)')
    .eq('product_id', productId)
    .eq('user_id', userId)
    .eq('request_type', 'waitlist')
    .eq('is_active', true)
    .maybeSingle();
  if (error) return res.status(400).json({ success: false, error: error.message });
  if (!subscription) {
    return res.status(404).json({ success: false, error: '활성 상태인 대기 신청을 찾지 못했습니다.' });
  }

  try {
    await upsertNotifications({
      user_id: subscription.user_id,
      type: 'waitlist_promoted',
      title: `${subscription.products?.name || '대기 신청 상품'} 신청 가능`,
      body: '신청 가능한 수량이 생겼어요. 상품 페이지에서 확인해 주세요.',
      link: `./product-detail.html?id=${encodeURIComponent(productId)}`,
      dedupe_key: `waitlist-invite:${productId}:${userId}:${subscription.updated_at}`
    });
    const { error: deactivateError } = await supabaseAdmin
      .from('restock_subscriptions')
      .update({ is_active: false })
      .eq('product_id', productId)
      .eq('user_id', userId)
      .eq('request_type', 'waitlist')
      .eq('is_active', true);
    if (deactivateError) throw deactivateError;
    res.json({ success: true });
  } catch (notifyError) {
    res.status(400).json({ success: false, error: notifyError.message });
  }
});

app.patch('/api/admin/products/:id', ...adminOnly, async (req, res) => {
  try {
    const beforeCatalog = await readCatalog(true);
    const beforeProduct = beforeCatalog.find((item) => item.id === req.params.id);
    const values = productPayload(req.body || {});
    if (!values.name || !['bundle', 'fruit', 'market'].includes(values.category)) {
      return res.status(400).json({ success: false, error: '상품명과 판매 위치를 확인해 주세요.' });
    }
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .update(values)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    await upsertBundleForProduct(product, req.body || {}, req.user.id);
    const catalog = await readCatalog(true);
    const savedProduct = catalog.find((item) => item.id === product.id);
    let restockNotificationCount = 0;
    if (beforeProduct && Number(beforeProduct.stock || 0) <= 0 && Number(savedProduct?.stock || 0) > 0) {
      restockNotificationCount = await notifyRestockSubscribers(product.id, product.name);
    }
    let publishNotificationCount = 0;
    let notificationWarning = null;
    if (
      product.category === 'bundle'
      && beforeProduct?.isActive === false
      && savedProduct?.isActive !== false
      && req.body?.sendPublishNotification === true
    ) {
      try {
        publishNotificationCount = await notifyCustomersOfNewBundle(product);
      } catch (notificationError) {
        notificationWarning = `상품은 공개됐지만 새 보따리 알림 생성에 실패했습니다: ${notificationError.message}`;
      }
    }
    await recordAdminAudit({
      adminId: req.user.id,
      action: 'product_updated',
      targetType: 'product',
      targetId: product.id,
      before: beforeProduct,
      after: savedProduct,
      metadata: { restockNotificationCount, publishNotificationCount }
    });
    res.json({
      success: true,
      data: savedProduct,
      restockNotificationCount,
      publishNotificationCount,
      warning: notificationWarning
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.patch('/api/admin/products/:id/settings', ...adminOnly, async (req, res) => {
  try {
    const productUpdates = {};
    if (typeof req.body?.showOriginalPrice === 'boolean') {
      productUpdates.show_original_price = req.body.showOriginalPrice;
    }
    if (typeof req.body?.isRecommended === 'boolean') {
      productUpdates.is_recommended = req.body.isRecommended;
    }
    if (typeof req.body?.isActive === 'boolean') {
      productUpdates.is_active = req.body.isActive;
    }
    if (Number.isFinite(Number(req.body?.stock))) {
      productUpdates.stock_quantity = Math.max(0, Number(req.body.stock));
    }
    if (Number.isFinite(Number(req.body?.totalStock))) {
      productUpdates.initial_stock_quantity = Math.max(1, Number(req.body.totalStock));
    }

    if (Object.keys(productUpdates).length) {
      const { error: productError } = await supabaseAdmin
        .from('products')
        .update(productUpdates)
        .eq('id', req.params.id);
      if (productError) throw productError;
    }

    const { data: bundleItem, error: bundleItemError } = await supabaseAdmin
      .from('bundle_items')
      .select('id, bundle_id')
      .eq('product_id', req.params.id)
      .maybeSingle();
    if (bundleItemError) throw bundleItemError;

    if (bundleItem) {
      const itemUpdates = {};
      if (Number.isFinite(Number(req.body?.stock))) {
        itemUpdates.stock_quantity = Math.max(0, Number(req.body.stock));
      }
      if (Number.isFinite(Number(req.body?.totalStock))) {
        itemUpdates.initial_stock_quantity = Math.max(1, Number(req.body.totalStock));
      }
      if (Object.keys(itemUpdates).length) {
        const { error: itemError } = await supabaseAdmin
          .from('bundle_items')
          .update(itemUpdates)
          .eq('id', bundleItem.id);
        if (itemError) throw itemError;
      }
      if (typeof req.body?.isClosed === 'boolean') {
        const { error: bundleError } = await supabaseAdmin
          .from('bundles')
          .update({ status: req.body.isClosed ? 'closed' : 'recruiting' })
          .eq('id', bundleItem.bundle_id);
        if (bundleError) throw bundleError;
      }
    }

    const catalog = await readCatalog(true);
    const savedProduct = catalog.find((item) => item.id === req.params.id);
    if (!savedProduct) return res.status(404).json({ success: false, error: '상품을 찾지 못했습니다.' });
    await recordAdminAudit({
      adminId: req.user.id,
      action: 'product_settings_updated',
      targetType: 'product',
      targetId: req.params.id,
      after: savedProduct,
      metadata: req.body || {}
    });
    res.json({ success: true, data: savedProduct });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/products/:id', ...adminOnly, async (req, res) => {
  try {
    const deletedAt = new Date().toISOString();
    const { data: currentProduct, error: currentError } = await supabaseAdmin
      .from('products')
      .select('id, name, tags')
      .eq('id', req.params.id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!currentProduct || (currentProduct.tags || []).includes('__deleted__')) {
      return res.status(404).json({ success: false, error: '상품을 찾지 못했습니다.' });
    }
    const tags = [...new Set([...(currentProduct.tags || []), '__deleted__'])];
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .update({ is_active: false, tags })
      .eq('id', req.params.id)
      .select('id, name')
      .maybeSingle();
    if (error) throw error;

    const { data: bundleItems, error: itemError } = await supabaseAdmin
      .from('bundle_items')
      .update({ arrival_status: 'cancelled' })
      .eq('product_id', req.params.id)
      .select('bundle_id');
    const cleanupWarnings = [];
    if (itemError) cleanupWarnings.push(`보따리 입고 상태 정리 실패: ${itemError.message}`);
    const bundleIds = [...new Set((bundleItems || []).map((item) => item.bundle_id).filter(Boolean))];
    if (bundleIds.length) {
      const { error: bundleError } = await supabaseAdmin
        .from('bundles')
        .update({ status: 'cancelled' })
        .in('id', bundleIds);
      if (bundleError) cleanupWarnings.push(`보따리 상태 정리 실패: ${bundleError.message}`);
    }
    const { error: subscriptionError } = await supabaseAdmin
      .from('restock_subscriptions')
      .update({ is_active: false })
      .eq('product_id', req.params.id)
      .eq('is_active', true);
    if (subscriptionError) cleanupWarnings.push(`신청자 명단 정리 실패: ${subscriptionError.message}`);

    await recordAdminAudit({
      adminId: req.user.id,
      action: 'product_deleted',
      targetType: 'product',
      targetId: product.id,
      before: currentProduct,
      after: { id: product.id, isActive: false, deletedAt },
      metadata: { cleanupWarnings }
    });
    res.json({
      success: true,
      data: { id: product.id, deletedAt },
      ...(cleanupWarnings.length ? { warning: cleanupWarnings.join(' / ') } : {})
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.patch('/api/admin/products-legacy/:id', ...adminOnly, async (req, res) => {
  const allowed = ['name', 'description', 'price', 'original_price', 'show_original_price', 'is_active'];
  const updates = Object.fromEntries(
    Object.entries(req.body || {}).filter(([key]) => allowed.includes(key))
  );
  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: '변경할 상품 정보가 없습니다.' });
  }
  const { data, error } = await supabaseAdmin
    .from('products')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

// 🛠️ [수정 완료] 리뷰 조회 API (productId가 없어도 400에러를 내지 않고 전체 반환)
app.get('/api/reviews', async (req, res) => {
  let query = supabaseAdmin
    .from('reviews')
    .select('id, user_id, product_id, order_id, rating, content, photo_urls, admin_reply, created_at, products(name, category)')
    .eq('is_visible', true)
    .order('created_at', { ascending: false })
    .limit(200);

  // 쿼리 파라미터가 유효하게 전달된 경우에만 eq 조건 추가
  if (req.query.productId && req.query.productId !== 'undefined' && req.query.productId !== 'null') {
    query = query.eq('product_id', req.query.productId);
  }

  const { data: reviews, error } = await query;
  if (error) return res.status(400).json({ success: false, error: error.message });

  const userIds = [...new Set((reviews || []).map((review) => review.user_id).filter(Boolean))];
  let names = new Map();
  if (userIds.length) {
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles').select('id, name').in('id', userIds);
    if (profileError) return res.status(400).json({ success: false, error: profileError.message });
    names = new Map((profiles || []).map((profile) => [profile.id, profile.name]));
  }
  res.json({
    success: true,
    data: (reviews || []).map((review) => ({
      id: review.id,
      productId: review.product_id,
      orderId: review.order_id,
      productName: review.products?.name || '',
      productCategory: review.products?.category || 'market',
      userName: names.get(review.user_id) || '고객',
      rating: review.rating,
      comment: review.content,
      photoUrls: review.photo_urls || [],
      reply: review.admin_reply || null,
      isVisible: true,
      date: String(review.created_at).slice(0, 10),
      createdAt: review.created_at
    }))
  });
});

app.post('/api/reviews', requireAuth, async (req, res) => {
  const { orderId, rating, content, photoUrls } = req.body || {};
  const cleanContent = String(content || '').trim();
  if (!orderId || !cleanContent || Number(rating) < 1 || Number(rating) > 5) {
    return res.status(400).json({ success: false, error: '주문, 별점, 후기 내용을 확인해 주세요.' });
  }
  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, status, bundle_items(product_id)')
    .eq('id', orderId)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (orderError) return res.status(400).json({ success: false, error: orderError.message });
  if (!order || order.status !== 'completed') {
    return res.status(403).json({ success: false, error: '수령 완료된 실제 주문만 후기를 작성할 수 있습니다.' });
  }
  const { data: existing } = await supabaseAdmin
    .from('reviews').select('id').eq('order_id', order.id).maybeSingle();
  if (existing) return res.status(409).json({ success: false, error: '이미 후기를 작성한 주문입니다.' });

  const { data, error } = await supabaseAdmin.from('reviews').insert({
    user_id: req.user.id,
    product_id: order.bundle_items.product_id,
    order_id: order.id,
    rating: Number(rating),
    content: cleanContent,
    photo_urls: Array.isArray(photoUrls) ? photoUrls.filter(Boolean).slice(0, 10) : []
  }).select().single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.status(201).json({ success: true, data });
});

app.patch('/api/admin/reviews/:id', ...adminOnly, async (req, res) => {
  const updates = {};
  if (typeof req.body?.is_visible === 'boolean') updates.is_visible = req.body.is_visible;
  if (typeof req.body?.admin_reply === 'string') {
    updates.admin_reply = req.body.admin_reply.trim() || null;
    updates.replied_by = updates.admin_reply ? req.user.id : null;
    updates.replied_at = updates.admin_reply ? new Date().toISOString() : null;
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: '변경할 후기 정보가 없습니다.' });
  }
  const { data, error } = await supabaseAdmin
    .from('reviews')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.get('/api/favorites', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('favorites')
    .select('product_id, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data: (data || []).map((item) => item.product_id) });
});

app.put('/api/favorites/:productId', requireAuth, async (req, res) => {
  const { error } = await supabaseAdmin
    .from('favorites')
    .upsert({
      user_id: req.user.id,
      product_id: req.params.productId
    }, { onConflict: 'user_id,product_id' });
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, favorite: true });
});

app.delete('/api/favorites/:productId', requireAuth, async (req, res) => {
  const { error } = await supabaseAdmin
    .from('favorites')
    .delete()
    .eq('user_id', req.user.id)
    .eq('product_id', req.params.productId);
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, favorite: false });
});

function decodeImageDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('지원하지 않는 이미지 형식입니다.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
    throw new Error('이미지는 한 장당 5MB 이하만 업로드할 수 있습니다.');
  }
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  return { buffer, contentType: match[1], extension: extensions[match[1]] };
}

async function uploadImageDataUrl(bucket, ownerId, dataUrl) {
  const image = decodeImageDataUrl(dataUrl);
  const objectPath = `${ownerId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${image.extension}`;
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(objectPath, image.buffer, {
      contentType: image.contentType,
      cacheControl: '31536000',
      upsert: false
    });
  if (error) throw error;
  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(objectPath);
  return data.publicUrl;
}

app.post('/api/uploads/review-image', requireAuth, async (req, res) => {
  try {
    const url = await uploadImageDataUrl('review-images', req.user.id, req.body?.dataUrl);
    res.status(201).json({ success: true, url });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/uploads/product-image', ...adminOnly, async (req, res) => {
  try {
    const url = await uploadImageDataUrl('product-images', req.user.id, req.body?.dataUrl);
    res.status(201).json({ success: true, url });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/push/config', (_req, res) => {
  res.json({ success: true, enabled: pushEnabled, publicKey: pushEnabled ? VAPID_PUBLIC_KEY : null });
});

app.get('/api/push/subscriptions/status', requireAuth, async (req, res) => {
  const endpoint = String(req.query?.endpoint || '').trim();
  let query = supabaseAdmin
    .from('web_push_subscriptions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.user.id)
    .eq('is_active', true);
  if (endpoint) query = query.eq('endpoint', endpoint);
  const { count, error } = await query;
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({
    success: true,
    registered: Number(count) > 0,
    activeDeviceCount: Number(count) || 0,
    pushConfigured: pushEnabled
  });
});

app.post('/api/push/subscriptions', requireAuth, async (req, res) => {
  const endpoint = String(req.body?.endpoint || '').trim();
  const p256dh = String(req.body?.keys?.p256dh || '').trim();
  const authKey = String(req.body?.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !authKey) {
    return res.status(400).json({ success: false, error: '푸시 구독 정보가 올바르지 않습니다.' });
  }
  const { data, error } = await supabaseAdmin
    .from('web_push_subscriptions')
    .upsert({
      user_id: req.user.id,
      endpoint,
      p256dh,
      auth_key: authKey,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
      is_active: true
    }, { onConflict: 'endpoint' })
    .select('id')
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });

  await supabaseAdmin
    .from('profiles')
    .update({
      notification_settings: {
        enabled: true,
        all: true,
        arrival: true,
        inquiry: true,
        important: true
      }
    })
    .eq('id', req.user.id);

  // 알림이 먼저 생성되고 기기 구독이 나중에 완료된 경우, 최근 알림을 놓치지 않도록 즉시 재전송합니다.
  let resumedNotificationCount = 0;
  if (pushEnabled) {
    const recentSince = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: recentNotifications, error: recentError } = await supabaseAdmin
      .from('notifications')
      .select('id, user_id, type, title, body, link, push_sent_at, push_attempt_count')
      .eq('user_id', req.user.id)
      .is('read_at', null)
      .is('push_sent_at', null)
      .gte('created_at', recentSince)
      .order('created_at', { ascending: false })
      .limit(5);
    if (!recentError && recentNotifications?.length) {
      const notificationIds = recentNotifications.map((notification) => notification.id);
      await supabaseAdmin
        .from('notifications')
        .update({ push_next_retry_at: new Date().toISOString() })
        .in('id', notificationIds);
      const results = await Promise.allSettled(recentNotifications.map(deliverPushNotification));
      resumedNotificationCount = results.filter((result) => result.status === 'fulfilled').length;
    }
  }
  res.status(201).json({ success: true, data, resumedNotificationCount });
});

app.delete('/api/push/subscriptions', requireAuth, async (req, res) => {
  const endpoint = String(req.body?.endpoint || '').trim();
  if (!endpoint) return res.status(400).json({ success: false, error: '구독 주소가 필요합니다.' });
  const { error } = await supabaseAdmin
    .from('web_push_subscriptions')
    .update({ is_active: false })
    .eq('user_id', req.user.id)
    .eq('endpoint', endpoint);
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true });
});

app.patch('/api/profile/notification-settings', requireAuth, async (req, res) => {
  const enabled = typeof req.body?.enabled === 'boolean'
    ? req.body.enabled
    : !(
      req.body?.arrival === false
      && req.body?.inquiry === false
      && req.body?.important === false
    );
  const notificationSettings = {
    enabled,
    all: enabled,
    arrival: enabled,
    inquiry: enabled,
    important: enabled
  };
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ notification_settings: notificationSettings })
    .eq('id', req.user.id)
    .select('notification_settings')
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data: data.notification_settings });
});

app.get('/vendor/supabase.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'));
});

app.use(express.static(PUBLIC_DIR, {
  dotfiles: 'deny',
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      success: false,
      error: '전송한 이미지 또는 상품 정보의 용량이 너무 큽니다. 이미지 수나 용량을 줄여 다시 시도해 주세요.'
    });
  }
  if (err instanceof SyntaxError && err?.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: '상품 등록 요청 형식을 읽지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.'
    });
  }
  res.status(500).json({
    success: false,
    error: '서버 요청 처리 중 오류가 발생했습니다. 서버를 다시 실행한 뒤 재시도해 주세요.'
  });
});

async function retryPendingPushNotifications() {
  if (!pushEnabled) return;
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('id, user_id, type, title, body, link, push_sent_at, push_attempt_count')
    .is('push_sent_at', null)
    .not('push_next_retry_at', 'is', null)
    .lte('push_next_retry_at', new Date().toISOString())
    .lt('push_attempt_count', 5)
    .limit(50);
  if (error) {
    console.error('푸시 재시도 목록 조회 실패:', error.message);
    return;
  }
  await Promise.allSettled((data || []).map(deliverPushNotification));
}

async function expireOverdueTransferOrders() {
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, bundle_items(bundles(order_deadline))')
    .eq('payment_type', 'transfer')
    .eq('payment_status', 'pending')
    .in('status', ['applied', 'ready'])
    .limit(200);
  if (error) throw error;

  const now = Date.now();
  for (const order of orders || []) {
    const deadline = new Date(order.bundle_items?.bundles?.order_deadline).getTime();
    if (!Number.isFinite(deadline) || deadline + PAYMENT_EXPIRY_GRACE_MINUTES * 60_000 > now) continue;
    const { data: cancelled, error: cancelError } = await supabaseAdmin.rpc('cancel_customer_order', {
      p_order_id: order.id,
      p_actor_id: order.user_id,
      p_actor_role: 'admin',
      p_reason: '입금 기한 만료로 자동 취소'
    });
    if (cancelError) {
      console.error('입금 대기 자동 만료 실패:', order.id, cancelError.message);
      continue;
    }
    await upsertNotifications({
      user_id: order.user_id,
      type: 'order_cancelled',
      title: '입금 기한이 지나 주문이 취소되었어요',
      body: '입금 확인 전 신청 마감 시간이 지나 주문이 자동 취소되었습니다.',
      link: './order-history.html',
      dedupe_key: `payment-expired:${order.id}`
    });
    await recordAdminAudit({
      action: 'payment_auto_expired',
      targetType: 'order',
      targetId: order.id,
      after: cancelled,
      metadata: { graceMinutes: PAYMENT_EXPIRY_GRACE_MINUTES }
    });
  }
}

async function notifyAdminsOfUpcomingUnpaidTransfers() {
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, bundle_item_id, bundle_items(id, products(name), bundles(id, title, order_deadline))')
    .eq('payment_type', 'transfer')
    .eq('payment_status', 'pending')
    .in('status', ['applied', 'ready'])
    .limit(500);
  if (error) throw error;

  const now = Date.now();
  const upcoming = new Map();
  for (const order of orders || []) {
    const bundle = order.bundle_items?.bundles;
    const deadline = new Date(bundle?.order_deadline).getTime();
    const remaining = deadline - now;
    if (!Number.isFinite(deadline) || remaining <= 0 || remaining > 60 * 60 * 1000) continue;
    const key = bundle?.id || order.bundle_item_id;
    const current = upcoming.get(key) || {
      id: key,
      title: bundle?.title || order.bundle_items?.products?.name || '보따리',
      deadline: bundle?.order_deadline,
      count: 0
    };
    current.count += 1;
    upcoming.set(key, current);
  }
  if (!upcoming.size) return 0;

  const { data: admins, error: adminError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('role', 'admin');
  if (adminError) throw adminError;

  const rows = [];
  for (const admin of admins || []) {
    for (const bundle of upcoming.values()) {
      rows.push({
        user_id: admin.id,
        type: 'payment_reminder',
        title: '신청 마감 1시간 전 · 미입금 확인',
        body: `${bundle.title}에 미입금 주문 ${bundle.count}건이 있어요. 입금 내역을 확인해 주세요.`,
        link: './admin.html',
        dedupe_key: `admin-unpaid-deadline:${bundle.id}:${bundle.deadline}`
      });
    }
  }
  await upsertNotifications(rows);
  return rows.length;
}

async function runScheduledMaintenance() {
  return Promise.allSettled([
    retryPendingPushNotifications(),
    expireOverdueTransferOrders(),
    expireOverduePickupOrders(),
    notifyAdminsOfUpcomingUnpaidTransfers()
  ]);
}

if (!IS_CLOUDFLARE_WORKER) {
const pushRetryTimer = setInterval(() => {
  retryPendingPushNotifications().catch((error) => {
    console.error('푸시 재시도 실패:', error.message);
  });
}, 60 * 1000);
pushRetryTimer.unref();

const paymentExpiryTimer = setInterval(() => {
  expireOverdueTransferOrders().catch((error) => {
    console.error('입금 자동 만료 작업 실패:', error.message);
  });
}, 60 * 1000);
paymentExpiryTimer.unref();

const pickupExpiryTimer = setInterval(() => {
  expireOverduePickupOrders().catch((error) => {
    console.error('지정 수령일 경과 자동 만료 작업 실패:', error.message);
  });
}, 60 * 1000);
pickupExpiryTimer.unref();

const unpaidDeadlineReminderTimer = setInterval(() => {
  notifyAdminsOfUpcomingUnpaidTransfers().catch((error) => {
    console.error('마감 전 관리자 미입금 알림 생성 실패:', error.message);
  });
}, 60 * 1000);
unpaidDeadlineReminderTimer.unref();

setTimeout(() => {
  expireOverduePickupOrders().catch((error) => {
    console.error('초기 지정 수령일 경과 자동 만료 실패:', error.message);
  });
  notifyAdminsOfUpcomingUnpaidTransfers().catch((error) => {
    console.error('초기 관리자 미입금 알림 생성 실패:', error.message);
  });
}, 5 * 1000).unref();
}

app.listen(PORT, '0.0.0.0', () => {
  if (!IS_CLOUDFLARE_WORKER) {
    console.log(`Server running on port ${PORT}`);
  }
});

// 1. 디코딩 함수 (최상단 위치 유지)
// ✅ 수정 후: Cloudflare Workers 표준 UTF-8 디코딩
function decodeBase64Korean(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '';
  if (/[가-힣]/.test(rawValue)) return rawValue;

  const hasPrefix = /^base64:/i.test(rawValue);
  const encodedValue = hasPrefix ? rawValue.replace(/^base64:/i, '').trim() : rawValue;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedValue) || encodedValue.length % 4 !== 0) {
    return rawValue;
  }
  try {
    const binaryString = atob(encodedValue);
    const bytes = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    if (!decoded || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(decoded)) {
      return rawValue;
    }
    return decoded;
  } catch (e) {
    return rawValue;
  }
}

// 2. 통합된 단 하나의 export default
export default {
  // 스케줄러 기능이 필요한 경우를 대비해 유지
  runScheduledMaintenance,

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 기존 Express / Hono 앱이 요청을 처리하도록 연결
    if (typeof app !== "undefined" && typeof app.fetch === "function") {
      return app.fetch(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  }
};
