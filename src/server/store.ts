import crypto from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { adminDb } from './firebase-admin.ts';
import {
  DEV_SEED_PRODUCTS,
  DEV_SEED_SUPPLIERS,
  INITIAL_COMMISSION_RULES,
  INITIAL_COUPONS,
  INITIAL_SETTINGS,
  INITIAL_SHIPPING_ZONES,
} from './seed-data.ts';
import {
  ActivityEvent,
  AiReportRecord,
  AuditLog,
  BackupSnapshotMeta,
  CartItem,
  CommissionRule,
  Coupon,
  DataRetentionPolicy,
  MarketplaceSettings,
  NotificationItem,
  NotificationPreferences,
  NotificationPriority,
  NotificationType,
  Order,
  PaymentAuditLog,
  PaymentSubmission,
  PaymentTransaction,
  Product,
  ProductImageMeta,
  RefundRequest,
  Review,
  ShippingZone,
  SupplierPayout,
  SupplierProfile,
  SupplierSuborder,
  SupportTicket,
  SyncDiagnostics,
  UserAccount,
  UserCartRecord,
  UserPreferenceProfile,
} from '../types/marketplace.ts';

export interface StoreSnapshot {
  users: Record<string, UserAccount>;
  suppliers: Record<string, SupplierProfile>;
  products: Record<string, Product>;
  productImages: Record<string, ProductImageMeta>;
  orders: Record<string, Order>;
  suborders: Record<string, SupplierSuborder>;
  payments: Record<string, PaymentTransaction>;
  paymentSubmissions: Record<string, PaymentSubmission>;
  paymentAuditLogs: Record<string, PaymentAuditLog>;
  commissionRules: Record<string, CommissionRule>;
  payouts: Record<string, SupplierPayout>;
  refunds: Record<string, RefundRequest>;
  reviews: Record<string, Review>;
  coupons: Record<string, Coupon>;
  shippingZones: Record<string, ShippingZone>;
  tickets: Record<string, SupportTicket>;
  notifications: Record<string, NotificationItem>;
  notificationPreferences: Record<string, NotificationPreferences>;
  auditLogs: Record<string, AuditLog>;
  activityEvents: Record<string, ActivityEvent>;
  userPreferences: Record<string, UserPreferenceProfile>;
  aiReports: Record<string, AiReportRecord>;
  newsletterSubscribers: { email: string; market: string; createdAt: string }[];
  wishlists: Record<string, string[]>;
  carts: Record<string, UserCartRecord>;
  settings: MarketplaceSettings;
  retentionPolicy?: DataRetentionPolicy;
  backups?: BackupSnapshotMeta[];
}

export interface PendingSyncOp {
  id: string;
  key: string;
  op: 'set' | 'delete';
  collectionPath: string;
  docId: string;
  data?: Record<string, unknown>;
  attempts: number;
  lastError?: string;
  queuedAt: string;
  updatedAt: string;
}

export const notificationEvents = new EventEmitter();
notificationEvents.setMaxListeners(500);

const DATA_DIR = path.resolve(process.cwd(), '.mik-data');
const DATA_FILE = path.join(DATA_DIR, 'marketplace-store.json');
const OUTBOX_FILE = path.join(DATA_DIR, 'sync-outbox.json');
const MAX_OUTBOX_OPS = 1500;

// ------------------------------------------------------------------
// API LATENCY / 5XX TELEMETRY & SANITIZED ERROR RING BUFFER
// ------------------------------------------------------------------
const processStartedAt = new Date().toISOString();
const processStartedMs = Date.now();
let totalApiRequests = 0;
let totalApi5xxErrors = 0;
let totalApiDurationMs = 0;
const recentErrorRing: { timestamp: string; source: string; message: string }[] = [];

function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(AIza[0-9A-Za-z\-_]{12,})/g, '[REDACTED_KEY]')
    .slice(0, 260);
}

export function recordApiRequestMetric(durationMs: number, statusCode: number): void {
  totalApiRequests += 1;
  totalApiDurationMs += Math.max(0, durationMs);
  if (statusCode >= 500) {
    totalApi5xxErrors += 1;
  }
}

export function recordSystemError(source: string, err: unknown): void {
  const raw = err instanceof Error ? err.message : String(err || 'Unknown server error');
  recentErrorRing.unshift({
    timestamp: new Date().toISOString(),
    source: source.slice(0, 80),
    message: sanitizeErrorMessage(raw),
  });
  if (recentErrorRing.length > 30) {
    recentErrorRing.length = 30;
  }
}

export function getSystemMetricsSnapshot() {
  return {
    apiMetrics: {
      startedAt: processStartedAt,
      uptimeSeconds: Math.floor((Date.now() - processStartedMs) / 1000),
      totalRequests: totalApiRequests,
      error5xxCount: totalApi5xxErrors,
      avgResponseMs:
        totalApiRequests > 0 ? Math.round((totalApiDurationMs / totalApiRequests) * 10) / 10 : 0,
    },
    recentErrors: [...recentErrorRing],
  };
}

// ------------------------------------------------------------------
// ASYNC MUTEX QUEUE FOR ATOMIC READ-MODIFY-WRITE STORE OPERATIONS
// ------------------------------------------------------------------
let lockTail: Promise<void> = Promise.resolve();

export async function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = lockTail;
  let release!: () => void;
  lockTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

// ------------------------------------------------------------------
// FIRESTORE SYNC DIAGNOSTICS & DURABLE RETRY OUTBOX
// ------------------------------------------------------------------
let syncState: {
  status: SyncDiagnostics['status'];
  firestoreHydrated: boolean;
  lastSyncAttemptAt: string | null;
  lastSyncSuccessAt: string | null;
  lastError: string | null;
  failedSyncCount: number;
  totalSyncedCount: number;
  retrying: boolean;
} = {
  status: 'unconfigured',
  firestoreHydrated: false,
  lastSyncAttemptAt: null,
  lastSyncSuccessAt: null,
  lastError: null,
  failedSyncCount: 0,
  totalSyncedCount: 0,
  retrying: false,
};

let outboxCache: PendingSyncOp[] | null = null;
let outboxFlushTimer: ReturnType<typeof setInterval> | null = null;

function isTestStoreContext(): boolean {
  return process.argv.some((a) => a.includes('marketplace.test')) || process.env.VITEST === 'true';
}

function loadOutbox(): PendingSyncOp[] {
  if (outboxCache) return outboxCache;
  try {
    if (fs.existsSync(OUTBOX_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(OUTBOX_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        outboxCache = parsed;
        return outboxCache;
      }
    }
  } catch {
    // Fallback to empty queue
  }
  outboxCache = [];
  return outboxCache;
}

function persistOutbox(ops: PendingSyncOp[]): void {
  outboxCache = ops;
  if (isTestStoreContext()) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmp = `${OUTBOX_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(ops, null, 2), 'utf-8');
    fs.renameSync(tmp, OUTBOX_FILE);
  } catch {
    // Non-fatal
  }
}

function enqueueSyncOp(
  op: 'set' | 'delete',
  collectionPath: string,
  docId: string,
  data?: Record<string, unknown>,
  errorMessage?: string
): void {
  const ops = loadOutbox().slice();
  const key = `${collectionPath}:${docId}`;
  const now = new Date().toISOString();
  const existingIdx = ops.findIndex((item) => item.key === key);

  if (existingIdx >= 0) {
    const existing = ops[existingIdx];
    ops[existingIdx] = {
      ...existing,
      op,
      data: op === 'set' ? data : undefined,
      attempts: existing.attempts + 1,
      lastError: errorMessage || existing.lastError,
      updatedAt: now,
    };
  } else {
    ops.push({
      id: `sync_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      key,
      op,
      collectionPath,
      docId,
      data: op === 'set' ? data : undefined,
      attempts: 1,
      lastError: errorMessage,
      queuedAt: now,
      updatedAt: now,
    });
  }

  if (ops.length > MAX_OUTBOX_OPS) {
    ops.splice(0, ops.length - MAX_OUTBOX_OPS);
  }
  persistOutbox(ops);
}

function removeSyncOp(collectionPath: string, docId: string): void {
  const ops = loadOutbox();
  const key = `${collectionPath}:${docId}`;
  const next = ops.filter((item) => item.key !== key);
  if (next.length !== ops.length) {
    persistOutbox(next);
  }
}

function formatFirestoreError(err: unknown): string {
  if (!err) return 'Unknown Firestore error';
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 260);
}

function isCredentialUnavailableError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('could not load the default credentials') ||
    lower.includes('default credentials') ||
    lower.includes('unable to detect a project id') ||
    lower.includes('unauthenticated')
  );
}

function createInitialStore(): StoreSnapshot {
  const isDev = process.env.NODE_ENV !== 'production';
  const suppliers: Record<string, SupplierProfile> = {};
  const products: Record<string, Product> = {};
  const commissionRules: Record<string, CommissionRule> = {};
  const coupons: Record<string, Coupon> = {};
  const shippingZones: Record<string, ShippingZone> = {};

  for (const r of INITIAL_COMMISSION_RULES) commissionRules[r.id] = r;
  for (const c of INITIAL_COUPONS) coupons[c.id] = c;
  for (const z of INITIAL_SHIPPING_ZONES) shippingZones[z.id] = z;

  if (isDev) {
    for (const s of DEV_SEED_SUPPLIERS) suppliers[s.id] = s;
    for (const p of DEV_SEED_PRODUCTS) products[p.id] = p;
  }

  return {
    users: {},
    suppliers,
    products,
    productImages: {},
    orders: {},
    suborders: {},
    payments: {},
    paymentSubmissions: {},
    paymentAuditLogs: {},
    commissionRules,
    payouts: {},
    refunds: {},
    reviews: {},
    coupons,
    shippingZones,
    tickets: {},
    notifications: {},
    notificationPreferences: {},
    auditLogs: {},
    activityEvents: {},
    userPreferences: {},
    aiReports: {},
    newsletterSubscribers: [],
    wishlists: {},
    carts: {},
    settings: INITIAL_SETTINGS,
    backups: [],
  };
}

let memoryStore: StoreSnapshot | null = null;

function loadLocalStore(): StoreSnapshot {
  if (memoryStore) return memoryStore;
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as StoreSnapshot;
      parsed.users = parsed.users || {};
      parsed.suppliers = parsed.suppliers || {};
      parsed.products = parsed.products || {};
      parsed.productImages = parsed.productImages || {};
      parsed.orders = parsed.orders || {};
      parsed.suborders = parsed.suborders || {};
      parsed.payments = parsed.payments || {};
      parsed.paymentSubmissions = parsed.paymentSubmissions || {};
      parsed.paymentAuditLogs = parsed.paymentAuditLogs || {};
      parsed.commissionRules = parsed.commissionRules || {};
      parsed.payouts = parsed.payouts || {};
      parsed.refunds = parsed.refunds || {};
      parsed.reviews = parsed.reviews || {};
      parsed.coupons = parsed.coupons || {};
      parsed.shippingZones = parsed.shippingZones || {};
      parsed.tickets = parsed.tickets || {};
      parsed.notificationPreferences = parsed.notificationPreferences || {};
      parsed.notifications = parsed.notifications || {};
      parsed.auditLogs = parsed.auditLogs || {};
      parsed.activityEvents = parsed.activityEvents || {};
      parsed.userPreferences = parsed.userPreferences || {};
      parsed.aiReports = parsed.aiReports || {};
      parsed.newsletterSubscribers = parsed.newsletterSubscribers || [];
      parsed.wishlists = parsed.wishlists || {};
      parsed.carts = parsed.carts || {};
      parsed.backups = parsed.backups || [];

      for (const n of Object.values(parsed.notifications)) {
        if (!n.type) n.type = 'system';
      }

      const normalizeRecipient = (val: string | undefined, fallback: string): string => {
        const trimmed = (val || '').trim();
        if (!trimmed || trimmed === 'MIK FASHION HUB') return fallback;
        return trimmed;
      };
      const resolvedOfficialRecipient = normalizeRecipient(
        parsed.settings?.officialRecipientName ??
          parsed.settings?.mpesaAccountHolder ??
          parsed.settings?.manualPaymentAccountName,
        INITIAL_SETTINGS.officialRecipientName
      );

      const rawBrand = (parsed.settings?.brandName || '').trim();
      const brandName =
        !rawBrand || rawBrand.toUpperCase() === 'MIK FASHION HUB'
          ? INITIAL_SETTINGS.brandName
          : rawBrand;
      const rawSeoTitle = (parsed.settings?.seoTitle || '').trim();
      const seoTitle =
        !rawSeoTitle || rawSeoTitle.includes('MIK FASHION HUB')
          ? INITIAL_SETTINGS.seoTitle
          : rawSeoTitle;
      const rawSeoDesc = (parsed.settings?.seoDescription || '').trim();
      const seoDescription =
        !rawSeoDesc || rawSeoDesc.includes('MIK FASHION HUB')
          ? INITIAL_SETTINGS.seoDescription
          : rawSeoDesc;
      const rawHeroTitle = (parsed.settings?.heroTitle || '').trim();
      const heroTitle =
        !rawHeroTitle || rawHeroTitle.includes('MIK')
          ? INITIAL_SETTINGS.heroTitle
          : rawHeroTitle;

      parsed.settings = {
        ...INITIAL_SETTINGS,
        ...(parsed.settings || {}),
        brandName,
        heroTitle,
        seoTitle,
        seoDescription,
        manualPaymentPhone:
          parsed.settings?.mpesaPhone ??
          parsed.settings?.manualPaymentPhone ??
          INITIAL_SETTINGS.manualPaymentPhone,
        manualPaymentBankName:
          parsed.settings?.manualPaymentBankName || INITIAL_SETTINGS.manualPaymentBankName,
        manualPaymentBankAccount:
          parsed.settings?.nmbAccountNumber ??
          parsed.settings?.manualPaymentBankAccount ??
          INITIAL_SETTINGS.manualPaymentBankAccount,
        officialRecipientName: resolvedOfficialRecipient,
        manualPaymentAccountName: resolvedOfficialRecipient,
        mpesaEnabled: parsed.settings?.mpesaEnabled ?? INITIAL_SETTINGS.mpesaEnabled,
        mpesaPhone:
          parsed.settings?.mpesaPhone ??
          parsed.settings?.manualPaymentPhone ??
          INITIAL_SETTINGS.mpesaPhone,
        mpesaAccountHolder: normalizeRecipient(
          parsed.settings?.mpesaAccountHolder ?? parsed.settings?.manualPaymentAccountName,
          resolvedOfficialRecipient
        ),
        mpesaInstructions:
          parsed.settings?.mpesaInstructions || INITIAL_SETTINGS.mpesaInstructions,
        nmbEnabled: parsed.settings?.nmbEnabled ?? INITIAL_SETTINGS.nmbEnabled,
        nmbAccountName: normalizeRecipient(
          parsed.settings?.nmbAccountName ?? parsed.settings?.manualPaymentAccountName,
          resolvedOfficialRecipient
        ),
        nmbAccountNumber:
          parsed.settings?.nmbAccountNumber ??
          parsed.settings?.manualPaymentBankAccount ??
          INITIAL_SETTINGS.nmbAccountNumber,
        nmbBranch: parsed.settings?.nmbBranch || INITIAL_SETTINGS.nmbBranch,
        nmbInstructions: parsed.settings?.nmbInstructions || INITIAL_SETTINGS.nmbInstructions,
        autoReleaseSubordersOnPaymentConfirm:
          parsed.settings?.autoReleaseSubordersOnPaymentConfirm ??
          INITIAL_SETTINGS.autoReleaseSubordersOnPaymentConfirm,
        announcementTextSw: parsed.settings?.announcementTextSw || INITIAL_SETTINGS.announcementTextSw,
        heroTitleSw: parsed.settings?.heroTitleSw || INITIAL_SETTINGS.heroTitleSw,
        heroSubtitleSw: parsed.settings?.heroSubtitleSw || INITIAL_SETTINGS.heroSubtitleSw,
        heroCtaTextSw: parsed.settings?.heroCtaTextSw || INITIAL_SETTINGS.heroCtaTextSw,
        currencyRates: {
          ...INITIAL_SETTINGS.currencyRates,
          ...(parsed.settings?.currencyRates || {}),
        },
        socialLinks: {
          ...INITIAL_SETTINGS.socialLinks,
          ...(parsed.settings?.socialLinks || {}),
        },
      };

      for (const c of INITIAL_COUPONS) {
        if (!parsed.coupons[c.id]) {
          parsed.coupons[c.id] = c;
        }
      }
      for (const r of INITIAL_COMMISSION_RULES) {
        if (!parsed.commissionRules[r.id]) {
          parsed.commissionRules[r.id] = r;
        }
      }
      for (const z of INITIAL_SHIPPING_ZONES) {
        if (!parsed.shippingZones[z.id]) {
          parsed.shippingZones[z.id] = z;
        }
      }

      memoryStore = parsed;
      return memoryStore;
    }
  } catch {
    // Fall back to fresh snapshot
  }
  memoryStore = createInitialStore();
  persistLocalStore(memoryStore);
  return memoryStore;
}

function persistLocalStore(store: StoreSnapshot) {
  memoryStore = store;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    console.warn('Local persistence write skipped:', err);
  }
}

function docRefFromPath(collectionPath: string, docId: string) {
  const parts = collectionPath.split('/').filter(Boolean);
  if (parts.length === 1) {
    return adminDb.collection(parts[0]).doc(docId);
  }
  if (parts.length === 3) {
    return adminDb.collection(parts[0]).doc(parts[1]).collection(parts[2]).doc(docId);
  }
  return adminDb.doc(`${collectionPath}/${docId}`);
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

async function syncCollectionToFirestore<T extends object>(
  collectionName: string,
  recordId: string,
  data: T
) {
  const now = new Date().toISOString();
  syncState.lastSyncAttemptAt = now;
  const cleanPayload = stripUndefinedDeep(data as Record<string, unknown>);

  try {
    await docRefFromPath(collectionName, recordId).set(cleanPayload, { merge: true });
    syncState.status = loadOutbox().length > 0 ? 'degraded' : 'connected';
    syncState.lastSyncSuccessAt = now;
    syncState.lastError = null;
    syncState.totalSyncedCount += 1;
    removeSyncOp(collectionName, recordId);
  } catch (err) {
    const msg = formatFirestoreError(err);
    syncState.lastError = msg;
    syncState.failedSyncCount += 1;
    syncState.status = isCredentialUnavailableError(msg) ? 'offline_fallback' : 'degraded';
    enqueueSyncOp('set', collectionName, recordId, cleanPayload, msg);
  }
}

async function deleteDocFromFirestore(collectionName: string, recordId: string) {
  const now = new Date().toISOString();
  syncState.lastSyncAttemptAt = now;
  try {
    await docRefFromPath(collectionName, recordId).delete();
    syncState.status = loadOutbox().length > 0 ? 'degraded' : 'connected';
    syncState.lastSyncSuccessAt = now;
    syncState.lastError = null;
    syncState.totalSyncedCount += 1;
    removeSyncOp(collectionName, recordId);
  } catch (err) {
    const msg = formatFirestoreError(err);
    syncState.lastError = msg;
    syncState.failedSyncCount += 1;
    syncState.status = isCredentialUnavailableError(msg) ? 'offline_fallback' : 'degraded';
    enqueueSyncOp('delete', collectionName, recordId, undefined, msg);
  }
}

function isRemoteRecordNewer(
  remote: Record<string, any> | undefined,
  local: Record<string, any> | undefined
): boolean {
  if (!remote) return false;
  if (!local) return true;
  const remoteTs = String(remote.updatedAt || remote.createdAt || '');
  const localTs = String(local.updatedAt || local.createdAt || '');
  if (!remoteTs) return false;
  if (!localTs) return true;
  return remoteTs > localTs;
}

export async function flushFirestoreOutbox(maxOps: number = 100): Promise<{
  attempted: number;
  flushed: number;
  remaining: number;
  lastError: string | null;
}> {
  if (syncState.retrying) {
    return {
      attempted: 0,
      flushed: 0,
      remaining: loadOutbox().length,
      lastError: syncState.lastError,
    };
  }

  const queue = loadOutbox().slice();
  if (queue.length === 0) {
    return { attempted: 0, flushed: 0, remaining: 0, lastError: syncState.lastError };
  }

  syncState.retrying = true;
  let flushed = 0;
  let attempted = 0;
  const remaining: PendingSyncOp[] = [];
  const now = new Date().toISOString();

  try {
    for (let i = 0; i < queue.length; i += 1) {
      const item = queue[i];
      if (attempted >= maxOps) {
        remaining.push(item);
        continue;
      }
      attempted += 1;
      syncState.lastSyncAttemptAt = now;
      try {
        if (item.op === 'delete') {
          await docRefFromPath(item.collectionPath, item.docId).delete();
        } else {
          await docRefFromPath(item.collectionPath, item.docId).set(item.data || {}, {
            merge: true,
          });
        }
        flushed += 1;
        syncState.totalSyncedCount += 1;
        syncState.lastSyncSuccessAt = new Date().toISOString();
        syncState.lastError = null;
      } catch (err) {
        const msg = formatFirestoreError(err);
        syncState.lastError = msg;
        syncState.status = isCredentialUnavailableError(msg) ? 'offline_fallback' : 'degraded';
        remaining.push({
          ...item,
          attempts: item.attempts + 1,
          lastError: msg,
          updatedAt: new Date().toISOString(),
        });
        // If credentials themselves are missing, stop looping over every queued op unnecessarily
        if (isCredentialUnavailableError(msg)) {
          for (let j = i + 1; j < queue.length; j += 1) {
            remaining.push(queue[j]);
          }
          break;
        }
      }
    }
    persistOutbox(remaining);
    if (remaining.length === 0 && !syncState.lastError) {
      syncState.status = 'connected';
    }
  } finally {
    syncState.retrying = false;
  }

  return {
    attempted,
    flushed,
    remaining: remaining.length,
    lastError: syncState.lastError,
  };
}

export function startSyncOutboxWorker(): void {
  if (outboxFlushTimer || isTestStoreContext()) return;
  outboxFlushTimer = setInterval(() => {
    if (loadOutbox().length > 0) {
      void flushFirestoreOutbox(50);
    }
  }, 60 * 1000);
  if (typeof outboxFlushTimer.unref === 'function') {
    outboxFlushTimer.unref();
  }
}

export function getSyncDiagnostics(): SyncDiagnostics {
  return {
    status: syncState.status,
    firestoreHydrated: syncState.firestoreHydrated,
    lastSyncAttemptAt: syncState.lastSyncAttemptAt,
    lastSyncSuccessAt: syncState.lastSyncSuccessAt,
    lastError: syncState.lastError,
    pendingQueueCount: loadOutbox().length,
    failedSyncCount: syncState.failedSyncCount,
    totalSyncedCount: syncState.totalSyncedCount,
    retrying: syncState.retrying,
  };
}

export function getLocalPersistenceInfo(): {
  localStoreExists: boolean;
  localStoreSizeBytes: number;
  localDataDir: string;
} {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const stat = fs.statSync(DATA_FILE);
      return {
        localStoreExists: true,
        localStoreSizeBytes: stat.size,
        localDataDir: DATA_DIR,
      };
    }
  } catch {
    // Ignore stat errors
  }
  return {
    localStoreExists: false,
    localStoreSizeBytes: 0,
    localDataDir: DATA_DIR,
  };
}

/**
 * Hydrates store collections from Firestore on startup if Cloud credentials are available,
 * without overwriting newer local offline state or crashing when running locally without GCP ADC.
 */
export async function initializeStoreWithFirestore(): Promise<StoreSnapshot> {
  const store = loadLocalStore();
  startSyncOutboxWorker();

  if (syncState.firestoreHydrated) {
    return store;
  }
  syncState.firestoreHydrated = true;
  syncState.lastSyncAttemptAt = new Date().toISOString();

  try {
    const collections: [string, keyof StoreSnapshot][] = [
      ['users', 'users'],
      ['suppliers', 'suppliers'],
      ['products', 'products'],
      ['product_images', 'productImages'],
      ['orders', 'orders'],
      ['suborders', 'suborders'],
      ['payments', 'payments'],
      ['payment_submissions', 'paymentSubmissions'],
      ['payment_audit_logs', 'paymentAuditLogs'],
      ['commission_rules', 'commissionRules'],
      ['coupons', 'coupons'],
      ['shipping_zones', 'shippingZones'],
      ['reviews', 'reviews'],
      ['refund_requests', 'refunds'],
      ['support_tickets', 'tickets'],
      ['notifications', 'notifications'],
      ['notification_preferences', 'notificationPreferences'],
      ['audit_logs', 'auditLogs'],
      ['activity_events', 'activityEvents'],
      ['user_preferences', 'userPreferences'],
      ['ai_reports', 'aiReports'],
      ['supplier_payouts', 'payouts'],
      ['carts', 'carts'],
    ];

    const settingsDoc = await adminDb.collection('marketplace_settings').doc('default').get();
    syncState.status = loadOutbox().length > 0 ? 'degraded' : 'connected';
    syncState.lastSyncSuccessAt = new Date().toISOString();
    syncState.lastError = null;

    if (settingsDoc.exists) {
      const remoteSettings = settingsDoc.data() as Partial<MarketplaceSettings>;
      if (isRemoteRecordNewer(remoteSettings as any, store.settings as any)) {
        store.settings = { ...store.settings, ...remoteSettings };
      }
    }

    const retentionDoc = await adminDb.collection('marketplace_settings').doc('retention_policy').get();
    if (retentionDoc.exists) {
      const remotePolicy = retentionDoc.data() as Partial<DataRetentionPolicy>;
      if (isRemoteRecordNewer(remotePolicy as any, store.retentionPolicy as any)) {
        store.retentionPolicy = {
          ...(store.retentionPolicy || {}),
          ...remotePolicy,
        } as DataRetentionPolicy;
      }
    }

    for (const [colName, key] of collections) {
      const snap = await adminDb.collection(colName).get();
      if (!snap.empty) {
        const target = store[key] as Record<string, any>;
        for (const doc of snap.docs) {
          const remoteData = doc.data();
          if (colName === 'users') {
            try {
              const privateSnap = await adminDb
                .collection('users')
                .doc(doc.id)
                .collection('private')
                .doc('info')
                .get();
              if (privateSnap.exists) {
                const pData = privateSnap.data() || {};
                if (pData.email) remoteData.email = pData.email;
                if (typeof pData.phone === 'string') remoteData.phone = pData.phone;
                if (Array.isArray(pData.addresses)) remoteData.addresses = pData.addresses;
              }
            } catch {
              // Non-fatal if private subdoc absent
            }
          }
          if (!target[doc.id] || isRemoteRecordNewer(remoteData, target[doc.id])) {
            target[doc.id] = {
              ...(target[doc.id] || {}),
              ...remoteData,
            };
          }
        }
      }
    }

    const newsletterSnap = await adminDb.collection('newsletter_subscribers').get();
    if (!newsletterSnap.empty) {
      const existingEmails = new Set(
        store.newsletterSubscribers.map((s) => s.email.toLowerCase())
      );
      newsletterSnap.forEach((doc) => {
        const d = doc.data() as { email?: string; market?: string; createdAt?: string };
        if (d?.email && !existingEmails.has(d.email.toLowerCase())) {
          existingEmails.add(d.email.toLowerCase());
          store.newsletterSubscribers.push({
            email: d.email.toLowerCase(),
            market: d.market || 'Global',
            createdAt: d.createdAt || new Date().toISOString(),
          });
        }
      });
    }

    const wishlistSnap = await adminDb.collection('wishlists').get();
    if (!wishlistSnap.empty) {
      wishlistSnap.forEach((doc) => {
        const data = doc.data() as { productIds?: string[] };
        if (Array.isArray(data?.productIds) && !store.wishlists[doc.id]) {
          store.wishlists[doc.id] = data.productIds;
        }
      });
    }

    persistLocalStore(store);

    // Best-effort flush of any pending offline sync mutations on reconnect
    if (loadOutbox().length > 0) {
      await flushFirestoreOutbox(50);
    }
  } catch (err) {
    const msg = formatFirestoreError(err);
    syncState.lastError = msg;
    syncState.status = isCredentialUnavailableError(msg) ? 'offline_fallback' : 'degraded';
  }
  return store;
}

export async function reconcileFirestoreSync(): Promise<{
  hydratedCollections: number;
  outboxResult: Awaited<ReturnType<typeof flushFirestoreOutbox>>;
  diagnostics: SyncDiagnostics;
}> {
  const outboxResult = await flushFirestoreOutbox(250);
  syncState.firestoreHydrated = false;
  await initializeStoreWithFirestore();
  return {
    hydratedCollections: 24,
    outboxResult,
    diagnostics: getSyncDiagnostics(),
  };
}

export async function getStore(): Promise<StoreSnapshot> {
  return loadLocalStore();
}

export async function saveStore(store: StoreSnapshot): Promise<void> {
  persistLocalStore(store);
}

export async function upsertUser(user: UserAccount): Promise<UserAccount> {
  const store = await getStore();
  store.users[user.uid] = user;
  await saveStore(store);
  await syncCollectionToFirestore('users', user.uid, {
    uid: user.uid,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    preferredCurrency: user.preferredCurrency,
    preferredCountry: user.preferredCountry,
    personalizationEnabled: user.personalizationEnabled ?? true,
    analyticsConsent: user.analyticsConsent ?? true,
    lastLoginAt: user.lastLoginAt || null,
    loginCount: user.loginCount || 0,
    erasureRequestedAt: user.erasureRequestedAt || null,
    anonymizedAt: user.anonymizedAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
  await syncCollectionToFirestore(`users/${user.uid}/private`, 'info', {
    uid: user.uid,
    email: user.email,
    phone: user.phone || '',
    addresses: user.addresses || [],
    updatedAt: user.updatedAt,
  });
  return user;
}

export async function upsertSupportTicket(ticket: SupportTicket): Promise<SupportTicket> {
  const store = await getStore();
  store.tickets[ticket.id] = ticket;
  await saveStore(store);
  await syncCollectionToFirestore('support_tickets', ticket.id, ticket);
  return ticket;
}

export async function upsertRefundRequest(refund: RefundRequest): Promise<RefundRequest> {
  const store = await getStore();
  store.refunds[refund.id] = refund;
  await saveStore(store);
  await syncCollectionToFirestore('refund_requests', refund.id, refund);
  return refund;
}

export async function upsertSupplierPayout(payout: SupplierPayout): Promise<SupplierPayout> {
  const store = await getStore();
  store.payouts[payout.id] = payout;
  await saveStore(store);
  await syncCollectionToFirestore('supplier_payouts', payout.id, payout);
  return payout;
}

export async function upsertReviewRecord(review: Review): Promise<Review> {
  const store = await getStore();
  store.reviews[review.id] = review;
  await saveStore(store);
  await syncCollectionToFirestore('reviews', review.id, review);
  return review;
}

export async function upsertCouponRecord(coupon: Coupon): Promise<Coupon> {
  const store = await getStore();
  store.coupons[coupon.id] = coupon;
  await saveStore(store);
  await syncCollectionToFirestore('coupons', coupon.id, coupon);
  return coupon;
}

export async function upsertCommissionRuleRecord(rule: CommissionRule): Promise<CommissionRule> {
  const store = await getStore();
  store.commissionRules[rule.id] = rule;
  await saveStore(store);
  await syncCollectionToFirestore('commission_rules', rule.id, rule);
  return rule;
}

export async function deleteCommissionRuleRecord(ruleId: string): Promise<void> {
  const store = await getStore();
  delete store.commissionRules[ruleId];
  await saveStore(store);
  await deleteDocFromFirestore('commission_rules', ruleId);
}

export async function upsertShippingZoneRecord(zone: ShippingZone): Promise<ShippingZone> {
  const store = await getStore();
  store.shippingZones[zone.id] = zone;
  await saveStore(store);
  await syncCollectionToFirestore('shipping_zones', zone.id, zone);
  return zone;
}

export async function syncWishlistForUser(uid: string, productIds: string[]): Promise<void> {
  const store = await getStore();
  store.wishlists[uid] = productIds;
  await saveStore(store);
  await syncCollectionToFirestore('wishlists', uid, {
    uid,
    productIds,
    updatedAt: new Date().toISOString(),
  });
}

export async function upsertCartForUser(uid: string, items: CartItem[]): Promise<UserCartRecord> {
  const store = await getStore();
  const record: UserCartRecord = {
    uid,
    items,
    updatedAt: new Date().toISOString(),
  };
  store.carts[uid] = record;
  await saveStore(store);
  await syncCollectionToFirestore('carts', uid, record);
  return record;
}

export async function upsertNewsletterSubscriber(params: {
  email: string;
  market: string;
  createdAt?: string;
}): Promise<{ email: string; market: string; createdAt: string }> {
  const store = await getStore();
  const cleanEmail = params.email.trim().toLowerCase();
  const existing = store.newsletterSubscribers.find((s) => s.email === cleanEmail);
  if (existing) {
    return existing;
  }
  const entry = {
    email: cleanEmail,
    market: params.market || 'Global',
    createdAt: params.createdAt || new Date().toISOString(),
  };
  store.newsletterSubscribers.push(entry);
  await saveStore(store);
  const docId = `sub_${crypto.createHash('sha256').update(cleanEmail).digest('hex').slice(0, 24)}`;
  await syncCollectionToFirestore('newsletter_subscribers', docId, entry);
  return entry;
}

export async function upsertRetentionPolicy(
  policy: DataRetentionPolicy
): Promise<DataRetentionPolicy> {
  const store = await getStore();
  store.retentionPolicy = policy;
  await saveStore(store);
  await syncCollectionToFirestore('marketplace_settings', 'retention_policy', policy);
  return policy;
}

export async function upsertActivityEvent(event: ActivityEvent): Promise<ActivityEvent> {
  const store = await getStore();
  store.activityEvents[event.id] = event;
  const keys = Object.keys(store.activityEvents);
  if (keys.length > 4000) {
    const sorted = keys.sort(
      (a, b) =>
        new Date(store.activityEvents[a].createdAt).getTime() -
        new Date(store.activityEvents[b].createdAt).getTime()
    );
    for (const oldKey of sorted.slice(0, keys.length - 4000)) {
      delete store.activityEvents[oldKey];
    }
  }
  await saveStore(store);
  await syncCollectionToFirestore('activity_events', event.id, event);
  return event;
}

export async function upsertUserPreferenceProfile(
  profile: UserPreferenceProfile
): Promise<UserPreferenceProfile> {
  const store = await getStore();
  store.userPreferences[profile.uid] = profile;
  await saveStore(store);
  await syncCollectionToFirestore('user_preferences', profile.uid, profile);
  return profile;
}

export async function upsertAiReport(report: AiReportRecord): Promise<AiReportRecord> {
  const store = await getStore();
  store.aiReports[report.id] = report;
  await saveStore(store);
  await syncCollectionToFirestore('ai_reports', report.id, report);
  return report;
}

export async function upsertMarketplaceSettings(
  settings: MarketplaceSettings
): Promise<MarketplaceSettings> {
  const store = await getStore();
  store.settings = settings;
  await saveStore(store);
  await syncCollectionToFirestore('marketplace_settings', 'default', settings);
  return settings;
}

export async function upsertSupplier(supplier: SupplierProfile): Promise<SupplierProfile> {
  const store = await getStore();
  store.suppliers[supplier.id] = supplier;
  await saveStore(store);
  await syncCollectionToFirestore('suppliers', supplier.id, supplier);
  return supplier;
}

export async function upsertProduct(product: Product): Promise<Product> {
  const store = await getStore();
  store.products[product.id] = product;
  await saveStore(store);
  await syncCollectionToFirestore('products', product.id, product);
  return product;
}

export async function deleteProductRecord(productId: string): Promise<void> {
  const store = await getStore();
  delete store.products[productId];
  await saveStore(store);
  await deleteDocFromFirestore('products', productId);
}

export async function upsertProductImage(meta: ProductImageMeta): Promise<ProductImageMeta> {
  const store = await getStore();
  store.productImages[meta.id] = meta;
  await saveStore(store);
  await syncCollectionToFirestore('product_images', meta.id, meta);
  return meta;
}

export async function deleteProductImageRecord(imageId: string): Promise<void> {
  const store = await getStore();
  delete store.productImages[imageId];
  await saveStore(store);
  await deleteDocFromFirestore('product_images', imageId);
}

export async function upsertOrder(order: Order): Promise<Order> {
  const store = await getStore();
  store.orders[order.id] = order;
  await saveStore(store);
  await syncCollectionToFirestore('orders', order.id, order);
  return order;
}

export async function upsertSuborder(suborder: SupplierSuborder): Promise<SupplierSuborder> {
  const store = await getStore();
  store.suborders[suborder.id] = suborder;
  await saveStore(store);
  await syncCollectionToFirestore('suborders', suborder.id, suborder);
  return suborder;
}

export async function upsertPayment(payment: PaymentTransaction): Promise<PaymentTransaction> {
  const store = await getStore();
  store.payments[payment.id] = payment;
  await saveStore(store);
  await syncCollectionToFirestore('payments', payment.id, payment);
  return payment;
}

export async function upsertPaymentSubmission(
  submission: PaymentSubmission
): Promise<PaymentSubmission> {
  const store = await getStore();
  store.paymentSubmissions[submission.id] = submission;
  await saveStore(store);
  const { receiptImageDataUrl: _omit, ...metadata } = submission;
  await syncCollectionToFirestore('payment_submissions', submission.id, metadata);
  return submission;
}

export async function appendPaymentAuditLog(params: {
  paymentId: string;
  submissionId?: string;
  orderId: string;
  action: PaymentAuditLog['action'];
  previousStatus: string;
  newStatus: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  reason?: string;
  metadata?: Record<string, string | number | boolean>;
}): Promise<PaymentAuditLog> {
  const store = await getStore();
  const id = `pal_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const entry: PaymentAuditLog = {
    id,
    ...params,
    createdAt: new Date().toISOString(),
  };
  store.paymentAuditLogs[id] = entry;
  await saveStore(store);
  await syncCollectionToFirestore('payment_audit_logs', id, entry);
  return entry;
}

export async function appendAuditLog(params: {
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  targetUserId?: string;
  relatedOrderId?: string;
  previousValue?: string;
  newValue?: string;
  outcome?: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  technicalRef?: string;
  details: string;
}): Promise<AuditLog> {
  const store = await getStore();
  const id = `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const entry: AuditLog = {
    id,
    actorUid: params.actorUid,
    actorEmail: params.actorEmail,
    actorRole: params.actorRole,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    ...(params.targetUserId ? { targetUserId: params.targetUserId } : {}),
    ...(params.relatedOrderId ? { relatedOrderId: params.relatedOrderId } : {}),
    ...(params.previousValue !== undefined ? { previousValue: params.previousValue } : {}),
    ...(params.newValue !== undefined ? { newValue: params.newValue } : {}),
    ...(params.outcome ? { outcome: params.outcome } : { outcome: 'SUCCESS' }),
    ...(params.technicalRef ? { technicalRef: params.technicalRef } : {}),
    details: params.details,
    createdAt: new Date().toISOString(),
  };
  store.auditLogs[id] = entry;
  await saveStore(store);
  await syncCollectionToFirestore('audit_logs', id, entry);
  return entry;
}

export function getUserNotificationPreferences(
  store: StoreSnapshot,
  uid: string
): NotificationPreferences {
  return (
    store.notificationPreferences[uid] || {
      uid,
      inAppEnabled: true,
      emailEnabled: true,
      mutedTypes: [],
      updatedAt: new Date().toISOString(),
    }
  );
}

export async function upsertNotificationPreferences(
  prefs: NotificationPreferences
): Promise<NotificationPreferences> {
  const store = await getStore();
  store.notificationPreferences[prefs.uid] = prefs;
  await saveStore(store);
  await syncCollectionToFirestore('notification_preferences', prefs.uid, prefs);
  return prefs;
}

export async function createNotification(params: {
  recipientUid: string;
  type?: NotificationType;
  priority?: NotificationPriority;
  dedupeKey?: string;
  title: string;
  message: string;
  channel?: 'in_app' | 'email' | 'whatsapp';
  targetType?: NotificationItem['targetType'];
  targetId?: string;
  link?: string;
  actionLabel?: string;
}): Promise<NotificationItem | null> {
  const store = await getStore();
  const type: NotificationType = params.type || 'system';
  const prefs = getUserNotificationPreferences(store, params.recipientUid);

  if (!prefs.inAppEnabled && type !== 'security' && type !== 'payment') {
    return null;
  }
  if (prefs.mutedTypes.includes(type) && type !== 'security' && type !== 'payment') {
    return null;
  }

  if (params.dedupeKey) {
    const existingDup = Object.values(store.notifications).find(
      (n) =>
        n.recipientUid === params.recipientUid &&
        n.dedupeKey === params.dedupeKey &&
        !n.hiddenByRecipient
    );
    if (existingDup) {
      return existingDup;
    }
  }

  const defaultPriority: NotificationPriority =
    params.priority ||
    (type === 'security' || type === 'return'
      ? 'urgent'
      : type === 'payment' || type === 'order'
      ? 'high'
      : 'normal');

  const id = `ntf_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const item: NotificationItem = {
    id,
    recipientUid: params.recipientUid,
    type,
    priority: defaultPriority,
    ...(params.dedupeKey ? { dedupeKey: params.dedupeKey } : {}),
    title: params.title,
    message: params.message,
    channel: params.channel || 'in_app',
    read: false,
    targetType: params.targetType,
    targetId: params.targetId,
    link: params.link,
    ...(params.actionLabel ? { actionLabel: params.actionLabel } : {}),
    createdAt: new Date().toISOString(),
  };
  store.notifications[id] = item;
  await saveStore(store);
  await syncCollectionToFirestore('notifications', id, item);

  notificationEvents.emit(`user:${params.recipientUid}`, item);
  return item;
}

export async function markNotificationAsRead(
  uid: string,
  notificationId: string
): Promise<NotificationItem | null> {
  const store = await getStore();
  const item = store.notifications[notificationId];
  if (!item || item.recipientUid !== uid) return null;
  if (!item.read) {
    const readAt = new Date().toISOString();
    item.read = true;
    item.readAt = readAt;
    await saveStore(store);
    await syncCollectionToFirestore('notifications', item.id, { read: true, readAt });
    notificationEvents.emit(`sync:${uid}`, { reason: 'read', notificationId });
  }
  return item;
}

export async function markAllNotificationsAsReadForUser(uid: string): Promise<number> {
  const store = await getStore();
  const readAt = new Date().toISOString();
  let updatedCount = 0;
  for (const n of Object.values(store.notifications)) {
    if (n.recipientUid === uid && !n.read && !n.hiddenByRecipient) {
      n.read = true;
      n.readAt = readAt;
      updatedCount += 1;
      await syncCollectionToFirestore('notifications', n.id, { read: true, readAt });
    }
  }
  if (updatedCount > 0) {
    await saveStore(store);
    notificationEvents.emit(`sync:${uid}`, { reason: 'read_all' });
  }
  return updatedCount;
}

export async function hideNotificationForUser(
  uid: string,
  notificationId: string,
  actor?: { email: string; role: string }
): Promise<NotificationItem | null> {
  const store = await getStore();
  const item = store.notifications[notificationId];
  if (!item || item.recipientUid !== uid) return null;

  const now = new Date().toISOString();
  if (!item.hiddenByRecipient) {
    item.hiddenByRecipient = true;
    item.hiddenAt = now;
    if (!item.read) {
      item.read = true;
      item.readAt = now;
    }
    await saveStore(store);
    await syncCollectionToFirestore('notifications', item.id, {
      hiddenByRecipient: true,
      hiddenAt: now,
      read: true,
      readAt: item.readAt,
    });

    await appendAuditLog({
      actorUid: uid,
      actorEmail: actor?.email || store.users[uid]?.email || uid,
      actorRole: actor?.role || store.users[uid]?.role || 'customer',
      action: 'NOTIFICATION_HIDDEN_BY_USER',
      targetType: 'notification',
      targetId: item.id,
      targetUserId: uid,
      relatedOrderId: item.targetType === 'order' ? item.targetId : undefined,
      details: `User hid notification "${item.title}" (${item.type}) from personal inbox; underlying record & audit trail preserved.`,
    });

    notificationEvents.emit(`sync:${uid}`, { reason: 'hidden', notificationId });
  }
  return item;
}

export async function clearVisibleNotificationsForUser(
  uid: string,
  actor?: { email: string; role: string }
): Promise<number> {
  const store = await getStore();
  const now = new Date().toISOString();
  let clearedCount = 0;

  for (const item of Object.values(store.notifications)) {
    if (item.recipientUid === uid && !item.hiddenByRecipient) {
      item.hiddenByRecipient = true;
      item.hiddenAt = now;
      if (!item.read) {
        item.read = true;
        item.readAt = now;
      }
      clearedCount += 1;
      await syncCollectionToFirestore('notifications', item.id, {
        hiddenByRecipient: true,
        hiddenAt: now,
        read: true,
        readAt: item.readAt,
      });
    }
  }

  if (clearedCount > 0) {
    await saveStore(store);
    await appendAuditLog({
      actorUid: uid,
      actorEmail: actor?.email || store.users[uid]?.email || uid,
      actorRole: actor?.role || store.users[uid]?.role || 'customer',
      action: 'NOTIFICATION_CLEARED_BY_USER',
      targetType: 'notification',
      targetId: uid,
      targetUserId: uid,
      details: `User cleared ${clearedCount} notification(s) from personal inbox view; underlying records & audit logs preserved.`,
    });
    notificationEvents.emit(`sync:${uid}`, { reason: 'cleared', clearedCount });
  }
  return clearedCount;
}

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}
