import {
  ActivityEvent,
  ActivityEventType,
  AnalyticsRangeMetrics,
  Product,
  RecommendationSet,
  SupplierAnalyticsMetrics,
  UserPreferenceProfile,
} from '../types/marketplace.ts';
import { isProductLiveOnStorefront, round2 } from './marketplace-engine.ts';
import {
  generateId,
  StoreSnapshot,
  upsertActivityEvent,
  upsertUserPreferenceProfile,
} from './store.ts';

export async function recordActivityEvent(
  store: StoreSnapshot,
  params: {
    userId?: string;
    sessionId?: string;
    type: ActivityEventType;
    productId?: string;
    supplierId?: string;
    category?: string;
    gender?: 'MEN' | 'WOMEN' | 'UNISEX';
    query?: string;
    priceUsd?: number;
    size?: string;
    color?: string;
    source?: string;
  }
): Promise<ActivityEvent | null> {
  // Respect user analytics consent if disabled
  if (params.userId) {
    const user = store.users[params.userId];
    if (user && user.analyticsConsent === false) {
      return null;
    }
  }

  const event: ActivityEvent = {
    id: generateId('evt'),
    userId: params.userId,
    sessionId: params.sessionId,
    type: params.type,
    productId: params.productId,
    supplierId: params.supplierId,
    category: params.category,
    gender: params.gender,
    query: params.query ? params.query.slice(0, 140) : undefined,
    priceUsd: params.priceUsd,
    size: params.size ? params.size.slice(0, 32) : undefined,
    color: params.color ? params.color.slice(0, 32) : undefined,
    source: params.source ? params.source.slice(0, 64) : undefined,
    createdAt: new Date().toISOString(),
  };

  await upsertActivityEvent(event);

  if (params.userId) {
    await rebuildUserPreferenceProfile(store, params.userId);
  }
  return event;
}

export async function rebuildUserPreferenceProfile(
  store: StoreSnapshot,
  uid: string
): Promise<UserPreferenceProfile> {
  const user = store.users[uid];
  const personalizationEnabled = user?.personalizationEnabled ?? true;
  const analyticsConsent = user?.analyticsConsent ?? true;
  const now = new Date().toISOString();

  if (!personalizationEnabled) {
    const disabledProfile: UserPreferenceProfile = {
      uid,
      personalizationEnabled: false,
      analyticsConsent,
      favoriteCategories: [],
      preferredGenders: [],
      preferredSizes: [],
      preferredColors: [],
      favoriteSuppliers: [],
      recentlyViewedProductIds: [],
      totalViews: 0,
      totalPurchases: 0,
      updatedAt: now,
    };
    await upsertUserPreferenceProfile(disabledProfile);
    return disabledProfile;
  }

  const catScores: Record<string, number> = {};
  const genderScores: Record<'MEN' | 'WOMEN' | 'UNISEX', number> = { MEN: 0, WOMEN: 0, UNISEX: 0 };
  const sizeCounts: Record<string, number> = {};
  const colorCounts: Record<string, number> = {};
  const supplierScores: Record<string, number> = {};
  const prices: number[] = [];
  const viewedIds: string[] = [];
  let totalViews = 0;
  let totalPurchases = 0;

  const events = Object.values(store.activityEvents)
    .filter((e) => e.userId === uid)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const weightForType = (t: ActivityEventType): number => {
    if (t === 'purchase') return 6;
    if (t === 'cart_add' || t === 'wishlist_add') return 4;
    if (t === 'review') return 3;
    if (t === 'recommendation_click' || t === 'product_view') return 2;
    if (t === 'category_visit') return 1.5;
    return 1;
  };

  for (const e of events) {
    const w = weightForType(e.type);
    const prod = e.productId ? store.products[e.productId] : undefined;
    const cat = e.category || prod?.category;
    const gender = e.gender || prod?.gender;
    const supId = e.supplierId || prod?.supplierId;
    const price = e.priceUsd ?? prod?.sellingPriceUsd;

    if (cat) catScores[cat] = (catScores[cat] || 0) + w;
    if (gender) genderScores[gender] = (genderScores[gender] || 0) + w;
    if (e.size) sizeCounts[e.size] = (sizeCounts[e.size] || 0) + 1;
    if (e.color) colorCounts[e.color] = (colorCounts[e.color] || 0) + 1;
    if (supId) supplierScores[supId] = (supplierScores[supId] || 0) + w;
    if (typeof price === 'number' && price > 0) prices.push(price);

    if (e.type === 'product_view' && e.productId) {
      totalViews += 1;
      if (!viewedIds.includes(e.productId)) {
        viewedIds.push(e.productId);
      }
    }
    if (e.type === 'purchase') {
      totalPurchases += 1;
    }
  }

  // Factor in wishlist items & past confirmed orders directly
  for (const pid of store.wishlists[uid] || []) {
    const prod = store.products[pid];
    if (!prod) continue;
    catScores[prod.category] = (catScores[prod.category] || 0) + 3;
    genderScores[prod.gender] = (genderScores[prod.gender] || 0) + 2;
    supplierScores[prod.supplierId] = (supplierScores[prod.supplierId] || 0) + 2;
    prices.push(prod.sellingPriceUsd);
  }

  for (const ord of Object.values(store.orders)) {
    if (ord.customerId !== uid || ord.overallStatus === 'Cancelled') continue;
    totalPurchases += 1;
    for (const sid of ord.suborderIds) {
      const sub = store.suborders[sid];
      if (!sub) continue;
      supplierScores[sub.supplierId] = (supplierScores[sub.supplierId] || 0) + 5;
      for (const item of sub.items) {
        const prod = store.products[item.productId];
        if (prod) {
          catScores[prod.category] = (catScores[prod.category] || 0) + 5;
          genderScores[prod.gender] = (genderScores[prod.gender] || 0) + 3;
        }
        if (item.size) sizeCounts[item.size] = (sizeCounts[item.size] || 0) + 2;
        if (item.color) colorCounts[item.color] = (colorCounts[item.color] || 0) + 2;
        prices.push(item.unitSellingPriceUsd);
      }
    }
  }

  const favoriteCategories = Object.entries(catScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, score]) => ({ category, score: round2(score) }));

  const preferredGenders = (Object.entries(genderScores) as ['MEN' | 'WOMEN' | 'UNISEX', number][])
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);

  const preferredSizes = Object.entries(sizeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([s]) => s);

  const preferredColors = Object.entries(colorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([c]) => c);

  const favoriteSuppliers = Object.entries(supplierScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([supplierId, score]) => ({
      supplierId,
      supplierName: store.suppliers[supplierId]?.businessName || supplierId,
      score: round2(score),
    }));

  const sortedPrices = prices.slice().sort((a, b) => a - b);
  const profile: UserPreferenceProfile = {
    uid,
    personalizationEnabled: true,
    analyticsConsent,
    favoriteCategories,
    preferredGenders,
    preferredSizes,
    preferredColors,
    minPriceUsd: sortedPrices.length ? round2(sortedPrices[0] * 0.7) : undefined,
    maxPriceUsd: sortedPrices.length ? round2(sortedPrices[sortedPrices.length - 1] * 1.35) : undefined,
    favoriteSuppliers,
    recentlyViewedProductIds: viewedIds.slice(0, 12),
    totalViews,
    totalPurchases,
    updatedAt: now,
  };

  await upsertUserPreferenceProfile(profile);
  return profile;
}

export async function getRecommendationsForUser(
  store: StoreSnapshot,
  params: {
    userId?: string;
    anchorProductId?: string;
    sessionViewedIds?: string[];
  }
): Promise<RecommendationSet> {
  // Strictly published & available products only
  const liveAvailable = Object.values(store.products).filter(
    (p) => isProductLiveOnStorefront(p) && p.totalStock > 0
  );

  // Popularity score per product from real views & sales
  const viewsByProduct: Record<string, number> = {};
  const salesByProduct: Record<string, number> = {};
  for (const e of Object.values(store.activityEvents)) {
    if (e.type === 'product_view' && e.productId) {
      viewsByProduct[e.productId] = (viewsByProduct[e.productId] || 0) + 1;
    }
  }
  for (const sub of Object.values(store.suborders)) {
    if (sub.status === 'Cancelled') continue;
    for (const item of sub.items) {
      salesByProduct[item.productId] = (salesByProduct[item.productId] || 0) + item.quantity;
    }
  }

  const popularityScore = (p: Product) =>
    (salesByProduct[p.id] || 0) * 5 +
    (viewsByProduct[p.id] || 0) * 1.5 +
    (p.isBestSeller ? 4 : 0) +
    (p.featured ? 2 : 0) +
    p.ratingAvg;

  const user = params.userId ? store.users[params.userId] : undefined;
  const personalizationEnabled = user?.personalizationEnabled ?? true;

  let profile: UserPreferenceProfile | undefined;
  if (params.userId && personalizationEnabled) {
    profile = store.userPreferences[params.userId] || (await rebuildUserPreferenceProfile(store, params.userId));
  }

  const hasHistory = Boolean(
    profile &&
      (profile.favoriteCategories.length > 0 ||
        profile.recentlyViewedProductIds.length > 0 ||
        profile.totalPurchases > 0)
  );

  const scoreProductForUser = (p: Product): number => {
    let score = popularityScore(p);
    if (!profile || !personalizationEnabled) return score;
    const catMatch = profile.favoriteCategories.find((c) => c.category === p.category);
    if (catMatch) score += catMatch.score * 2.5;
    if (profile.preferredGenders.includes(p.gender)) score += 6;
    if (profile.favoriteSuppliers.some((s) => s.supplierId === p.supplierId)) score += 4;
    if (
      profile.minPriceUsd !== undefined &&
      profile.maxPriceUsd !== undefined &&
      p.sellingPriceUsd >= profile.minPriceUsd &&
      p.sellingPriceUsd <= profile.maxPriceUsd
    ) {
      score += 3;
    }
    if (
      profile.preferredSizes.some((sz) =>
        p.variants.some((v) => v.stock > 0 && v.size.toLowerCase() === sz.toLowerCase())
      )
    ) {
      score += 2;
    }
    if (
      profile.preferredColors.some((clr) =>
        p.variants.some((v) => v.stock > 0 && v.color.toLowerCase() === clr.toLowerCase())
      )
    ) {
      score += 2;
    }
    return score;
  };

  const recentIds = Array.from(
    new Set([
      ...(profile?.recentlyViewedProductIds || []),
      ...(params.sessionViewedIds || []),
    ])
  );
  const recentlyViewed = recentIds
    .map((id) => liveAvailable.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p))
    .slice(0, 6);

  const anchorProduct =
    (params.anchorProductId ? store.products[params.anchorProductId] : undefined) ||
    recentlyViewed[0];

  const similarProducts = anchorProduct
    ? liveAvailable
        .filter((p) => p.id !== anchorProduct.id)
        .map((p) => {
          let sim = 0;
          if (p.category === anchorProduct.category) sim += 10;
          if (p.gender === anchorProduct.gender) sim += 6;
          if (Math.abs(p.sellingPriceUsd - anchorProduct.sellingPriceUsd) <= anchorProduct.sellingPriceUsd * 0.4) {
            sim += 3;
          }
          if (p.supplierId !== anchorProduct.supplierId) sim += 1; // diversity bonus
          return { p, sim: sim + popularityScore(p) * 0.1 };
        })
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 4)
        .map((x) => x.p)
    : [];

  const recommendedForYou = liveAvailable
    .filter((p) => p.id !== params.anchorProductId)
    .slice()
    .sort((a, b) => scoreProductForUser(b) - scoreProductForUser(a))
    .slice(0, 6);

  const usedInRec = new Set(recommendedForYou.map((p) => p.id));

  const becauseYouViewedProducts = anchorProduct
    ? similarProducts.filter((p) => p.id !== anchorProduct.id).slice(0, 4)
    : [];

  const topCat = profile?.favoriteCategories[0]?.category || anchorProduct?.category || liveAvailable[0]?.category;
  const trendingInCategoryProducts = liveAvailable
    .filter((p) => (!topCat || p.category === topCat) && !usedInRec.has(p.id))
    .sort((a, b) => popularityScore(b) - popularityScore(a))
    .slice(0, 4);

  const newArrivals = liveAvailable
    .slice()
    .sort((a, b) => {
      if (a.isNewArrival !== b.isNewArrival) return a.isNewArrival ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, 4);

  const youMayAlsoLike = liveAvailable
    .filter((p) => !usedInRec.has(p.id) && p.id !== params.anchorProductId)
    .sort((a, b) => popularityScore(b) - popularityScore(a))
    .slice(0, 4);

  return {
    personalizationEnabled,
    hasHistory,
    preferenceSummary: profile,
    recommendedForYou,
    becauseYouViewed: {
      anchorTitle: anchorProduct?.title,
      products: becauseYouViewedProducts,
    },
    similarProducts,
    trendingInCategory: {
      category: topCat,
      products: trendingInCategoryProducts.length > 0 ? trendingInCategoryProducts : liveAvailable.slice(0, 4),
    },
    youMayAlsoLike,
    recentlyViewed,
    newArrivals,
  };
}

export function resolveDateWindow(range?: string, from?: string, to?: string): {
  label: string;
  fromMs: number;
  toMs: number;
} {
  const now = Date.now();
  if (range === 'custom' && from && to) {
    const f = new Date(from).getTime();
    const t = new Date(to).getTime() + 86399999;
    if (Number.isFinite(f) && Number.isFinite(t) && f <= t) {
      return { label: `${from} → ${to}`, fromMs: f, toMs: t };
    }
  }
  if (range === 'daily' || range === '1d') {
    return { label: 'Last 24 Hours', fromMs: now - 86400000, toMs: now };
  }
  if (range === 'weekly' || range === '7d') {
    return { label: 'Last 7 Days', fromMs: now - 7 * 86400000, toMs: now };
  }
  if (range === 'all') {
    return { label: 'All Time', fromMs: 0, toMs: now };
  }
  return { label: 'Last 30 Days', fromMs: now - 30 * 86400000, toMs: now };
}

export function computeAdminAnalytics(
  store: StoreSnapshot,
  range?: string,
  from?: string,
  to?: string
): AnalyticsRangeMetrics {
  const win = resolveDateWindow(range, from, to);
  const inWin = (iso: string) => {
    const ts = new Date(iso).getTime();
    return ts >= win.fromMs && ts <= win.toMs;
  };

  const ordersInWin = Object.values(store.orders).filter((o) => inWin(o.createdAt));
  const subordersInWin = Object.values(store.suborders).filter((s) => inWin(s.createdAt));
  const submissionsInWin = Object.values(store.paymentSubmissions).filter((s) => inWin(s.createdAt));
  const refundsInWin = Object.values(store.refunds).filter((r) => inWin(r.createdAt));
  const eventsInWin = Object.values(store.activityEvents).filter((e) => inWin(e.createdAt));

  const validOrders = ordersInWin.filter((o) => o.overallStatus !== 'Cancelled');
  const confirmedOrders = validOrders.filter((o) => o.paymentStatus === 'CONFIRMED');
  const completedOrders = ordersInWin.filter(
    (o) => o.overallStatus === 'Delivered' || o.overallStatus === 'Completed'
  );
  const cancelledOrders = ordersInWin.filter((o) => o.overallStatus === 'Cancelled');

  const grossRevenueUsd = round2(confirmedOrders.reduce((sum, o) => sum + o.totalUsd, 0));
  const marketplaceCommissionsUsd = round2(
    subordersInWin
      .filter((s) => s.paymentStatus === 'CONFIRMED' && s.status !== 'Cancelled')
      .reduce((sum, s) => sum + (s.adminMarkupUsd ?? s.marketplaceCommissionUsd), 0)
  );

  const pendingPaymentsCount = submissionsInWin.filter(
    (s) => s.status === 'PENDING_VERIFICATION' || s.status === 'INFO_REQUESTED'
  ).length;
  const verifiedPaymentsCount = submissionsInWin.filter((s) => s.status === 'VERIFIED').length;
  const rejectedPaymentsCount = submissionsInWin.filter((s) => s.status === 'REJECTED').length;

  const users = Object.values(store.users);
  const activeCustomers = users.filter((u) => u.role === 'customer' && u.status === 'active');
  const activeSuppliers = Object.values(store.suppliers).filter((s) => s.status === 'APPROVED');

  // Customer retention & repeat purchase rate across all non-cancelled orders
  const ordersByCustomer: Record<string, number> = {};
  for (const o of Object.values(store.orders)) {
    if (o.overallStatus === 'Cancelled') continue;
    ordersByCustomer[o.customerId] = (ordersByCustomer[o.customerId] || 0) + 1;
  }
  const buyingCustomersCount = Object.keys(ordersByCustomer).length;
  const repeatCustomersCount = Object.values(ordersByCustomer).filter((c) => c >= 2).length;
  const repeatPurchaseRatePct =
    buyingCustomersCount > 0 ? round2((repeatCustomersCount / buyingCustomersCount) * 100) : 0;

  const checkoutStartsCount = eventsInWin.filter((e) => e.type === 'checkout_start').length;
  const cartAddsCount = eventsInWin.filter((e) => e.type === 'cart_add').length;
  const cartAbandonDenom = checkoutStartsCount > 0 ? checkoutStartsCount : cartAddsCount;
  const cartAbandonmentRatePct =
    cartAbandonDenom > 0
      ? round2(Math.max(0, ((cartAbandonDenom - ordersInWin.length) / cartAbandonDenom) * 100))
      : 0;

  const productViews: Record<string, number> = {};
  const categoryViews: Record<string, number> = {};
  for (const e of eventsInWin) {
    if (e.type === 'product_view' && e.productId) {
      productViews[e.productId] = (productViews[e.productId] || 0) + 1;
      const cat = e.category || store.products[e.productId]?.category;
      if (cat) categoryViews[cat] = (categoryViews[cat] || 0) + 1;
    } else if (e.type === 'category_visit' && e.category) {
      categoryViews[e.category] = (categoryViews[e.category] || 0) + 1;
    }
  }
  const productViewsCount = Object.values(productViews).reduce((a, b) => a + b, 0);

  const productSales: Record<string, { units: number; rev: number }> = {};
  const categorySales: Record<string, { units: number; rev: number }> = {};
  const supplierStats: Record<string, { name: string; orders: number; rev: number; slaOk: number }> =
    {};

  for (const sub of subordersInWin) {
    if (sub.status === 'Cancelled') continue;
    if (!supplierStats[sub.supplierId]) {
      supplierStats[sub.supplierId] = {
        name: sub.supplierName,
        orders: 0,
        rev: 0,
        slaOk: 0,
      };
    }
    supplierStats[sub.supplierId].orders += 1;
    if (sub.paymentStatus === 'CONFIRMED') {
      supplierStats[sub.supplierId].rev += sub.supplierSubtotalUsd;
    }
    if (!sub.delayedAlertTriggered) {
      supplierStats[sub.supplierId].slaOk += 1;
    }

    for (const item of sub.items) {
      if (!productSales[item.productId]) {
        productSales[item.productId] = { units: 0, rev: 0 };
      }
      productSales[item.productId].units += item.quantity;
      productSales[item.productId].rev += item.lineTotalUsd;

      const cat = store.products[item.productId]?.category || 'Uncategorized';
      if (!categorySales[cat]) categorySales[cat] = { units: 0, rev: 0 };
      categorySales[cat].units += item.quantity;
      categorySales[cat].rev += item.lineTotalUsd;
    }
  }

  const bestSuppliers = Object.entries(supplierStats)
    .map(([supplierId, s]) => ({
      supplierId,
      supplierName: s.name,
      ordersCount: s.orders,
      revenueUsd: round2(s.rev),
      onTimeRatePct: s.orders > 0 ? round2((s.slaOk / s.orders) * 100) : 100,
    }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd || b.ordersCount - a.ordersCount)
    .slice(0, 6);

  const allProducts = Object.values(store.products);
  const productPerformance = allProducts.map((p) => {
    const views = productViews[p.id] || 0;
    const units = productSales[p.id]?.units || 0;
    const rev = round2(productSales[p.id]?.rev || 0);
    const conv = views > 0 ? round2((units / views) * 100) : 0;
    return {
      productId: p.id,
      title: p.title,
      unitsSold: units,
      revenueUsd: rev,
      views,
      conversionRatePct: conv,
    };
  });

  const bestSellingProducts = productPerformance
    .filter((p) => p.unitsSold > 0)
    .sort((a, b) => b.unitsSold - a.unitsSold || b.revenueUsd - a.revenueUsd)
    .slice(0, 8);

  const mostViewedProducts = productPerformance
    .filter((p) => p.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);

  const lowConversionProducts = productPerformance
    .filter((p) => p.views >= 3 && p.conversionRatePct < 5)
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);

  const allCats = new Set([...Object.keys(categoryViews), ...Object.keys(categorySales)]);
  const popularCategories = Array.from(allCats)
    .map((category) => ({
      category,
      views: categoryViews[category] || 0,
      unitsSold: categorySales[category]?.units || 0,
      revenueUsd: round2(categorySales[category]?.rev || 0),
    }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd || b.views - a.views)
    .slice(0, 8);

  const availabilityIssues = allProducts
    .filter((p) => p.totalStock <= 5 && p.status !== 'ARCHIVED' && p.status !== 'REJECTED')
    .map((p) => ({
      productId: p.id,
      title: p.title,
      totalStock: p.totalStock,
      status: p.status,
    }))
    .slice(0, 10);

  // Sales trend grouped by YYYY-MM-DD
  const trendMap: Record<string, { orders: number; revenueUsd: number }> = {};
  for (const o of validOrders) {
    const day = o.createdAt.slice(0, 10);
    if (!trendMap[day]) trendMap[day] = { orders: 0, revenueUsd: 0 };
    trendMap[day].orders += 1;
    if (o.paymentStatus === 'CONFIRMED') {
      trendMap[day].revenueUsd += o.totalUsd;
    }
  }
  const salesTrend = Object.entries(trendMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, val]) => ({
      date,
      orders: val.orders,
      revenueUsd: round2(val.revenueUsd),
    }));

  const overallConversionRatePct =
    productViewsCount > 0 ? round2((validOrders.length / productViewsCount) * 100) : 0;

  const calculatedInsights: string[] = [];
  if (popularCategories[0]) {
    calculatedInsights.push(
      `Top category by demand is ${popularCategories[0].category} (${popularCategories[0].views} views, ${popularCategories[0].unitsSold} units sold).`
    );
  }
  if (bestSuppliers[0]) {
    calculatedInsights.push(
      `Leading supplier: ${bestSuppliers[0].supplierName} with $${bestSuppliers[0].revenueUsd} confirmed revenue and ${bestSuppliers[0].onTimeRatePct}% SLA compliance.`
    );
  }
  if (lowConversionProducts.length > 0) {
    calculatedInsights.push(
      `${lowConversionProducts[0].title} has high interest (${lowConversionProducts[0].views} views) but low conversion (${lowConversionProducts[0].conversionRatePct}%) — consider reviewing price markup or gallery photos.`
    );
  }
  if (pendingPaymentsCount > 0) {
    calculatedInsights.push(
      `${pendingPaymentsCount} manual M-Pesa/NMB payment submission(s) are currently awaiting Admin verification.`
    );
  }
  if (availabilityIssues.length > 0) {
    calculatedInsights.push(
      `${availabilityIssues.length} product(s) have low stock (<= 5 units) or stockout risk.`
    );
  }
  if (calculatedInsights.length === 0) {
    calculatedInsights.push(
      'Marketplace activity is recorded cleanly. Insights will enrich automatically as customers browse, add to cart, and complete verified orders.'
    );
  }

  return {
    rangeLabel: win.label,
    fromIso: new Date(win.fromMs).toISOString(),
    toIso: new Date(win.toMs).toISOString(),
    totalSalesCount: confirmedOrders.length,
    grossRevenueUsd,
    marketplaceCommissionsUsd,
    pendingPaymentsCount,
    verifiedPaymentsCount,
    rejectedPaymentsCount,
    totalOrdersCount: ordersInWin.length,
    completedOrdersCount: completedOrders.length,
    cancelledOrdersCount: cancelledOrders.length,
    refundsCount: refundsInWin.length,
    registeredUsersCount: users.length,
    activeCustomersCount: activeCustomers.length,
    activeSuppliersCount: activeSuppliers.length,
    repeatPurchaseRatePct,
    customerRetentionPct: repeatPurchaseRatePct,
    cartAbandonmentRatePct,
    checkoutStartsCount,
    productViewsCount,
    overallConversionRatePct,
    bestSuppliers,
    bestSellingProducts,
    mostViewedProducts,
    popularCategories,
    lowConversionProducts,
    availabilityIssues,
    salesTrend,
    calculatedInsights,
  };
}

export function computeSupplierAnalytics(
  store: StoreSnapshot,
  supplierId: string,
  range?: string,
  from?: string,
  to?: string
): SupplierAnalyticsMetrics {
  const win = resolveDateWindow(range, from, to);
  const inWin = (iso: string) => {
    const ts = new Date(iso).getTime();
    return ts >= win.fromMs && ts <= win.toMs;
  };

  const myProducts = Object.values(store.products).filter((p) => p.supplierId === supplierId);
  const myProductIds = new Set(myProducts.map((p) => p.id));
  const mySuborders = Object.values(store.suborders).filter(
    (s) => s.supplierId === supplierId && inWin(s.createdAt)
  );
  const myEvents = Object.values(store.activityEvents).filter(
    (e) =>
      inWin(e.createdAt) &&
      (e.supplierId === supplierId || (e.productId && myProductIds.has(e.productId)))
  );

  const viewsByProduct: Record<string, number> = {};
  for (const e of myEvents) {
    if (e.type === 'product_view' && e.productId) {
      viewsByProduct[e.productId] = (viewsByProduct[e.productId] || 0) + 1;
    }
  }
  const totalProductViews = Object.values(viewsByProduct).reduce((a, b) => a + b, 0);

  const activeSubs = mySuborders.filter((s) => s.status !== 'Cancelled');
  const confirmedSubs = activeSubs.filter((s) => s.paymentStatus === 'CONFIRMED');
  const completedFulfillments = activeSubs.filter(
    (s) => s.status === 'Delivered' || s.status === 'Completed'
  ).length;
  const cancelledOrReturned = mySuborders.filter(
    (s) =>
      s.status === 'Cancelled' ||
      s.status === 'Refunded' ||
      s.status === 'Partially Refunded' ||
      s.status === 'Refund Requested'
  ).length;

  const grossSalesUsd = round2(confirmedSubs.reduce((sum, s) => sum + s.supplierSubtotalUsd, 0));
  const netEarningsUsd = round2(confirmedSubs.reduce((sum, s) => sum + s.supplierNetEarningsUsd, 0));

  const paidPayouts = Object.values(store.payouts)
    .filter((p) => p.supplierId === supplierId && p.status === 'PAID')
    .reduce((sum, p) => sum + p.amountUsd, 0);
  const pendingPayoutUsd = round2(Math.max(0, netEarningsUsd - paidPayouts));

  const slaOnTime = activeSubs.filter((s) => !s.delayedAlertTriggered).length;
  const slaOnTimePct = activeSubs.length > 0 ? round2((slaOnTime / activeSubs.length) * 100) : 100;

  const myReviews = Object.values(store.reviews).filter((r) => myProductIds.has(r.productId));
  const averageRating =
    myReviews.length > 0
      ? round2(myReviews.reduce((sum, r) => sum + r.rating, 0) / myReviews.length)
      : 0;

  const salesByProduct: Record<string, { units: number; rev: number }> = {};
  const trendMap: Record<string, { orders: number; revenueUsd: number }> = {};

  for (const s of activeSubs) {
    const day = s.createdAt.slice(0, 10);
    if (!trendMap[day]) trendMap[day] = { orders: 0, revenueUsd: 0 };
    trendMap[day].orders += 1;
    if (s.paymentStatus === 'CONFIRMED') {
      trendMap[day].revenueUsd += s.supplierNetEarningsUsd;
    }

    for (const item of s.items) {
      if (!salesByProduct[item.productId]) salesByProduct[item.productId] = { units: 0, rev: 0 };
      salesByProduct[item.productId].units += item.quantity;
      salesByProduct[item.productId].rev += item.unitWholesalePriceUsd * item.quantity;
    }
  }

  const productPerf = myProducts.map((p) => {
    const views = viewsByProduct[p.id] || 0;
    const units = salesByProduct[p.id]?.units || 0;
    const rev = round2(salesByProduct[p.id]?.rev || 0);
    const conv = views > 0 ? round2((units / views) * 100) : 0;
    return {
      productId: p.id,
      title: p.title,
      unitsSold: units,
      revenueUsd: rev,
      views,
      conversionRatePct: conv,
    };
  });

  const bestSellingProducts = productPerf
    .filter((p) => p.unitsSold > 0)
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, 6);

  const mostViewedProducts = productPerf
    .filter((p) => p.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 6);

  const lowConversionProducts = productPerf
    .filter((p) => p.views >= 3 && p.conversionRatePct < 5)
    .sort((a, b) => b.views - a.views)
    .slice(0, 6);

  const restockAlerts = myProducts
    .filter((p) => p.totalStock <= 5 && p.status !== 'ARCHIVED')
    .map((p) => ({
      productId: p.id,
      title: p.title,
      totalStock: p.totalStock,
    }));

  const salesTrend = Object.entries(trendMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, orders: v.orders, revenueUsd: round2(v.revenueUsd) }));

  const suggestions: string[] = [];
  for (const p of myProducts) {
    if (p.images.length < 2) {
      suggestions.push(`Add at least 2–3 high-resolution photos for "${p.title}" to improve buyer confidence.`);
    }
    if (p.description.trim().length < 45) {
      suggestions.push(`Expand fabric, sizing, and care details in "${p.title}" description.`);
    }
  }
  if (restockAlerts.length > 0) {
    suggestions.push(`${restockAlerts.length} of your products have 5 or fewer units remaining and need restocking.`);
  }
  if (lowConversionProducts.length > 0) {
    suggestions.push(
      `"${lowConversionProducts[0].title}" received ${lowConversionProducts[0].views} views with low conversion — consider adjusting your supplier base price or adding variant photos.`
    );
  }
  if (suggestions.length === 0) {
    suggestions.push('Your catalog photos, stock levels, and SLA compliance are in good standing.');
  }

  return {
    supplierId,
    rangeLabel: win.label,
    fromIso: new Date(win.fromMs).toISOString(),
    toIso: new Date(win.toMs).toISOString(),
    totalProductViews,
    totalOrders: activeSubs.length,
    grossSalesUsd,
    netEarningsUsd,
    pendingPayoutUsd,
    completedFulfillments,
    cancelledOrReturned,
    slaOnTimePct,
    averageRating,
    bestSellingProducts,
    mostViewedProducts,
    lowConversionProducts,
    restockAlerts,
    salesTrend,
    suggestions: suggestions.slice(0, 6),
  };
}
