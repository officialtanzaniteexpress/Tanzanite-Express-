import {
  OrderStatus,
  Product,
  SupplierSuborder,
} from '../types/marketplace.ts';
import { StoreSnapshot } from './store.ts';

export function resolveCommissionRatePct(
  store: StoreSnapshot,
  supplierId: string,
  category: string
): number {
  const supplier = store.suppliers[supplierId];
  // 1. Individual supplier override takes highest priority
  if (supplier && typeof supplier.commissionRatePct === 'number') {
    return supplier.commissionRatePct;
  }
  // 2. Promotional rule
  const promoRule = Object.values(store.commissionRules).find(
    (r) => r.active && r.scope === 'promotional'
  );
  if (promoRule) return promoRule.percentage;

  // 3. Category-specific rule
  const catRule = Object.values(store.commissionRules).find(
    (r) =>
      r.active &&
      r.scope === 'category' &&
      r.targetId?.toLowerCase() === category.toLowerCase()
  );
  if (catRule) return catRule.percentage;

  // 4. Global rate from settings
  return store.settings.globalCommissionPct;
}

export function calculateSupplierEarningsSummary(
  store: StoreSnapshot,
  supplierId: string
) {
  const supplierSuborders = Object.values(store.suborders).filter(
    (s) => s.supplierId === supplierId
  );

  let pendingEarningsUsd = 0;
  let availableEarningsUsd = 0;
  let totalCommissionUsd = 0;
  let grossSalesUsd = 0;
  let sentToSupplierUsd = 0;

  for (const sub of supplierSuborders) {
    if (sub.paymentStatus !== 'CONFIRMED') continue;
    const baseCost =
      typeof sub.supplierBaseCostUsd === 'number'
        ? sub.supplierBaseCostUsd + sub.shippingFeeUsd
        : sub.supplierNetEarningsUsd;
    grossSalesUsd += baseCost;
    totalCommissionUsd +=
      typeof sub.adminMarkupUsd === 'number' ? sub.adminMarkupUsd : sub.marketplaceCommissionUsd;

    if (sub.supplierSettlementStatus === 'SENT_TO_SUPPLIER') {
      sentToSupplierUsd += sub.supplierNetEarningsUsd;
    }

    if (sub.status === 'Delivered' || sub.status === 'Completed') {
      availableEarningsUsd += sub.supplierNetEarningsUsd;
    } else if (
      sub.status !== 'Cancelled' &&
      sub.status !== 'Refunded'
    ) {
      pendingEarningsUsd += sub.supplierNetEarningsUsd;
    }
  }

  const payouts = Object.values(store.payouts).filter(
    (p) => p.supplierId === supplierId
  );
  const reservedOrPaidUsd = payouts
    .filter((p) => p.status !== 'REJECTED')
    .reduce((acc, p) => acc + p.amountUsd, 0);
  const paidEarningsUsd = payouts
    .filter((p) => p.status === 'PAID')
    .reduce((acc, p) => acc + p.amountUsd, 0);

  return {
    grossSalesUsd: round2(grossSalesUsd),
    totalCommissionUsd: round2(totalCommissionUsd),
    pendingEarningsUsd: round2(pendingEarningsUsd),
    availableEarningsUsd: round2(Math.max(0, availableEarningsUsd - reservedOrPaidUsd)),
    paidEarningsUsd: round2(paidEarningsUsd + sentToSupplierUsd),
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeOverallOrderStatus(suborders: SupplierSuborder[]): OrderStatus {
  if (suborders.length === 0) return 'Pending Payment';
  const statuses = suborders.map((s) => s.status);
  if (statuses.every((s) => s === 'Completed')) return 'Completed';
  if (statuses.every((s) => s === 'Delivered' || s === 'Completed')) return 'Delivered';
  if (statuses.every((s) => s === 'Cancelled')) return 'Cancelled';
  if (statuses.every((s) => s === 'Refunded')) return 'Refunded';
  if (statuses.some((s) => s === 'Shipped' || s === 'In Transit')) return 'In Transit';
  if (statuses.some((s) => s === 'Processing' || s === 'Ready for Shipping' || s === 'Supplier Confirmed')) {
    return 'Processing';
  }
  if (statuses.some((s) => s === 'Awaiting Supplier Confirmation')) {
    return 'Awaiting Supplier Confirmation';
  }
  if (statuses.some((s) => s === 'Payment Confirmed')) {
    return 'Payment Confirmed';
  }
  if (statuses.some((s) => s === 'Awaiting Payment Verification')) {
    return 'Awaiting Payment Verification';
  }
  return statuses[0];
}

export function isProductLiveOnStorefront(p: Product): boolean {
  return p.status === 'PUBLISHED' || (p.status === 'APPROVED' && p.isPublished !== false);
}

export interface UploadedCsvImageRef {
  fileName: string;
  url: string;
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes?: number;
}

export interface CsvMatchedImage {
  ref: string;
  url: string;
  source: 'uploaded' | 'url';
}

export interface CsvPreviewRow {
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
  matchedImages: CsvMatchedImage[];
  errors: string[];
  product?: Product;
}

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function splitCsvLines(csvText: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (ch === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && csvText[i + 1] === '\n') i++;
      if (current.trim()) lines.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function normalizeNameKey(s: string): string {
  return s.trim().toLowerCase().replace(/^.*[\\/]/, '');
}

function stripExt(name: string): string {
  return name.replace(/\.(jpe?g|png|webp)$/i, '');
}

const VALID_REMOTE_EXT_RE = /\.(jpe?g|png|webp)(\?.*)?$/i;

export function resolveCsvImageRef(
  rawRef: string,
  sku: string,
  localImages: UploadedCsvImageRef[]
): { matched?: CsvMatchedImage; error?: string } {
  const ref = rawRef.trim();
  if (!ref) return { error: 'Empty image reference.' };

  if (ref.startsWith('blob:') || ref.startsWith('data:')) {
    return {
      error: `Temporary or inline URI ("${ref.slice(0, 28)}...") is not allowed. Upload the image file or provide an HTTPS/media URL.`,
    };
  }

  // Internal uploaded media or seeded asset URLs
  if (ref.startsWith('/api/media/products/') || ref.startsWith('/src/assets/images/')) {
    return { matched: { ref, url: ref, source: 'url' } };
  }

  // Exact filename match against uploaded local images
  const refFile = normalizeNameKey(ref);
  const byFile = localImages.find((img) => normalizeNameKey(img.fileName) === refFile);
  if (byFile) {
    return { matched: { ref, url: byFile.url, source: 'uploaded' } };
  }

  // Match by basename without extension (if SKU or filename base matches)
  const refBase = stripExt(refFile);
  const byBase = localImages.find((img) => stripExt(normalizeNameKey(img.fileName)) === refBase);
  if (byBase) {
    return { matched: { ref, url: byBase.url, source: 'uploaded' } };
  }

  // External HTTP(S) image URL validation
  if (/^https?:\/\//i.test(ref)) {
    try {
      const parsed = new URL(ref);
      const pathname = parsed.pathname.toLowerCase();
      if (pathname.endsWith('.svg') || pathname.endsWith('.html')) {
        return { error: `Unsupported image format in URL "${ref}". Only JPG, JPEG, PNG, and WEBP are allowed.` };
      }
      if (!VALID_REMOTE_EXT_RE.test(pathname) && !pathname.includes('/media/')) {
        return { error: `URL "${ref}" must point to a .jpg, .jpeg, .png, or .webp image.` };
      }
      return { matched: { ref, url: parsed.toString(), source: 'url' } };
    } catch {
      return { error: `Invalid image URL "${ref}".` };
    }
  }

  // Not matched locally and not a valid URL
  return {
    error: `Missing or unmatched image "${ref}" (SKU ${sku || 'N/A'}). Upload "${refFile}" or use a valid JPG/PNG/WEBP URL.`,
  };
}

export function findSkuMatchedLocalImages(
  sku: string,
  localImages: UploadedCsvImageRef[]
): CsvMatchedImage[] {
  const cleanSku = sku.trim().toLowerCase();
  if (!cleanSku || localImages.length === 0) return [];
  const matches = localImages.filter((img) => {
    const base = stripExt(normalizeNameKey(img.fileName));
    return (
      base === cleanSku ||
      base.startsWith(`${cleanSku}_`) ||
      base.startsWith(`${cleanSku}-`) ||
      base.startsWith(`${cleanSku}.`)
    );
  });
  return matches.map((m) => ({
    ref: m.fileName,
    url: m.url,
    source: 'uploaded' as const,
  }));
}

export function validateAndPreviewCsvProducts(
  csvText: string,
  supplierId: string,
  supplierOwnerUid: string,
  supplierName: string,
  supplierCountry: string,
  localImages: UploadedCsvImageRef[] = []
): {
  rows: CsvPreviewRow[];
  validProducts: Product[];
  validCount: number;
  errorCount: number;
} {
  const lines = splitCsvLines(csvText);
  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one product row.');
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
  const now = new Date().toISOString();
  const rows: CsvPreviewRow[] = [];
  const validProducts: Product[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] || '').trim();
    });

    const rowNumber = i + 1;
    const errors: string[] = [];
    const title = row['title'] || row['productname'] || row['name'] || '';
    if (title.length < 2) {
      errors.push('Product name (title) is required (min 2 chars).');
    }

    const sku = (row['sku'] || `${supplierId.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-4)}-${i}`).trim();
    const genderRaw = (row['gender'] || 'UNISEX').toUpperCase();
    const gender: Product['gender'] =
      genderRaw === 'MEN' || genderRaw === 'WOMEN' || genderRaw === 'UNISEX'
        ? genderRaw
        : 'UNISEX';

    const priceRaw = Number(row['wholesalepriceusd'] || row['supplierpriceusd'] || row['price']);
    if (!Number.isFinite(priceRaw) || priceRaw <= 0) {
      errors.push('Valid positive supplier price (wholesalePriceUsd) is required.');
    }
    const wholesalePriceUsd = Number.isFinite(priceRaw) && priceRaw > 0 ? round2(priceRaw) : 0;

    const stockRaw = Number(row['stock'] || row['quantity'] || row['availablequantity']);
    if (!Number.isFinite(stockRaw) || stockRaw < 0) {
      errors.push('Valid non-negative stock quantity is required.');
    }
    const stock = Number.isFinite(stockRaw) && stockRaw >= 0 ? Math.floor(stockRaw) : 0;

    const sizeRaw = row['sizes'] || row['size'] || 'One Size';
    const sizes = sizeRaw
      .split(/[|;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const colorRaw = row['colors'] || row['color'] || 'Black';
    const colors = colorRaw
      .split(/[|;]/)
      .map((c) => c.trim())
      .filter(Boolean);

    const category = row['category'] || (gender === 'WOMEN' ? 'Dresses' : 'Shirts');
    const brand = row['brand'] || supplierName;
    const material = row['material'] || undefined;
    const weightNum = Number(row['weightkg'] || row['weight']);
    const weightKg = Number.isFinite(weightNum) && weightNum > 0 ? round2(weightNum) : undefined;

    const shippingFeeNum = Number(row['shippingfeeusd'] || 0);
    const shippingFeeUsd = Number.isFinite(shippingFeeNum) && shippingFeeNum >= 0 ? round2(shippingFeeNum) : 5;
    const estimatedDaysMin = Math.max(1, Math.floor(Number(row['estimateddaysmin']) || 2));
    const estimatedDaysMax = Math.max(estimatedDaysMin, Math.floor(Number(row['estimateddaysmax']) || 5));
    const shippingOriginCountry = row['shippingorigincountry'] || supplierCountry;
    const description =
      row['description'] || `${title} supplied directly by ${supplierName} (${supplierCountry}).`;
    if (description.length < 10) {
      errors.push('Description must be at least 10 characters.');
    }

    // Image matching: CSV imageUrls column (pipe | or semicolon ; separated) or SKU-matched local uploads
    const rawImageField = row['imageurls'] || row['images'] || row['imageurl'] || row['image'] || '';
    const rawImageRefs = rawImageField
      .split(/[|;]/)
      .map((r) => r.trim())
      .filter(Boolean);

    const matchedImages: CsvMatchedImage[] = [];
    if (rawImageRefs.length > 0) {
      for (const ref of rawImageRefs) {
        const res = resolveCsvImageRef(ref, sku, localImages);
        if (res.error) {
          errors.push(res.error);
        } else if (res.matched) {
          matchedImages.push(res.matched);
        }
      }
    } else {
      const skuMatches = findSkuMatchedLocalImages(sku, localImages);
      if (skuMatches.length > 0) {
        matchedImages.push(...skuMatches);
      } else {
        errors.push(
          `At least one product image is required. Provide imageUrls (e.g. "https://...jpg" or "${sku}_1.jpg") or upload local images matching SKU "${sku}".`
        );
      }
    }

    if (matchedImages.length > 6) {
      errors.push('Maximum of 6 images allowed per product.');
    }

    const variants = [];
    const perVariantStock = Math.max(
      0,
      Math.floor(stock / Math.max(1, (sizes.length || 1) * (colors.length || 1)))
    );
    let remainder = stock - perVariantStock * Math.max(1, (sizes.length || 1) * (colors.length || 1));
    for (const s of sizes.length ? sizes : ['One Size']) {
      for (const c of colors.length ? colors : ['Black']) {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder--;
        variants.push({
          sku: sizes.length === 1 && colors.length === 1 ? sku : `${sku}-${s}-${c}`.replace(/\s+/g, '-'),
          size: s,
          color: c,
          stock: perVariantStock + extra,
        });
      }
    }

    const id = `prod_csv_${Date.now()}_${i}`;
    let product: Product | undefined;

    if (errors.length === 0) {
      product = {
        id,
        supplierId,
        supplierOwnerUid,
        supplierName,
        supplierCountry,
        title,
        slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i}`,
        brand,
        material,
        weightKg,
        gender,
        category,
        description,
        images: matchedImages.map((m) => m.url),
        wholesalePriceUsd,
        sellingPriceUsd: wholesalePriceUsd,
        variants,
        totalStock: variants.reduce((a, v) => a + v.stock, 0),
        shippingOriginCountry,
        shippingDestinations: [
          'Tanzania',
          'Kenya',
          'United Kingdom',
          'United States',
          'International',
        ],
        estimatedDaysMin,
        estimatedDaysMax,
        shippingFeeUsd,
        returnPolicySummary: '14-day unworn return with original packaging.',
        // Newly submitted products always start PENDING_APPROVAL and unpublished
        status: 'PENDING_APPROVAL',
        isPublished: false,
        featured: false,
        isNewArrival: true,
        isBestSeller: false,
        ratingAvg: 0,
        ratingCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      validProducts.push(product);
    }

    rows.push({
      rowNumber,
      sku,
      title,
      category,
      gender,
      brand,
      material,
      weightKg,
      wholesalePriceUsd,
      stock,
      sizes,
      colors,
      shippingFeeUsd,
      estimatedDaysMin,
      estimatedDaysMax,
      shippingOriginCountry,
      description,
      rawImageRefs,
      matchedImages,
      errors,
      product,
    });
  }

  return {
    rows,
    validProducts,
    validCount: validProducts.length,
    errorCount: rows.filter((r) => r.errors.length > 0).length,
  };
}

export function parseCsvProducts(
  csvText: string,
  supplierId: string,
  supplierOwnerUid: string,
  supplierName: string,
  supplierCountry: string,
  _requireApproval: boolean,
  localImages: UploadedCsvImageRef[] = []
): Product[] {
  const preview = validateAndPreviewCsvProducts(
    csvText,
    supplierId,
    supplierOwnerUid,
    supplierName,
    supplierCountry,
    localImages
  );
  if (preview.errorCount > 0) {
    const firstErrs = preview.rows
      .filter((r) => r.errors.length > 0)
      .slice(0, 3)
      .map((r) => `Row ${r.rowNumber} (${r.title || r.sku}): ${r.errors.join(' ')}`)
      .join(' | ');
    throw new Error(`CSV validation failed (${preview.errorCount} row(s)): ${firstErrs}`);
  }
  if (preview.validProducts.length === 0) {
    throw new Error('No valid product rows found in CSV.');
  }
  return preview.validProducts;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (val: unknown) => {
    const s = val === null || val === undefined ? '' : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h])).join(','));
  }
  return lines.join('\n');
}
