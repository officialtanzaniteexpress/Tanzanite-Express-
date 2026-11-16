import React, { useEffect, useState } from 'react';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  Heart,
  KeyRound,
  LifeBuoy,
  MailCheck,
  MapPin,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext';
import { apiFetch } from '../lib/api';
import { auth } from '../lib/firebase';
import { compressReceiptImage } from '../lib/receipt-upload';
import {
  Address,
  AuditLog,
  Order,
  PaymentMethodId,
  PaymentSubmission,
  PaymentTransaction,
  RefundRequest,
  SupplierSuborder,
  SupportTicket,
} from '../types/marketplace';
import { PaymentInstructionCard } from './PaymentInstructionCard';
import { SafeImage } from './SafeImage';

type Tab = 'orders' | 'returns' | 'payments' | 'wishlist' | 'addresses' | 'profile' | 'notifications' | 'tickets';
type CustomerOrderFilter =
  | 'ALL'
  | 'PENDING_PAYMENT'
  | 'AWAITING_VERIFICATION'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED';

interface OrderProofDraft {
  paymentMethod: PaymentMethodId;
  transactionId: string;
  amountSent: string;
  senderName: string;
  senderPhone: string;
  transactionDate: string;
  receiptDataUrl?: string;
  receiptFileName?: string;
}

export const CustomerDashboard: React.FC = () => {
  const {
    firebaseUser,
    authReady,
    userAccount,
    openAuthModal,
    signInWithGoogle,
    resendVerificationEmail,
    changePassword,
    products,
    wishlist,
    toggleWishlist,
    addToCart,
    setIsCartOpen,
    recommendations,
    refreshRecommendations,
    trackActivity,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    hideNotification,
    clearVisibleNotifications,
    navigateFromNotification,
    pendingTarget,
    clearPendingTarget,
    setActivePage,
    paymentGateways,
    formatMoney,
    currency,
    setCurrency,
    t,
    setSelectedProduct,
    refreshMe,
    toast,
  } = useMarketplace();

  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [suborders, setSuborders] = useState<SupplierSuborder[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [paymentSubmissions, setPaymentSubmissions] = useState<PaymentSubmission[]>([]);
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(false);

  // Full 6-field payment proof draft per order
  const [txInputs, setTxInputs] = useState<Record<string, OrderProofDraft>>({});
  const [submittingOrderId, setSubmittingOrderId] = useState<string | null>(null);
  const [receiptModal, setReceiptModal] = useState<{ fileName: string; dataUrl: string } | null>(null);

  // Return modal state
  const [returnTarget, setReturnTarget] = useState<{ orderId: string; suborderId: string } | null>(
    null
  );
  const [returnReason, setReturnReason] = useState('');
  const [returnEvidenceUrl, setReturnEvidenceUrl] = useState('');

  // Address form
  const [newAddr, setNewAddr] = useState<Omit<Address, 'id'>>({
    label: 'Home',
    fullName: userAccount?.displayName || '',
    phone: '',
    country: 'Tanzania',
    city: 'Dar es Salaam',
    street: '',
    postalCode: '',
  });

  // Profile & privacy form
  const [displayName, setDisplayName] = useState(userAccount?.displayName || '');
  const [phone, setPhone] = useState(userAccount?.phone || '');
  const [prefCountry, setPrefCountry] = useState(userAccount?.preferredCountry || 'Tanzania');
  const [personalizationEnabled, setPersonalizationEnabled] = useState(
    userAccount?.personalizationEnabled ?? true
  );
  const [analyticsConsent, setAnalyticsConsent] = useState(userAccount?.analyticsConsent ?? true);
  const [resendingVerif, setResendingVerif] = useState(false);

  // Change password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPw, setChangingPw] = useState(false);
  const [pwError, setPwError] = useState('');

  // Order history filtering, search, pagination & detail modal
  const [orderFilter, setOrderFilter] = useState<CustomerOrderFilter>('ALL');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderPage, setOrderPage] = useState(1);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<Order | null>(null);
  const [confirmClearNotifOpen, setConfirmClearNotifOpen] = useState(false);

  // Account history, export & privacy erasure
  const [accountHistory, setAccountHistory] = useState<AuditLog[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [erasureModalOpen, setErasureModalOpen] = useState(false);
  const [erasureReason, setErasureReason] = useState('');
  const [submittingErasure, setSubmittingErasure] = useState(false);

  const loadData = async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const [ordRes, tktRes] = await Promise.all([
        apiFetch<{
          orders: Order[];
          suborders: SupplierSuborder[];
          payments: PaymentTransaction[];
          paymentSubmissions?: PaymentSubmission[];
          refunds: RefundRequest[];
        }>('/api/me/orders'),
        apiFetch<{ tickets: SupportTicket[] }>('/api/me/tickets'),
      ]);
      setOrders(ordRes.orders);
      setSuborders(ordRes.suborders);
      setPayments(ordRes.payments);
      setPaymentSubmissions(ordRes.paymentSubmissions || []);
      setRefunds(ordRes.refunds);
      setTickets(tktRes.tickets);
    } catch (err: any) {
      toast(err.message || 'Failed to load account records', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadAccountHistory = async (targetPage: number = historyPage) => {
    if (!firebaseUser) return;
    setHistoryLoading(true);
    try {
      const res = await apiFetch<{
        events?: AuditLog[];
        items?: AuditLog[];
        pagination: { page: number; totalPages: number };
      }>(`/api/me/account-history?page=${targetPage}&limit=10`);
      setAccountHistory(res.events || res.items || []);
      setHistoryTotalPages(res.pagination?.totalPages || 1);
      setHistoryPage(res.pagination?.page || targetPage);
    } catch {
      // Non-blocking
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [firebaseUser]);

  useEffect(() => {
    if (firebaseUser && tab === 'profile') {
      void loadAccountHistory(historyPage);
    }
  }, [firebaseUser, tab, historyPage]);

  useEffect(() => {
    if (pendingTarget && pendingTarget.page === 'customer' && pendingTarget.tab) {
      setTab(pendingTarget.tab as Tab);
      clearPendingTarget();
    }
  }, [pendingTarget, clearPendingTarget]);

  useEffect(() => {
    if (userAccount) {
      setDisplayName(userAccount.displayName || '');
      setPhone(userAccount.phone || '');
      setPrefCountry(userAccount.preferredCountry || 'Tanzania');
      setPersonalizationEnabled(userAccount.personalizationEnabled ?? true);
      setAnalyticsConsent(userAccount.analyticsConsent ?? true);
    }
  }, [userAccount]);

  if (!authReady) {
    return (
      <div className="max-w-xl mx-auto my-16 bg-white border border-[#E2E5F0] p-8 text-center text-xs text-neutral-500">
        Restoring session...
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="max-w-xl mx-auto my-16 bg-white border border-[#E2E5F0] p-8 text-center">
        <h2 className="font-editorial text-3xl font-semibold text-[#111322]">
          {t('customerDashboard')}
        </h2>
        <p className="text-sm text-neutral-600 mt-3">{t('customerSignInDesc')}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => openAuthModal('signin')}
            className="bg-[#2B3A9F] hover:bg-[#1E2A78] text-white px-6 py-3 min-h-[44px] text-xs font-semibold uppercase tracking-wide cursor-pointer"
          >
            {t('signIn')}
          </button>
          <button
            type="button"
            onClick={() => openAuthModal('register')}
            className="border border-[#2B3A9F] text-[#2B3A9F] hover:bg-[#EEF2FF] px-6 py-3 min-h-[44px] text-xs font-semibold uppercase tracking-wide cursor-pointer"
          >
            {t('createAccount')}
          </button>
          <button
            type="button"
            onClick={signInWithGoogle}
            className="border border-[#E2E5F0] bg-[#F8F9FC] text-[#111322] px-5 py-3 min-h-[44px] text-xs font-semibold uppercase tracking-wide cursor-pointer hover:border-[#2B3A9F]"
          >
            {t('signInGoogle')}
          </button>
        </div>
      </div>
    );
  }

  const savedProducts = products.filter((p) => wishlist.includes(p.id));

  const submitRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnTarget) return;
    try {
      await apiFetch('/api/refunds', {
        method: 'POST',
        body: JSON.stringify({
          orderId: returnTarget.orderId,
          suborderId: returnTarget.suborderId,
          reason: returnReason,
          evidenceImages: returnEvidenceUrl.trim() ? [returnEvidenceUrl.trim()] : [],
        }),
      });
      setReturnTarget(null);
      setReturnReason('');
      setReturnEvidenceUrl('');
      await loadData();
      toast('Return/refund claim submitted.', 'success');
    } catch (err: any) {
      toast(err.message || 'Could not submit refund request', 'error');
    }
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    const list = [
      ...(userAccount?.addresses || []),
      { ...newAddr, id: `addr_${Date.now()}` },
    ];
    try {
      await apiFetch('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({ addresses: list }),
      });
      setNewAddr({
        label: 'Office',
        fullName: userAccount?.displayName || '',
        phone: '',
        country: 'Tanzania',
        city: 'Dar es Salaam',
        street: '',
        postalCode: '',
      });
      await refreshMe();
      toast('Delivery address saved.', 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to save address', 'error');
    }
  };

  const handleDeleteAddress = async (id: string) => {
    const list = (userAccount?.addresses || []).filter((a) => a.id !== id);
    await apiFetch('/api/me', { method: 'PATCH', body: JSON.stringify({ addresses: list }) });
    await refreshMe();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName,
          phone,
          preferredCurrency: currency,
          preferredCountry: prefCountry,
          personalizationEnabled,
          analyticsConsent,
        }),
      });
      await refreshMe();
      await refreshRecommendations();
      toast('Profile, regional & privacy preferences updated.', 'success');
    } catch (err: any) {
      toast(err.message || 'Update failed', 'error');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('New password and confirmation do not match.');
      return;
    }
    setChangingPw(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPwError(err?.message || 'Unable to change password.');
    } finally {
      setChangingPw(false);
    }
  };

  const getOrderDraft = (order: Order): OrderProofDraft => {
    return (
      txInputs[order.id] || {
        paymentMethod: order.paymentProvider === 'manual_nmb' ? 'manual_nmb' : 'manual_mobile',
        transactionId: order.submittedTransactionId || '',
        amountSent: String(order.totalDisplay),
        senderName: order.submittedPayerName || order.shippingAddress.fullName || userAccount?.displayName || '',
        senderPhone: order.submittedPayerPhone || order.shippingAddress.phone || '',
        transactionDate: new Date().toISOString().slice(0, 10),
      }
    );
  };

  const handleOrderReceiptPick = async (order: Order, file: File) => {
    try {
      const compressed = await compressReceiptImage(file);
      const draft = getOrderDraft(order);
      setTxInputs({
        ...txInputs,
        [order.id]: {
          ...draft,
          receiptDataUrl: compressed.dataUrl,
          receiptFileName: compressed.fileName,
        },
      });
    } catch (err: any) {
      toast(err.message || 'Invalid receipt image', 'error');
    }
  };

  const handleViewMyReceipt = async (submissionId: string) => {
    try {
      const res = await apiFetch<{ receiptFileName: string; receiptImageDataUrl: string }>(
        `/api/payment-submissions/${encodeURIComponent(submissionId)}/receipt`
      );
      setReceiptModal({ fileName: res.receiptFileName, dataUrl: res.receiptImageDataUrl });
    } catch (err: any) {
      toast(err.message || 'Unable to load receipt', 'error');
    }
  };

  const handleSubmitOrderTx = async (order: Order) => {
    const draft = getOrderDraft(order);
    if (!draft.transactionId.trim() || draft.transactionId.trim().length < 4) {
      toast('Enter your Transaction / Reference ID (min 4 characters).', 'error');
      return;
    }
    const parsedAmt = Number(draft.amountSent);
    if (!Number.isFinite(parsedAmt) || parsedAmt <= 0) {
      toast('Enter a valid amount sent.', 'error');
      return;
    }
    if (!draft.senderName.trim() || draft.senderName.trim().length < 2) {
      toast('Enter the sender full name.', 'error');
      return;
    }

    setSubmittingOrderId(order.id);
    try {
      await apiFetch(`/api/orders/${order.id}/submit-payment`, {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod: draft.paymentMethod,
          transactionId: draft.transactionId.trim(),
          amountSent: parsedAmt,
          senderName: draft.senderName.trim(),
          senderPhone: draft.senderPhone.trim() || undefined,
          transactionDate: draft.transactionDate,
          receiptImageDataUrl: draft.receiptDataUrl,
          receiptFileName: draft.receiptFileName,
          email: order.customerEmail,
        }),
      });
      await loadData();
      toast(t('txSubmittedBanner'), 'success');
    } catch (err: any) {
      toast(err.message || 'Could not submit payment proof', 'error');
    } finally {
      setSubmittingOrderId(null);
    }
  };

  const handleReorderOrder = (order: Order) => {
    const orderSubs = suborders.filter((s) => s.orderId === order.id);
    let addedCount = 0;
    let skippedCount = 0;
    for (const sub of orderSubs) {
      for (const it of sub.items) {
        const liveProduct = products.find((p) => p.id === it.productId && p.isPublished !== false && p.totalStock > 0);
        if (!liveProduct) {
          skippedCount += 1;
          continue;
        }
        const matchedVariant =
          liveProduct.variants.find((v) => v.sku === it.sku && v.stock > 0) ||
          liveProduct.variants.find((v) => v.stock > 0);
        if (!matchedVariant) {
          skippedCount += 1;
          continue;
        }
        addToCart({
          productId: liveProduct.id,
          supplierId: liveProduct.supplierId,
          supplierName: liveProduct.supplierName,
          title: liveProduct.title,
          image: liveProduct.images[0] || it.image || '',
          sku: matchedVariant.sku,
          size: matchedVariant.size,
          color: matchedVariant.color,
          quantity: Math.min(it.quantity, matchedVariant.stock),
          unitPriceUsd: liveProduct.sellingPriceUsd,
          wholesalePriceUsd: liveProduct.wholesalePriceUsd,
          shippingFeeUsd: liveProduct.shippingFeeUsd,
          estimatedDaysMin: liveProduct.estimatedDaysMin,
          estimatedDaysMax: liveProduct.estimatedDaysMax,
          shippingOriginCountry: liveProduct.shippingOriginCountry,
        });
        addedCount += 1;
      }
    }
    if (addedCount > 0) {
      setIsCartOpen(true);
      toast(
        skippedCount > 0
          ? `Added ${addedCount} available item(s) to bag (${skippedCount} currently unavailable).`
          : `Added ${addedCount} item(s) to your bag.`,
        'success'
      );
    } else {
      toast('None of the items in this order are currently in stock.', 'error');
    }
  };

  const handleExportMyData = async (format: 'json' | 'csv') => {
    if (!firebaseUser) return;
    setExportingData(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/me/export?format=${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Export failed');
      const text = await res.text();
      const blob = new Blob([text], {
        type: format === 'csv' ? 'text/csv;charset=utf-8;' : 'application/json;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tanzanite-express-account-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Downloaded account data export (${format.toUpperCase()}).`, 'success');
    } catch (err: any) {
      toast(err.message || 'Unable to export account data', 'error');
    } finally {
      setExportingData(false);
    }
  };

  const handleSubmitErasureRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingErasure(true);
    try {
      await apiFetch('/api/me/erasure-request', {
        method: 'POST',
        body: JSON.stringify({ reason: erasureReason.trim() }),
      });
      setErasureModalOpen(false);
      setErasureReason('');
      await refreshMe();
      await loadAccountHistory(1);
      toast('Privacy erasure request submitted and logged for Super Admin review.', 'success');
    } catch (err: any) {
      toast(err.message || 'Unable to submit erasure request', 'error');
    } finally {
      setSubmittingErasure(false);
    }
  };

  const navItems: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'orders', label: t('ordersTab'), icon: <Package className="w-4 h-4" /> },
    { id: 'returns', label: t('returnsTab'), icon: <RotateCcw className="w-4 h-4" /> },
    { id: 'payments', label: t('paymentsTab'), icon: <CreditCard className="w-4 h-4" /> },
    { id: 'wishlist', label: t('wishlistTab'), icon: <Heart className="w-4 h-4" /> },
    { id: 'addresses', label: t('addressesTab'), icon: <MapPin className="w-4 h-4" /> },
    { id: 'notifications', label: t('notificationsTab'), icon: <Bell className="w-4 h-4" /> },
    { id: 'tickets', label: t('ticketsTab'), icon: <LifeBuoy className="w-4 h-4" /> },
    { id: 'profile', label: t('profileTab'), icon: <User className="w-4 h-4" /> },
  ];

  const isPasswordProvider =
    userAccount?.authProvider === 'password' ||
    firebaseUser.providerData.some((p) => p.providerId === 'password');
  const needsEmailVerification = isPasswordProvider && !firebaseUser.emailVerified;

  const customerRecommended = (recommendations?.recommendedForYou || []).slice(0, 4);
  const customerRecentlyViewed = (recommendations?.recentlyViewed || []).slice(0, 4);

  return (
    <div className="max-w-[1440px] mx-auto px-3.5 sm:px-8 py-6 sm:py-8 grid lg:grid-cols-12 gap-6 lg:gap-8">
      <aside className="lg:col-span-3 min-w-0 bg-white border border-[#E2E5F0] p-4 h-fit">
        <div className="pb-4 mb-3 border-b border-[#E2E5F0]">
          <p className="text-xs text-[#5B3CC4] uppercase tracking-wider font-semibold">
            {t('customerWorkspace')}
          </p>
          <p className="text-sm font-semibold text-[#111322] truncate mt-0.5">
            {userAccount?.displayName}
          </p>
        </div>
        <nav className="flex max-w-full overflow-x-auto gap-1.5 pb-1 lg:pb-0 lg:block lg:space-y-1">
          {navItems.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setTab(n.id)}
              className={`shrink-0 lg:w-full flex items-center gap-2.5 px-3 py-2.5 min-h-[44px] text-xs font-medium text-left transition-colors cursor-pointer ${
                tab === n.id
                  ? 'bg-[#2B3A9F] text-white'
                  : 'text-neutral-700 hover:bg-[#EEF2FF]'
              }`}
            >
              {n.icon}
              <span className="whitespace-nowrap">{n.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="lg:col-span-9 min-w-0 space-y-6">
        {needsEmailVerification && (
          <div className="bg-amber-50 border border-amber-300 px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950">
            <div className="flex items-center gap-2 min-w-0">
              <MailCheck className="w-4 h-4 shrink-0 text-amber-700" />
              <span className="min-w-0 break-words">
                Please verify your email address (<strong>{firebaseUser.email}</strong>) to secure your TANZANITE EXPRESS account.
              </span>
            </div>
            <button
              type="button"
              disabled={resendingVerif}
              onClick={async () => {
                setResendingVerif(true);
                try {
                  await resendVerificationEmail();
                } finally {
                  setResendingVerif(false);
                }
              }}
              className="border border-amber-700 bg-white px-3 py-2 min-h-[40px] font-semibold text-amber-950 hover:bg-amber-100 cursor-pointer disabled:opacity-50"
            >
              {resendingVerif ? 'Sending...' : 'Resend Verification Email'}
            </button>
          </div>
        )}

        <div className="bg-white border border-[#E2E5F0] px-4 sm:px-6 py-3.5 sm:py-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-neutral-500">
            {t('account')} / <span className="text-[#111322] font-medium capitalize">{tab}</span>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="text-xs font-medium text-[#2B3A9F] underline cursor-pointer min-h-[36px]"
          >
            {t('refresh')}
          </button>
        </div>

        {tab === 'orders' && (() => {
          const matchesOrderFilter = (order: Order): boolean => {
            if (orderFilter === 'ALL') return true;
            if (orderFilter === 'PENDING_PAYMENT') {
              return order.paymentStatus === 'PENDING' && order.overallStatus !== 'Cancelled';
            }
            if (orderFilter === 'AWAITING_VERIFICATION') {
              return order.paymentStatus === 'AWAITING_VERIFICATION';
            }
            if (orderFilter === 'CONFIRMED') {
              return order.paymentStatus === 'CONFIRMED' && order.overallStatus === 'Payment Confirmed';
            }
            if (orderFilter === 'PROCESSING') {
              return (
                order.overallStatus === 'Processing' ||
                order.overallStatus === 'Supplier Confirmed' ||
                order.overallStatus === 'Ready for Shipping'
              );
            }
            if (orderFilter === 'SHIPPED') {
              return order.overallStatus === 'Shipped' || order.overallStatus === 'In Transit';
            }
            if (orderFilter === 'COMPLETED') {
              return order.overallStatus === 'Completed' || order.overallStatus === 'Delivered';
            }
            if (orderFilter === 'CANCELLED') {
              return order.overallStatus === 'Cancelled';
            }
            if (orderFilter === 'REFUNDED') {
              return (
                order.paymentStatus === 'REFUNDED' ||
                order.paymentStatus === 'PARTIALLY_REFUNDED' ||
                order.overallStatus === 'Refunded'
              );
            }
            return true;
          };

          const q = orderSearch.trim().toLowerCase();
          const filteredOrders = orders.filter((order) => {
            if (!matchesOrderFilter(order)) return false;
            if (!q) return true;
            const orderSubs = suborders.filter((s) => s.orderId === order.id);
            const subHit = orderSubs.some(
              (s) =>
                s.supplierName.toLowerCase().includes(q) ||
                (s.trackingNumber || '').toLowerCase().includes(q) ||
                s.items.some((it) => it.title.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q))
            );
            return (
              order.id.toLowerCase().includes(q) ||
              (order.submittedTransactionId || '').toLowerCase().includes(q) ||
              order.shippingAddress.city.toLowerCase().includes(q) ||
              subHit
            );
          });

          const ORDER_PAGE_SIZE = 6;
          const totalOrderPages = Math.max(1, Math.ceil(filteredOrders.length / ORDER_PAGE_SIZE));
          const safeOrderPage = Math.min(orderPage, totalOrderPages);
          const pagedOrders = filteredOrders.slice(
            (safeOrderPage - 1) * ORDER_PAGE_SIZE,
            safeOrderPage * ORDER_PAGE_SIZE
          );

          const filterTabs: { id: CustomerOrderFilter; label: string }[] = [
            { id: 'ALL', label: t('orderHistoryFiltersAll') },
            { id: 'PENDING_PAYMENT', label: 'Pending Payment' },
            { id: 'AWAITING_VERIFICATION', label: 'Awaiting Verification' },
            { id: 'CONFIRMED', label: 'Confirmed' },
            { id: 'PROCESSING', label: 'Processing' },
            { id: 'SHIPPED', label: 'Shipped' },
            { id: 'COMPLETED', label: 'Completed' },
            { id: 'CANCELLED', label: 'Cancelled' },
            { id: 'REFUNDED', label: 'Refunded' },
          ];

          return (
            <div className="space-y-4">
              {orders.length > 0 && (
                <div className="bg-white border border-[#E2E5F0] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {filterTabs.map((ft) => (
                        <button
                          key={ft.id}
                          type="button"
                          onClick={() => {
                            setOrderFilter(ft.id);
                            setOrderPage(1);
                          }}
                          className={`px-2.5 py-1.5 text-[11px] font-medium border cursor-pointer ${
                            orderFilter === ft.id
                              ? 'bg-[#2B3A9F] text-white border-[#2B3A9F]'
                              : 'bg-[#F8F9FC] text-neutral-700 border-[#E2E5F0] hover:border-[#2B3A9F]'
                          }`}
                        >
                          {ft.label}
                        </button>
                      ))}
                    </div>
                    <div className="relative w-full sm:w-64">
                      <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-2.5" />
                      <input
                        type="search"
                        value={orderSearch}
                        onChange={(e) => {
                          setOrderSearch(e.target.value);
                          setOrderPage(1);
                        }}
                        placeholder={t('orderSearchPlaceholder')}
                        className="w-full border border-[#E2E5F0] pl-8 pr-3 py-1.5 text-xs bg-[#F8F9FC]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="bg-white border border-[#E5E2DC] p-8 text-xs text-neutral-500">
                  Loading...
                </div>
              ) : orders.length === 0 ? (
                <div className="bg-white border border-[#E5E2DC] p-8 text-center">
                  <p className="font-editorial text-2xl text-[#111111]">{t('noOrdersYet')}</p>
                  <p className="text-xs text-neutral-500 mt-1">{t('noOrdersSub')}</p>
                </div>
              ) : pagedOrders.length === 0 ? (
                <div className="bg-white border border-[#E5E2DC] p-8 text-center text-xs text-neutral-500">
                  No orders match the selected filter or search.
                </div>
              ) : (
                pagedOrders.map((order) => {
                  const orderSubs = suborders.filter((s) => s.orderId === order.id);
                  const orderSubmissions = paymentSubmissions.filter((s) => s.orderId === order.id);
                  const latestSub = orderSubmissions[0];
                  const needsPaymentSubmission =
                    order.overallStatus !== 'Cancelled' &&
                    (order.paymentStatus === 'PENDING' ||
                      order.paymentStatus === 'AWAITING_VERIFICATION' ||
                      latestSub?.status === 'INFO_REQUESTED' ||
                      latestSub?.status === 'REJECTED');
                  const draft = getOrderDraft(order);
                  const mpesaGw = paymentGateways.find((g) => g.id === 'manual_mobile' && g.enabledForCheckout);
                  const nmbGw = paymentGateways.find((g) => g.id === 'manual_nmb' && g.enabledForCheckout);
                  const selectedOrderGw =
                    draft.paymentMethod === 'manual_nmb'
                      ? nmbGw || mpesaGw
                      : mpesaGw || nmbGw;
                  const amountDisplayStr = `${order.currency} ${order.totalDisplay.toLocaleString()} (${formatMoney(order.totalUsd)})`;

                  return (
                    <div key={order.id} className="bg-white border border-[#E5E2DC] p-4 sm:p-6 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E5E2DC]">
                        <div>
                          <p className="text-xs text-neutral-500 font-mono-tabular">
                            {order.id} · {new Date(order.createdAt).toLocaleDateString()} ·{' '}
                            {order.paymentProvider === 'manual_mobile'
                              ? 'M-PESA'
                              : order.paymentProvider === 'manual_nmb'
                                ? 'NMB BANK'
                                : order.paymentProvider.toUpperCase()}
                          </p>
                          <p className="text-sm font-semibold text-[#111111] mt-0.5">
                            {order.overallStatus} ·{' '}
                            {order.paymentStatus === 'CONFIRMED'
                              ? t('paymentConfirmedLabel')
                              : latestSub
                                ? latestSub.status
                                : order.paymentStatus}
                          </p>
                          {order.submittedTransactionId && (
                            <p className="text-xs text-[#8B6F47] font-mono-tabular mt-0.5">
                              {t('submittedTxIdLabel')}: {order.submittedTransactionId}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col sm:items-end gap-1.5">
                          <div className="sm:text-right">
                            <p className="text-sm font-semibold tabular-nums">
                              {formatMoney(order.totalUsd)}
                            </p>
                            <p className="text-[11px] text-neutral-500">
                              {order.currency} {order.totalDisplay.toLocaleString()} ·{' '}
                              {order.shippingAddress.city}, {order.shippingAddress.country}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedOrderDetail(order)}
                              className="inline-flex items-center gap-1 border border-[#E2E5F0] bg-[#F8F9FC] hover:border-[#2B3A9F] px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                            >
                              <Eye className="w-3 h-3" /> {t('viewOrderDetails')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReorderOrder(order)}
                              className="inline-flex items-center gap-1 border border-[#2B3A9F] text-[#2B3A9F] hover:bg-[#EEF2FF] px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                            >
                              <RefreshCw className="w-3 h-3" /> {t('reorderItems')}
                            </button>
                          </div>
                        </div>
                      </div>

                      {order.paymentRejectionReason && (
                        <div className="bg-red-50 border border-red-200 p-3 text-xs text-red-900">
                          <strong>Payment Rejected:</strong> {order.paymentRejectionReason}
                        </div>
                      )}

                      {order.paymentInfoRequestMessage && (
                        <div className="bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                          <strong>Admin Info Request:</strong> {order.paymentInfoRequestMessage}
                        </div>
                      )}

                      {latestSub && latestSub.hasReceiptImage && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs border border-[#E5E2DC] bg-[#FAF9F6] px-3 py-2 min-w-0">
                          <span className="text-neutral-600 min-w-0 truncate">
                            Attached Receipt: {latestSub.receiptFileName || 'receipt'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleViewMyReceipt(latestSub.id)}
                            className="inline-flex items-center gap-1 text-[#8B6F47] font-medium underline cursor-pointer shrink-0"
                          >
                            <Eye className="w-3.5 h-3.5" /> {t('viewReceipt')}
                          </button>
                        </div>
                      )}

                      {needsPaymentSubmission && order.paymentStatus !== 'CONFIRMED' && (
                        <div className="bg-white border border-[#E5E2DC] p-4 space-y-3 text-xs">
                          <div className="space-y-1.5">
                            <p className="font-semibold text-[#111111]">
                              {latestSub?.status === 'PENDING_VERIFICATION'
                                ? t('awaitingAdminCheck')
                                : t('submitTxIdNow')}
                            </p>
                            <p className="text-neutral-600">{t('paymentNotConfirmedDisclaimer')}</p>
                          </div>

                          {selectedOrderGw && (
                            <PaymentInstructionCard
                              gateway={selectedOrderGw}
                              amountText={amountDisplayStr}
                              highlighted
                              compact
                            />
                          )}

                          {selectedOrderGw?.accountDetails?.accountName && (
                            <div className="border border-[#8B6F47] bg-[#FAF9F6] p-3 text-xs space-y-0.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B6F47] flex items-center gap-1.5">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                {t('confirmRecipientTitle')}
                              </p>
                              <p className="text-neutral-800">
                                {t('confirmRecipientNotice')}{' '}
                                <strong className="text-[#111111]">
                                  {selectedOrderGw.accountDetails.accountName}
                                </strong>
                              </p>
                            </div>
                          )}

                          <div className="grid sm:grid-cols-2 gap-2.5">
                            <select
                              value={draft.paymentMethod}
                              onChange={(e) =>
                                setTxInputs({
                                  ...txInputs,
                                  [order.id]: {
                                    ...draft,
                                    paymentMethod: e.target.value as PaymentMethodId,
                                  },
                                })
                              }
                              className="border border-[#E5E2DC] bg-white px-3 py-2"
                            >
                              {paymentGateways
                                .filter(
                                  (g) =>
                                    (g.id === 'manual_mobile' || g.id === 'manual_nmb') &&
                                    g.enabledForCheckout
                                )
                                .map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                            </select>
                            <input
                              type="text"
                              value={draft.transactionId}
                              onChange={(e) =>
                                setTxInputs({
                                  ...txInputs,
                                  [order.id]: { ...draft, transactionId: e.target.value },
                                })
                              }
                              placeholder={t('transactionIdLabel')}
                              className="border border-[#E5E2DC] bg-white px-3 py-2 font-mono-tabular"
                            />
                            <input
                              type="number"
                              step="0.01"
                              value={draft.amountSent}
                              onChange={(e) =>
                                setTxInputs({
                                  ...txInputs,
                                  [order.id]: { ...draft, amountSent: e.target.value },
                                })
                              }
                              placeholder={`${t('amountSentLabel')} (${order.currency})`}
                              className="border border-[#E5E2DC] bg-white px-3 py-2 font-mono-tabular"
                            />
                            <input
                              type="date"
                              value={draft.transactionDate}
                              onChange={(e) =>
                                setTxInputs({
                                  ...txInputs,
                                  [order.id]: { ...draft, transactionDate: e.target.value },
                                })
                              }
                              className="border border-[#E5E2DC] bg-white px-3 py-2 font-mono-tabular"
                            />
                            <input
                              type="text"
                              value={draft.senderName}
                              onChange={(e) =>
                                setTxInputs({
                                  ...txInputs,
                                  [order.id]: { ...draft, senderName: e.target.value },
                                })
                              }
                              placeholder={t('senderNameLabel')}
                              className="border border-[#E5E2DC] bg-white px-3 py-2"
                            />
                            <input
                              type="tel"
                              value={draft.senderPhone}
                              onChange={(e) =>
                                setTxInputs({
                                  ...txInputs,
                                  [order.id]: { ...draft, senderPhone: e.target.value },
                                })
                              }
                              placeholder={t('payerPhoneLabel')}
                              className="border border-[#E5E2DC] bg-white px-3 py-2"
                            />
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <label className="inline-flex items-center gap-1.5 border border-dashed border-[#E5E2DC] bg-white px-3 py-2 cursor-pointer hover:border-[#111111]">
                              <Upload className="w-3.5 h-3.5 text-[#8B6F47]" />
                              <span>{draft.receiptFileName || t('receiptScreenshotLabel')}</span>
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleOrderReceiptPick(order, f);
                                }}
                                className="hidden"
                              />
                            </label>
                            <button
                              type="button"
                              disabled={submittingOrderId === order.id}
                              onClick={() => handleSubmitOrderTx(order)}
                              className="bg-[#111111] text-white px-5 py-2 font-semibold cursor-pointer disabled:opacity-60"
                            >
                              {submittingOrderId === order.id
                                ? t('submittingTx')
                                : order.paymentRejectionReason || latestSub?.status === 'INFO_REQUESTED'
                                  ? t('reSubmitTxId')
                                  : t('submitTransactionBtn')}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-3">
                        {orderSubs.map((sub) => (
                          <div key={sub.id} className="border border-[#E5E2DC] bg-[#FAF9F6] p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="font-semibold text-[#111111]">
                                {sub.supplierName} ({sub.supplierCountry})
                              </span>
                              <span className="font-medium text-[#8B6F47]">{sub.status}</span>
                            </div>
                            <ul className="mt-2 space-y-2 text-xs text-neutral-700">
                              {sub.items.map((it) => {
                                const thumb =
                                  it.image || products.find((p) => p.id === it.productId)?.images?.[0];
                                return (
                                  <li key={it.sku} className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      {thumb && (
                                        <div className="w-10 h-10 bg-white border border-[#E5E2DC] shrink-0 overflow-hidden">
                                          <SafeImage
                                            src={thumb}
                                            alt={it.title}
                                            className="w-full h-full object-cover"
                                          />
                                        </div>
                                      )}
                                      <span className="truncate">
                                        {it.title} ({it.size}/{it.color}) × {it.quantity}
                                      </span>
                                    </div>
                                    <span className="tabular-nums shrink-0">
                                      {formatMoney(it.lineTotalUsd)}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                            {sub.trackingNumber && (
                              <p className="mt-2 text-xs text-emerald-800">
                                Tracking ({sub.carrierName}):{' '}
                                <span className="font-mono-tabular font-medium">
                                  {sub.trackingNumber}
                                </span>
                                {sub.trackingUrl && (
                                  <>
                                    {' · '}
                                    <a
                                      href={sub.trackingUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline"
                                    >
                                      Track Package
                                    </a>
                                  </>
                                )}
                              </p>
                            )}
                            {order.paymentStatus === 'CONFIRMED' &&
                              sub.status !== 'Refund Requested' &&
                              sub.status !== 'Refunded' && (
                                <div className="mt-3 pt-2 border-t border-[#E5E2DC] flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setReturnTarget({ orderId: order.id, suborderId: sub.id })
                                    }
                                    className="text-xs text-neutral-700 underline cursor-pointer"
                                  >
                                    {t('requestReturn')}
                                  </button>
                                </div>
                              )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}

              {totalOrderPages > 1 && (
                <div className="flex items-center justify-between bg-white border border-[#E2E5F0] px-4 py-3 text-xs">
                  <span className="text-neutral-600 font-mono-tabular">
                    Page {safeOrderPage} of {totalOrderPages} ({filteredOrders.length} orders)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={safeOrderPage <= 1}
                      onClick={() => setOrderPage((p) => Math.max(1, p - 1))}
                      className="inline-flex items-center gap-1 border border-[#E2E5F0] px-3 py-1.5 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" /> Prev
                    </button>
                    <button
                      type="button"
                      disabled={safeOrderPage >= totalOrderPages}
                      onClick={() => setOrderPage((p) => Math.min(totalOrderPages, p + 1))}
                      className="inline-flex items-center gap-1 border border-[#E2E5F0] px-3 py-1.5 disabled:opacity-40 cursor-pointer"
                    >
                      Next <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {tab === 'returns' && (
          <div className="bg-white border border-[#E5E2DC] p-6 space-y-4">
            <h3 className="font-editorial text-2xl font-semibold">Return & Refund Claims</h3>
            {refunds.length === 0 ? (
              <p className="text-xs text-neutral-500">No return or refund requests submitted.</p>
            ) : (
              refunds.map((r) => (
                <div key={r.id} className="border border-[#E5E2DC] p-4 bg-[#FAF9F6] text-xs space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span className="font-mono-tabular">{r.id}</span>
                    <span>{r.status}</span>
                  </div>
                  <p className="text-neutral-600">Reason: {r.reason}</p>
                  {r.supplierResponse && (
                    <p className="text-neutral-700">Supplier Note: {r.supplierResponse}</p>
                  )}
                  {r.adminNotes && (
                    <p className="text-[#8B6F47]">Resolution Note: {r.adminNotes}</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'payments' && (
          <div className="space-y-4">
            <div className="bg-white border border-[#E5E2DC] p-6 space-y-4">
              <div>
                <h3 className="font-editorial text-2xl font-semibold text-[#111111]">
                  {t('howToPayTitle')}
                </h3>
                <p className="text-xs text-neutral-500 mt-1">
                  {t('paymentNotConfirmedDisclaimer')}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {paymentGateways
                  .filter(
                    (g) =>
                      (g.id === 'manual_mobile' || g.id === 'manual_nmb') && g.enabledForCheckout
                  )
                  .map((gw) => (
                    <PaymentInstructionCard
                      key={gw.id}
                      gateway={gw}
                      amountText="Exact Order Total"
                      compact
                    />
                  ))}
              </div>
            </div>

            <div className="bg-white border border-[#E5E2DC] p-4 sm:p-6">
              <h3 className="font-editorial text-2xl font-semibold mb-4">Payment Transactions</h3>
              {payments.length === 0 ? (
                <p className="text-xs text-neutral-500">No payment records found.</p>
              ) : (
                <>
                  <div className="md:hidden space-y-2.5 text-xs">
                    {payments.map((p) => (
                      <div key={p.id} className="border border-[#E5E2DC] bg-[#FAF9F6] p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono-tabular font-semibold break-all">{p.reference}</span>
                          <span className="font-semibold tabular-nums shrink-0">{formatMoney(p.amountUsd)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-600">
                          <span className="uppercase">{p.provider}</span>
                          <span>{p.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="border-b border-[#E5E2DC] text-neutral-500">
                        <tr>
                          <th className="py-2 pr-4">Reference</th>
                          <th className="py-2 pr-4">Provider</th>
                          <th className="py-2 pr-4">Status</th>
                          <th className="py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E2DC]">
                        {payments.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2.5 pr-4 font-mono-tabular">{p.reference}</td>
                            <td className="py-2.5 pr-4 uppercase">{p.provider}</td>
                            <td className="py-2.5 pr-4">{p.status}</td>
                            <td className="py-2.5 text-right tabular-nums">
                              {formatMoney(p.amountUsd)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === 'wishlist' && (
          <div className="bg-white border border-[#E5E2DC] p-4 sm:p-6">
            <h3 className="font-editorial text-2xl font-semibold mb-4">
              Saved Wishlist ({savedProducts.length})
            </h3>
            {savedProducts.length === 0 ? (
              <p className="text-xs text-neutral-500">No items saved in your wishlist yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedProducts.map((p) => (
                  <div key={p.id} className="border border-[#E5E2DC] p-3 space-y-2 min-w-0">
                    <div className="aspect-[4/3] bg-[#F4F2EE] overflow-hidden">
                      <SafeImage src={p.images[0]} alt={p.title} className="w-full h-full object-cover" />
                    </div>
                    <p className="text-xs font-semibold truncate">{p.title}</p>
                    <p className="text-xs tabular-nums text-neutral-600">
                      {formatMoney(p.sellingPriceUsd)}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedProduct(p)}
                        className="flex-1 min-h-[40px] bg-[#111111] text-white py-1.5 text-xs cursor-pointer"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleWishlist(p.id)}
                        className="min-h-[40px] border border-[#E5E2DC] px-2.5 py-1.5 text-xs cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'addresses' && (
          <div className="bg-white border border-[#E5E2DC] p-4 sm:p-6 space-y-6">
            <h3 className="font-editorial text-2xl font-semibold">Saved Delivery Addresses</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {(userAccount?.addresses || []).map((addr) => (
                <div key={addr.id} className="border border-[#E5E2DC] p-4 text-xs space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>{addr.label}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteAddress(addr.id)}
                      className="text-red-700 underline cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                  <p>{addr.fullName} · {addr.phone}</p>
                  <p className="text-neutral-600">
                    {addr.street}, {addr.city}, {addr.country}
                  </p>
                </div>
              ))}
            </div>

            <form onSubmit={handleSaveAddress} className="border-t border-[#E5E2DC] pt-5 grid sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={newAddr.label}
                onChange={(e) => setNewAddr({ ...newAddr, label: e.target.value })}
                placeholder="Label (Home / Office)"
                className="border border-[#E5E2DC] px-3 py-2 text-xs"
              />
              <input
                type="text"
                required
                value={newAddr.fullName}
                onChange={(e) => setNewAddr({ ...newAddr, fullName: e.target.value })}
                placeholder="Full Name"
                className="border border-[#E5E2DC] px-3 py-2 text-xs"
              />
              <input
                type="tel"
                required
                value={newAddr.phone}
                onChange={(e) => setNewAddr({ ...newAddr, phone: e.target.value })}
                placeholder="Phone"
                className="border border-[#E5E2DC] px-3 py-2 text-xs"
              />
              <input
                type="text"
                required
                value={newAddr.country}
                onChange={(e) => setNewAddr({ ...newAddr, country: e.target.value })}
                placeholder="Country"
                className="border border-[#E5E2DC] px-3 py-2 text-xs"
              />
              <input
                type="text"
                required
                value={newAddr.city}
                onChange={(e) => setNewAddr({ ...newAddr, city: e.target.value })}
                placeholder="City"
                className="border border-[#E5E2DC] px-3 py-2 text-xs"
              />
              <input
                type="text"
                required
                value={newAddr.street}
                onChange={(e) => setNewAddr({ ...newAddr, street: e.target.value })}
                placeholder="Street & Landmark"
                className="border border-[#E5E2DC] px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="sm:col-span-2 bg-[#111111] text-white py-2.5 text-xs font-medium cursor-pointer"
              >
                Add Delivery Address
              </button>
            </form>
          </div>
        )}

        {tab === 'notifications' && (
          <div className="bg-white border border-[#E5E2DC] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-editorial text-2xl font-semibold">{t('notifications')}</h3>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActivePage('notifications')}
                  className="text-xs text-[#8B6F47] underline cursor-pointer"
                >
                  {t('viewAllNotifications')}
                </button>
                <button
                  type="button"
                  onClick={markAllNotificationsRead}
                  className="text-xs underline cursor-pointer"
                >
                  {t('markAllRead')}
                </button>
                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmClearNotifOpen(true)}
                    className="inline-flex items-center gap-1 text-xs text-red-700 underline cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" /> {t('clearVisibleNotifications')}
                  </button>
                )}
              </div>
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-neutral-500">{t('noNotificationsYet')}</p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`border p-4 text-xs flex flex-wrap items-start justify-between gap-3 ${
                    n.read ? 'border-[#E5E2DC] bg-white' : 'border-[#8B6F47] bg-[#FAF9F6]'
                  }`}
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <p className="text-[10px] uppercase text-[#8B6F47] font-semibold">
                      {n.type} · {new Date(n.createdAt).toLocaleString()}
                    </p>
                    <p className="font-semibold text-[#111111]">{n.title}</p>
                    <p className="text-neutral-600">{n.message}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!n.read && (
                      <button
                        type="button"
                        onClick={() => markNotificationRead(n.id)}
                        className="border border-[#E5E2DC] px-2.5 py-1 text-[11px] cursor-pointer"
                      >
                        {t('markRead')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => hideNotification(n.id)}
                      className="inline-flex items-center gap-1 border border-[#E5E2DC] px-2.5 py-1 text-[11px] text-neutral-600 hover:text-red-700 cursor-pointer"
                    >
                      <EyeOff className="w-3 h-3" /> {t('hideNotification')}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateFromNotification(n)}
                      className="bg-[#111111] text-white px-2.5 py-1 text-[11px] cursor-pointer"
                    >
                      Open
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'tickets' && (
          <div className="bg-white border border-[#E5E2DC] p-6 space-y-4">
            <h3 className="font-editorial text-2xl font-semibold">My Support Tickets</h3>
            {tickets.length === 0 ? (
              <p className="text-xs text-neutral-500">
                No support tickets submitted. Visit Support in the navigation bar to open a ticket.
              </p>
            ) : (
              tickets.map((t) => (
                <div key={t.id} className="border border-[#E5E2DC] p-4 text-xs space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>{t.subject}</span>
                    <span>{t.status}</span>
                  </div>
                  <p className="text-neutral-600">{t.message}</p>
                  {t.responses.map((r, i) => (
                    <p key={i} className="text-[#8B6F47] pt-1">
                      {r.author}: {r.message}
                    </p>
                  ))}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'profile' && (
          <div className="space-y-6">
            <form onSubmit={handleSaveProfile} className="bg-white border border-[#E2E5F0] p-6 space-y-5">
              <h3 className="font-editorial text-2xl font-semibold text-[#111322]">
                Profile, Currency & Privacy Preferences
              </h3>
              <div className="grid sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-neutral-500 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full border border-[#E2E5F0] px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-neutral-500 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full border border-[#E2E5F0] px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-neutral-500 mb-1">Preferred Country</label>
                  <input
                    type="text"
                    value={prefCountry}
                    onChange={(e) => setPrefCountry(e.target.value)}
                    className="w-full border border-[#E2E5F0] px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-neutral-500 mb-1">Preferred Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as any)}
                    className="w-full border border-[#E2E5F0] px-3 py-2 bg-white"
                  >
                    <option value="TZS">TZS</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                    <option value="EUR">EUR</option>
                    <option value="KES">KES</option>
                  </select>
                </div>
              </div>

              <div className="border-t border-[#E2E5F0] pt-4 space-y-2.5 text-xs">
                <p className="font-semibold text-[#111322]">{t('privacyPersonalizationTitle')}</p>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={personalizationEnabled}
                    onChange={(e) => setPersonalizationEnabled(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-neutral-700">
                    Enable personalized fashion recommendations (Recommended for You, Recently Viewed, Similar Styles). Turning this off clears your saved recommendation preference profile.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={analyticsConsent}
                    onChange={(e) => setAnalyticsConsent(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-neutral-700">
                    Allow anonymous marketplace browsing & search telemetry to improve category discovery and product availability.
                  </span>
                </label>
              </div>

              <button
                type="submit"
                className="bg-[#2B3A9F] hover:bg-[#1E2A78] text-white px-6 py-2.5 min-h-[42px] text-xs font-semibold cursor-pointer"
              >
                Save Preferences
              </button>
            </form>

            <div className="bg-white border border-[#E2E5F0] p-6 space-y-4">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#5B3CC4]" />
                <h3 className="font-editorial text-2xl font-semibold text-[#111322]">
                  {t('changePasswordTitle')}
                </h3>
              </div>
              {isPasswordProvider ? (
                <form onSubmit={handleChangePassword} className="grid sm:grid-cols-3 gap-3 text-xs">
                  <input
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    className="border border-[#E2E5F0] px-3 py-2.5"
                  />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 8 chars)"
                    className="border border-[#E2E5F0] px-3 py-2.5"
                  />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="border border-[#E2E5F0] px-3 py-2.5"
                  />
                  {pwError && (
                    <p className="sm:col-span-3 text-red-700 bg-red-50 border border-red-200 px-3 py-2">
                      {pwError}
                    </p>
                  )}
                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      disabled={changingPw}
                      className="bg-[#111322] text-white px-5 py-2.5 min-h-[40px] font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {changingPw ? 'Updating...' : t('changePasswordTitle')}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="text-xs text-neutral-600">
                  Your account is signed in with Google ({firebaseUser.email}). Password management is handled by your Google account security settings.
                </p>
              )}
            </div>
            <div className="bg-white border border-[#E2E5F0] p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#5B3CC4]" />
                  <h3 className="font-editorial text-2xl font-semibold text-[#111322]">
                    {t('accountHistoryTitle')}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    disabled={exportingData}
                    onClick={() => handleExportMyData('json')}
                    className="inline-flex items-center gap-1.5 border border-[#E2E5F0] bg-[#F8F9FC] hover:border-[#2B3A9F] px-3 py-1.5 font-medium cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" /> Export JSON
                  </button>
                  <button
                    type="button"
                    disabled={exportingData}
                    onClick={() => handleExportMyData('csv')}
                    className="inline-flex items-center gap-1.5 border border-[#E2E5F0] bg-[#F8F9FC] hover:border-[#2B3A9F] px-3 py-1.5 font-medium cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" /> Export CSV
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="border border-[#E2E5F0] bg-[#F8F9FC] p-3">
                  <p className="text-[10px] uppercase text-neutral-500">Member Since</p>
                  <p className="font-semibold text-[#111322] mt-0.5 font-mono-tabular">
                    {userAccount?.createdAt
                      ? new Date(userAccount.createdAt).toLocaleDateString()
                      : '—'}
                  </p>
                </div>
                <div className="border border-[#E2E5F0] bg-[#F8F9FC] p-3">
                  <p className="text-[10px] uppercase text-neutral-500">Last Login</p>
                  <p className="font-semibold text-[#111322] mt-0.5 font-mono-tabular">
                    {userAccount?.lastLoginAt
                      ? new Date(userAccount.lastLoginAt).toLocaleString()
                      : 'Active session'}
                  </p>
                </div>
                <div className="border border-[#E2E5F0] bg-[#F8F9FC] p-3">
                  <p className="text-[10px] uppercase text-neutral-500">Recorded Logins</p>
                  <p className="font-semibold text-[#111322] mt-0.5 font-mono-tabular">
                    {userAccount?.loginCount ?? 1}
                  </p>
                </div>
                <div className="border border-[#E2E5F0] bg-[#F8F9FC] p-3">
                  <p className="text-[10px] uppercase text-neutral-500">Total Orders</p>
                  <p className="font-semibold text-[#111322] mt-0.5 font-mono-tabular">
                    {orders.length}
                  </p>
                </div>
              </div>

              {historyLoading ? (
                <p className="text-xs text-neutral-500">Loading security & activity history...</p>
              ) : accountHistory.length === 0 ? (
                <p className="text-xs text-neutral-500">No recorded security or account activity events yet.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {accountHistory.map((ev) => (
                    <div
                      key={ev.id}
                      className="border border-[#E2E5F0] bg-[#F8F9FC] px-3 py-2.5 flex flex-wrap justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-[#111322]">{ev.action}</p>
                        <p className="text-neutral-600 break-words">{ev.details}</p>
                      </div>
                      <span className="font-mono-tabular text-[11px] text-neutral-500 shrink-0">
                        {new Date(ev.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {historyTotalPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-[11px] font-mono-tabular text-neutral-500">
                        Page {historyPage} of {historyTotalPages}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={historyPage <= 1}
                          onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                          className="border border-[#E2E5F0] px-2.5 py-1 disabled:opacity-40 cursor-pointer"
                        >
                          Prev
                        </button>
                        <button
                          type="button"
                          disabled={historyPage >= historyTotalPages}
                          onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                          className="border border-[#E2E5F0] px-2.5 py-1 disabled:opacity-40 cursor-pointer"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-[#E2E5F0] pt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <p className="font-semibold text-[#111322] flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-700" />
                    Privacy & Personal Data Erasure
                  </p>
                  <p className="text-neutral-600 mt-0.5">
                    Request personal data anonymization. Required financial & order ledger totals remain preserved for accounting compliance.
                  </p>
                </div>
                {userAccount?.erasureRequestedAt ? (
                  <span className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-900 font-medium">
                    Erasure Requested ({new Date(userAccount.erasureRequestedAt).toLocaleDateString()})
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setErasureModalOpen(true)}
                    className="border border-red-300 text-red-700 hover:bg-red-50 px-3.5 py-2 font-medium cursor-pointer"
                  >
                    {t('requestErasureBtn')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {(customerRecommended.length > 0 || customerRecentlyViewed.length > 0) && (
          <div className="bg-white border border-[#E2E5F0] p-5 space-y-5">
            {customerRecommended.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-editorial text-xl font-semibold text-[#111322] flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#5B3CC4]" />
                    {t('recommendedForYou')}
                  </h4>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {customerRecommended.map((prod) => (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => {
                        void trackActivity({
                          type: 'recommendation_click',
                          productId: prod.id,
                          supplierId: prod.supplierId,
                          source: 'customer_dashboard_recommended',
                        });
                        setSelectedProduct(prod);
                      }}
                      className="text-left border border-[#E2E5F0] bg-[#F8F9FC] p-2.5 hover:border-[#2B3A9F] cursor-pointer space-y-1.5"
                    >
                      <div className="aspect-[4/3] bg-white overflow-hidden">
                        <SafeImage src={prod.images[0]} alt={prod.title} className="w-full h-full object-cover" />
                      </div>
                      <p className="text-xs font-medium text-[#111322] truncate">{prod.title}</p>
                      <p className="text-[11px] font-semibold text-[#2B3A9F] tabular-nums">
                        {formatMoney(prod.sellingPriceUsd)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {customerRecentlyViewed.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-[#E2E5F0]">
                <h4 className="font-editorial text-lg font-semibold text-[#111322]">
                  {t('recentlyViewed')}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {customerRecentlyViewed.map((prod) => (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => {
                        void trackActivity({
                          type: 'recommendation_click',
                          productId: prod.id,
                          supplierId: prod.supplierId,
                          source: 'customer_dashboard_recent',
                        });
                        setSelectedProduct(prod);
                      }}
                      className="text-left border border-[#E2E5F0] bg-[#F8F9FC] p-2.5 hover:border-[#2B3A9F] cursor-pointer space-y-1.5"
                    >
                      <div className="aspect-[4/3] bg-white overflow-hidden">
                        <SafeImage src={prod.images[0]} alt={prod.title} className="w-full h-full object-cover" />
                      </div>
                      <p className="text-xs font-medium text-[#111322] truncate">{prod.title}</p>
                      <p className="text-[11px] font-semibold text-[#2B3A9F] tabular-nums">
                        {formatMoney(prod.sellingPriceUsd)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {returnTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={submitRefund}
            className="bg-white border border-[#E5E2DC] p-6 w-full max-w-md space-y-4"
          >
            <h3 className="font-editorial text-2xl font-semibold">Request Return or Refund</h3>
            <p className="text-xs text-neutral-500">
              Suborder: <span className="font-mono-tabular">{returnTarget.suborderId}</span>
            </p>
            <textarea
              required
              rows={3}
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="Describe the sizing issue, defect, or delivery problem..."
              className="w-full border border-[#E5E2DC] p-3 text-xs"
            />
            <input
              type="url"
              value={returnEvidenceUrl}
              onChange={(e) => setReturnEvidenceUrl(e.target.value)}
              placeholder="Evidence photo URL (optional)"
              className="w-full border border-[#E5E2DC] px-3 py-2 text-xs"
            />
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setReturnTarget(null)}
                className="border border-[#E5E2DC] px-4 py-2 text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="bg-[#111111] text-white px-5 py-2 text-xs font-medium cursor-pointer"
              >
                Submit Claim
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedOrderDetail && (() => {
        const orderSubs = suborders.filter((s) => s.orderId === selectedOrderDetail.id);
        return (
          <div className="fixed inset-0 z-50 bg-black/55 overflow-y-auto p-3 sm:p-6 flex justify-center items-start">
            <div className="bg-white border border-[#E2E5F0] w-full max-w-2xl my-6 p-5 sm:p-6 space-y-4 text-xs">
              <div className="flex items-start justify-between gap-3 border-b border-[#E2E5F0] pb-3">
                <div>
                  <p className="font-mono-tabular text-neutral-500">{selectedOrderDetail.id}</p>
                  <h3 className="font-editorial text-2xl font-semibold text-[#111322]">
                    Order Details & Status Timeline
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedOrderDetail(null)}
                  className="p-1.5 border border-[#E2E5F0] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 bg-[#F8F9FC] border border-[#E2E5F0] p-3.5">
                <div>
                  <p className="font-semibold text-[#111322] mb-1">Delivery Address Snapshot</p>
                  <p>{selectedOrderDetail.shippingAddress.fullName}</p>
                  <p>{selectedOrderDetail.shippingAddress.phone}</p>
                  <p className="text-neutral-600">
                    {selectedOrderDetail.shippingAddress.street},{' '}
                    {selectedOrderDetail.shippingAddress.city},{' '}
                    {selectedOrderDetail.shippingAddress.country}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-[#111322] mb-1">Financial Summary</p>
                  <p>Subtotal: {formatMoney(selectedOrderDetail.subtotalUsd)}</p>
                  <p>Shipping: {formatMoney(selectedOrderDetail.shippingUsd)}</p>
                  {selectedOrderDetail.discountUsd > 0 && (
                    <p>Discount: -{formatMoney(selectedOrderDetail.discountUsd)}</p>
                  )}
                  <p className="font-semibold text-[#111322] mt-1">
                    Total: {formatMoney(selectedOrderDetail.totalUsd)} ({selectedOrderDetail.currency}{' '}
                    {selectedOrderDetail.totalDisplay.toLocaleString()})
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {orderSubs.map((sub) => (
                  <div key={sub.id} className="border border-[#E2E5F0] p-3.5 space-y-2">
                    <div className="flex justify-between font-semibold">
                      <span>{sub.supplierName}</span>
                      <span className="text-[#2B3A9F]">{sub.status}</span>
                    </div>
                    <ul className="space-y-1 text-neutral-700">
                      {sub.items.map((it) => (
                        <li key={it.sku} className="flex justify-between">
                          <span>
                            {it.title} ({it.size}/{it.color}) × {it.quantity}
                          </span>
                          <span className="tabular-nums">{formatMoney(it.lineTotalUsd)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="border-t border-[#E2E5F0] pt-2 space-y-1">
                      <p className="text-[11px] font-semibold text-neutral-600">Fulfillment Timeline</p>
                      {(sub.statusHistory || []).map((ev, i) => (
                        <p key={i} className="text-[11px] text-neutral-600">
                          <span className="font-mono-tabular text-neutral-400">
                            {new Date(ev.timestamp).toLocaleString()}
                          </span>{' '}
                          — <strong>{ev.status}</strong>: {ev.note}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    handleReorderOrder(selectedOrderDetail);
                    setSelectedOrderDetail(null);
                  }}
                  className="inline-flex items-center gap-1.5 border border-[#2B3A9F] text-[#2B3A9F] px-4 py-2 font-semibold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> {t('reorderItems')}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedOrderDetail(null)}
                  className="bg-[#111322] text-white px-5 py-2 font-semibold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {confirmClearNotifOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E5F0] p-6 w-full max-w-md space-y-4">
            <h3 className="font-editorial text-2xl font-semibold text-[#111322]">
              {t('clearVisibleConfirmTitle')}
            </h3>
            <p className="text-xs text-neutral-600 leading-relaxed">
              {t('clearVisibleConfirmBody')}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmClearNotifOpen(false)}
                className="border border-[#E2E5F0] px-4 py-2 text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await clearVisibleNotifications();
                  setConfirmClearNotifOpen(false);
                }}
                className="bg-red-700 text-white px-5 py-2 text-xs font-semibold cursor-pointer"
              >
                {t('clearVisibleNotifications')}
              </button>
            </div>
          </div>
        </div>
      )}

      {erasureModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitErasureRequest}
            className="bg-white border border-[#E2E5F0] p-6 w-full max-w-md space-y-4 text-xs"
          >
            <h3 className="font-editorial text-2xl font-semibold text-[#111322]">
              {t('requestErasureBtn')}
            </h3>
            <p className="text-neutral-600 leading-relaxed">
              Submitting this request flags your account for PII anonymization by the Super Admin while preserving immutable financial order & tax records.
            </p>
            <textarea
              rows={3}
              required
              minLength={5}
              value={erasureReason}
              onChange={(e) => setErasureReason(e.target.value)}
              placeholder="Reason for privacy erasure request (min 5 characters)..."
              className="w-full border border-[#E2E5F0] p-2.5 bg-[#F8F9FC]"
            />
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setErasureModalOpen(false)}
                className="border border-[#E2E5F0] px-4 py-2 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingErasure}
                className="bg-red-700 text-white px-5 py-2 font-semibold cursor-pointer disabled:opacity-50"
              >
                {submittingErasure ? 'Submitting...' : 'Submit Erasure Request'}
              </button>
            </div>
          </form>
        </div>
      )}

      {receiptModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E2DC] p-5 max-w-lg w-full space-y-3">
            <div className="flex items-center justify-between border-b border-[#E5E2DC] pb-2">
              <p className="text-xs font-semibold">{receiptModal.fileName}</p>
              <button
                type="button"
                onClick={() => setReceiptModal(null)}
                className="text-xs underline cursor-pointer"
              >
                Close
              </button>
            </div>
            <img
              src={receiptModal.dataUrl}
              alt={receiptModal.fileName}
              className="max-h-[70vh] w-full object-contain bg-[#FAF9F6]"
            />
          </div>
        </div>
      )}
    </div>
  );
};
