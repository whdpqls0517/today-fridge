require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 .env에 설정해 주세요.');
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
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

// service role은 RLS를 우회하므로 이 클라이언트는 오직 인증된 백엔드 API에서만 사용합니다.
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

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

async function requireAdmin(req, res, next) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, phone, role, login_provider')
    .eq('id', req.user.id)
    .maybeSingle();

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
  res.json({ success: true });
});

app.get('/api/config', (_req, res) => {
  res.json({
    success: true,
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: PUBLISHABLE_KEY || null,
    authReady: Boolean(PUBLISHABLE_KEY)
  });
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
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, phone, role, login_provider')
    .eq('id', req.user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: '회원 정보를 불러오지 못했습니다.' });
  res.json({
    success: true,
    user: { id: req.user.id, email: req.user.email || null },
    profile
  });
});

function mapCatalogItem(product, bundleItem = null) {
  const bundle = bundleItem?.bundles || null;
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
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
    tags: product.tags || [],
    stock: bundleItem?.stock_quantity ?? product.stock_quantity ?? 0,
    totalStock: bundleItem?.initial_stock_quantity ?? product.initial_stock_quantity ?? 1,
    salesCount: product.sales_count || 0,
    rating: Number(product.rating || 0),
    reviewsCount: product.reviews_count || 0,
    isRecommended: product.is_recommended === true,
    prepaymentOnly: product.prepayment_only === true,
    isActive: product.is_active !== false,
    deadline: bundle?.order_deadline ? String(bundle.order_deadline).slice(0, 10) : null,
    deadlineTime: bundle?.order_deadline ? String(bundle.order_deadline).slice(11, 16) : null,
    pickupDate: bundle?.default_pickup_date || null,
    maxQuantity: bundleItem?.max_quantity_per_user || null,
    barcodeValue: bundleItem?.barcode_value || null,
    arrivalStatus: bundleItem?.arrival_status || null,
    arrivalExpectedText: bundleItem?.arrival_expected_text || '',
    arrivedAt: bundleItem?.arrived_at || null,
    isClosed: bundle ? ['closed', 'finished', 'cancelled'].includes(bundle.status) : false,
    createdAt: product.created_at,
    updatedAt: product.updated_at
  };
}

async function readCatalog(includeInactive = false) {
  let productQuery = supabaseAdmin.from('products').select('*').order('created_at', { ascending: false });
  if (!includeInactive) productQuery = productQuery.eq('is_active', true);
  const [{ data: products, error: productsError }, { data: items, error: itemsError }] = await Promise.all([
    productQuery,
    supabaseAdmin.from('bundle_items').select('*, bundles(*)').order('created_at', { ascending: false })
  ]);
  if (productsError) throw productsError;
  if (itemsError) throw itemsError;
  const itemByProduct = new Map();
  (items || []).forEach((item) => {
    if (!itemByProduct.has(item.product_id)) itemByProduct.set(item.product_id, item);
  });
  return (products || []).map((product) => mapCatalogItem(product, itemByProduct.get(product.id)));
}

app.get('/api/catalog', async (_req, res) => {
  try {
    res.json({ success: true, data: await readCatalog(false) });
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
    tags: Array.isArray(body.tags) ? body.tags : [],
    stock_quantity: Math.max(0, Number(body.stock) || 0),
    initial_stock_quantity: Math.max(1, Number(body.totalStock) || 1),
    is_recommended: body.isRecommended === true,
    prepayment_only: body.prepaymentOnly === true,
    is_active: body.isActive !== false
  };
}

async function upsertBundleForProduct(product, body, userId) {
  if (product.category !== 'bundle') return null;
  const deadlineDate = String(body.deadline || '').trim();
  const pickupDate = String(body.pickupDate || '').trim();
  if (!deadlineDate || !pickupDate) throw new Error('보따리 마감일과 수령일을 입력해 주세요.');
  const bundleValues = {
    title: product.name,
    order_deadline: `${deadlineDate}T${body.deadlineTime || '23:59'}:00+09:00`,
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
  const { error: itemError } = await supabaseAdmin.from('bundle_items').upsert({
    bundle_id: bundleId,
    product_id: product.id,
    sale_price: Math.max(0, Number(body.price) || 0),
    stock_quantity: Math.max(0, Number(body.stock) || 0),
    initial_stock_quantity: Math.max(1, Number(body.totalStock) || 1),
    max_quantity_per_user: Math.max(1, Number(body.maxQuantity) || 10),
    barcode_value: body.barcodeValue || null,
    arrival_status: body.arrivalStatus || 'scheduled',
    arrival_expected_text: body.arrivalExpectedText || null,
    arrived_at: body.arrivalStatus === 'arrived' ? (body.arrivedAt || new Date().toISOString()) : null
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
    res.status(201).json({ success: true, data: catalog.find((item) => item.id === product.id) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/dashboard', ...adminOnly, async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const [ordersResult, pendingResult, expiredResult, inquiriesResult] = await Promise.all([
    supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }).gte('created_at', `${today}T00:00:00`),
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
    .select('*, bundle_items(*, products(*), bundles(*)), profiles!orders_user_id_fkey(name, phone)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (req.query.status) query = query.eq('status', req.query.status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.get('/api/orders', requireAuth, async (req, res) => {
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

app.post('/api/orders', requireAuth, async (req, res) => {
  const { bundleItemId, quantity, paymentType, pickupDate, pickupTimeLabel, depositorName } = req.body || {};
  if (!bundleItemId || !pickupDate) {
    return res.status(400).json({ success: false, error: '상품과 수령일을 확인해 주세요.' });
  }
  const { data, error } = await supabaseAdmin.rpc('create_customer_order_v2', {
    p_user_id: req.user.id,
    p_bundle_item_id: bundleItemId,
    p_quantity: Math.max(1, Number(quantity) || 1),
    p_payment_type: paymentType === 'transfer' ? 'transfer' : 'onsite',
    p_pickup_date: pickupDate,
    p_pickup_time_label: pickupTimeLabel === '오후 7시 이전' ? '오후 7시 이전' : '오후 7시 이후',
    p_depositor_name: depositorName || null
  });
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.status(201).json({ success: true, data });
});

app.post('/api/orders/:id/cancel', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc('cancel_customer_order', {
    p_order_id: req.params.id,
    p_actor_id: req.user.id,
    p_actor_role: 'customer',
    p_reason: req.body?.reason || null
  });
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.patch('/api/orders/:id/pickup-date', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc('change_order_pickup_date', {
    p_order_id: req.params.id,
    p_user_id: req.user.id,
    p_pickup_date: req.body?.pickupDate
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

app.post('/api/admin/orders/:id/cancel', ...adminOnly, async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc('cancel_customer_order', {
    p_order_id: req.params.id,
    p_actor_id: req.user.id,
    p_actor_role: 'admin',
    p_reason: req.body?.reason || null
  });
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.post('/api/admin/orders/:id/confirm-payment', ...adminOnly, async (req, res) => {
  const { data: order, error } = await supabaseAdmin
    .from('orders').update({ payment_status: 'confirmed' }).eq('id', req.params.id)
    .eq('payment_type', 'transfer').select('id, user_id, order_number').single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  await supabaseAdmin.from('notifications').upsert({
    user_id: order.user_id,
    type: 'pickup',
    title: '입금 확인이 완료됐어요',
    body: '주문 내역과 수령 확인증에서 상태를 확인해 주세요.',
    link: './main.html#receipt',
    dedupe_key: `payment-confirmed:${order.id}`
  }, { onConflict: 'user_id,dedupe_key' });
  res.json({ success: true, data: order });
});

app.post('/api/admin/orders/:id/payment-reminder', ...adminOnly, async (req, res) => {
  const { data: order, error } = await supabaseAdmin
    .from('orders').update({ payment_reminded_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('payment_type', 'transfer').eq('payment_status', 'pending')
    .select('id, user_id').single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  await supabaseAdmin.from('notifications').upsert({
    user_id: order.user_id, type: 'pickup', title: '입금 확인이 필요해요',
    body: '신청 마감 전까지 입금해 주세요. 입금 확인 후 수령 확인증이 활성화됩니다.',
    link: './order-history.html', dedupe_key: `payment-reminder:${order.id}:${new Date().toISOString().slice(0,10)}`
  }, { onConflict: 'user_id,dedupe_key' });
  res.json({ success: true });
});

app.post('/api/admin/bundle-items/:id/pickup-reminder', ...adminOnly, async (req, res) => {
  const { data: orders, error } = await supabaseAdmin.from('orders')
    .select('id, user_id').eq('bundle_item_id', req.params.id).in('status', ['applied', 'ready']);
  if (error) return res.status(400).json({ success: false, error: error.message });
  const today = new Date().toISOString().slice(0, 10);
  const rows = (orders || []).map((order) => ({
    user_id: order.user_id, type: 'pickup', title: '아직 수령하지 않은 상품이 있어요',
    body: '지정한 수령일을 확인하고 매장에 방문해 주세요.', link: './main.html#receipt',
    dedupe_key: `pickup-reminder:${order.id}:${today}`
  }));
  if (rows.length) {
    const { error: notifyError } = await supabaseAdmin.from('notifications').upsert(rows, { onConflict: 'user_id,dedupe_key' });
    if (notifyError) return res.status(400).json({ success: false, error: notifyError.message });
  }
  res.json({ success: true, count: rows.length });
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

app.post('/api/admin/no-shows', ...adminOnly, async (req, res) => {
  const { orderId, reason } = req.body || {};
  if (!orderId) return res.status(400).json({ success: false, error: '주문 ID가 필요합니다.' });

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, user_id')
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
    .select()
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

// 필요한 프론트 파일만 명시적으로 공개합니다. .env와 server.js는 절대 공개하지 않습니다.
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
    .select('user_id, request_type, created_at')
    .eq('product_id', productId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (req.query.type === 'waitlist' || req.query.type === 'restock') {
    query = query.eq('request_type', req.query.type);
  }
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

app.patch('/api/admin/products/:id', ...adminOnly, async (req, res) => {
  try {
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
    res.json({ success: true, data: catalog.find((item) => item.id === product.id) });
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

app.get('/api/reviews', async (req, res) => {
  let query = supabaseAdmin
    .from('reviews')
    .select('id, user_id, product_id, order_id, rating, content, photo_urls, admin_reply, created_at, products(name, category)')
    .eq('is_visible', true)
    .order('created_at', { ascending: false })
    .limit(200);
  if (req.query.productId) query = query.eq('product_id', req.query.productId);
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

app.use('/css', express.static(path.join(__dirname, 'css'), { dotfiles: 'deny' }));
app.use('/js', express.static(path.join(__dirname, 'js'), { dotfiles: 'deny' }));
app.get('/today-fridge.css', (_req, res) => res.sendFile(path.join(__dirname, 'today-fridge.css')));
app.get('/vendor/supabase.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'));
});

const publicImages = [
  'asset-daily-fruit.png',
  'asset-bundle-produce.png',
  'asset-bundle-mixed-food.png',
  'asset-bundle-food-gradient.png',
  'asset-mini-vote.png',
  'asset-mini-arrival-status.png',
  'asset-mini-guide.png',
  'asset-mini-chat.png',
  'asset-store-market.png'
];

publicImages.forEach((fileName) => {
  app.get(`/${fileName}`, (_req, res) => res.sendFile(path.join(__dirname, fileName)));
});

const publicPages = [
  'main.html',
  'login.html',
  'my-page.html',
  'notifications.html',
  'reviews.html',
  'review-write.html',
  'bundle-apply.html',
  'bundle-apply-complete.html',
  'order-history.html',
  'favorites.html',
  'search.html',
  'search-results.html',
  'category.html',
  'bundle-list.html',
  'fruit-list.html',
  'market-list.html',
  'product-detail.html',
  'admin.html',
  'admin-product-form.html'
];

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'main.html')));
publicPages.forEach((fileName) => {
  app.get(`/${fileName}`, (_req, res) => res.sendFile(path.join(__dirname, fileName)));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, error: '서버 요청 처리 중 오류가 발생했습니다.' });
});

app.listen(PORT, () => {
  console.log(`🚀 서버 실행 완료: http://localhost:${PORT}`);
});
