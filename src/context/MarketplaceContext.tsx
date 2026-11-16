import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  User,
} from 'firebase/auth';
import { apiFetch } from '../lib/api';
import { formatPrice } from '../lib/currency';
import { auth, googleAuthProvider, testFirestoreConnection } from '../lib/firebase';
import { TRANSLATIONS } from '../lib/i18n';
import {
  ActivityEventType,
  CartItem,
  CurrencyCode,
  LanguageCode,
  MarketplaceSettings,
  NotificationItem,
  NotificationPreferences,
  NotificationType,
  PaymentGatewayStatus,
  Product,
  RecommendationSet,
  Review,
  ShippingZone,
  SupplierProfile,
  UserAccount,
} from '../types/marketplace';

export type ActivePage =
  | 'storefront'
  | 'customer'
  | 'supplier'
  | 'admin'
  | 'track'
  | 'support'
  | 'notifications';

export type AuthModalTab = 'signin' | 'register' | 'reset';

export interface PendingNavTarget {
  page: ActivePage;
  tab?: string;
  targetId?: string;
  ts: number;
}

export interface PublicSupplierSummary {
  id: string;
  businessName: string;
  country: string;
  category: string;
  description: string;
  shippingOrigin: string;
  subscriptionPlan: string;
  isDevelopmentSeed?: boolean;
}

interface BootstrapResponse {
  isDevelopmentMode: boolean;
  settings: MarketplaceSettings;
  categories: { MEN: string[]; WOMEN: string[] };
  suppliers: PublicSupplierSummary[];
  products: Product[];
  reviews: Review[];
  shippingZones: ShippingZone[];
  paymentGateways: PaymentGatewayStatus[];
}

interface MeResponse {
  user: UserAccount;
  supplier: SupplierProfile | null;
  wishlist: string[];
  notifications: NotificationItem[];
  adminEmailUnverified?: boolean;
}

interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'error';
  text: string;
}

interface RegisterEmailParams {
  displayName: string;
  email: string;
  phone?: string;
  password: string;
  accountType: 'customer' | 'supplier';
  acceptedTerms: boolean;
}

interface MarketplaceContextValue {
  firebaseUser: User | null;
  authReady: boolean;
  userAccount: UserAccount | null;
  adminEmailUnverified: boolean;
  profileLoadError: string | null;
  mySupplier: SupplierProfile | null;
  wishlist: string[];
  notifications: NotificationItem[];
  unreadNotificationCount: number;
  notificationPreferences: NotificationPreferences | null;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  hideNotification: (id: string) => Promise<void>;
  clearVisibleNotifications: (type?: NotificationType) => Promise<void>;
  updateNotificationPreferences: (
    updates: Partial<Pick<NotificationPreferences, 'inAppEnabled' | 'emailEnabled' | 'mutedTypes'>>
  ) => Promise<void>;
  pendingTarget: PendingNavTarget | null;
  clearPendingTarget: () => void;
  navigateFromNotification: (n: NotificationItem) => Promise<void>;
  isDevelopmentMode: boolean;
  settings: MarketplaceSettings | null;
  categories: { MEN: string[]; WOMEN: string[] };
  suppliers: PublicSupplierSummary[];
  products: Product[];
  reviews: Review[];
  shippingZones: ShippingZone[];
  paymentGateways: PaymentGatewayStatus[];
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: string) => string;
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  formatMoney: (amountUsd: number) => string;
  cart: CartItem[];
  addToCart: (item: CartItem) => void;
  updateCartQty: (sku: string, delta: number) => void;
  removeFromCart: (sku: string) => void;
  clearCart: () => void;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  selectedProduct: Product | null;
  setSelectedProduct: (p: Product | null) => void;
  activePage: ActivePage;
  setActivePage: (page: ActivePage) => void;
  authModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;
  authModalTab: AuthModalTab;
  setAuthModalTab: (tab: AuthModalTab) => void;
  openAuthModal: (tab?: AuthModalTab) => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (params: RegisterEmailParams) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshBootstrap: () => Promise<void>;
  refreshMe: (options?: { throwOnError?: boolean }) => Promise<MeResponse | null>;
  toggleWishlist: (productId: string) => Promise<void>;
  recommendations: RecommendationSet | null;
  refreshRecommendations: (anchorProductId?: string) => Promise<void>;
  trackActivity: (params: {
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
  }) => Promise<void>;
  toast: (text: string, type?: 'info' | 'success' | 'error') => void;
  toasts: ToastMessage[];
  dismissToast: (id: string) => void;
  loadingStorefront: boolean;
}

const MarketplaceContext = createContext<MarketplaceContextValue | null>(null);

const CART_STORAGE_KEY = 'tanzanite_express_cart_v1';
const LEGACY_CART_KEY = 'mik_fashion_hub_cart_v1';
const CURRENCY_STORAGE_KEY = 'tanzanite_express_currency_v1';
const LEGACY_CURRENCY_KEY = 'mik_fashion_hub_currency_v1';
const LANGUAGE_STORAGE_KEY = 'tanzanite_express_lang_v1';
const LEGACY_LANGUAGE_KEY = 'mik_fashion_hub_lang_v1';
const SESSION_ID_KEY = 'tanzanite_express_session_id';
const RECENT_VIEWED_KEY = 'tanzanite_express_recent_viewed';

function formatFirebaseAuthError(err: any, attemptedEmail?: string): string {
  const code = String(err?.code || '');
  const isOfficialAdminEmail =
    attemptedEmail?.trim().toLowerCase() === 'mahelaissa1@gmail.com';

  if (code === 'auth/operation-not-allowed') {
    return 'Email/Password sign-in is disabled in Firebase Console Authentication settings for this project. Enable Email/Password under Firebase Console → Authentication → Sign-in method, or sign in with Google.';
  }
  if (code === 'auth/email-already-in-use') {
    return 'An account with this email already exists. Try signing in or resetting your password.';
  }
  if (code === 'auth/invalid-email') {
    return 'Invalid email format. Please check the email address and try again.';
  }
  if (code === 'auth/user-disabled') {
    return 'This account has been disabled in Firebase Authentication. Contact marketplace support.';
  }
  if (code === 'auth/user-not-found') {
    if (isOfficialAdminEmail) {
      return 'The Super Admin Firebase Auth account (mahelaissa1@gmail.com) does not exist yet in this Firebase project. Set ADMIN_BOOTSTRAP_PASSWORD and restart the server, or sign in once with Google to link your verified Gmail identity.';
    }
    return 'No account was found with this email address. Please check your spelling or create a new account.';
  }
  if (code === 'auth/wrong-password') {
    return 'Incorrect password entered for this account. Double-check your password or use Forgot Password.';
  }
  if (code === 'auth/invalid-credential') {
    if (isOfficialAdminEmail) {
      return 'Invalid credentials or Super Admin password account not yet provisioned in Firebase Authentication. Verify your password against ADMIN_BOOTSTRAP_PASSWORD, use Forgot Password if already created, or sign in directly with Google (mahelaissa1@gmail.com).';
    }
    return 'Email or password did not match an active credential. Verify your password, ensure Email/Password sign-in is active, or use Forgot Password.';
  }
  if (code === 'auth/weak-password') {
    return 'Password is too weak. Use at least 8 characters including letters and numbers.';
  }
  if (code === 'auth/requires-recent-login') {
    return 'For security, please sign out and sign in again before changing your password.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many failed login attempts detected. Wait a few minutes or reset your password before trying again.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network request failed while contacting Firebase Authentication. Check your internet connection and retry.';
  }
  if (
    code === 'auth/invalid-api-key' ||
    code === 'auth/app-not-authorized' ||
    code === 'auth/unauthorized-domain'
  ) {
    return `Firebase configuration mismatch (${code}). Verify authorized domains and Web API settings in Firebase Console.`;
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Sign-in popup was closed before completing authentication.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Sign-in popup was blocked by your browser. Allow popups for this site or try again.';
  }
  return err?.message || 'Authentication action failed.';
}

export const MarketplaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [userAccount, setUserAccount] = useState<UserAccount | null>(null);
  const [adminEmailUnverified, setAdminEmailUnverified] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [mySupplier, setMySupplier] = useState<SupplierProfile | null>(null);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences | null>(null);
  const [pendingTarget, setPendingTarget] = useState<PendingNavTarget | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationSet | null>(null);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<AuthModalTab>('signin');

  const [isDevelopmentMode, setIsDevelopmentMode] = useState(true);
  const [settings, setSettings] = useState<MarketplaceSettings | null>(null);
  const [categories, setCategories] = useState<{ MEN: string[]; WOMEN: string[] }>({
    MEN: [],
    WOMEN: [],
  });
  const [suppliers, setSuppliers] = useState<PublicSupplierSummary[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [shippingZones, setShippingZones] = useState<ShippingZone[]>([]);
  const [paymentGateways, setPaymentGateways] = useState<PaymentGatewayStatus[]>([]);
  const [loadingStorefront, setLoadingStorefront] = useState(true);

  const sessionId = useMemo(() => {
    try {
      const existing = localStorage.getItem(SESSION_ID_KEY);
      if (existing) return existing;
      const created = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(SESSION_ID_KEY, created);
      return created;
    } catch {
      return 'sess_browser';
    }
  }, []);

  const [recentViewedIds, setRecentViewedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_VIEWED_KEY);
      if (raw) return JSON.parse(raw) as string[];
    } catch {
      // Ignore storage errors
    }
    return [];
  });

  const [language, setLanguageState] = useState<LanguageCode>(() => {
    try {
      const saved = (localStorage.getItem(LANGUAGE_STORAGE_KEY) ||
        localStorage.getItem(LEGACY_LANGUAGE_KEY)) as LanguageCode | null;
      if (saved === 'en' || saved === 'sw') return saved;
    } catch {
      // Ignore storage errors
    }
    return 'en';
  });

  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    try {
      const saved = (localStorage.getItem(CURRENCY_STORAGE_KEY) ||
        localStorage.getItem(LEGACY_CURRENCY_KEY)) as CurrencyCode | null;
      if (saved && ['TZS', 'USD', 'GBP', 'EUR', 'KES'].includes(saved)) return saved;
    } catch {
      // Ignore storage failures
    }
    return 'TZS';
  });

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY) || localStorage.getItem(LEGACY_CART_KEY);
      if (raw) return JSON.parse(raw) as CartItem[];
    } catch {
      // Ignore storage errors
    }
    return [];
  });

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activePage, setActivePage] = useState<ActivePage>('storefront');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toast = useCallback((text: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4800);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const openAuthModal = useCallback((tab: AuthModalTab = 'signin') => {
    setAuthModalTab(tab);
    setAuthModalOpen(true);
  }, []);

  const cartHydratedUidRef = useRef<string | null>(null);
  const lastSyncedCartJsonRef = useRef<string>('');

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Ignore storage errors
    }
  }, [cart]);

  // Synchronize shopping bag with backend/Firestore for authenticated users
  useEffect(() => {
    const uid = userAccount?.uid;
    if (!uid) {
      cartHydratedUidRef.current = null;
      lastSyncedCartJsonRef.current = '';
      return;
    }
    if (cartHydratedUidRef.current === uid) return;

    let cancelled = false;
    apiFetch<{ items: CartItem[]; updatedAt?: string }>('/api/me/cart')
      .then((serverCart) => {
        if (cancelled) return;
        const serverItems = Array.isArray(serverCart?.items) ? serverCart.items : [];
        lastSyncedCartJsonRef.current = JSON.stringify(serverItems);
        cartHydratedUidRef.current = uid;
        setCart((localItems) => {
          if (serverItems.length === 0) return localItems;
          if (localItems.length === 0) return serverItems;
          const bySku = new Map<string, CartItem>();
          for (const item of serverItems) {
            bySku.set(item.sku, item);
          }
          for (const item of localItems) {
            const existing = bySku.get(item.sku);
            bySku.set(
              item.sku,
              existing
                ? { ...item, quantity: Math.max(existing.quantity, item.quantity) }
                : item
            );
          }
          return Array.from(bySku.values());
        });
      })
      .catch(() => {
        // Leave localStorage cart intact if server cart fetch fails transiently
        cartHydratedUidRef.current = uid;
      });

    return () => {
      cancelled = true;
    };
  }, [userAccount?.uid]);

  useEffect(() => {
    const uid = userAccount?.uid;
    if (!uid || cartHydratedUidRef.current !== uid) return;
    const serialized = JSON.stringify(cart);
    if (serialized === lastSyncedCartJsonRef.current) return;

    const timer = setTimeout(() => {
      apiFetch('/api/me/cart', {
        method: 'PUT',
        body: JSON.stringify({ items: cart }),
      })
        .then(() => {
          lastSyncedCartJsonRef.current = serialized;
        })
        .catch(() => {
          // Best-effort sync; localStorage preserves bag until next online sync
        });
    }, 450);

    return () => clearTimeout(timer);
  }, [cart, userAccount?.uid]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((lang: LanguageCode) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const t = useCallback(
    (key: string) => {
      return TRANSLATIONS[language][key] ?? TRANSLATIONS.en[key] ?? key;
    },
    [language]
  );

  const setCurrency = useCallback((c: CurrencyCode) => {
    setCurrencyState(c);
    try {
      localStorage.setItem(CURRENCY_STORAGE_KEY, c);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const refreshRecommendations = useCallback(
    async (anchorProductId?: string) => {
      try {
        const params = new URLSearchParams();
        if (anchorProductId) params.set('productId', anchorProductId);
        if (recentViewedIds.length > 0) params.set('recentIds', recentViewedIds.join(','));
        const qs = params.toString();
        const data = await apiFetch<RecommendationSet>(
          `/api/recommendations${qs ? `?${qs}` : ''}`
        );
        setRecommendations(data);
      } catch {
        // Non-blocking fallback
      }
    },
    [recentViewedIds]
  );

  const trackActivity = useCallback(
    async (params: {
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
    }) => {
      if (params.type === 'product_view' && params.productId) {
        setRecentViewedIds((prev) => {
          const next = [params.productId!, ...prev.filter((id) => id !== params.productId)].slice(
            0,
            12
          );
          try {
            localStorage.setItem(RECENT_VIEWED_KEY, JSON.stringify(next));
          } catch {
            // Ignore storage errors
          }
          return next;
        });
      }
      try {
        await apiFetch('/api/analytics/event', {
          method: 'POST',
          body: JSON.stringify({ ...params, sessionId }),
        });
      } catch {
        // Never interrupt shopping flow for telemetry errors
      }
    },
    [sessionId]
  );

  const refreshBootstrap = useCallback(async () => {
    try {
      const data = await apiFetch<BootstrapResponse>('/api/storefront/bootstrap');
      setIsDevelopmentMode(data.isDevelopmentMode);
      setSettings(data.settings);
      setCategories(data.categories);
      setSuppliers(data.suppliers);
      setProducts(data.products);
      setReviews(data.reviews);
      setShippingZones(data.shippingZones);
      setPaymentGateways(data.paymentGateways);
    } catch (err: any) {
      toast(err.message || 'Unable to load storefront catalog', 'error');
    } finally {
      setLoadingStorefront(false);
    }
  }, [toast]);

  const refreshMe = useCallback(
    async (options?: { throwOnError?: boolean }): Promise<MeResponse | null> => {
      if (!auth.currentUser) {
        setUserAccount(null);
        setAdminEmailUnverified(false);
        setProfileLoadError(null);
        setMySupplier(null);
        setWishlist([]);
        setNotifications([]);
        setNotificationPreferences(null);
        return null;
      }
      try {
        setProfileLoadError(null);
        const [meData, prefData] = await Promise.all([
          apiFetch<MeResponse>('/api/me'),
          apiFetch<{ preferences: NotificationPreferences }>('/api/notification-preferences').catch(
            () => null
          ),
        ]);
        if (!meData?.user) {
          throw new Error('Marketplace database profile could not be loaded for this account.');
        }
        setUserAccount(meData.user);
        setAdminEmailUnverified(Boolean(meData.adminEmailUnverified));
        setMySupplier(meData.supplier);
        setWishlist(meData.wishlist);
        setNotifications(meData.notifications);
        if (prefData?.preferences) {
          setNotificationPreferences(prefData.preferences);
        }
        return meData;
      } catch (err: any) {
        const msg =
          err?.message ||
          'Authentication succeeded, but loading your marketplace profile failed.';
        console.error('Failed to load user profile:', err);
        setProfileLoadError(msg);
        if (options?.throwOnError) {
          throw new Error(msg);
        }
        return null;
      }
    },
    []
  );

  useEffect(() => {
    testFirestoreConnection();
    refreshBootstrap();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setFirebaseUser(u);
      setAuthReady(true);
      if (u) {
        await refreshMe();
        await refreshRecommendations();
      } else {
        setUserAccount(null);
        setAdminEmailUnverified(false);
        setProfileLoadError(null);
        setMySupplier(null);
        setWishlist([]);
        setNotifications([]);
        setNotificationPreferences(null);
        await refreshRecommendations();
      }
    });
    return () => unsub();
  }, [refreshBootstrap, refreshMe, refreshRecommendations]);

  // Real-time Server-Sent Events stream with exponential backoff reconnect + online recovery
  useEffect(() => {
    if (!firebaseUser) return;
    let closed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;

    const connectStream = async () => {
      if (closed || !firebaseUser) return;
      try {
        const token = await firebaseUser.getIdToken();
        if (closed) return;
        source?.close();
        source = new EventSource(`/api/notifications/stream?token=${encodeURIComponent(token)}`);
        source.onopen = () => {
          retryAttempt = 0;
        };
        source.addEventListener('notification', (evt) => {
          try {
            const incoming = JSON.parse((evt as MessageEvent).data) as NotificationItem;
            setNotifications((prev) => {
              if (prev.some((n) => n.id === incoming.id)) return prev;
              return [incoming, ...prev];
            });
            toast(`${incoming.title} — ${incoming.message}`, incoming.type === 'security' ? 'error' : 'info');
          } catch {
            // Ignore malformed SSE payload
          }
        });
        source.addEventListener('notifications_sync', () => {
          refreshMe().catch(() => {});
        });
        source.onerror = () => {
          source?.close();
          source = null;
          if (closed) return;
          retryAttempt = Math.min(retryAttempt + 1, 5);
          const delayMs = Math.min(30000, 1500 * Math.pow(2, retryAttempt - 1));
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            void connectStream();
          }, delayMs);
        };
      } catch {
        // Ignore stream initialization failures
      }
    };

    void connectStream();

    const fallbackInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshMe().catch(() => {});
      }
    }, 45000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshMe().catch(() => {});
      }
    };
    const handleOnline = () => {
      refreshBootstrap().catch(() => {});
      refreshMe().catch(() => {});
      void connectStream();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(fallbackInterval);
      source?.close();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [firebaseUser, refreshBootstrap, refreshMe, toast]);

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.read && !n.hiddenByRecipient).length,
    [notifications]
  );

  const markNotificationRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
    } catch {
      // Best-effort sync
    }
  }, []);

  const markAllNotificationsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
    } catch (err: any) {
      toast(err.message || 'Unable to mark notifications read', 'error');
    }
  }, [toast]);

  const hideNotification = useCallback(
    async (id: string) => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      try {
        await apiFetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast('Notification hidden from your view.', 'info');
      } catch (err: any) {
        await refreshMe().catch(() => {});
        toast(err.message || 'Unable to hide notification', 'error');
      }
    },
    [refreshMe, toast]
  );

  const clearVisibleNotifications = useCallback(
    async (type?: NotificationType) => {
      setNotifications((prev) => (type ? prev.filter((n) => n.type !== type) : []));
      try {
        await apiFetch('/api/notifications/clear-visible', {
          method: 'POST',
          body: JSON.stringify(type ? { type } : {}),
        });
        toast('Visible notifications cleared from your view.', 'info');
      } catch (err: any) {
        await refreshMe().catch(() => {});
        toast(err.message || 'Unable to clear notifications', 'error');
      }
    },
    [refreshMe, toast]
  );

  const updateNotificationPreferences = useCallback(
    async (
      updates: Partial<{
        inAppEnabled: boolean;
        emailEnabled: boolean;
        mutedTypes: NotificationType[];
      }>
    ) => {
      try {
        const res = await apiFetch<{ preferences: NotificationPreferences }>(
          '/api/notification-preferences',
          {
            method: 'PATCH',
            body: JSON.stringify(updates),
          }
        );
        setNotificationPreferences(res.preferences);
        toast('Notification preferences saved.', 'success');
      } catch (err: any) {
        toast(err.message || 'Failed to update preferences', 'error');
      }
    },
    [toast]
  );

  const clearPendingTarget = useCallback(() => {
    setPendingTarget(null);
  }, []);

  const navigateFromNotification = useCallback(
    async (n: NotificationItem) => {
      if (!n.read) {
        await markNotificationRead(n.id);
      }
      const role = userAccount?.role || 'customer';
      let page: ActivePage = 'customer';
      let tab = 'orders';

      if (role === 'super_admin' || role === 'staff') {
        page = 'admin';
        if (n.targetType === 'payment_submission' || n.type === 'payment' || n.type === 'security') {
          tab = 'verification';
        } else if (n.targetType === 'supplier' || n.type === 'supplier') {
          tab = 'suppliers';
        } else if (n.targetType === 'product' || n.type === 'product') {
          tab = 'products';
        } else if (n.targetType === 'refund' || n.type === 'return') {
          tab = 'refunds';
        } else if (n.targetType === 'ticket') {
          tab = 'support';
        } else {
          tab = 'orders';
        }
      } else if (role === 'supplier' && mySupplier) {
        page = 'supplier';
        if (n.targetType === 'product' || n.type === 'product') {
          tab = 'products';
        } else if (n.targetType === 'refund' || n.type === 'return') {
          tab = 'refunds';
        } else if (n.type === 'payment') {
          tab = 'earnings';
        } else if (n.targetType === 'supplier') {
          tab = 'profile';
        } else {
          tab = 'orders';
        }
      } else {
        page = 'customer';
        if (n.targetType === 'refund' || n.type === 'return') {
          tab = 'returns';
        } else if (n.targetType === 'ticket') {
          tab = 'tickets';
        } else {
          tab = 'orders';
        }
      }

      setPendingTarget({ page, tab, targetId: n.targetId, ts: Date.now() });
      setActivePage(page);
    },
    [markNotificationRead, mySupplier, userAccount?.role]
  );

  const routeToRoleDashboard = useCallback((user?: UserAccount | null) => {
    if (!user) return;
    if (user.role === 'super_admin' || user.role === 'staff') {
      setActivePage('admin');
    } else if (user.role === 'supplier') {
      setActivePage('supplier');
    } else {
      setActivePage('customer');
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    try {
      await signInWithPopup(auth, googleAuthProvider);
      await apiFetch('/api/auth/audit-event', {
        method: 'POST',
        body: JSON.stringify({ action: 'USER_LOGIN', details: 'Google Sign-In' }),
      }).catch(() => {});
      const me = await refreshMe({ throwOnError: true });
      if (!me?.user) {
        throw new Error('Unable to load user profile after Google Sign-In.');
      }
      setAuthModalOpen(false);
      routeToRoleDashboard(me.user);
      toast('Signed in with Google.', 'success');
    } catch (err: any) {
      toast(formatFirebaseAuthError(err), 'error');
    }
  }, [refreshMe, routeToRoleDashboard, toast]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      try {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        await apiFetch('/api/auth/audit-event', {
          method: 'POST',
          body: JSON.stringify({ action: 'USER_LOGIN', details: 'Email/Password Sign-In' }),
        }).catch(() => {});
        const me = await refreshMe({ throwOnError: true });
        if (!me?.user) {
          throw new Error('Signed in to Firebase Auth, but database profile lookup failed.');
        }
        setAuthModalOpen(false);
        routeToRoleDashboard(me.user);
        toast('Signed in successfully.', 'success');
      } catch (err: any) {
        const msg = formatFirebaseAuthError(err, email);
        fetch('/api/auth/failed-attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            errorCode: String(err?.code || 'profile_or_auth_error'),
            provider: 'password',
          }),
        }).catch(() => {});
        toast(msg, 'error');
        throw new Error(msg);
      }
    },
    [refreshMe, routeToRoleDashboard, toast]
  );

  const registerWithEmail = useCallback(
    async (params: RegisterEmailParams) => {
      if (!params.acceptedTerms) {
        throw new Error('You must accept the Terms & Conditions and Privacy Policy.');
      }
      let createdUser: User | null = null;
      try {
        const cred = await createUserWithEmailAndPassword(
          auth,
          params.email.trim(),
          params.password
        );
        createdUser = cred.user;
        await updateProfile(cred.user, { displayName: params.displayName.trim() });
        try {
          await sendEmailVerification(cred.user);
        } catch {
          // Email verification dispatch is best-effort if provider restricts quota
        }
        try {
          await apiFetch('/api/auth/register-profile', {
            method: 'POST',
            body: JSON.stringify({
              displayName: params.displayName.trim(),
              phone: params.phone?.trim(),
              accountType: params.accountType,
              acceptedTerms: true,
              authProvider: 'password',
            }),
          });
        } catch (profileErr: any) {
          // Avoid trapping user with an orphaned Firebase Auth user if backend DB persistence fails
          await cred.user.delete().catch(() => {});
          throw profileErr;
        }
        const me = await refreshMe();
        setAuthModalOpen(false);
        routeToRoleDashboard(me?.user);
        toast(
          'Account created. Please check your inbox to verify your email address.',
          'success'
        );
      } catch (err: any) {
        if (createdUser && !err?.code) {
          // Non-Firebase error already handled above
        }
        const msg = formatFirebaseAuthError(err);
        toast(msg, 'error');
        throw new Error(msg);
      }
    },
    [refreshMe, routeToRoleDashboard, toast]
  );

  const sendPasswordReset = useCallback(
    async (email: string) => {
      try {
        await sendPasswordResetEmail(auth, email.trim());
        toast(`Password reset link sent to ${email.trim()}.`, 'success');
      } catch (err: any) {
        const msg = formatFirebaseAuthError(err);
        toast(msg, 'error');
        throw new Error(msg);
      }
    },
    [toast]
  );

  const resendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) return;
    try {
      await sendEmailVerification(auth.currentUser);
      await apiFetch('/api/auth/audit-event', {
        method: 'POST',
        body: JSON.stringify({ action: 'EMAIL_VERIFICATION_SENT' }),
      }).catch(() => {});
      toast('Verification email sent. Check your inbox and spam folder.', 'success');
    } catch (err: any) {
      toast(formatFirebaseAuthError(err), 'error');
    }
  }, [toast]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const user = auth.currentUser;
      if (!user || !user.email) {
        throw new Error('Sign in with your account first.');
      }
      try {
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPassword);
        await apiFetch('/api/me/confirm-password-change', { method: 'POST' });
        await refreshMe();
        toast('Password updated successfully.', 'success');
      } catch (err: any) {
        const msg = formatFirebaseAuthError(err);
        toast(msg, 'error');
        throw new Error(msg);
      }
    },
    [refreshMe, toast]
  );

  const logout = useCallback(async () => {
    await signOut(auth);
    setActivePage('storefront');
    toast('Signed out.', 'info');
  }, [toast]);

  const formatMoney = useCallback(
    (amountUsd: number) => {
      return formatPrice(amountUsd, currency, settings?.currencyRates);
    },
    [currency, settings?.currencyRates]
  );

  const addToCart = useCallback(
    (item: CartItem) => {
      setCart((prev) => {
        const idx = prev.findIndex((i) => i.sku === item.sku);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], quantity: next[idx].quantity + item.quantity };
          return next;
        }
        return [...prev, item];
      });
      void trackActivity({
        type: 'cart_add',
        productId: item.productId,
        supplierId: item.supplierId,
        priceUsd: item.unitPriceUsd,
        size: item.size,
        color: item.color,
      });
      toast(`Added ${item.title} to your bag`, 'success');
      setIsCartOpen(true);
    },
    [toast, trackActivity]
  );

  const updateCartQty = useCallback((sku: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => (item.sku === sku ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0)
    );
  }, []);

  const removeFromCart = useCallback(
    (sku: string) => {
      setCart((prev) => {
        const target = prev.find((i) => i.sku === sku);
        if (target) {
          void trackActivity({
            type: 'cart_remove',
            productId: target.productId,
            supplierId: target.supplierId,
          });
        }
        return prev.filter((item) => item.sku !== sku);
      });
    },
    [trackActivity]
  );

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  const toggleWishlist = useCallback(
    async (productId: string) => {
      if (!auth.currentUser) {
        openAuthModal('signin');
        toast('Sign in to save items to your wishlist.', 'info');
        return;
      }
      try {
        const res = await apiFetch<{ wishlist: string[] }>('/api/me/wishlist', {
          method: 'POST',
          body: JSON.stringify({ productId }),
        });
        setWishlist(res.wishlist);
        toast(
          res.wishlist.includes(productId) ? 'Saved to wishlist' : 'Removed from wishlist',
          'info'
        );
      } catch (err: any) {
        toast(err.message || 'Failed to update wishlist', 'error');
      }
    },
    [openAuthModal, toast]
  );

  return (
    <MarketplaceContext.Provider
      value={{
        firebaseUser,
        authReady,
        userAccount,
        adminEmailUnverified,
        profileLoadError,
        mySupplier,
        wishlist,
        notifications,
        unreadNotificationCount,
        notificationPreferences,
        markNotificationRead,
        markAllNotificationsRead,
        hideNotification,
        clearVisibleNotifications,
        updateNotificationPreferences,
        pendingTarget,
        clearPendingTarget,
        navigateFromNotification,
        isDevelopmentMode,
        settings,
        categories,
        suppliers,
        products,
        reviews,
        shippingZones,
        paymentGateways,
        language,
        setLanguage,
        t,
        currency,
        setCurrency,
        formatMoney,
        cart,
        addToCart,
        updateCartQty,
        removeFromCart,
        clearCart,
        isCartOpen,
        setIsCartOpen,
        selectedProduct,
        setSelectedProduct,
        activePage,
        setActivePage,
        authModalOpen,
        setAuthModalOpen,
        authModalTab,
        setAuthModalTab,
        openAuthModal,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        sendPasswordReset,
        resendVerificationEmail,
        changePassword,
        logout,
        refreshBootstrap,
        refreshMe,
        toggleWishlist,
        recommendations,
        refreshRecommendations,
        trackActivity,
        toast,
        toasts,
        dismissToast,
        loadingStorefront,
      }}
    >
      {children}
    </MarketplaceContext.Provider>
  );
};

export function useMarketplace() {
  const ctx = useContext(MarketplaceContext);
  if (!ctx) throw new Error('useMarketplace must be used inside MarketplaceProvider');
  return ctx;
}
