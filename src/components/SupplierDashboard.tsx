import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Download,
  Edit3,
  FileSpreadsheet,
  ImagePlus,
  Link2,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext';
import { apiFetch } from '../lib/api';
import {
  deleteUploadedProductImage,
  extractMediaId,
  uploadProductImageWithProgress,
} from '../lib/product-image-upload';
import {
  AiReportRecord,
  Product,
  ProductStatus,
  ProductVariant,
  RefundRequest,
  Review,
  SupplierAnalyticsMetrics,
  SupplierIntegrationStatus,
  SupplierPayout,
  SupplierProfile,
  SupplierSuborder,
} from '../types/marketplace';
import { SafeImage } from './SafeImage';

type SupplierTab =
  | 'overview'
  | 'products'
  | 'orders'
  | 'earnings'
  | 'refunds'
  | 'integrations'
  | 'profile';

type SubmissionMethod = 'NONE' | 'MANUAL' | 'CSV';
type ProductFilterStatus =
  | 'ALL'
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'CHANGES_REQUESTED';

interface SupplierWorkspaceData {
  supplier: SupplierProfile;
  products: Product[];
  suborders: SupplierSuborder[];
  payouts: SupplierPayout[];
  refunds: RefundRequest[];
  reviews: Review[];
  earnings: {
    grossSalesUsd: number;
    totalCommissionUsd: number;
    pendingEarningsUsd: number;
    availableEarningsUsd: number;
    paidEarningsUsd: number;
  };
  integrations: SupplierIntegrationStatus[];
}

interface UploadedImageItem {
  id: string;
  url: string;
  fileName: string;
  progress: number;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
}

interface CsvPreviewRowClient {
  rowNumber: number;
  sku: string;
  title: string;
  category: string;
  gender: 'MEN' | 'WOMEN' | 'UNISEX';
  brand: string;
  material?: string;
  weightKg?: number;
  wholesalePriceUsd: number;
  stock: number;
  sizes: string[];
  colors: string[];
  shippingFeeUsd: number;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  shippingOriginCountry: string;
  description: string;
  rawImageRefs: string[];
  matchedImages: { ref: string; url: string; source: 'uploaded' | 'url' }[];
  errors: string[];
}

const CSV_TEMPLATE_TEXT = [
  'sku,title,gender,category,brand,material,weightKg,wholesalePriceUsd,sizes,colors,stock,shippingFeeUsd,estimatedDaysMin,estimatedDaysMax,shippingOriginCountry,description,imageUrls',
  'MIK-LIN-01,Zanzibar Coastal Linen Shirt,MEN,Shirts,Coastal Atelier,100% Organic Linen,0.35,32,M|L|XL,Ivory|Sand,24,4,2,4,Tanzania,"Breathable coastal linen shirt tailored in Dar es Salaam for warm East African climates.",MIK-LIN-01_1.jpg|MIK-LIN-01_2.jpg',
  'MIK-DRS-02,Kigamboni Silk Wrap Dress,WOMEN,Dresses,MIK Atelier,Mulberry Silk Blend,0.42,48,S|M|L,Terracotta|Olive,15,5,2,5,Tanzania,"Hand-finished silk wrap dress with adjustable waist tie and lined bodice.",/src/assets/images/cat_womens_atelier_1794751435891.jpg',
].join('\n');

const ALL_DESTINATIONS = ['Tanzania', 'Kenya', 'Uganda', 'United Kingdom', 'United States', 'Europe', 'International'];
const CATEGORY_SUGGESTIONS = [
  'Shirts',
  'T-shirts',
  'Dresses',
  'Tops',
  'Jeans',
  'Trousers',
  'Skirts',
  'Sneakers',
  'Formal shoes',
  'Shoes',
  'Jackets',
  'Hoodies',
  'Handbags',
  'Watches & Accessories',
  'Accessories',
];

function getEffectiveSupplierStatus(p: Product): Exclude<ProductFilterStatus, 'ALL'> {
  if (p.status === 'PUBLISHED' || (p.status === 'APPROVED' && p.isPublished !== false)) {
    return 'PUBLISHED';
  }
  if (p.status === 'APPROVED') return 'APPROVED';
  if (p.status === 'DRAFT') return 'DRAFT';
  if (p.status === 'REJECTED') return 'REJECTED';
  if (p.status === 'CHANGES_REQUESTED') return 'CHANGES_REQUESTED';
  return 'PENDING_APPROVAL';
}

export const SupplierDashboard: React.FC = () => {
  const {
    firebaseUser,
    authReady,
    userAccount,
    mySupplier,
    unreadNotificationCount,
    setActivePage,
    openAuthModal,
    signInWithGoogle,
    refreshMe,
    refreshBootstrap,
    pendingTarget,
    clearPendingTarget,
    formatMoney,
    t,
    toast,
  } = useMarketplace();

  const [tab, setTab] = useState<SupplierTab>('overview');
  const [workspace, setWorkspace] = useState<SupplierWorkspaceData | null>(null);
  const [loading, setLoading] = useState(false);

  // Supplier Order Center filters, search, pagination & history expanders
  type SupplierOrderFilter =
    | 'ALL'
    | 'AWAITING_ACTION'
    | 'PROCESSING'
    | 'SHIPPED'
    | 'COMPLETED'
    | 'CANCELLED_REFUNDED';
  const [orderFilter, setOrderFilter] = useState<SupplierOrderFilter>('ALL');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderPage, setOrderPage] = useState(1);
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});

  // Supplier BI & AI Reports
  const [biRange, setBiRange] = useState<'daily' | 'weekly' | 'monthly' | 'all' | 'custom'>('monthly');
  const [biFrom, setBiFrom] = useState('');
  const [biTo, setBiTo] = useState('');
  const [biMetrics, setBiMetrics] = useState<SupplierAnalyticsMetrics | null>(null);
  const [biReports, setBiReports] = useState<AiReportRecord[]>([]);
  const [biGeminiConfigured, setBiGeminiConfigured] = useState(false);
  const [biLoading, setBiLoading] = useState(false);
  const [biGenerating, setBiGenerating] = useState(false);

  // Onboarding form
  const [reg, setReg] = useState({
    businessName: '',
    ownerFullName: userAccount?.displayName || '',
    email: userAccount?.email || '',
    phone: '',
    country: 'Tanzania',
    businessAddress: '',
    category: 'Apparel & Tailoring',
    description: '',
    registrationNumber: '',
    preferredPayoutMethod: 'Mobile Money (M-Pesa / Tigo Pesa / Airtel) / NMB Bank',
    payoutAccountMasked: '',
    verificationDocRef: '',
    shippingOrigin: 'Dar es Salaam, Tanzania',
  });

  // Product Submission Method & My Products filter
  const [submissionMethod, setSubmissionMethod] = useState<SubmissionMethod>('NONE');
  const [productStatusTab, setProductStatusTab] = useState<ProductFilterStatus>('ALL');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [submittingProduct, setSubmittingProduct] = useState(false);

  // Manual Product Form State
  const [manualForm, setManualForm] = useState({
    title: '',
    brand: '',
    gender: 'UNISEX' as 'MEN' | 'WOMEN' | 'UNISEX',
    category: 'Shirts',
    material: '',
    weightKg: '',
    description: '',
    wholesalePriceUsd: '35',
    totalQuantity: '15',
    sizesText: 'S, M, L',
    colorsText: 'Black, Ivory',
    baseSku: `MIK-${Date.now().toString().slice(-4)}`,
    shippingOriginCountry: 'Tanzania',
    shippingFeeUsd: '5',
    estimatedDaysMin: '2',
    estimatedDaysMax: '5',
    shippingNotes: '',
    returnPolicySummary: '14-day unworn return with original packaging.',
    shippingDestinations: ['Tanzania', 'Kenya', 'United Kingdom', 'United States', 'International'],
  });
  const [variantRows, setVariantRows] = useState<ProductVariant[]>([
    { sku: `MIK-${Date.now().toString().slice(-4)}-M-BLK`, size: 'M', color: 'Black', stock: 15 },
  ]);
  const [uploadedImages, setUploadedImages] = useState<UploadedImageItem[]>([]);
  const replaceIndexRef = useRef<number | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  // Bulk CSV State
  const [csvText, setCsvText] = useState('');
  const [csvLocalImages, setCsvLocalImages] = useState<UploadedImageItem[]>([]);
  const [csvPreviewRows, setCsvPreviewRows] = useState<CsvPreviewRowClient[] | null>(null);
  const [csvCounts, setCsvCounts] = useState<{ validCount: number; errorCount: number } | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  // Tracking form state per suborder
  const [trackingInputs, setTrackingInputs] = useState<
    Record<string, { carrierName: string; trackingNumber: string; trackingUrl: string }>
  >({});

  // Payout request
  const [payoutAmount, setPayoutAmount] = useState('');

  const loadWorkspace = async () => {
    if (!firebaseUser || !mySupplier) return;
    setLoading(true);
    try {
      const data = await apiFetch<SupplierWorkspaceData>('/api/supplier/workspace');
      setWorkspace(data);
    } catch (err: any) {
      toast(err.message || 'Unable to load supplier workspace', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadSupplierAnalytics = async (
    rangeVal: 'daily' | 'weekly' | 'monthly' | 'all' | 'custom' = biRange,
    fromVal: string = biFrom,
    toVal: string = biTo
  ) => {
    if (!firebaseUser || !mySupplier) return;
    setBiLoading(true);
    try {
      const params = new URLSearchParams({ range: rangeVal });
      if (rangeVal === 'custom' && fromVal && toVal) {
        params.set('from', fromVal);
        params.set('to', toVal);
      }
      const res = await apiFetch<{
        metrics: SupplierAnalyticsMetrics;
        reports: AiReportRecord[];
        geminiConfigured: boolean;
      }>(`/api/supplier/analytics?${params.toString()}`);
      setBiMetrics(res.metrics);
      setBiReports(res.reports || []);
      setBiGeminiConfigured(Boolean(res.geminiConfigured));
    } catch {
      // Analytics panel shows graceful fallback if unavailable
    } finally {
      setBiLoading(false);
    }
  };

  const handleGenerateSupplierAiReport = async () => {
    if (!mySupplier) return;
    setBiGenerating(true);
    try {
      const res = await apiFetch<{ report: AiReportRecord; metrics: SupplierAnalyticsMetrics }>(
        '/api/supplier/ai-report',
        {
          method: 'POST',
          body: JSON.stringify({
            range: biRange,
            from: biRange === 'custom' ? biFrom : undefined,
            to: biRange === 'custom' ? biTo : undefined,
          }),
        }
      );
      setBiMetrics(res.metrics);
      setBiReports((prev) => [res.report, ...prev.filter((r) => r.id !== res.report.id)]);
      toast(
        res.report.aiGenerated
          ? 'AI performance report generated.'
          : 'Computed analytics summary generated.',
        'success'
      );
    } catch (err: any) {
      toast(err.message || 'Unable to generate report', 'error');
    } finally {
      setBiGenerating(false);
    }
  };

  useEffect(() => {
    if (mySupplier) {
      loadWorkspace();
      loadSupplierAnalytics();
      setManualForm((prev) => ({
        ...prev,
        shippingOriginCountry: prev.shippingOriginCountry || mySupplier.country,
      }));
    }
  }, [mySupplier?.id, mySupplier?.status]);

  useEffect(() => {
    if (pendingTarget && pendingTarget.page === 'supplier' && pendingTarget.tab) {
      setTab(pendingTarget.tab as SupplierTab);
      clearPendingTarget();
    }
  }, [pendingTarget, clearPendingTarget]);

  const statusCounts = useMemo(() => {
    const counts: Record<ProductFilterStatus, number> = {
      ALL: 0,
      DRAFT: 0,
      PENDING_APPROVAL: 0,
      APPROVED: 0,
      PUBLISHED: 0,
      REJECTED: 0,
      CHANGES_REQUESTED: 0,
    };
    for (const p of workspace?.products || []) {
      counts.ALL++;
      const eff = getEffectiveSupplierStatus(p);
      counts[eff]++;
    }
    return counts;
  }, [workspace?.products]);

  const filteredProducts = useMemo(() => {
    const list = workspace?.products || [];
    if (productStatusTab === 'ALL') return list;
    return list.filter((p) => getEffectiveSupplierStatus(p) === productStatusTab);
  }, [workspace?.products, productStatusTab]);

  if (!authReady) {
    return (
      <div className="max-w-xl mx-auto my-16 bg-white border border-[#E2E5F0] p-8 text-center text-xs text-neutral-500">
        Restoring supplier session...
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="max-w-xl mx-auto my-16 bg-white border border-[#E2E5F0] p-8 text-center">
        <p className="text-[11px] uppercase tracking-[0.14em] text-[#5B3CC4] font-semibold mb-2">
          {t('supplierFreeBadge')}
        </p>
        <h2 className="font-editorial text-3xl font-semibold text-[#111322]">
          {t('supplierPortalTitle')}
        </h2>
        <p className="text-sm text-neutral-600 mt-3">{t('supplierSignInDesc')}</p>
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

  const handleRegisterSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/suppliers/register', {
        method: 'POST',
        body: JSON.stringify(reg),
      });
      await refreshMe();
      toast('Supplier application submitted for review.', 'success');
    } catch (err: any) {
      toast(err.message || 'Registration failed', 'error');
    }
  };

  if (!mySupplier) {
    return (
      <div className="max-w-3xl mx-auto my-10 px-4">
        <div className="bg-white border border-[#E5E2DC] p-8 space-y-6">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#8B6F47]">
              {t('supplierFreeBadge')}
            </p>
            <h2 className="font-editorial text-3xl font-semibold text-[#111111] mt-1">
              {t('applyToSellTitle')}
            </h2>
            <p className="text-xs text-neutral-600 mt-2">{t('supplierWorkflowSub')}</p>
          </div>

          <form onSubmit={handleRegisterSupplier} className="grid sm:grid-cols-2 gap-4 text-xs">
            <input
              required
              placeholder="Business / Brand Name"
              value={reg.businessName}
              onChange={(e) => setReg({ ...reg, businessName: e.target.value })}
              className="border border-[#E5E2DC] px-3 py-2.5"
            />
            <input
              required
              placeholder="Owner Full Name"
              value={reg.ownerFullName}
              onChange={(e) => setReg({ ...reg, ownerFullName: e.target.value })}
              className="border border-[#E5E2DC] px-3 py-2.5"
            />
            <input
              required
              type="email"
              placeholder="Business Email"
              value={reg.email}
              onChange={(e) => setReg({ ...reg, email: e.target.value })}
              className="border border-[#E5E2DC] px-3 py-2.5"
            />
            <input
              required
              placeholder="Phone / WhatsApp (+255...)"
              value={reg.phone}
              onChange={(e) => setReg({ ...reg, phone: e.target.value })}
              className="border border-[#E5E2DC] px-3 py-2.5"
            />
            <input
              required
              placeholder="Country (e.g., Tanzania, UK, China)"
              value={reg.country}
              onChange={(e) => setReg({ ...reg, country: e.target.value })}
              className="border border-[#E5E2DC] px-3 py-2.5"
            />
            <input
              required
              placeholder="Shipping Origin City, Country"
              value={reg.shippingOrigin}
              onChange={(e) => setReg({ ...reg, shippingOrigin: e.target.value })}
              className="border border-[#E5E2DC] px-3 py-2.5"
            />
            <input
              required
              placeholder="Business Address"
              value={reg.businessAddress}
              onChange={(e) => setReg({ ...reg, businessAddress: e.target.value })}
              className="border border-[#E5E2DC] px-3 py-2.5 sm:col-span-2"
            />
            <input
              required
              placeholder="Primary Category (e.g., Menswear, Dresses, Footwear)"
              value={reg.category}
              onChange={(e) => setReg({ ...reg, category: e.target.value })}
              className="border border-[#E5E2DC] px-3 py-2.5"
            />
            <input
              placeholder="Business Reg / TIN / VAT Number"
              value={reg.registrationNumber}
              onChange={(e) => setReg({ ...reg, registrationNumber: e.target.value })}
              className="border border-[#E5E2DC] px-3 py-2.5"
            />
            <input
              required
              placeholder="Preferred Payout Method (Mobile Money / Bank / Wire)"
              value={reg.preferredPayoutMethod}
              onChange={(e) => setReg({ ...reg, preferredPayoutMethod: e.target.value })}
              className="border border-[#E5E2DC] px-3 py-2.5"
            />
            <input
              placeholder="Verification Document Reference / Link"
              value={reg.verificationDocRef}
              onChange={(e) => setReg({ ...reg, verificationDocRef: e.target.value })}
              className="border border-[#E5E2DC] px-3 py-2.5"
            />
            <textarea
              required
              rows={3}
              placeholder="Describe your fashion lines, sourcing capacity, and fulfillment turnaround..."
              value={reg.description}
              onChange={(e) => setReg({ ...reg, description: e.target.value })}
              className="border border-[#E5E2DC] p-3 sm:col-span-2"
            />
            <button
              type="submit"
              className="sm:col-span-2 bg-[#111111] text-white py-3 font-semibold uppercase tracking-wide cursor-pointer"
            >
              {t('submitSupplierApp')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- Image & Variant Helpers for Manual Product Form ---
  const resetManualForm = () => {
    const code = `MIK-${Date.now().toString().slice(-4)}`;
    setEditingProductId(null);
    setManualForm({
      title: '',
      brand: '',
      gender: 'UNISEX',
      category: 'Shirts',
      material: '',
      weightKg: '',
      description: '',
      wholesalePriceUsd: '35',
      totalQuantity: '15',
      sizesText: 'S, M, L',
      colorsText: 'Black, Ivory',
      baseSku: code,
      shippingOriginCountry: mySupplier.country || 'Tanzania',
      shippingFeeUsd: '5',
      estimatedDaysMin: '2',
      estimatedDaysMax: '5',
      shippingNotes: '',
      returnPolicySummary: '14-day unworn return with original packaging.',
      shippingDestinations: ['Tanzania', 'Kenya', 'United Kingdom', 'United States', 'International'],
    });
    setVariantRows([{ sku: `${code}-M-BLK`, size: 'M', color: 'Black', stock: 15 }]);
    setUploadedImages([]);
  };

  const openManualAdd = () => {
    resetManualForm();
    setSubmissionMethod('MANUAL');
  };

  const openEditProduct = (p: Product) => {
    setEditingProductId(p.id);
    const sizes = Array.from(new Set(p.variants.map((v) => v.size)));
    const colors = Array.from(new Set(p.variants.map((v) => v.color)));
    setManualForm({
      title: p.title,
      brand: p.brand || '',
      gender: p.gender,
      category: p.category,
      material: p.material || '',
      weightKg: p.weightKg !== undefined ? String(p.weightKg) : '',
      description: p.description,
      wholesalePriceUsd: String(p.wholesalePriceUsd),
      totalQuantity: String(p.totalStock),
      sizesText: sizes.join(', '),
      colorsText: colors.join(', '),
      baseSku: p.variants[0]?.sku.split('-')[0] || 'MIK',
      shippingOriginCountry: p.shippingOriginCountry || mySupplier.country,
      shippingFeeUsd: String(p.shippingFeeUsd),
      estimatedDaysMin: String(p.estimatedDaysMin),
      estimatedDaysMax: String(p.estimatedDaysMax),
      shippingNotes: p.shippingNotes || '',
      returnPolicySummary: p.returnPolicySummary,
      shippingDestinations: p.shippingDestinations || ['Tanzania', 'International'],
    });
    setVariantRows(p.variants.length > 0 ? p.variants : [{ sku: `SKU-${p.id.slice(-4)}`, size: 'One Size', color: 'Black', stock: p.totalStock }]);
    setUploadedImages(
      (p.images || []).map((url, idx) => ({
        id: extractMediaId(url) || `existing_${idx}_${Date.now()}`,
        url,
        fileName: p.imageMetadata?.find((m) => m.url === url)?.fileName || `image-${idx + 1}.jpg`,
        progress: 100,
        status: 'ready' as const,
      }))
    );
    setSubmissionMethod('MANUAL');
  };

  const generateVariantsFromInputs = () => {
    const sizes = manualForm.sizesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const colors = manualForm.colorsText
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    const sList = sizes.length ? sizes : ['One Size'];
    const cList = colors.length ? colors : ['Black'];
    const totalQty = Math.max(0, Math.floor(Number(manualForm.totalQuantity) || 0));
    const count = sList.length * cList.length;
    const baseEach = Math.floor(totalQty / count);
    let rem = totalQty - baseEach * count;
    const prefix = (manualForm.baseSku || 'MIK').trim().toUpperCase();
    const generated: ProductVariant[] = [];
    for (const sz of sList) {
      for (const col of cList) {
        const extra = rem > 0 ? 1 : 0;
        if (rem > 0) rem--;
        generated.push({
          sku: `${prefix}-${sz.replace(/\s+/g, '')}-${col.replace(/\s+/g, '').slice(0, 4).toUpperCase()}`,
          size: sz,
          color: col,
          stock: baseEach + extra,
        });
      }
    }
    setVariantRows(generated);
  };

  const handleUploadManualImages = async (files: FileList | null, replaceAtIndex?: number) => {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);
    const currentReadyOrUploading = uploadedImages.filter((i) => i.status !== 'error').length;

    if (replaceAtIndex === undefined && currentReadyOrUploading + fileArr.length > 8) {
      toast('Maximum of 8 product images allowed per listing.', 'error');
      return;
    }

    for (const file of fileArr) {
      const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const placeholder: UploadedImageItem = {
        id: tempId,
        url: '',
        fileName: file.name,
        progress: 5,
        status: 'uploading',
      };

      setUploadedImages((prev) => {
        if (typeof replaceAtIndex === 'number' && replaceAtIndex >= 0 && replaceAtIndex < prev.length) {
          const next = [...prev];
          next[replaceAtIndex] = placeholder;
          return next;
        }
        return [...prev, placeholder];
      });

      try {
        const meta = await uploadProductImageWithProgress(
          file,
          (pct) => {
            setUploadedImages((prev) =>
              prev.map((item) => (item.id === tempId ? { ...item, progress: pct } : item))
            );
          },
          editingProductId || undefined
        );
        setUploadedImages((prev) =>
          prev.map((item) =>
            item.id === tempId
              ? {
                  id: meta.id,
                  url: meta.url,
                  fileName: meta.fileName,
                  progress: 100,
                  status: 'ready',
                }
              : item
          )
        );
      } catch (err: any) {
        const msg = err.message || `Failed to upload ${file.name}`;
        toast(msg, 'error');
        setUploadedImages((prev) =>
          prev.map((item) =>
            item.id === tempId ? { ...item, status: 'error', error: msg, progress: 0 } : item
          )
        );
      }
    }
  };

  const handleRemoveImage = async (index: number) => {
    const target = uploadedImages[index];
    if (!target) return;
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
    // Clean up newly uploaded unattached image file immediately if not yet saved to an existing product
    const mediaId = extractMediaId(target.url);
    if (mediaId && !editingProductId) {
      try {
        await deleteUploadedProductImage(mediaId);
      } catch {
        // Ignore if already attached
      }
    }
  };

  const persistImageReorderIfSaved = async (nextList: UploadedImageItem[]) => {
    if (!editingProductId) return;
    if (nextList.length === 0 || nextList.some((img) => img.status !== 'ready' || !img.url)) return;
    try {
      await apiFetch(`/api/supplier/products/${editingProductId}/reorder-images`, {
        method: 'PATCH',
        body: JSON.stringify({ images: nextList.map((i) => i.url) }),
      });
      toast('Image order saved.', 'success');
    } catch {
      // Final save will also apply the new image order cleanly
    }
  };

  const handleSetPrimaryImage = (index: number) => {
    if (index <= 0 || index >= uploadedImages.length) return;
    const next = [...uploadedImages];
    const [chosen] = next.splice(index, 1);
    const reordered = [chosen, ...next];
    setUploadedImages(reordered);
    void persistImageReorderIfSaved(reordered);
  };

  const handleMoveImage = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= uploadedImages.length) return;
    const next = [...uploadedImages];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setUploadedImages(next);
    void persistImageReorderIfSaved(next);
  };

  const handleSubmitManualProduct = async (submitMode: 'DRAFT' | 'PENDING_APPROVAL') => {
    if (uploadedImages.some((i) => i.status === 'uploading')) {
      toast('Please wait for all image uploads to complete.', 'info');
      return;
    }
    const readyUrls = uploadedImages.filter((i) => i.status === 'ready' && i.url).map((i) => i.url);
    if (submitMode === 'PENDING_APPROVAL' && readyUrls.length < 1) {
      toast('Please upload at least one product image before submitting for Admin approval.', 'error');
      return;
    }
    if (!manualForm.title.trim() || manualForm.description.trim().length < 10) {
      toast('Enter a product name and description (minimum 10 characters).', 'error');
      return;
    }
    const wholesaleNum = Number(manualForm.wholesalePriceUsd);
    if (!Number.isFinite(wholesaleNum) || wholesaleNum <= 0) {
      toast('Enter a valid positive Supplier Price (USD).', 'error');
      return;
    }

    setSubmittingProduct(true);
    try {
      const payload = {
        title: manualForm.title.trim(),
        brand: manualForm.brand.trim() || mySupplier.businessName,
        material: manualForm.material.trim() || undefined,
        weightKg: manualForm.weightKg.trim() ? Number(manualForm.weightKg) : undefined,
        gender: manualForm.gender,
        category: manualForm.category.trim(),
        description: manualForm.description.trim(),
        images: readyUrls,
        wholesalePriceUsd: wholesaleNum,
        shippingOriginCountry: manualForm.shippingOriginCountry.trim() || mySupplier.country,
        shippingDestinations: manualForm.shippingDestinations.length
          ? manualForm.shippingDestinations
          : ['Tanzania', 'International'],
        estimatedDaysMin: Math.max(1, Number(manualForm.estimatedDaysMin) || 2),
        estimatedDaysMax: Math.max(1, Number(manualForm.estimatedDaysMax) || 5),
        shippingFeeUsd: Math.max(0, Number(manualForm.shippingFeeUsd) || 0),
        shippingNotes: manualForm.shippingNotes.trim() || undefined,
        returnPolicySummary: manualForm.returnPolicySummary.trim(),
        variants: variantRows,
      };

      if (editingProductId) {
        await apiFetch(`/api/supplier/products/${editingProductId}`, {
          method: 'PUT',
          body: JSON.stringify({
            ...payload,
            action: submitMode === 'DRAFT' ? 'SAVE_DRAFT' : 'SUBMIT_FOR_APPROVAL',
          }),
        });
        toast(
          submitMode === 'DRAFT'
            ? 'Product draft updated.'
            : 'Product updated & submitted for Admin approval.',
          'success'
        );
      } else {
        await apiFetch('/api/supplier/products', {
          method: 'POST',
          body: JSON.stringify({ ...payload, submitMode }),
        });
        toast(
          submitMode === 'DRAFT'
            ? 'Product saved as Draft.'
            : 'Product submitted for Admin price markup & approval.',
          'success'
        );
      }

      setSubmissionMethod('NONE');
      resetManualForm();
      await loadWorkspace();
      await refreshBootstrap();
    } catch (err: any) {
      toast(err.message || 'Product save failed', 'error');
    } finally {
      setSubmittingProduct(false);
    }
  };

  // --- Bulk CSV Upload Handlers ---
  const handleDownloadCsvTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE_TEXT], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tanzanite-express-product-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadCsvLocalImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const tempId = `csv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setCsvLocalImages((prev) => [
        ...prev,
        { id: tempId, url: '', fileName: file.name, progress: 10, status: 'uploading' },
      ]);
      try {
        const meta = await uploadProductImageWithProgress(file, (pct) => {
          setCsvLocalImages((prev) =>
            prev.map((item) => (item.id === tempId ? { ...item, progress: pct } : item))
          );
        });
        setCsvLocalImages((prev) =>
          prev.map((item) =>
            item.id === tempId
              ? { id: meta.id, url: meta.url, fileName: file.name, progress: 100, status: 'ready' }
              : item
          )
        );
      } catch (err: any) {
        toast(err.message || `Failed to upload ${file.name}`, 'error');
        setCsvLocalImages((prev) =>
          prev.map((item) =>
            item.id === tempId ? { ...item, status: 'error', error: err.message, progress: 0 } : item
          )
        );
      }
    }
  };

  const handleCsvFileUpload = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setCsvPreviewRows(null);
    setCsvCounts(null);
  };

  const handlePreviewCsvImport = async () => {
    if (!csvText.trim()) {
      toast('Upload a CSV file or paste CSV rows first.', 'error');
      return;
    }
    if (csvLocalImages.some((i) => i.status === 'uploading')) {
      toast('Wait for local image uploads to complete before previewing.', 'info');
      return;
    }
    setCsvBusy(true);
    try {
      const localImagesPayload = csvLocalImages
        .filter((i) => i.status === 'ready' && i.url)
        .map((i) => ({ fileName: i.fileName, url: i.url }));
      const res = await apiFetch<{
        rows: CsvPreviewRowClient[];
        validCount: number;
        errorCount: number;
      }>('/api/supplier/products/csv-preview', {
        method: 'POST',
        body: JSON.stringify({ csvText, localImages: localImagesPayload }),
      });
      setCsvPreviewRows(res.rows);
      setCsvCounts({ validCount: res.validCount, errorCount: res.errorCount });
    } catch (err: any) {
      toast(err.message || 'CSV validation preview failed', 'error');
    } finally {
      setCsvBusy(false);
    }
  };

  const handleConfirmCsvImport = async () => {
    if (!csvText.trim()) return;
    setCsvBusy(true);
    try {
      const localImagesPayload = csvLocalImages
        .filter((i) => i.status === 'ready' && i.url)
        .map((i) => ({ fileName: i.fileName, url: i.url }));
      const res = await apiFetch<{ importedCount: number }>('/api/supplier/products/csv-import', {
        method: 'POST',
        body: JSON.stringify({ csvText, localImages: localImagesPayload }),
      });
      setSubmissionMethod('NONE');
      setCsvText('');
      setCsvLocalImages([]);
      setCsvPreviewRows(null);
      setCsvCounts(null);
      await loadWorkspace();
      await refreshBootstrap();
      toast(`Imported ${res.importedCount} product(s) for Admin approval.`, 'success');
    } catch (err: any) {
      toast(err.message || 'CSV import blocked due to missing images or validation errors', 'error');
    } finally {
      setCsvBusy(false);
    }
  };

  const handleQuickResubmit = async (productId: string) => {
    try {
      await apiFetch(`/api/supplier/products/${productId}`, {
        method: 'PUT',
        body: JSON.stringify({ action: 'SUBMIT_FOR_APPROVAL' }),
      });
      await loadWorkspace();
      toast('Product resubmitted for Admin approval.', 'success');
    } catch (err: any) {
      toast(err.message || 'Unable to resubmit product', 'error');
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    try {
      await apiFetch(`/api/supplier/products/${productId}`, {
        method: 'DELETE',
      });
      await loadWorkspace();
      await refreshBootstrap();
      toast('Product and unreferenced images removed.', 'success');
    } catch (err: any) {
      toast(err.message || 'Unable to delete product', 'error');
    }
  };

  const handleSuborderUpdate = async (suborderId: string, nextStatus: string) => {
    const trk = trackingInputs[suborderId];
    try {
      await apiFetch(`/api/supplier/suborders/${suborderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: nextStatus,
          carrierName: trk?.carrierName,
          trackingNumber: trk?.trackingNumber,
          trackingUrl: trk?.trackingUrl,
        }),
      });
      await loadWorkspace();
      toast(`Suborder updated to ${nextStatus}.`, 'success');
    } catch (err: any) {
      toast(err.message || 'Fulfillment update failed', 'error');
    }
  };

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/supplier/payouts', {
        method: 'POST',
        body: JSON.stringify({ amountUsd: Number(payoutAmount), currency: 'USD' }),
      });
      setPayoutAmount('');
      await loadWorkspace();
      toast('Payout request submitted for Admin review.', 'success');
    } catch (err: any) {
      toast(err.message || 'Payout request failed', 'error');
    }
  };

  const nav: { id: SupplierTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: t('salesOverviewTab'), icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'products', label: t('productsCsvTab'), icon: <Boxes className="w-4 h-4" /> },
    { id: 'orders', label: t('subordersShippingTab'), icon: <PackageCheck className="w-4 h-4" /> },
    { id: 'earnings', label: t('earningsPayoutsTab'), icon: <DollarSign className="w-4 h-4" /> },
    { id: 'refunds', label: t('returnsClaimsTab'), icon: <RotateCcw className="w-4 h-4" /> },
    { id: 'integrations', label: t('externalAdaptersTab'), icon: <Link2 className="w-4 h-4" /> },
    { id: 'profile', label: t('storeProfileTab'), icon: <Settings className="w-4 h-4" /> },
  ];

  const statusBadgeStyle = (st: Exclude<ProductFilterStatus, 'ALL'>) => {
    if (st === 'PUBLISHED') return 'bg-emerald-50 border-emerald-300 text-emerald-900';
    if (st === 'APPROVED') return 'bg-sky-50 border-sky-300 text-sky-900';
    if (st === 'REJECTED') return 'bg-red-50 border-red-300 text-red-900';
    if (st === 'CHANGES_REQUESTED') return 'bg-amber-50 border-amber-300 text-amber-950';
    if (st === 'DRAFT') return 'bg-neutral-100 border-neutral-300 text-neutral-800';
    return 'bg-[#F4F2EE] border-[#E5E2DC] text-[#8B6F47]';
  };

  return (
    <div className="max-w-[1440px] mx-auto px-3.5 sm:px-8 py-6 sm:py-8 grid lg:grid-cols-12 gap-6 lg:gap-8">
      <aside className="lg:col-span-3 min-w-0 bg-white border border-[#E2E5F0] p-4 h-fit">
        <div className="pb-4 mb-3 border-b border-[#E2E5F0]">
          <p className="text-xs text-[#5B3CC4] uppercase tracking-wider font-semibold">
            {t('supplierPortal')}
          </p>
          <p className="text-sm font-semibold text-[#111322] truncate">{mySupplier.businessName}</p>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            {mySupplier.status} · Free Plan
          </p>
        </div>
        <nav className="flex max-w-full overflow-x-auto gap-1.5 pb-1 lg:pb-0 lg:block lg:space-y-1">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`shrink-0 lg:w-full flex items-center gap-2.5 px-3 py-2.5 min-h-[44px] text-xs font-medium text-left cursor-pointer transition-colors ${
                tab === item.id
                  ? 'bg-[#2B3A9F] text-white'
                  : 'text-neutral-700 hover:bg-[#EEF2FF]'
              }`}
            >
              {item.icon}
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="lg:col-span-9 min-w-0 space-y-6">
        {mySupplier.status !== 'APPROVED' && (
          <div className="bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900">
            <strong>{mySupplier.status}</strong> — {t('supplierApprovalPending')}
          </div>
        )}

        {loading || !workspace ? (
          <div className="bg-white border border-[#E2E5F0] p-8 text-xs text-neutral-500">
            Loading supplier workspace...
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <div className="bg-white border border-[#E2E5F0] p-4 min-w-0">
                    <p className="text-[11px] uppercase text-neutral-500">Gross Sales</p>
                    <p className="text-lg sm:text-xl font-semibold text-[#111322] tabular-nums mt-1 break-words">
                      {formatMoney(workspace.earnings.grossSalesUsd)}
                    </p>
                  </div>
                  <div className="bg-white border border-[#E2E5F0] p-4 min-w-0">
                    <p className="text-[11px] uppercase text-neutral-500">Pending Earnings</p>
                    <p className="text-lg sm:text-xl font-semibold text-[#111322] tabular-nums mt-1 break-words">
                      {formatMoney(workspace.earnings.pendingEarningsUsd)}
                    </p>
                  </div>
                  <div className="bg-white border border-[#E2E5F0] p-4 min-w-0">
                    <p className="text-[11px] uppercase text-neutral-500">Available for Payout</p>
                    <p className="text-lg sm:text-xl font-semibold text-emerald-700 tabular-nums mt-1 break-words">
                      {formatMoney(workspace.earnings.availableEarningsUsd)}
                    </p>
                  </div>
                  <div className="bg-white border border-[#E2E5F0] p-4 min-w-0">
                    <p className="text-[11px] uppercase text-neutral-500">Published Products</p>
                    <p className="text-lg sm:text-xl font-semibold text-[#111322] tabular-nums mt-1">
                      {statusCounts.PUBLISHED} / {workspace.products.length}
                    </p>
                  </div>
                </div>

                {/* Supplier AI Business Intelligence & Analytics */}
                <div className="bg-white border border-[#E2E5F0] p-5 sm:p-6 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E5F0] pb-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-[#5B3CC4] font-semibold flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        {t('biReportsTab')}
                      </p>
                      <h3 className="font-editorial text-2xl font-semibold text-[#111322]">
                        Store Performance & Analytics
                      </h3>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {(
                        [
                          { id: 'daily', label: '24h' },
                          { id: 'weekly', label: '7d' },
                          { id: 'monthly', label: '30d' },
                          { id: 'all', label: 'All' },
                          { id: 'custom', label: 'Custom' },
                        ] as const
                      ).map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setBiRange(r.id);
                            if (r.id !== 'custom') {
                              void loadSupplierAnalytics(r.id);
                            }
                          }}
                          className={`px-3 py-1.5 border cursor-pointer font-medium ${
                            biRange === r.id
                              ? 'bg-[#2B3A9F] text-white border-[#2B3A9F]'
                              : 'bg-[#F8F9FC] text-neutral-700 border-[#E2E5F0] hover:border-[#2B3A9F]'
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}

                      <button
                        type="button"
                        disabled={biGenerating}
                        onClick={handleGenerateSupplierAiReport}
                        className="inline-flex items-center gap-1.5 bg-[#5B3CC4] hover:bg-[#492EA6] text-white px-4 py-1.5 font-semibold cursor-pointer disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {biGenerating ? 'Generating...' : t('generateAiReport')}
                      </button>
                    </div>
                  </div>

                  {biRange === 'custom' && (
                    <div className="flex flex-wrap items-center gap-2 text-xs bg-[#F8F9FC] border border-[#E2E5F0] p-3">
                      <input
                        type="date"
                        value={biFrom}
                        onChange={(e) => setBiFrom(e.target.value)}
                        className="border border-[#E2E5F0] px-2.5 py-1.5 bg-white"
                      />
                      <span>to</span>
                      <input
                        type="date"
                        value={biTo}
                        onChange={(e) => setBiTo(e.target.value)}
                        className="border border-[#E2E5F0] px-2.5 py-1.5 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => void loadSupplierAnalytics('custom', biFrom, biTo)}
                        className="bg-[#2B3A9F] text-white px-3 py-1.5 font-medium cursor-pointer"
                      >
                        Apply Range
                      </button>
                    </div>
                  )}

                  {biLoading && !biMetrics ? (
                    <p className="text-xs text-neutral-500">Loading store analytics...</p>
                  ) : biMetrics ? (
                    <div className="space-y-5">
                      <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="border border-[#E2E5F0] bg-[#F8F9FC] p-3">
                          <p className="text-[11px] uppercase text-neutral-500">
                            Views ({biMetrics.rangeLabel})
                          </p>
                          <p className="text-lg font-semibold text-[#111322] tabular-nums mt-0.5">
                            {biMetrics.totalProductViews}
                          </p>
                        </div>
                        <div className="border border-[#E2E5F0] bg-[#F8F9FC] p-3">
                          <p className="text-[11px] uppercase text-neutral-500">Orders</p>
                          <p className="text-lg font-semibold text-[#111322] tabular-nums mt-0.5">
                            {biMetrics.totalOrders}
                          </p>
                        </div>
                        <div className="border border-[#E2E5F0] bg-[#F8F9FC] p-3">
                          <p className="text-[11px] uppercase text-neutral-500">SLA On-Time</p>
                          <p className="text-lg font-semibold text-emerald-700 tabular-nums mt-0.5">
                            {biMetrics.slaOnTimePct}%
                          </p>
                        </div>
                        <div className="border border-[#E2E5F0] bg-[#F8F9FC] p-3">
                          <p className="text-[11px] uppercase text-neutral-500">Avg Rating</p>
                          <p className="text-lg font-semibold text-[#5B3CC4] tabular-nums mt-0.5">
                            {biMetrics.averageRating > 0 ? `${biMetrics.averageRating} / 5` : 'No reviews'}
                          </p>
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4 text-xs">
                        <div className="border border-[#E2E5F0] p-4 space-y-2 min-w-0">
                          <p className="font-semibold text-[#111322]">Best-Selling Products</p>
                          {biMetrics.bestSellingProducts.length === 0 ? (
                            <p className="text-neutral-500">No unit sales recorded in this range yet.</p>
                          ) : (
                            <ul className="space-y-2">
                              {biMetrics.bestSellingProducts.map((bp) => (
                                <li key={bp.productId} className="flex flex-col min-[420px]:flex-row min-[420px]:justify-between gap-1 sm:gap-2 min-w-0">
                                  <span className="truncate min-w-0">{bp.title}</span>
                                  <span className="font-mono-tabular shrink-0 text-[#2B3A9F]">
                                    {bp.unitsSold} sold · {formatMoney(bp.revenueUsd)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="border border-[#E2E5F0] p-4 space-y-2 min-w-0">
                          <p className="font-semibold text-[#111322]">Most-Viewed & Conversion</p>
                          {biMetrics.mostViewedProducts.length === 0 ? (
                            <p className="text-neutral-500">No product views recorded in this range yet.</p>
                          ) : (
                            <ul className="space-y-2">
                              {biMetrics.mostViewedProducts.map((mv) => (
                                <li key={mv.productId} className="flex flex-col min-[420px]:flex-row min-[420px]:justify-between gap-1 sm:gap-2 min-w-0">
                                  <span className="truncate min-w-0">{mv.title}</span>
                                  <span className="font-mono-tabular shrink-0 text-neutral-700">
                                    {mv.views} views · {mv.conversionRatePct}% conv
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      {(biMetrics.restockAlerts.length > 0 || biMetrics.lowConversionProducts.length > 0) && (
                        <div className="grid md:grid-cols-2 gap-4 text-xs">
                          {biMetrics.restockAlerts.length > 0 && (
                            <div className="bg-amber-50 border border-amber-200 p-4 space-y-1.5">
                              <p className="font-semibold text-amber-950">Restock Alerts (≤ 5 units)</p>
                              {biMetrics.restockAlerts.map((ra) => (
                                <p key={ra.productId} className="text-amber-900">
                                  {ra.title} — <strong className="font-mono-tabular">{ra.totalStock} left</strong>
                                </p>
                              ))}
                            </div>
                          )}
                          {biMetrics.lowConversionProducts.length > 0 && (
                            <div className="bg-[#EEF2FF] border border-[#C7D2FE] p-4 space-y-1.5">
                              <p className="font-semibold text-[#111322]">Low-Conversion Attention</p>
                              {biMetrics.lowConversionProducts.map((lc) => (
                                <p key={lc.productId} className="text-[#1E2A78]">
                                  {lc.title}: {lc.views} views, {lc.conversionRatePct}% conversion
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="bg-[#F8F9FC] border border-[#E2E5F0] p-4 text-xs space-y-1.5">
                        <p className="font-semibold text-[#111322]">Catalog & Fulfillment Insights</p>
                        <ul className="list-disc pl-4 space-y-1 text-neutral-700">
                          {biMetrics.suggestions.map((sug, idx) => (
                            <li key={idx}>{sug}</li>
                          ))}
                        </ul>
                      </div>

                      {biReports.length > 0 && (
                        <div className="space-y-3 pt-2 border-t border-[#E2E5F0]">
                          <div className="flex items-center justify-between text-xs">
                            <p className="font-semibold text-[#111322]">
                              Generated Reports ({biReports.length})
                            </p>
                            <span className="text-neutral-500">
                              Gemini Status: {biGeminiConfigured ? 'Connected' : 'Calculated Fallback (Set GEMINI_API_KEY)'}
                            </span>
                          </div>
                          {biReports.slice(0, 4).map((rep) => (
                            <div key={rep.id} className="border border-[#E2E5F0] bg-[#F8F9FC] p-4 text-xs space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-[#111322]">
                                  {rep.rangeLabel} ·{' '}
                                  <span className={rep.aiGenerated ? 'text-[#5B3CC4]' : 'text-neutral-600'}>
                                    {rep.aiGenerated ? `Gemini AI (${rep.model || 'gemini'})` : 'Calculated Analytics'}
                                  </span>
                                </span>
                                <span className="font-mono-tabular text-neutral-500">
                                  {new Date(rep.createdAt).toLocaleString()}
                                </span>
                              </div>
                              {rep.statusMessage && (
                                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1">
                                  {rep.statusMessage}
                                </p>
                              )}
                              <p className="text-neutral-800 leading-relaxed">{rep.executiveSummary}</p>
                              {rep.actionableRecommendations.length > 0 && (
                                <div>
                                  <p className="font-semibold text-[#2B3A9F]">Actionable Recommendations</p>
                                  <ul className="list-disc pl-4 text-neutral-700 mt-1 space-y-0.5">
                                    {rep.actionableRecommendations.map((item, i) => (
                                      <li key={i}>{item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {tab === 'products' && (
              <div className="space-y-6">
                {/* Two Product Submission Methods Header */}
                <div className="bg-white border border-[#E5E2DC] p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-editorial text-2xl font-semibold">
                        {t('myProductsHeading')} & Product Submission
                      </h3>
                      <p className="text-xs text-neutral-600 mt-1">{t('supplierPriceNote')}</p>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() =>
                        submissionMethod === 'MANUAL' && !editingProductId
                          ? setSubmissionMethod('NONE')
                          : openManualAdd()
                      }
                      className={`text-left border p-4 transition-colors cursor-pointer ${
                        submissionMethod === 'MANUAL'
                          ? 'border-[#111111] bg-[#111111] text-white'
                          : 'border-[#E5E2DC] bg-[#FAF9F6] hover:border-[#111111]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider">
                          {t('methodManualTitle')}
                        </span>
                        <Plus className="w-4 h-4" />
                      </div>
                      <p
                        className={`text-xs mt-1.5 ${
                          submissionMethod === 'MANUAL' ? 'text-neutral-300' : 'text-neutral-600'
                        }`}
                      >
                        Upload multiple real product photos (JPG/PNG/WEBP), set sizes/colors, supplier cost & shipping details.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setEditingProductId(null);
                        setSubmissionMethod((prev) => (prev === 'CSV' ? 'NONE' : 'CSV'));
                      }}
                      className={`text-left border p-4 transition-colors cursor-pointer ${
                        submissionMethod === 'CSV'
                          ? 'border-[#111111] bg-[#111111] text-white'
                          : 'border-[#E5E2DC] bg-[#FAF9F6] hover:border-[#111111]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider">
                          {t('methodBulkCsvTitle')}
                        </span>
                        <FileSpreadsheet className="w-4 h-4" />
                      </div>
                      <p
                        className={`text-xs mt-1.5 ${
                          submissionMethod === 'CSV' ? 'text-neutral-300' : 'text-neutral-600'
                        }`}
                      >
                        Import catalog spreadsheets with image URLs or batch-uploaded local photos matched by SKU or filename.
                      </p>
                    </button>
                  </div>

                  {/* A. MANUAL PRODUCT SUBMISSION / EDIT FORM */}
                  {submissionMethod === 'MANUAL' && (
                    <div className="border border-[#111111] bg-[#FAF9F6] p-5 space-y-5 text-xs">
                      <div className="flex items-center justify-between border-b border-[#E5E2DC] pb-3">
                        <h4 className="font-editorial text-xl font-semibold text-[#111111]">
                          {editingProductId ? `Edit Product (${editingProductId})` : t('methodManualTitle')}
                        </h4>
                        <button
                          type="button"
                          onClick={() => {
                            setSubmissionMethod('NONE');
                            resetManualForm();
                          }}
                          className="inline-flex items-center gap-1 text-neutral-600 hover:text-[#111111] cursor-pointer"
                        >
                          <X className="w-4 h-4" /> Close
                        </button>
                      </div>

                      {/* Image Upload Manager */}
                      <div className="bg-white border border-[#E5E2DC] p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-[#111111]">{t('productImagesTitle')}</p>
                            <p className="text-[11px] text-neutral-500">
                              Minimum 1 image required for submission (up to 8 photos). First image is the Primary Cover shown on customer cards.
                            </p>
                          </div>
                          <label className="inline-flex items-center gap-1.5 bg-[#111111] text-white px-3.5 py-2 text-xs font-medium cursor-pointer hover:bg-neutral-800">
                            <ImagePlus className="w-3.5 h-3.5" />
                            <span>{t('uploadImagesBtn')}</span>
                            <input
                              type="file"
                              multiple
                              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                              className="sr-only"
                              onChange={(e) => {
                                handleUploadManualImages(e.target.files);
                                e.target.value = '';
                              }}
                            />
                          </label>
                          <input
                            ref={replaceInputRef}
                            type="file"
                            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                            className="sr-only"
                            onChange={(e) => {
                              const idx = replaceIndexRef.current;
                              replaceIndexRef.current = null;
                              if (idx !== null) {
                                handleUploadManualImages(e.target.files, idx);
                              }
                              e.target.value = '';
                            }}
                          />
                        </div>

                        {uploadedImages.length === 0 ? (
                          <label className="block border border-dashed border-[#8B6F47] bg-[#FAF9F6] p-6 text-center cursor-pointer hover:bg-[#F4F2EE]">
                            <Upload className="w-5 h-5 text-[#8B6F47] mx-auto mb-2" />
                            <p className="font-medium text-[#111111]">
                              Click to select or upload JPG, PNG, or WEBP product photos
                            </p>
                            <p className="text-[11px] text-neutral-500 mt-1">
                              Images are compressed automatically and saved securely to backend storage.
                            </p>
                            <input
                              type="file"
                              multiple
                              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                              className="sr-only"
                              onChange={(e) => {
                                handleUploadManualImages(e.target.files);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {uploadedImages.map((img, idx) => (
                              <div
                                key={img.id}
                                className={`border bg-[#FAF9F6] flex flex-col justify-between ${
                                  idx === 0 ? 'border-[#111111]' : 'border-[#E5E2DC]'
                                }`}
                              >
                                <div className="relative aspect-[4/3] bg-white overflow-hidden">
                                  {img.status === 'uploading' ? (
                                    <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center">
                                      <p className="text-[11px] font-medium text-[#111111] truncate w-full">
                                        {img.fileName}
                                      </p>
                                      <div className="w-full bg-[#E5E2DC] h-1.5 mt-2">
                                        <div
                                          className="bg-[#8B6F47] h-1.5 transition-all"
                                          style={{ width: `${img.progress}%` }}
                                        />
                                      </div>
                                      <p className="text-[10px] font-mono-tabular text-neutral-500 mt-1">
                                        {img.progress}%
                                      </p>
                                    </div>
                                  ) : img.status === 'error' ? (
                                    <div className="w-full h-full flex flex-col items-center justify-center p-2 bg-red-50 text-red-700 text-center">
                                      <AlertTriangle className="w-4 h-4 mb-1" />
                                      <p className="text-[10px] line-clamp-3">{img.error}</p>
                                    </div>
                                  ) : (
                                    <SafeImage
                                      src={img.url}
                                      alt={img.fileName}
                                      requiresAuth
                                      className="w-full h-full object-cover"
                                    />
                                  )}
                                  {idx === 0 && img.status === 'ready' && (
                                    <span className="absolute top-1.5 left-1.5 bg-[#111111] text-white px-1.5 py-0.5 text-[10px] font-medium">
                                      {t('primaryCoverBadge')}
                                    </span>
                                  )}
                                </div>

                                <div className="p-2 space-y-1.5 border-t border-[#E5E2DC]">
                                  <p className="text-[10px] text-neutral-600 truncate" title={img.fileName}>
                                    {img.fileName}
                                  </p>
                                  <div className="flex items-center justify-between gap-1">
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={idx === 0}
                                        onClick={() => handleMoveImage(idx, -1)}
                                        aria-label="Move left"
                                        className="border border-[#E5E2DC] bg-white p-1 disabled:opacity-35 cursor-pointer"
                                      >
                                        <ArrowLeft className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={idx === uploadedImages.length - 1}
                                        onClick={() => handleMoveImage(idx, 1)}
                                        aria-label="Move right"
                                        className="border border-[#E5E2DC] bg-white p-1 disabled:opacity-35 cursor-pointer"
                                      >
                                        <ArrowRight className="w-3 h-3" />
                                      </button>
                                      {idx !== 0 && img.status === 'ready' && (
                                        <button
                                          type="button"
                                          onClick={() => handleSetPrimaryImage(idx)}
                                          className="border border-[#E5E2DC] bg-white px-1.5 py-0.5 text-[10px] hover:border-[#111111] cursor-pointer"
                                          title={t('setPrimaryBtn')}
                                        >
                                          <Star className="w-3 h-3 inline mr-0.5 text-[#8B6F47]" />
                                          Cover
                                        </button>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          replaceIndexRef.current = idx;
                                          replaceInputRef.current?.click();
                                        }}
                                        className="border border-[#E5E2DC] bg-white px-1.5 py-0.5 text-[10px] hover:border-[#111111] cursor-pointer"
                                      >
                                        {t('replaceBtn')}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveImage(idx)}
                                        aria-label="Remove image"
                                        className="border border-red-200 bg-white text-red-700 p-1 hover:bg-red-50 cursor-pointer"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Product Core Information */}
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                            Product Name *
                          </label>
                          <input
                            required
                            placeholder="e.g., Kariakoo Linen Resort Shirt"
                            value={manualForm.title}
                            onChange={(e) => setManualForm({ ...manualForm, title: e.target.value })}
                            className="w-full border border-[#E5E2DC] px-3 py-2 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                            Brand (Optional)
                          </label>
                          <input
                            placeholder={mySupplier.businessName}
                            value={manualForm.brand}
                            onChange={(e) => setManualForm({ ...manualForm, brand: e.target.value })}
                            className="w-full border border-[#E5E2DC] px-3 py-2 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                            Gender / Department *
                          </label>
                          <select
                            value={manualForm.gender}
                            onChange={(e) => setManualForm({ ...manualForm, gender: e.target.value as any })}
                            className="w-full border border-[#E5E2DC] px-3 py-2 bg-white"
                          >
                            <option value="MEN">MEN</option>
                            <option value="WOMEN">WOMEN</option>
                            <option value="UNISEX">UNISEX</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                            Product Category *
                          </label>
                          <input
                            list="mik-category-options"
                            required
                            value={manualForm.category}
                            onChange={(e) => setManualForm({ ...manualForm, category: e.target.value })}
                            className="w-full border border-[#E5E2DC] px-3 py-2 bg-white"
                          />
                          <datalist id="mik-category-options">
                            {CATEGORY_SUGGESTIONS.map((c) => (
                              <option key={c} value={c} />
                            ))}
                          </datalist>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                            {t('supplierBasePriceLabel')} *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.5"
                            required
                            value={manualForm.wholesalePriceUsd}
                            onChange={(e) =>
                              setManualForm({ ...manualForm, wholesalePriceUsd: e.target.value })
                            }
                            className="w-full border border-[#E5E2DC] px-3 py-2 bg-white font-mono-tabular"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                            Material (Optional)
                          </label>
                          <input
                            placeholder="e.g., 100% Organic Cotton / Silk"
                            value={manualForm.material}
                            onChange={(e) => setManualForm({ ...manualForm, material: e.target.value })}
                            className="w-full border border-[#E5E2DC] px-3 py-2 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                            Weight in kg (Optional)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="e.g., 0.45"
                            value={manualForm.weightKg}
                            onChange={(e) => setManualForm({ ...manualForm, weightKg: e.target.value })}
                            className="w-full border border-[#E5E2DC] px-3 py-2 bg-white font-mono-tabular"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                            Available Quantity (Total) *
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={manualForm.totalQuantity}
                            onChange={(e) =>
                              setManualForm({ ...manualForm, totalQuantity: e.target.value })
                            }
                            className="w-full border border-[#E5E2DC] px-3 py-2 bg-white font-mono-tabular"
                          />
                        </div>
                        <div className="sm:col-span-2 lg:col-span-3">
                          <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                            Product Description *
                          </label>
                          <textarea
                            required
                            rows={3}
                            placeholder="Describe tailoring details, fabric weight, fit, and care instructions (min 10 characters)..."
                            value={manualForm.description}
                            onChange={(e) =>
                              setManualForm({ ...manualForm, description: e.target.value })
                            }
                            className="w-full border border-[#E5E2DC] p-2.5 bg-white"
                          />
                        </div>
                      </div>

                      {/* Sizes & Colors Matrix */}
                      <div className="bg-white border border-[#E5E2DC] p-4 space-y-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="flex-1 min-w-[160px]">
                            <label className="block text-[11px] text-neutral-600 mb-1">
                              Product Sizes (comma-separated)
                            </label>
                            <input
                              value={manualForm.sizesText}
                              onChange={(e) =>
                                setManualForm({ ...manualForm, sizesText: e.target.value })
                              }
                              placeholder="S, M, L, XL or EU 40, EU 41"
                              className="w-full border border-[#E5E2DC] px-2.5 py-1.5 bg-[#FAF9F6]"
                            />
                          </div>
                          <div className="flex-1 min-w-[160px]">
                            <label className="block text-[11px] text-neutral-600 mb-1">
                              Available Colors (comma-separated)
                            </label>
                            <input
                              value={manualForm.colorsText}
                              onChange={(e) =>
                                setManualForm({ ...manualForm, colorsText: e.target.value })
                              }
                              placeholder="Black, Ivory, Olive"
                              className="w-full border border-[#E5E2DC] px-2.5 py-1.5 bg-[#FAF9F6]"
                            />
                          </div>
                          <div className="w-32">
                            <label className="block text-[11px] text-neutral-600 mb-1">
                              Base SKU
                            </label>
                            <input
                              value={manualForm.baseSku}
                              onChange={(e) =>
                                setManualForm({ ...manualForm, baseSku: e.target.value })
                              }
                              className="w-full border border-[#E5E2DC] px-2.5 py-1.5 bg-[#FAF9F6] font-mono-tabular"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={generateVariantsFromInputs}
                            className="border border-[#111111] px-3 py-1.5 font-medium hover:bg-[#111111] hover:text-white cursor-pointer"
                          >
                            Generate Variants
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] text-neutral-500">
                            <span>Variant SKUs & Per-Variant Stock ({variantRows.length})</span>
                            <button
                              type="button"
                              onClick={() =>
                                setVariantRows((prev) => [
                                  ...prev,
                                  {
                                    sku: `${manualForm.baseSku}-${prev.length + 1}`,
                                    size: 'One Size',
                                    color: 'Black',
                                    stock: 5,
                                  },
                                ])
                              }
                              className="text-[#8B6F47] underline cursor-pointer"
                            >
                              + Add row
                            </button>
                          </div>
                          {variantRows.map((v, idx) => (
                            <div
                              key={idx}
                              className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center border border-[#E5E2DC] p-2.5 sm:border-0 sm:p-0 bg-[#FAF9F6] sm:bg-transparent"
                            >
                              <input
                                value={v.sku}
                                onChange={(e) =>
                                  setVariantRows((prev) =>
                                    prev.map((row, i) => (i === idx ? { ...row, sku: e.target.value } : row))
                                  )
                                }
                                placeholder="SKU"
                                className="col-span-2 sm:col-span-4 border border-[#E5E2DC] px-2 py-1.5 min-h-[38px] font-mono-tabular bg-white"
                              />
                              <input
                                value={v.size}
                                onChange={(e) =>
                                  setVariantRows((prev) =>
                                    prev.map((row, i) => (i === idx ? { ...row, size: e.target.value } : row))
                                  )
                                }
                                placeholder="Size"
                                className="col-span-1 sm:col-span-3 border border-[#E5E2DC] px-2 py-1.5 min-h-[38px] bg-white"
                              />
                              <input
                                value={v.color}
                                onChange={(e) =>
                                  setVariantRows((prev) =>
                                    prev.map((row, i) => (i === idx ? { ...row, color: e.target.value } : row))
                                  )
                                }
                                placeholder="Color"
                                className="col-span-1 sm:col-span-3 border border-[#E5E2DC] px-2 py-1.5 min-h-[38px] bg-white"
                              />
                              <input
                                type="number"
                                min="0"
                                value={v.stock}
                                onChange={(e) =>
                                  setVariantRows((prev) =>
                                    prev.map((row, i) =>
                                      i === idx ? { ...row, stock: Math.max(0, Number(e.target.value)) } : row
                                    )
                                  )
                                }
                                placeholder="Stock"
                                className="col-span-1 sm:col-span-1 border border-[#E5E2DC] px-2 py-1.5 min-h-[38px] sm:text-right font-mono-tabular bg-white"
                              />
                              <button
                                type="button"
                                disabled={variantRows.length <= 1}
                                onClick={() =>
                                  setVariantRows((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="col-span-1 sm:col-span-1 min-h-[38px] text-red-600 disabled:opacity-30 cursor-pointer flex items-center justify-center border border-[#E5E2DC] sm:border-0 bg-white sm:bg-transparent"
                                aria-label="Remove variant"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Shipping Information */}
                      <div className="bg-white border border-[#E5E2DC] p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-[11px] text-neutral-600 mb-1">
                            Shipping Origin Country *
                          </label>
                          <input
                            value={manualForm.shippingOriginCountry}
                            onChange={(e) =>
                              setManualForm({ ...manualForm, shippingOriginCountry: e.target.value })
                            }
                            className="w-full border border-[#E5E2DC] px-2.5 py-1.5 bg-[#FAF9F6]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-neutral-600 mb-1">
                            Base Shipping Fee (USD) *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={manualForm.shippingFeeUsd}
                            onChange={(e) =>
                              setManualForm({ ...manualForm, shippingFeeUsd: e.target.value })
                            }
                            className="w-full border border-[#E5E2DC] px-2.5 py-1.5 bg-[#FAF9F6] font-mono-tabular"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-neutral-600 mb-1">
                            Min Delivery Days
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={manualForm.estimatedDaysMin}
                            onChange={(e) =>
                              setManualForm({ ...manualForm, estimatedDaysMin: e.target.value })
                            }
                            className="w-full border border-[#E5E2DC] px-2.5 py-1.5 bg-[#FAF9F6] font-mono-tabular"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-neutral-600 mb-1">
                            Max Delivery Days
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={manualForm.estimatedDaysMax}
                            onChange={(e) =>
                              setManualForm({ ...manualForm, estimatedDaysMax: e.target.value })
                            }
                            className="w-full border border-[#E5E2DC] px-2.5 py-1.5 bg-[#FAF9F6] font-mono-tabular"
                          />
                        </div>
                        <div className="sm:col-span-2 lg:col-span-4">
                          <label className="block text-[11px] text-neutral-600 mb-1">
                            Shipping Destinations
                          </label>
                          <div className="flex flex-wrap gap-3">
                            {ALL_DESTINATIONS.map((dest) => {
                              const checked = manualForm.shippingDestinations.includes(dest);
                              return (
                                <label key={dest} className="inline-flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      setManualForm((prev) => ({
                                        ...prev,
                                        shippingDestinations: e.target.checked
                                          ? [...prev.shippingDestinations, dest]
                                          : prev.shippingDestinations.filter((d) => d !== dest),
                                      }));
                                    }}
                                    className="accent-[#111111]"
                                  />
                                  <span>{dest}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] text-neutral-600 mb-1">
                            Shipping Notes (Optional)
                          </label>
                          <input
                            placeholder="e.g., Same-day boda courier within Dar es Salaam; DHL internationally."
                            value={manualForm.shippingNotes}
                            onChange={(e) =>
                              setManualForm({ ...manualForm, shippingNotes: e.target.value })
                            }
                            className="w-full border border-[#E5E2DC] px-2.5 py-1.5 bg-[#FAF9F6]"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] text-neutral-600 mb-1">
                            Return Policy Summary *
                          </label>
                          <input
                            value={manualForm.returnPolicySummary}
                            onChange={(e) =>
                              setManualForm({ ...manualForm, returnPolicySummary: e.target.value })
                            }
                            className="w-full border border-[#E5E2DC] px-2.5 py-1.5 bg-[#FAF9F6]"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                        <button
                          type="button"
                          disabled={submittingProduct}
                          onClick={() => handleSubmitManualProduct('DRAFT')}
                          className="border border-[#111111] bg-white text-[#111111] px-5 py-2.5 font-semibold cursor-pointer hover:bg-[#F4F2EE] disabled:opacity-50"
                        >
                          {t('saveDraftBtn')}
                        </button>
                        <button
                          type="button"
                          disabled={submittingProduct || mySupplier.status !== 'APPROVED'}
                          onClick={() => handleSubmitManualProduct('PENDING_APPROVAL')}
                          className="bg-[#111111] text-white px-6 py-2.5 font-semibold cursor-pointer hover:bg-neutral-800 disabled:opacity-50"
                        >
                          {submittingProduct ? 'Submitting...' : t('submitApprovalBtn')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* B. BULK CSV UPLOAD WITH IMAGE MATCHER & IMPORT PREVIEW */}
                  {submissionMethod === 'CSV' && (
                    <div className="border border-[#111111] bg-[#FAF9F6] p-5 space-y-4 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E2DC] pb-3">
                        <div>
                          <h4 className="font-editorial text-xl font-semibold text-[#111111]">
                            {t('methodBulkCsvTitle')}
                          </h4>
                          <p className="text-[11px] text-neutral-600 mt-0.5">
                            Provide <code className="font-mono-tabular">imageUrls</code> (pipe <code className="font-mono-tabular">|</code> separated URLs or filenames), OR upload local JPG/PNG/WEBP files named after your SKU (e.g. <code className="font-mono-tabular">MIK-LIN-01_1.jpg</code>).
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleDownloadCsvTemplate}
                            className="inline-flex items-center gap-1.5 border border-[#111111] bg-white px-3 py-1.5 font-medium hover:bg-[#111111] hover:text-white cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" /> {t('downloadCsvTemplateBtn')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSubmissionMethod('NONE')}
                            className="p-1.5 text-neutral-600 hover:text-[#111111] cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Step 1: Upload local images for CSV matching */}
                      <div className="bg-white border border-[#E5E2DC] p-4 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-[#111111]">{t('uploadLocalCsvImagesBtn')}</p>
                            <p className="text-[11px] text-neutral-500">
                              Optional if CSV rows contain HTTPS image URLs. Required when referencing filenames or SKU-named files.
                            </p>
                          </div>
                          <label className="inline-flex items-center gap-1.5 border border-[#111111] bg-white px-3 py-1.5 font-medium cursor-pointer hover:bg-[#111111] hover:text-white">
                            <ImagePlus className="w-3.5 h-3.5" /> Select Batch Photos
                            <input
                              type="file"
                              multiple
                              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                              className="sr-only"
                              onChange={(e) => {
                                handleUploadCsvLocalImages(e.target.files);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        </div>

                        {csvLocalImages.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-2">
                            {csvLocalImages.map((img) => (
                              <div
                                key={img.id}
                                className="flex items-center gap-2 border border-[#E5E2DC] bg-[#FAF9F6] px-2.5 py-1.5"
                              >
                                {img.status === 'ready' && (
                                  <div className="w-7 h-7 bg-white border border-[#E5E2DC] overflow-hidden shrink-0">
                                    <SafeImage
                                      src={img.url}
                                      alt={img.fileName}
                                      requiresAuth
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                )}
                                <span className="font-mono-tabular text-[11px]">
                                  {img.fileName}
                                  {img.status === 'uploading' ? ` (${img.progress}%)` : ''}
                                  {img.status === 'error' ? ' (Failed)' : ''}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCsvLocalImages((prev) => prev.filter((x) => x.id !== img.id))
                                  }
                                  className="text-neutral-500 hover:text-red-700 cursor-pointer"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Step 2: Upload .csv file or paste */}
                      <div className="bg-white border border-[#E5E2DC] p-4 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-[#111111]">CSV Data</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setCsvText(CSV_TEMPLATE_TEXT);
                                setCsvPreviewRows(null);
                              }}
                              className="text-[#8B6F47] underline cursor-pointer"
                            >
                              Load Sample Rows
                            </button>
                            <label className="inline-flex items-center gap-1.5 border border-[#E5E2DC] px-3 py-1 bg-[#FAF9F6] cursor-pointer hover:border-[#111111]">
                              <Upload className="w-3 h-3" /> Upload .csv File
                              <input
                                type="file"
                                accept=".csv,text/csv"
                                className="sr-only"
                                onChange={(e) => {
                                  handleCsvFileUpload(e.target.files?.[0] || null);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          </div>
                        </div>

                        <textarea
                          rows={6}
                          value={csvText}
                          onChange={(e) => {
                            setCsvText(e.target.value);
                            setCsvPreviewRows(null);
                          }}
                          placeholder="Paste CSV text or click 'Load Sample Rows' / upload a .csv file..."
                          className="w-full border border-[#E5E2DC] p-2.5 text-xs font-mono-tabular bg-[#FAF9F6]"
                        />

                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            disabled={csvBusy}
                            onClick={handlePreviewCsvImport}
                            className="border border-[#111111] bg-white text-[#111111] px-4 py-2 font-semibold hover:bg-[#F4F2EE] cursor-pointer disabled:opacity-50"
                          >
                            {csvBusy ? 'Validating...' : t('previewCsvBtn')}
                          </button>

                          {csvPreviewRows && (
                            <button
                              type="button"
                              disabled={
                                csvBusy ||
                                !csvCounts ||
                                csvCounts.validCount === 0 ||
                                csvCounts.errorCount > 0 ||
                                mySupplier.status !== 'APPROVED'
                              }
                              onClick={handleConfirmCsvImport}
                              className="bg-[#111111] text-white px-5 py-2 font-semibold cursor-pointer hover:bg-neutral-800 disabled:opacity-40"
                            >
                              {t('confirmCsvImportBtn')} ({csvCounts?.validCount || 0})
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Step 3: Preview Table Before Submission */}
                      {csvPreviewRows && (
                        <div className="bg-white border border-[#E5E2DC] p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-[#111111]">
                              Import Preview: {csvCounts?.validCount || 0} valid ·{' '}
                              <span
                                className={
                                  (csvCounts?.errorCount || 0) > 0
                                    ? 'text-red-700'
                                    : 'text-emerald-700'
                                }
                              >
                                {csvCounts?.errorCount || 0} error(s)
                              </span>
                            </p>
                            {(csvCounts?.errorCount || 0) > 0 && (
                              <span className="text-[11px] text-red-700 font-medium">
                                Fix missing images or invalid fields before confirming import.
                              </span>
                            )}
                          </div>

                          <div className="md:hidden space-y-2.5 text-xs">
                            {csvPreviewRows.map((row) => (
                              <div key={row.rowNumber} className="border border-[#E5E2DC] bg-[#FAF9F6] p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono-tabular font-semibold">Row #{row.rowNumber}</span>
                                  <span className="font-mono-tabular font-semibold">${row.wholesalePriceUsd.toFixed(2)}</span>
                                </div>
                                <div className="flex items-start gap-2.5 min-w-0">
                                  {row.matchedImages[0] ? (
                                    <div className="w-10 h-10 border border-[#E5E2DC] bg-white overflow-hidden shrink-0">
                                      <SafeImage
                                        src={row.matchedImages[0].url}
                                        alt={row.title || row.sku}
                                        requiresAuth
                                        className="w-full h-full object-cover"
                                      />
                                    </div>
                                  ) : (
                                    <span className="text-red-700 text-[11px] shrink-0">No image</span>
                                  )}
                                  <div className="min-w-0">
                                    <p className="font-semibold text-[#111111] truncate">{row.title || '(Missing title)'}</p>
                                    <p className="text-[11px] text-neutral-500 font-mono-tabular break-all">
                                      {row.sku} · {row.gender} · {row.category} · Stock {row.stock}
                                    </p>
                                  </div>
                                </div>
                                {row.errors.length === 0 ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                                  </span>
                                ) : (
                                  <div className="text-red-700 space-y-0.5 text-[11px]">
                                    {row.errors.map((err, ei) => (
                                      <p key={ei}>• {err}</p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-xs text-left">
                              <thead className="border-b border-[#E5E2DC] text-neutral-500">
                                <tr>
                                  <th className="py-2 pr-3">Row</th>
                                  <th className="py-2 pr-3">Images</th>
                                  <th className="py-2 pr-3">SKU & Title</th>
                                  <th className="py-2 pr-3 text-right">Supplier Price</th>
                                  <th className="py-2 pr-3">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#E5E2DC]">
                                {csvPreviewRows.map((row) => (
                                  <tr key={row.rowNumber}>
                                    <td className="py-2.5 pr-3 font-mono-tabular">#{row.rowNumber}</td>
                                    <td className="py-2.5 pr-3">
                                      <div className="flex items-center gap-1.5">
                                        {row.matchedImages.map((m, idx) => (
                                          <div
                                            key={idx}
                                            className="w-10 h-10 border border-[#E5E2DC] bg-[#F4F2EE] overflow-hidden shrink-0"
                                          >
                                            <SafeImage
                                              src={m.url}
                                              alt={row.title || row.sku}
                                              requiresAuth
                                              className="w-full h-full object-cover"
                                            />
                                          </div>
                                        ))}
                                        {row.matchedImages.length === 0 && (
                                          <span className="text-red-700 text-[11px]">No image</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-2.5 pr-3">
                                      <div className="font-semibold text-[#111111]">
                                        {row.title || '(Missing title)'}
                                      </div>
                                      <div className="text-[11px] text-neutral-500 font-mono-tabular">
                                        {row.sku} · {row.gender} · {row.category} · Stock {row.stock}
                                      </div>
                                    </td>
                                    <td className="py-2.5 pr-3 text-right font-mono-tabular font-semibold">
                                      ${row.wholesalePriceUsd.toFixed(2)}
                                    </td>
                                    <td className="py-2.5 pr-3">
                                      {row.errors.length === 0 ? (
                                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                          <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                                        </span>
                                      ) : (
                                        <div className="text-red-700 space-y-0.5 text-[11px]">
                                          {row.errors.map((err, ei) => (
                                            <p key={ei}>• {err}</p>
                                          ))}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Supplier "My Products" Section with 6 Status Tabs */}
                <div className="bg-white border border-[#E5E2DC] p-4 sm:p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="font-editorial text-xl font-semibold text-[#111111]">
                      {t('myProductsHeading')} ({workspace.products.length})
                    </h4>
                  </div>

                  <div className="flex flex-wrap gap-1.5 border-b border-[#E5E2DC] pb-3">
                    {(
                      [
                        { id: 'ALL', label: t('statusAll') },
                        { id: 'DRAFT', label: t('statusDraft') },
                        { id: 'PENDING_APPROVAL', label: t('statusPending') },
                        { id: 'APPROVED', label: t('statusApproved') },
                        { id: 'PUBLISHED', label: t('statusPublished') },
                        { id: 'REJECTED', label: t('statusRejected') },
                        { id: 'CHANGES_REQUESTED', label: t('statusChangesRequested') },
                      ] as { id: ProductFilterStatus; label: string }[]
                    ).map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => setProductStatusTab(st.id)}
                        className={`px-3 py-1.5 text-xs font-medium border cursor-pointer transition-colors ${
                          productStatusTab === st.id
                            ? 'bg-[#111111] text-white border-[#111111]'
                            : 'bg-[#FAF9F6] text-neutral-700 border-[#E5E2DC] hover:border-[#111111]'
                        }`}
                      >
                        {st.label}{' '}
                        <span className="font-mono-tabular opacity-75">({statusCounts[st.id]})</span>
                      </button>
                    ))}
                  </div>

                  {filteredProducts.length === 0 ? (
                    <div className="p-8 text-center border border-[#E5E2DC] bg-[#FAF9F6] text-xs text-neutral-500">
                      No products in this status category yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredProducts.map((p) => {
                        const effStatus = getEffectiveSupplierStatus(p);
                        return (
                          <div
                            key={p.id}
                            className="border border-[#E5E2DC] bg-[#FAF9F6] p-4 flex flex-col sm:flex-row gap-4 justify-between text-xs"
                          >
                            <div className="flex gap-3 sm:gap-4 min-w-0 flex-1">
                              <div className="w-20 h-20 sm:w-24 bg-white border border-[#E5E2DC] shrink-0 overflow-hidden">
                                <SafeImage
                                  src={p.images[0]}
                                  alt={p.title}
                                  requiresAuth
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-sm text-[#111111]">
                                    {p.title}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 border text-[11px] font-semibold ${statusBadgeStyle(
                                      effStatus
                                    )}`}
                                  >
                                    {effStatus}
                                  </span>
                                </div>
                                <p className="text-neutral-600">
                                  {p.brand} · {p.gender} · {p.category} · {p.images.length} photo(s) ·{' '}
                                  <span className="font-mono-tabular">{p.totalStock} in stock</span>
                                </p>
                                <div className="flex flex-wrap gap-4 tabular-nums text-neutral-700">
                                  <span>
                                    {t('supplierCostLabel')}:{' '}
                                    <strong className="text-[#111111]">
                                      {formatMoney(p.wholesalePriceUsd)}
                                    </strong>
                                  </span>
                                  <span>
                                    {t('retailPriceLabel')}:{' '}
                                    <strong>
                                      {effStatus === 'DRAFT' || effStatus === 'PENDING_APPROVAL'
                                        ? 'Pending Admin Price'
                                        : formatMoney(p.sellingPriceUsd)}
                                    </strong>
                                  </span>
                                </div>

                                {p.adminRejectionReason && (
                                  <p className="text-red-700 bg-red-50 border border-red-200 px-2.5 py-1.5 mt-1">
                                    <strong>Rejection Reason:</strong> {p.adminRejectionReason}
                                  </p>
                                )}
                                {p.adminChangeRequestMessage && (
                                  <p className="text-amber-950 bg-amber-50 border border-amber-200 px-2.5 py-1.5 mt-1">
                                    <strong>Admin Change Request:</strong> {p.adminChangeRequestMessage}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-wrap sm:flex-col items-end justify-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => openEditProduct(p)}
                                className="inline-flex items-center gap-1.5 border border-[#111111] bg-white px-3 py-1.5 font-medium hover:bg-[#111111] hover:text-white cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" /> Edit
                              </button>

                              {(effStatus === 'REJECTED' ||
                                effStatus === 'CHANGES_REQUESTED' ||
                                effStatus === 'DRAFT') && (
                                <button
                                  type="button"
                                  disabled={mySupplier.status !== 'APPROVED'}
                                  onClick={() => handleQuickResubmit(p.id)}
                                  className="inline-flex items-center gap-1.5 bg-[#111111] text-white px-3 py-1.5 font-medium hover:bg-neutral-800 cursor-pointer disabled:opacity-40"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" /> {t('resubmitApprovalBtn')}
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => handleDeleteProduct(p.id)}
                                className="inline-flex items-center gap-1.5 border border-red-300 bg-white text-red-700 px-3 py-1.5 font-medium hover:bg-red-50 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'orders' && (() => {
              const allSubs = workspace.suborders;
              const classifySub = (s: SupplierSuborder): Exclude<typeof orderFilter, 'ALL'> => {
                if (
                  s.status === 'Cancelled' ||
                  s.status === 'Refunded' ||
                  s.status === 'Refund Requested' ||
                  s.paymentStatus === 'REFUNDED' ||
                  s.paymentStatus === 'PARTIALLY_REFUNDED'
                ) {
                  return 'CANCELLED_REFUNDED';
                }
                if (s.status === 'Delivered' || s.status === 'Completed') return 'COMPLETED';
                if (s.status === 'Shipped' || s.status === 'In Transit') return 'SHIPPED';
                if (s.status === 'Processing' || s.status === 'Ready for Shipping') return 'PROCESSING';
                return 'AWAITING_ACTION';
              };

              const q = orderSearch.trim().toLowerCase();
              const filteredSubs = allSubs.filter((sub) => {
                if (orderFilter !== 'ALL' && classifySub(sub) !== orderFilter) return false;
                if (!q) return true;
                return (
                  sub.id.toLowerCase().includes(q) ||
                  sub.orderId.toLowerCase().includes(q) ||
                  sub.customerShippingName.toLowerCase().includes(q) ||
                  sub.customerShippingCity.toLowerCase().includes(q) ||
                  (sub.trackingNumber || '').toLowerCase().includes(q) ||
                  sub.items.some(
                    (it) => it.title.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q)
                  )
                );
              });

              const SUB_PAGE_SIZE = 8;
              const totalSubPages = Math.max(1, Math.ceil(filteredSubs.length / SUB_PAGE_SIZE));
              const safeSubPage = Math.min(orderPage, totalSubPages);
              const pagedSubs = filteredSubs.slice(
                (safeSubPage - 1) * SUB_PAGE_SIZE,
                safeSubPage * SUB_PAGE_SIZE
              );

              const subFilterTabs: { id: typeof orderFilter; label: string; count: number }[] = [
                { id: 'ALL', label: 'All', count: allSubs.length },
                {
                  id: 'AWAITING_ACTION',
                  label: 'Awaiting Action',
                  count: allSubs.filter((s) => classifySub(s) === 'AWAITING_ACTION').length,
                },
                {
                  id: 'PROCESSING',
                  label: 'Processing',
                  count: allSubs.filter((s) => classifySub(s) === 'PROCESSING').length,
                },
                {
                  id: 'SHIPPED',
                  label: 'Shipped',
                  count: allSubs.filter((s) => classifySub(s) === 'SHIPPED').length,
                },
                {
                  id: 'COMPLETED',
                  label: 'Completed',
                  count: allSubs.filter((s) => classifySub(s) === 'COMPLETED').length,
                },
                {
                  id: 'CANCELLED_REFUNDED',
                  label: 'Cancelled / Refunded',
                  count: allSubs.filter((s) => classifySub(s) === 'CANCELLED_REFUNDED').length,
                },
              ];

              return (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-editorial text-2xl font-semibold">
                      {t('subordersShippingTab')} ({allSubs.length})
                    </h3>
                    {unreadNotificationCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setActivePage('notifications')}
                        className="inline-flex items-center gap-1.5 border border-[#2B3A9F] bg-[#EEF2FF] text-[#2B3A9F] px-3 py-1.5 text-xs font-semibold cursor-pointer"
                      >
                        <Bell className="w-3.5 h-3.5" />
                        {unreadNotificationCount} Unread Alerts
                      </button>
                    )}
                  </div>

                  <div className="bg-[#FAF9F6] border border-[#E5E2DC] p-3 text-xs text-neutral-700">
                    {t('suborderReleaseNotice')} Completed, cancelled, and refunded suborders remain permanently visible here for your historical records.
                  </div>

                  {allSubs.length > 0 && (
                    <div className="bg-white border border-[#E5E2DC] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          {subFilterTabs.map((ft) => (
                            <button
                              key={ft.id}
                              type="button"
                              onClick={() => {
                                setOrderFilter(ft.id);
                                setOrderPage(1);
                              }}
                              className={`px-2.5 py-1.5 text-[11px] font-medium border cursor-pointer ${
                                orderFilter === ft.id
                                  ? 'bg-[#111111] text-white border-[#111111]'
                                  : 'bg-[#FAF9F6] text-neutral-700 border-[#E5E2DC] hover:border-[#111111]'
                              }`}
                            >
                              {ft.label} ({ft.count})
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
                            placeholder="Search ID, buyer, SKU, tracking..."
                            className="w-full border border-[#E5E2DC] pl-8 pr-3 py-1.5 text-xs bg-[#FAF9F6]"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {allSubs.length === 0 ? (
                    <div className="bg-white border border-[#E5E2DC] p-6 text-xs text-neutral-500">
                      {t('suborderReleaseNotice')}
                    </div>
                  ) : pagedSubs.length === 0 ? (
                    <div className="bg-white border border-[#E5E2DC] p-6 text-xs text-neutral-500">
                      No suborders match your current filter or search.
                    </div>
                  ) : (
                    pagedSubs.map((sub) => {
                      const isHistoricalTerminal =
                        sub.status === 'Cancelled' ||
                        sub.status === 'Refunded' ||
                        sub.paymentStatus === 'REFUNDED';
                      const showTimeline = Boolean(expandedHistory[sub.id]);

                      return (
                        <div key={sub.id} className="bg-white border border-[#E5E2DC] p-5 space-y-3 text-xs">
                          <div className="flex flex-wrap justify-between gap-2 pb-2 border-b border-[#E5E2DC]">
                            <div>
                              <span className="font-mono-tabular font-semibold">{sub.id}</span>
                              <span className="text-neutral-500 ml-2">
                                {sub.customerShippingName} ({sub.customerShippingCity},{' '}
                                {sub.customerShippingCountry})
                              </span>
                              <span className="text-neutral-400 ml-2 font-mono-tabular">
                                · {new Date(sub.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <span
                              className={`font-semibold ${
                                isHistoricalTerminal ? 'text-red-700' : 'text-[#8B6F47]'
                              }`}
                            >
                              {sub.status}
                            </span>
                          </div>

                          {sub.supplierSettlementStatus === 'SENT_TO_SUPPLIER' && (
                            <div className="bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-900">
                              {t('adminSettlementPaid')}:{' '}
                              <strong className="font-mono-tabular">{sub.supplierSettlementRef}</strong>
                            </div>
                          )}

                          {sub.adminExceptionReleased && (
                            <div className="bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
                              <strong>Admin Documented Exception Release:</strong>{' '}
                              {sub.adminExceptionReason || 'Released for fulfillment by Super Admin.'}
                            </div>
                          )}

                          <div className="space-y-2">
                            {sub.items.map((it) => {
                              const thumb =
                                it.image ||
                                workspace.products.find((p) => p.id === it.productId)?.images?.[0];
                              return (
                                <div key={it.sku} className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    {thumb && (
                                      <div className="w-10 h-10 bg-[#FAF9F6] border border-[#E5E2DC] shrink-0 overflow-hidden">
                                        <SafeImage
                                          src={thumb}
                                          alt={it.title}
                                          requiresAuth
                                          className="w-full h-full object-cover"
                                        />
                                      </div>
                                    )}
                                    <span className="truncate">
                                      {it.title} ({it.size}/{it.color}) × {it.quantity}
                                      <span className="text-neutral-400 font-mono-tabular ml-1.5">
                                        [{it.sku}]
                                      </span>
                                    </span>
                                  </div>
                                  <span className="tabular-nums shrink-0">
                                    {formatMoney(it.unitWholesalePriceUsd * it.quantity)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          <div className="text-neutral-500 flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-[#E5E2DC]">
                            <span>
                              {t('supplierCostLabel')}:{' '}
                              <strong className="text-[#111111] tabular-nums">
                                {formatMoney(sub.supplierNetEarningsUsd)}
                              </strong>{' '}
                              <span className="text-[11px]">
                                ({sub.supplierSettlementStatus || 'AWAITING_RELEASE'})
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedHistory((prev) => ({
                                  ...prev,
                                  [sub.id]: !prev[sub.id],
                                }))
                              }
                              className="inline-flex items-center gap-1 text-[#111111] underline cursor-pointer"
                            >
                              <Clock className="w-3 h-3" />
                              {showTimeline ? 'Hide Timeline' : `Status History (${(sub.statusHistory || []).length})`}
                            </button>
                          </div>

                          {showTimeline && (
                            <div className="bg-[#FAF9F6] border border-[#E5E2DC] p-3 space-y-1 text-[11px]">
                              {(sub.statusHistory || []).map((ev, idx) => (
                                <p key={idx} className="text-neutral-700">
                                  <span className="font-mono-tabular text-neutral-500">
                                    {new Date(ev.timestamp).toLocaleString()}
                                  </span>{' '}
                                  — <strong>{ev.status}</strong>: {ev.note}
                                </p>
                              ))}
                            </div>
                          )}

                          {!isHistoricalTerminal &&
                            (sub.paymentStatus === 'CONFIRMED' ||
                              sub.fulfillmentReleased ||
                              sub.adminExceptionReleased) && (
                              <div className="pt-2 space-y-2">
                                <div className="grid sm:grid-cols-3 gap-2">
                                  <input
                                    placeholder="Carrier (e.g., DHL / Azam Courier)"
                                    value={trackingInputs[sub.id]?.carrierName || sub.carrierName || ''}
                                    onChange={(e) =>
                                      setTrackingInputs({
                                        ...trackingInputs,
                                        [sub.id]: {
                                          carrierName: e.target.value,
                                          trackingNumber:
                                            trackingInputs[sub.id]?.trackingNumber ||
                                            sub.trackingNumber ||
                                            '',
                                          trackingUrl:
                                            trackingInputs[sub.id]?.trackingUrl ||
                                            sub.trackingUrl ||
                                            '',
                                        },
                                      })
                                    }
                                    className="border border-[#E5E2DC] px-2.5 py-1.5"
                                  />
                                  <input
                                    placeholder="Tracking Number"
                                    value={
                                      trackingInputs[sub.id]?.trackingNumber ||
                                      sub.trackingNumber ||
                                      ''
                                    }
                                    onChange={(e) =>
                                      setTrackingInputs({
                                        ...trackingInputs,
                                        [sub.id]: {
                                          carrierName:
                                            trackingInputs[sub.id]?.carrierName ||
                                            sub.carrierName ||
                                            '',
                                          trackingNumber: e.target.value,
                                          trackingUrl:
                                            trackingInputs[sub.id]?.trackingUrl ||
                                            sub.trackingUrl ||
                                            '',
                                        },
                                      })
                                    }
                                    className="border border-[#E5E2DC] px-2.5 py-1.5"
                                  />
                                  <input
                                    placeholder="Tracking URL (optional)"
                                    value={
                                      trackingInputs[sub.id]?.trackingUrl || sub.trackingUrl || ''
                                    }
                                    onChange={(e) =>
                                      setTrackingInputs({
                                        ...trackingInputs,
                                        [sub.id]: {
                                          carrierName:
                                            trackingInputs[sub.id]?.carrierName ||
                                            sub.carrierName ||
                                            '',
                                          trackingNumber:
                                            trackingInputs[sub.id]?.trackingNumber ||
                                            sub.trackingNumber ||
                                            '',
                                          trackingUrl: e.target.value,
                                        },
                                      })
                                    }
                                    className="border border-[#E5E2DC] px-2.5 py-1.5"
                                  />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {[
                                    'Supplier Confirmed',
                                    'Processing',
                                    'Ready for Shipping',
                                    'Shipped',
                                    'In Transit',
                                    'Delivered',
                                  ].map((st) => (
                                    <button
                                      key={st}
                                      type="button"
                                      onClick={() => handleSuborderUpdate(sub.id, st)}
                                      className="border border-[#E5E2DC] bg-[#FAF9F6] hover:border-[#111111] px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                                    >
                                      Mark {st}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                        </div>
                      );
                    })
                  )}

                  {totalSubPages > 1 && (
                    <div className="flex items-center justify-between bg-white border border-[#E5E2DC] px-4 py-3 text-xs">
                      <span className="text-neutral-600 font-mono-tabular">
                        Page {safeSubPage} of {totalSubPages} ({filteredSubs.length} suborders)
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={safeSubPage <= 1}
                          onClick={() => setOrderPage((p) => Math.max(1, p - 1))}
                          className="inline-flex items-center gap-1 border border-[#E5E2DC] px-3 py-1.5 disabled:opacity-40 cursor-pointer"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" /> Prev
                        </button>
                        <button
                          type="button"
                          disabled={safeSubPage >= totalSubPages}
                          onClick={() => setOrderPage((p) => Math.min(totalSubPages, p + 1))}
                          className="inline-flex items-center gap-1 border border-[#E5E2DC] px-3 py-1.5 disabled:opacity-40 cursor-pointer"
                        >
                          Next <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {tab === 'earnings' && (
              <div className="bg-white border border-[#E5E2DC] p-6 space-y-5">
                <h3 className="font-editorial text-2xl font-semibold">Earnings & Payout Requests</h3>
                <div className="grid sm:grid-cols-3 gap-4 text-xs">
                  <div className="border border-[#E5E2DC] p-4">
                    <p className="text-neutral-500">Pending (In Transit)</p>
                    <p className="text-lg font-semibold tabular-nums mt-1">
                      {formatMoney(workspace.earnings.pendingEarningsUsd)}
                    </p>
                  </div>
                  <div className="border border-[#E5E2DC] p-4">
                    <p className="text-neutral-500">Available for Payout</p>
                    <p className="text-lg font-semibold text-emerald-700 tabular-nums mt-1">
                      {formatMoney(workspace.earnings.availableEarningsUsd)}
                    </p>
                  </div>
                  <div className="border border-[#E5E2DC] p-4">
                    <p className="text-neutral-500">Total Paid Out</p>
                    <p className="text-lg font-semibold tabular-nums mt-1">
                      {formatMoney(workspace.earnings.paidEarningsUsd)}
                    </p>
                  </div>
                </div>

                <form onSubmit={handleRequestPayout} className="flex flex-col min-[380px]:flex-row gap-2.5 items-stretch min-[380px]:items-center pt-2">
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    placeholder="Amount in USD"
                    className="border border-[#E5E2DC] px-3 py-2 min-h-[40px] text-xs w-full min-[380px]:w-48"
                  />
                  <button
                    type="submit"
                    className="bg-[#111111] text-white px-5 py-2 min-h-[40px] text-xs font-medium cursor-pointer shrink-0"
                  >
                    Request Payout
                  </button>
                </form>

                <div className="border-t border-[#E5E2DC] pt-4 space-y-2">
                  <p className="text-xs font-semibold">Payout History</p>
                  {workspace.payouts.length === 0 ? (
                    <p className="text-xs text-neutral-500">No payouts requested yet.</p>
                  ) : (
                    workspace.payouts.map((p) => (
                      <div key={p.id} className="flex justify-between text-xs border border-[#E5E2DC] p-3">
                        <span className="font-mono-tabular">
                          {p.id} · {p.payoutMethod}
                        </span>
                        <span>
                          {p.status} · <strong className="tabular-nums">${p.amountUsd} USD</strong>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {tab === 'refunds' && (
              <div className="bg-white border border-[#E5E2DC] p-6 space-y-3">
                <h3 className="font-editorial text-2xl font-semibold">Customer Claims on Your Store</h3>
                {workspace.refunds.length === 0 ? (
                  <p className="text-xs text-neutral-500">No active refund claims.</p>
                ) : (
                  workspace.refunds.map((r) => (
                    <div key={r.id} className="border border-[#E5E2DC] p-4 text-xs space-y-2">
                      <div className="flex justify-between font-semibold">
                        <span>Claim {r.id}</span>
                        <span>{r.status}</span>
                      </div>
                      <p className="text-neutral-600">{r.reason}</p>
                      {!r.supplierResponse && (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/supplier/refunds/${r.id}/respond`, {
                              method: 'POST',
                              body: JSON.stringify({
                                supplierResponse: 'Supplier reviewed claim and awaits admin resolution.',
                              }),
                            });
                            loadWorkspace();
                          }}
                          className="border border-[#111111] px-3 py-1.5 text-xs cursor-pointer"
                        >
                          Acknowledge Claim
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'integrations' && (
              <div className="bg-white border border-[#E5E2DC] p-6 space-y-4">
                <h3 className="font-editorial text-2xl font-semibold">
                  External Dropshipping & Sourcing Adapters
                </h3>
                <p className="text-xs text-neutral-600">
                  External API adapters remain clearly marked as awaiting credentials until live keys are configured in the server environment.
                </p>
                <div className="space-y-4">
                  {workspace.integrations.map((intg) => (
                    <div key={intg.id} className="border border-[#E5E2DC] p-4 bg-[#FAF9F6] text-xs space-y-2">
                      <div className="flex justify-between font-semibold">
                        <span>{intg.name}</span>
                        <span className="text-[#8B6F47]">{intg.connectionStatus}</span>
                      </div>
                      <p className="text-neutral-600">{intg.documentationNote}</p>
                      {intg.requiredEnvVars.length > 0 && (
                        <p className="font-mono-tabular text-[11px] text-neutral-500">
                          Required Env Vars: {intg.requiredEnvVars.join(', ')}
                        </p>
                      )}
                      {intg.syncWarnings.map((w, i) => (
                        <p key={i} className="text-amber-800">{w}</p>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'profile' && (
              <div className="bg-white border border-[#E5E2DC] p-6 text-xs space-y-2">
                <h3 className="font-editorial text-2xl font-semibold mb-3">Store Profile</h3>
                <p><strong>Business Name:</strong> {workspace.supplier.businessName}</p>
                <p><strong>Country & Origin:</strong> {workspace.supplier.shippingOrigin}</p>
                <p><strong>Commission Rate:</strong> {workspace.supplier.commissionRatePct ?? 'Global Default'}%</p>
                <p><strong>Preferred Payout:</strong> {workspace.supplier.preferredPayoutMethod}</p>
                <p><strong>Description:</strong> {workspace.supplier.description}</p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};
