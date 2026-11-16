import React, { useState } from 'react';
import { PackageSearch, Send } from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext';
import { apiFetch } from '../lib/api';

export const TrackOrderPage: React.FC = () => {
  const { formatMoney, t, toast } = useMarketplace();
  const [orderId, setOrderId] = useState('');
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await apiFetch(
        `/api/orders/track/${encodeURIComponent(orderId.trim())}?email=${encodeURIComponent(
          email.trim()
        )}`
      );
      setResult(data);
    } catch (err: any) {
      setResult(null);
      toast(err.message || 'Order not found', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-8">
      <div className="bg-white border border-[#E2E5F0] p-6 sm:p-8 space-y-5">
        <div className="flex items-center gap-2 text-xs text-[#5B3CC4] uppercase tracking-wider font-semibold">
          <PackageSearch className="w-4 h-4" />
          <span>{t('trackSubtitle')}</span>
        </div>
        <h1 className="font-editorial text-3xl font-semibold text-[#111322]">
          {t('trackOrderTitle')}
        </h1>
        <form onSubmit={handleTrack} className="grid sm:grid-cols-3 gap-3 text-xs">
          <input
            required
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder={t('orderIdPlaceholder')}
            className="border border-[#E2E5F0] px-3 py-2.5 font-mono-tabular"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('checkoutEmailPlaceholder')}
            className="border border-[#E2E5F0] px-3 py-2.5"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-[#2B3A9F] hover:bg-[#5B3CC4] text-white px-4 py-2.5 font-semibold uppercase tracking-wide cursor-pointer"
          >
            {loading ? t('searching') : t('trackButton')}
          </button>
        </form>
      </div>

      {result && (
        <div className="bg-white border border-[#E2E5F0] p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap justify-between gap-2 pb-3 border-b border-[#E2E5F0] text-xs">
            <div className="min-w-0">
              <p className="font-mono-tabular font-semibold break-all">{result.order.id}</p>
              <p className="text-neutral-500">
                {result.order.shippingCity}, {result.order.shippingCountry}
              </p>
              {result.order.submittedTransactionId && (
                <p className="font-mono-tabular text-[#5B3CC4] mt-0.5 break-all">
                  {t('submittedTxIdLabel')}: {result.order.submittedTransactionId} (
                  {String(result.order.paymentProvider || '').toUpperCase()})
                </p>
              )}
            </div>
            <div className="sm:text-right">
              <p className="font-semibold">
                {result.order.overallStatus} · {result.order.paymentStatus}
              </p>
              <p className="tabular-nums text-neutral-600">
                {t('total')}: {formatMoney(result.order.totalUsd)}
              </p>
            </div>
          </div>

          {result.order.paymentRejectionReason && (
            <div className="bg-red-50 border border-red-200 p-3 text-xs text-red-900">
              {result.order.paymentRejectionReason}
            </div>
          )}
          {result.order.paymentInfoRequestMessage && (
            <div className="bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              Additional Payment Info Requested: {result.order.paymentInfoRequestMessage}
            </div>
          )}

          <div className="space-y-3">
            {result.suborders.map((sub: any) => (
              <div key={sub.id} className="border border-[#E2E5F0] bg-[#F8F9FC] p-4 text-xs space-y-2">
                <div className="flex flex-wrap justify-between gap-2 font-semibold">
                  <span>
                    {sub.supplierName} ({sub.supplierCountry})
                  </span>
                  <span className="text-[#2B3A9F]">{sub.status}</span>
                </div>
                {sub.trackingNumber && (
                  <p className="font-mono-tabular text-emerald-800">
                    {sub.carrierName}: {sub.trackingNumber}
                  </p>
                )}
                <div className="text-[11px] text-neutral-500 space-y-1 pt-1">
                  {sub.statusHistory.map((h: any, idx: number) => (
                    <div key={idx}>
                      {new Date(h.timestamp).toLocaleString()} — {h.status} ({h.note})
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const SupportAndLegalPage: React.FC = () => {
  const { userAccount, t, toast } = useMarketplace();
  const [policyTab, setPolicyTab] = useState<'contact' | 'returns' | 'shipping' | 'privacy' | 'terms' | 'faq'>('contact');
  const [form, setForm] = useState({
    email: userAccount?.email || '',
    category: 'order' as 'order' | 'supplier' | 'payment' | 'general',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    orderId: '',
    subject: '',
    message: '',
  });

  const [ticketError, setTicketError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTicketError('');
    const msg = form.message.trim();
    if (msg.length < 1 || msg.length > 600) {
      setTicketError('Please enter a valid support question (1–600 characters).');
      return;
    }
    try {
      await apiFetch('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({ ...form, message: msg }),
      });
      setForm({ ...form, subject: '', message: '', orderId: '' });
      toast('Support ticket created. Our team will respond shortly.', 'success');
    } catch (err: any) {
      const m = err.message || 'Could not create ticket';
      setTicketError(m);
      toast(m, 'error');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-3.5 sm:px-8 py-8 sm:py-12 space-y-6 sm:space-y-8">
      <div className="flex flex-wrap gap-2 border-b border-[#E2E5F0] pb-4">
        {[
          { id: 'contact', label: t('contactSupportTab') },
          { id: 'returns', label: t('returnPolicyTab') },
          { id: 'shipping', label: t('shippingPolicyTab') },
          { id: 'faq', label: t('faqTab') },
          { id: 'privacy', label: t('privacyPolicyTab') },
          { id: 'terms', label: t('termsTab') },
        ].map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setPolicyTab(tabItem.id as any)}
            className={`px-3.5 sm:px-4 min-h-[40px] py-2 text-xs font-medium border cursor-pointer ${
              policyTab === tabItem.id
                ? 'bg-[#2B3A9F] text-white border-[#2B3A9F]'
                : 'bg-white text-neutral-700 border-[#E2E5F0] hover:border-[#2B3A9F]'
            }`}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {policyTab === 'contact' && (
        <div className="bg-white border border-[#E2E5F0] p-4 sm:p-8 space-y-5">
          <h1 className="font-editorial text-3xl font-semibold text-[#111322]">{t('supportDeskTitle')}</h1>
          <p className="text-xs text-neutral-600">{t('supportDeskSub')}</p>
          <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-4 text-xs">
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Your Email"
              className="border border-[#E2E5F0] px-3 py-2.5"
            />
            <input
              value={form.orderId}
              onChange={(e) => setForm({ ...form, orderId: e.target.value })}
              placeholder="Order ID (optional)"
              className="border border-[#E2E5F0] px-3 py-2.5 font-mono-tabular"
            />
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as any })}
              className="border border-[#E2E5F0] px-3 py-2.5 bg-white"
            >
              <option value="order">Order & Delivery Complaint</option>
              <option value="supplier">Supplier Dispute</option>
              <option value="payment">Payment / Transaction ID Issue</option>
              <option value="general">General Inquiry</option>
            </select>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as any })}
              className="border border-[#E2E5F0] px-3 py-2.5 bg-white"
            >
              <option value="low">Low Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="high">High Priority</option>
              <option value="urgent">Urgent</option>
            </select>
            <input
              required
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Subject"
              className="border border-[#E2E5F0] px-3 py-2.5 sm:col-span-2"
            />
            <div className="sm:col-span-2 space-y-1">
              <textarea
                required
                rows={4}
                maxLength={600}
                value={form.message}
                onChange={(e) => {
                  setForm({ ...form, message: e.target.value });
                  if (ticketError) setTicketError('');
                }}
                placeholder="Describe your inquiry in detail (1–600 characters)..."
                className="w-full border border-[#E2E5F0] p-3"
              />
              <div className="flex justify-between text-[11px] text-neutral-500">
                <span>{ticketError ? <span className="text-red-700 font-medium">{ticketError}</span> : 'Dedicated Support Ticket Form'}</span>
                <span className="font-mono-tabular">{form.message.length}/600</span>
              </div>
            </div>
            <button
              type="submit"
              className="sm:col-span-2 inline-flex items-center justify-center gap-2 bg-[#2B3A9F] hover:bg-[#5B3CC4] text-white py-3 font-semibold uppercase tracking-wide cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" /> {t('submitTicket')}
            </button>
          </form>
        </div>
      )}

      {policyTab === 'returns' && (
        <div className="bg-white border border-[#E2E5F0] p-5 sm:p-8 space-y-4 text-sm text-neutral-700 leading-relaxed">
          <h2 className="font-editorial text-3xl font-semibold text-[#111322]">
            {t('returnPolicyTab')}
          </h2>
          <p>
            Eligible unworn garments, footwear, and accessories with original tags and packaging may be returned within 14 days of verified delivery. Customers submit claims with photographic evidence directly from the Customer Dashboard.
          </p>
          <p>
            Refunds are reviewed by both the fulfilling supplier and TANZANITE EXPRESS administration before reversal.
          </p>
        </div>
      )}

      {policyTab === 'shipping' && (
        <div className="bg-white border border-[#E2E5F0] p-5 sm:p-8 space-y-4 text-sm text-neutral-700 leading-relaxed">
          <h2 className="font-editorial text-3xl font-semibold text-[#111322]">
            {t('shippingPolicyTab')}
          </h2>
          <p>
            Orders containing items from multiple suppliers are split automatically into supplier-specific suborders once Admin verifies your Transaction ID and releases payment to each supplier.
          </p>
          <p>
            <strong>Tanzania Domestic Delivery:</strong> Dispatched locally in 1–3 business days with no import duties.
          </p>
          <p>
            <strong>International Shipments:</strong> Cross-border shipments may be subject to customs clearance, import tariffs, or local VAT determined by the destination country.
          </p>
        </div>
      )}

      {policyTab === 'faq' && (
        <div className="bg-white border border-[#E2E5F0] p-5 sm:p-8 space-y-4 text-sm text-neutral-700">
          <h2 className="font-editorial text-3xl font-semibold text-[#111322]">{t('faqTitle')}</h2>
          <div>
            <p className="font-semibold text-[#111322]">{t('faqSplitQ')}</p>
            <p className="mt-1">{t('faqSplitA')}</p>
          </div>
          <div>
            <p className="font-semibold text-[#111322]">{t('faqPayQ')}</p>
            <p className="mt-1">{t('faqPayA')}</p>
          </div>
        </div>
      )}

      {policyTab === 'privacy' && (
        <div className="bg-white border border-[#E2E5F0] p-5 sm:p-8 space-y-4 text-sm text-neutral-700 leading-relaxed">
          <h2 className="font-editorial text-3xl font-semibold text-[#111322]">Privacy Policy</h2>
          <p>
            Customer PII (email, phone, shipping street address) is strictly isolated. Independent suppliers only receive the delivery details required to ship their assigned suborder and never gain access to other suppliers’ customer records or payment tokens.
          </p>
          <p>
            TANZANITE EXPRESS records anonymized browsing, search, and bag activity solely to power your storefront recommendations and supplier/admin performance analytics. Registered customers can opt out of personalized recommendations and preference profiling at any time inside Customer Dashboard → Profile & Preferences.
          </p>
        </div>
      )}

      {policyTab === 'terms' && (
        <div className="bg-white border border-[#E2E5F0] p-5 sm:p-8 space-y-4 text-sm text-neutral-700 leading-relaxed">
          <h2 className="font-editorial text-3xl font-semibold text-[#111322]">Terms & Conditions</h2>
          <p>
            TANZANITE EXPRESS (“Fashion You Love, Delivered to You”) operates as a curated multi-vendor fashion marketplace. Suppliers remain responsible for product authenticity, stock accuracy, and timely fulfillment within configured SLA response deadlines.
          </p>
        </div>
      )}
    </div>
  );
};
