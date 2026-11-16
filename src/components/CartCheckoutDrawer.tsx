import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Minus,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext';
import { apiFetch } from '../lib/api';
import { compressReceiptImage } from '../lib/receipt-upload';
import {
  Order,
  PaymentMethodId,
  PaymentProviderId,
  PaymentSubmission,
  PaymentTransaction,
  SupplierSuborder,
} from '../types/marketplace';
import { PaymentInstructionCard } from './PaymentInstructionCard';
import { SafeImage } from './SafeImage';

export const CartCheckoutDrawer: React.FC = () => {
  const {
    cart,
    updateCartQty,
    removeFromCart,
    clearCart,
    isCartOpen,
    setIsCartOpen,
    formatMoney,
    currency,
    t,
    userAccount,
    firebaseUser,
    paymentGateways,
    refreshBootstrap,
    trackActivity,
    toast,
  } = useMarketplace();

  const [step, setStep] = useState<'cart' | 'checkout' | 'payment'>('cart');
  const [customerEmail, setCustomerEmail] = useState(userAccount?.email || '');
  const [fullName, setFullName] = useState(userAccount?.displayName || '');
  const [phone, setPhone] = useState(userAccount?.phone || '');
  const [country, setCountry] = useState('Tanzania');
  const [city, setCity] = useState('Dar es Salaam');
  const [street, setStreet] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [discountUsd, setDiscountUsd] = useState(0);
  const [customsAccepted, setCustomsAccepted] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState<PaymentMethodId>('manual_mobile');
  const [submitting, setSubmitting] = useState(false);

  const [createdOrder, setCreatedOrder] = useState<{
    order: Order;
    suborders: SupplierSuborder[];
    payment: PaymentTransaction;
    submission?: PaymentSubmission;
  } | null>(null);

  // Full 6-field customer payment proof state
  const [proofMethod, setProofMethod] = useState<PaymentMethodId>('manual_mobile');
  const [transactionIdInput, setTransactionIdInput] = useState('');
  const [amountSentInput, setAmountSentInput] = useState('');
  const [senderNameInput, setSenderNameInput] = useState('');
  const [senderPhoneInput, setSenderPhoneInput] = useState('');
  const [transactionDateInput, setTransactionDateInput] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | undefined>(undefined);
  const [receiptFileName, setReceiptFileName] = useState<string | undefined>(undefined);
  const [submittingTx, setSubmittingTx] = useState(false);

  const mvpGateways = useMemo(
    () => paymentGateways.filter((g) => g.id === 'manual_mobile' || g.id === 'manual_nmb'),
    [paymentGateways]
  );

  useEffect(() => {
    const enabled = mvpGateways.filter((g) => g.enabledForCheckout);
    if (enabled.length > 0 && !enabled.some((g) => g.id === paymentProvider)) {
      setPaymentProvider(enabled[0].id as PaymentMethodId);
    }
  }, [mvpGateways, paymentProvider]);

  const groupedBySupplier = useMemo(() => {
    const map = new Map<string, typeof cart>();
    for (const item of cart) {
      const list = map.get(item.supplierName) || [];
      list.push(item);
      map.set(item.supplierName, list);
    }
    return Array.from(map.entries());
  }, [cart]);

  const subtotalUsd = useMemo(
    () => cart.reduce((acc, i) => acc + i.unitPriceUsd * i.quantity, 0),
    [cart]
  );

  const isInternational = country.trim().toLowerCase() !== 'tanzania';
  const estimatedShippingUsd = useMemo(() => {
    if (groupedBySupplier.length === 0) return 0;
    return groupedBySupplier.reduce((sum, [, items]) => {
      const base = Math.max(...items.map((i) => i.shippingFeeUsd));
      return sum + (isInternational ? base * 1.5 : base);
    }, 0);
  }, [groupedBySupplier, isInternational]);

  const totalUsd = Math.max(0, subtotalUsd - discountUsd + estimatedShippingUsd);

  if (!isCartOpen) return null;

  const applyCoupon = async () => {
    if (!couponCode.trim()) return;
    try {
      const res = await apiFetch<{ discountUsd: number }>('/api/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({ code: couponCode, subtotalUsd }),
      });
      setDiscountUsd(res.discountUsd);
      toast(`Coupon applied (${formatMoney(res.discountUsd)} off).`, 'success');
    } catch (err: any) {
      setDiscountUsd(0);
      toast(err.message || 'Invalid coupon', 'error');
    }
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailToUse = (customerEmail || userAccount?.email || firebaseUser?.email || '').trim();
    if (!emailToUse) {
      toast('Please enter your email address for order receipts and tracking.', 'error');
      return;
    }
    if (isInternational && !customsAccepted) {
      toast('Please acknowledge the international customs and duties notice.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const res = await apiFetch<{
        order: Order;
        suborders: SupplierSuborder[];
        payment: PaymentTransaction;
      }>('/api/checkout/create-order', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey,
          customerEmail: emailToUse,
          currency,
          couponCode: couponCode.trim() || undefined,
          paymentProvider: paymentProvider as PaymentProviderId,
          customsDisclaimerAccepted: isInternational ? customsAccepted : true,
          shippingAddress: {
            id: 'addr_checkout',
            label: 'Delivery Address',
            fullName: fullName || userAccount?.displayName || 'Customer',
            phone,
            country,
            city,
            street,
            postalCode,
          },
          items: cart.map((i) => ({
            productId: i.productId,
            sku: i.sku,
            quantity: i.quantity,
          })),
        }),
      });
      setCreatedOrder(res);
      setProofMethod(paymentProvider);
      setAmountSentInput(String(res.order.totalDisplay));
      setSenderNameInput(fullName || userAccount?.displayName || '');
      setSenderPhoneInput(phone || '');
      setTransactionDateInput(new Date().toISOString().slice(0, 10));
      setTransactionIdInput('');
      setReceiptDataUrl(undefined);
      setReceiptFileName(undefined);
      setStep('payment');
      clearCart();
      await refreshBootstrap();
      toast('Order created! Follow the payment instructions and submit your proof.', 'success');
    } catch (err: any) {
      toast(err.message || 'Checkout failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceiptPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressReceiptImage(file);
      setReceiptDataUrl(compressed.dataUrl);
      setReceiptFileName(compressed.fileName);
    } catch (err: any) {
      toast(err.message || 'Invalid receipt image', 'error');
    }
  };

  const handleSubmitTransactionId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createdOrder) return;
    if (!transactionIdInput.trim() || transactionIdInput.trim().length < 4) {
      toast('Enter a valid Transaction / Reference ID (min 4 characters).', 'error');
      return;
    }
    const parsedAmount = Number(amountSentInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast('Enter the exact amount you sent.', 'error');
      return;
    }
    if (!senderNameInput.trim() || senderNameInput.trim().length < 2) {
      toast('Enter the sender full name.', 'error');
      return;
    }

    setSubmittingTx(true);
    try {
      const res = await apiFetch<{
        order: Order;
        payment: PaymentTransaction;
        submission: PaymentSubmission;
      }>(`/api/orders/${createdOrder.order.id}/submit-payment`, {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod: proofMethod,
          transactionId: transactionIdInput.trim(),
          amountSent: parsedAmount,
          senderName: senderNameInput.trim(),
          senderPhone: senderPhoneInput.trim() || undefined,
          transactionDate: transactionDateInput,
          receiptImageDataUrl: receiptDataUrl,
          receiptFileName,
          email: createdOrder.order.customerEmail,
        }),
      });
      setCreatedOrder({
        ...createdOrder,
        order: res.order,
        payment: res.payment,
        submission: res.submission,
      });
      toast(t('txSubmittedBanner'), 'success');
    } catch (err: any) {
      toast(err.message || 'Unable to submit payment proof', 'error');
    } finally {
      setSubmittingTx(false);
    }
  };

  const selectedCheckoutGateway = mvpGateways.find((g) => g.id === paymentProvider);
  const selectedProofGateway = mvpGateways.find((g) => g.id === proofMethod);
  const orderedPaymentGateways = [
    ...mvpGateways.filter((g) => g.enabledForCheckout && g.id === proofMethod),
    ...mvpGateways.filter((g) => g.enabledForCheckout && g.id !== proofMethod),
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <div className="w-full max-w-lg bg-[#F8F9FC] h-full flex flex-col border-l border-[#E2E5F0]">
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-white border-b border-[#E2E5F0] flex items-center justify-between gap-2">
          <h2 className="font-editorial text-xl sm:text-2xl font-semibold text-[#111322] min-w-0 truncate">
            {step === 'cart'
              ? t('shoppingBag')
              : step === 'checkout'
                ? t('checkoutTitle')
                : t('paymentInstructionsTitle')}
          </h2>
          <button
            type="button"
            onClick={() => {
              setIsCartOpen(false);
              if (step === 'payment') {
                setStep('cart');
                setCreatedOrder(null);
              }
            }}
            aria-label="Close bag drawer"
            className="min-h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center text-neutral-600 hover:text-[#111111] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 sm:space-y-6">
          {step === 'cart' && (
            <>
              {cart.length === 0 ? (
                <div className="text-center py-16">
                  <p className="font-editorial text-xl text-[#111111]">{t('emptyBag')}</p>
                  <p className="text-xs text-neutral-500 mt-2">{t('emptyBagSub')}</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-neutral-600">{t('multiSupplierNote')}</p>

                  {groupedBySupplier.map(([supplierName, items]) => (
                    <div key={supplierName} className="bg-white border border-[#E5E2DC] p-4 space-y-4">
                      <div className="text-xs font-semibold text-[#111111] border-b border-[#E5E2DC] pb-2 flex justify-between">
                        <span>{supplierName}</span>
                        <span className="text-neutral-500 font-normal">
                          {items[0].shippingOriginCountry}
                        </span>
                      </div>
                      {items.map((item) => (
                        <div key={item.sku} className="flex gap-3">
                          <div className="w-16 h-16 bg-[#F4F2EE] shrink-0 overflow-hidden">
                            <SafeImage
                              src={item.image}
                              alt={item.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-[#111111] truncate">
                              {item.title}
                            </p>
                            <p className="text-[11px] text-neutral-500">
                              {item.size} · {item.color}
                            </p>
                            <div className="mt-2 flex items-center justify-between">
                              <div className="flex items-center border border-[#E5E2DC]">
                                <button
                                  type="button"
                                  onClick={() => updateCartQty(item.sku, -1)}
                                  className="px-2 py-1 text-xs cursor-pointer"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="px-2 text-xs tabular-nums">{item.quantity}</span>
                                <button
                                  type="button"
                                  onClick={() => updateCartQty(item.sku, 1)}
                                  className="px-2 py-1 text-xs cursor-pointer"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold tabular-nums">
                                  {formatMoney(item.unitPriceUsd * item.quantity)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeFromCart(item.sku)}
                                  aria-label="Remove item"
                                  className="text-neutral-400 hover:text-red-700 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {step === 'checkout' && (
            <form id="checkout-form" onSubmit={handlePlaceOrder} className="space-y-4">
              {userAccount?.addresses && userAccount.addresses.length > 0 && (
                <div className="bg-white border border-[#E5E2DC] p-3">
                  <p className="text-xs font-medium text-[#111111] mb-2">Saved Address</p>
                  <div className="flex flex-wrap gap-2">
                    {userAccount.addresses.map((addr) => (
                      <button
                        key={addr.id}
                        type="button"
                        onClick={() => {
                          setFullName(addr.fullName);
                          setPhone(addr.phone);
                          setCountry(addr.country);
                          setCity(addr.city);
                          setStreet(addr.street);
                          setPostalCode(addr.postalCode || '');
                        }}
                        className="text-xs border border-[#E5E2DC] px-2.5 py-1 hover:border-[#111111] cursor-pointer"
                      >
                        {addr.label} ({addr.city})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-white border border-[#E5E2DC] p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {t('contactDestination')}
                </p>
                <input
                  type="email"
                  required
                  value={customerEmail || userAccount?.email || ''}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full border border-[#E5E2DC] px-3 py-2 text-xs"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Full name"
                    className="border border-[#E5E2DC] px-3 py-2 text-xs"
                  />
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Phone (+255 / 07...)"
                    className="border border-[#E5E2DC] px-3 py-2 text-xs"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="border border-[#E5E2DC] px-3 py-2 text-xs bg-white"
                  >
                    <option value="Tanzania">Tanzania</option>
                    <option value="Kenya">Kenya</option>
                    <option value="Uganda">Uganda</option>
                    <option value="United Kingdom">United Kingdom</option>
                    <option value="United States">United States</option>
                    <option value="Germany">Germany</option>
                    <option value="UAE">UAE</option>
                  </select>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="City (e.g., Dar es Salaam)"
                    className="border border-[#E5E2DC] px-3 py-2 text-xs"
                  />
                </div>
                <input
                  type="text"
                  required
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="Street / Ward / Building"
                  className="w-full border border-[#E5E2DC] px-3 py-2 text-xs"
                />
              </div>

              {/* Coupon */}
              <div className="bg-white border border-[#E2E5F0] p-3.5 sm:p-4 flex flex-wrap min-[360px]:flex-nowrap gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="Promo code (e.g., TANZANITE10)"
                  className="flex-1 min-w-0 min-h-[42px] border border-[#E2E5F0] px-3 py-2 text-xs uppercase"
                />
                <button
                  type="button"
                  onClick={applyCoupon}
                  className="min-h-[42px] border border-[#2B3A9F] text-[#2B3A9F] px-4 py-2 text-xs font-medium cursor-pointer hover:bg-[#EEF2FF] shrink-0"
                >
                  Apply
                </button>
              </div>

              {/* Active Admin-Configured Manual Payment Methods */}
              <div className="bg-white border border-[#E5E2DC] p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {t('paymentMethodTitle')}
                </p>

                <div className="bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">
                  {t('directGatewayNotice')}
                </div>

                {mvpGateways.map((gw) => {
                  const disabled = !gw.enabledForCheckout;
                  return (
                    <label
                      key={gw.id}
                      className={`block border p-3 ${
                        paymentProvider === gw.id
                          ? 'border-[#111111] bg-[#FAF9F6]'
                          : 'border-[#E5E2DC]'
                      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <input
                          type="radio"
                          name="paymentProvider"
                          disabled={disabled}
                          checked={paymentProvider === gw.id}
                          onChange={() => setPaymentProvider(gw.id as PaymentMethodId)}
                          className="mt-0.5 accent-[#111111]"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[#111111]">
                              {gw.name}
                            </span>
                            <span className="text-[11px] text-neutral-500">{gw.market}</span>
                          </div>
                          <p className="text-[11px] text-neutral-500 mt-0.5">
                            {gw.methods.join(' · ')}
                          </p>
                          {gw.accountDetails?.accountName && (
                            <p className="text-[11px] text-[#111111] font-medium mt-1">
                              {gw.id === 'manual_mobile'
                                ? t('recipientNameLabel')
                                : t('accountHolderLabel')}
                              : {gw.accountDetails.accountName}
                            </p>
                          )}
                          <p className="text-[11px] text-[#8B6F47] mt-0.5">{gw.statusLabel}</p>
                        </div>
                      </div>
                    </label>
                  );
                })}

                {selectedCheckoutGateway?.enabledForCheckout && (
                  <div className="pt-1">
                    <PaymentInstructionCard
                      gateway={selectedCheckoutGateway}
                      amountText={formatMoney(totalUsd)}
                      highlighted
                      compact
                    />
                  </div>
                )}
              </div>

              {isInternational && (
                <label className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={customsAccepted}
                    onChange={(e) => setCustomsAccepted(e.target.checked)}
                    className="mt-0.5 accent-[#111111]"
                  />
                  <span>{t('customsDisclaimer')}</span>
                </label>
              )}
            </form>
          )}

          {step === 'payment' && createdOrder && (
            <div className="space-y-4">
              {/* Order Summary & Status */}
              <div className="bg-white border border-[#E5E2DC] p-5 space-y-2.5">
                <div className="flex items-center gap-2">
                  {createdOrder.order.paymentStatus === 'CONFIRMED' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-amber-700" />
                  )}
                  <h3 className="text-sm font-semibold text-[#111111]">
                    Order {createdOrder.order.id} — {createdOrder.order.overallStatus}
                  </h3>
                </div>
                <p className="text-xs text-neutral-600">
                  Ref:{' '}
                  <span className="font-mono-tabular font-medium">
                    {createdOrder.payment.reference}
                  </span>{' '}
                  · {t('total')}:{' '}
                  <span className="font-semibold text-[#111111] tabular-nums">
                    {createdOrder.order.currency}{' '}
                    {createdOrder.order.totalDisplay.toLocaleString()} (
                    {formatMoney(createdOrder.order.totalUsd)})
                  </span>
                </p>
              </div>

              {/* Admin-Configured Payment Channel Details */}
              <div className="bg-white border border-[#E5E2DC] p-5 space-y-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#111111]">
                  {t('howToPayTitle')}
                </h4>
                <ol className="space-y-1.5 text-xs text-neutral-700 leading-relaxed">
                  <li>{t('howToPayStep1')}</li>
                </ol>

                <div className="grid gap-3">
                  {orderedPaymentGateways.map((gw) => (
                    <PaymentInstructionCard
                      key={gw.id}
                      gateway={gw}
                      amountText={`${createdOrder.order.currency} ${createdOrder.order.totalDisplay.toLocaleString()} (${formatMoney(createdOrder.order.totalUsd)})`}
                      highlighted={gw.id === proofMethod}
                    />
                  ))}
                </div>

                <ol className="space-y-1.5 text-xs text-neutral-700 leading-relaxed">
                  <li>{t('howToPayStep2')}</li>
                  <li>{t('howToPayStep3')}</li>
                </ol>
              </div>

              {/* Customer Manual Payment Proof Submission Form */}
              {createdOrder.submission?.status === 'PENDING_VERIFICATION' ? (
                <div className="bg-emerald-50 border border-emerald-200 p-5 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-900 font-semibold text-xs">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      Status: PENDING VERIFICATION · Ref: {createdOrder.submission.transactionId}
                    </span>
                  </div>
                  <p className="text-xs text-emerald-900 leading-relaxed">
                    {t('txSubmittedBanner')}
                  </p>
                  <p className="text-[11px] text-emerald-800 font-mono-tabular">
                    {createdOrder.submission.paymentMethod === 'manual_mobile'
                      ? 'M-Pesa'
                      : 'NMB Bank Transfer'}{' '}
                    · {createdOrder.submission.currency}{' '}
                    {createdOrder.submission.amountSentDisplay.toLocaleString()} ·{' '}
                    {createdOrder.submission.senderName}
                  </p>
                </div>
              ) : createdOrder.order.paymentStatus !== 'CONFIRMED' ? (
                <form
                  onSubmit={handleSubmitTransactionId}
                  className="bg-[#111322] text-white p-5 space-y-3"
                >
                  {selectedProofGateway?.accountDetails?.accountName && (
                    <div className="border border-[#5B3CC4] bg-[#1A1D36] p-3 space-y-1">
                      <p className="text-[11px] uppercase tracking-wider text-[#A5B4FC] font-semibold flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {t('confirmRecipientTitle')}
                      </p>
                      <p className="text-[11px] text-neutral-200 leading-relaxed">
                        {t('confirmRecipientNotice')}{' '}
                        <strong className="text-white">
                          {selectedProofGateway.accountDetails.accountName}
                        </strong>
                        {selectedProofGateway.id === 'manual_mobile' &&
                        selectedProofGateway.accountDetails.phone
                          ? ` (${selectedProofGateway.accountDetails.phone})`
                          : selectedProofGateway.id === 'manual_nmb' &&
                              selectedProofGateway.accountDetails.bankAccount
                            ? ` (${selectedProofGateway.accountDetails.bankName || 'NMB Bank'} · ${selectedProofGateway.accountDetails.bankAccount})`
                            : ''}
                      </p>
                    </div>
                  )}

                  <p className="text-[11px] text-[#D4B483] leading-relaxed border border-neutral-800 bg-neutral-900/70 p-2.5">
                    {t('paymentNotConfirmedDisclaimer')}
                  </p>

                  <div>
                    <label className="block text-[11px] text-neutral-300 mb-1">
                      {t('paymentMethodLabel')}
                    </label>
                    <select
                      value={proofMethod}
                      onChange={(e) => setProofMethod(e.target.value as PaymentMethodId)}
                      className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4B483]"
                    >
                      {mvpGateways
                        .filter((g) => g.enabledForCheckout)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-neutral-300 mb-1">
                      {t('transactionIdLabel')} *
                    </label>
                    <input
                      type="text"
                      required
                      value={transactionIdInput}
                      onChange={(e) => setTransactionIdInput(e.target.value)}
                      placeholder="e.g., BGT89X21K9 or NMB-984122"
                      className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-xs text-white font-mono-tabular focus:outline-none focus:border-[#D4B483]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-neutral-300 mb-1">
                        {t('amountSentLabel')} ({createdOrder.order.currency}) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={amountSentInput}
                        onChange={(e) => setAmountSentInput(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-xs text-white font-mono-tabular focus:outline-none focus:border-[#D4B483]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-neutral-300 mb-1">
                        {t('transactionDateLabel')} *
                      </label>
                      <input
                        type="date"
                        required
                        value={transactionDateInput}
                        onChange={(e) => setTransactionDateInput(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-xs text-white font-mono-tabular focus:outline-none focus:border-[#D4B483]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-neutral-300 mb-1">
                        {t('senderNameLabel')} *
                      </label>
                      <input
                        type="text"
                        required
                        value={senderNameInput}
                        onChange={(e) => setSenderNameInput(e.target.value)}
                        placeholder="Full name"
                        className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4B483]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-neutral-300 mb-1">
                        {t('payerPhoneLabel')}
                      </label>
                      <input
                        type="tel"
                        value={senderPhoneInput}
                        onChange={(e) => setSenderPhoneInput(e.target.value)}
                        placeholder="+255..."
                        className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4B483]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-neutral-300 mb-1">
                      {t('receiptScreenshotLabel')}
                    </label>
                    <label className="flex items-center justify-between gap-2 min-w-0 border border-dashed border-neutral-600 px-3 py-2.5 min-h-[42px] text-xs text-neutral-300 cursor-pointer hover:border-[#D4B483]">
                      <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                        <Upload className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{receiptFileName || 'Choose PNG / JPG / WEBP'}</span>
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleReceiptPick}
                        className="hidden"
                      />
                      {receiptDataUrl && (
                        <button
                          type="button"
                          onClick={(evt) => {
                            evt.preventDefault();
                            setReceiptDataUrl(undefined);
                            setReceiptFileName(undefined);
                          }}
                          className="text-[11px] text-red-400 underline"
                        >
                          Clear
                        </button>
                      )}
                    </label>
                    {receiptDataUrl && (
                      <img
                        src={receiptDataUrl}
                        alt="Receipt preview"
                        className="mt-2 h-24 w-auto border border-neutral-700 object-contain"
                      />
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={submittingTx}
                    className="w-full bg-[#FAF9F6] text-[#111111] hover:bg-[#D4B483] py-2.5 text-xs font-semibold uppercase tracking-wide cursor-pointer disabled:opacity-60"
                  >
                    {submittingTx ? t('submittingTx') : t('submitTransactionBtn')}
                  </button>
                </form>
              ) : null}
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        {cart.length > 0 && step !== 'payment' && (
          <div className="p-4 sm:p-6 bg-white border-t border-[#E5E2DC] space-y-3">
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-neutral-600">
                <span>{t('subtotal')}</span>
                <span className="tabular-nums">{formatMoney(subtotalUsd)}</span>
              </div>
              {discountUsd > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>{t('promoDiscount')}</span>
                  <span className="tabular-nums">−{formatMoney(discountUsd)}</span>
                </div>
              )}
              <div className="flex justify-between text-neutral-600">
                <span>
                  {t('estimatedShipping')} ({country})
                </span>
                <span className="tabular-nums">{formatMoney(estimatedShippingUsd)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold text-[#111111] pt-2 border-t border-[#E5E2DC]">
                <span>{t('total')}</span>
                <span className="tabular-nums">{formatMoney(totalUsd)}</span>
              </div>
            </div>

            {step === 'cart' ? (
              <button
                type="button"
                onClick={() => {
                  void trackActivity({ type: 'checkout_start' });
                  setStep('checkout');
                }}
                className="w-full bg-[#2B3A9F] text-white py-3 text-xs font-semibold uppercase tracking-wide hover:bg-[#5B3CC4] transition-colors cursor-pointer"
              >
                {t('proceedToCheckout')}
              </button>
            ) : (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('cart')}
                  className="border border-[#E2E5F0] px-4 py-3 text-xs font-medium cursor-pointer"
                >
                  {t('back')}
                </button>
                <button
                  type="submit"
                  form="checkout-form"
                  disabled={submitting}
                  className="flex-1 bg-[#2B3A9F] text-white py-3 text-xs font-semibold uppercase tracking-wide hover:bg-[#5B3CC4] transition-colors cursor-pointer"
                >
                  {submitting ? t('creatingOrder') : t('placeOrder')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
