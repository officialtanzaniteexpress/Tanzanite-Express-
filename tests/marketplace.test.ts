import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TRANSLATIONS } from '../src/lib/i18n.ts';
import {
  computeAdminAnalytics,
  computeSupplierAnalytics,
  getRecommendationsForUser,
  rebuildUserPreferenceProfile,
  recordActivityEvent,
} from '../src/server/analytics-engine.ts';
import { hasPaymentVerificationAccess } from '../src/server/auth-middleware.ts';
import {
  bootstrapSuperAdmin,
  getAdminBootstrapStatus,
} from '../src/server/bootstrap-admin.ts';
import { getPaymentGatewaysStatus, getSupplierIntegrationsStatus } from '../src/server/gateways.ts';
import {
  calculateSupplierEarningsSummary,
  isProductLiveOnStorefront,
  parseCsvProducts,
  resolveCommissionRatePct,
  toCsv,
  validateAndPreviewCsvProducts,
} from '../src/server/marketplace-engine.ts';
import {
  deleteProductImageFile,
  detectImageMimeFromBuffer,
  findOrphanedMediaIds,
  getStorageDiagnostics,
  PAYMENT_RECEIPTS_DIR,
  PRODUCT_IMAGES_DIR,
  readPaymentReceiptDataUrl,
  readProductImageFile,
  savePaymentReceiptFile,
  saveProductImageFile,
  verifyProductMediaIntegrity,
} from '../src/server/media-storage.ts';
import {
  reviewPaymentSubmission,
  sanitizeSubmissionForClient,
  submitManualPaymentProof,
} from '../src/server/payment-verification.ts';
import {
  BACKUPS_DIR,
  createStoreBackup,
  normalizeRetentionPolicy,
  readBackupArchive,
  verifyLatestBackupChecksum,
} from '../src/server/retention-backup.ts';
import {
  createNotification,
  getLocalPersistenceInfo,
  getStore,
  getSyncDiagnostics,
  getSystemMetricsSnapshot,
  getUserNotificationPreferences,
  markNotificationAsRead,
  recordApiRequestMetric,
  recordSystemError,
  saveStore,
  upsertCartForUser,
  upsertNewsletterSubscriber,
  upsertNotificationPreferences,
  upsertOrder,
  upsertPayment,
  upsertSuborder,
  upsertUser,
  withStoreLock,
} from '../src/server/store.ts';
import { Order, PaymentTransaction, Product, ProductImageMeta, SupplierSuborder, UserAccount } from '../src/types/marketplace.ts';

async function runTests() {
  console.log('Running MIK FASHION HUB verification suite...');

  const dataFile = path.resolve(process.cwd(), '.mik-data', 'marketplace-store.json');
  const hadDataFile = fs.existsSync(dataFile);
  const prevBackup = hadDataFile ? fs.readFileSync(dataFile, 'utf-8') : null;

  try {
    // 1. Store bootstrap & seed integrity
    const store = await getStore();
    assert.ok(Object.keys(store.products).length >= 10, 'Seed catalog loaded');
    assert.ok(Object.keys(store.suppliers).length >= 4, 'Seed suppliers loaded');
    assert.equal(store.settings.mpesaEnabled, true, 'M-Pesa enabled by default');
    assert.equal(store.settings.nmbEnabled, true, 'NMB Bank enabled by default');
    assert.ok(Boolean(store.settings.mpesaPhone), 'M-Pesa receiving phone configured in settings');
    assert.ok(Boolean(store.settings.nmbAccountNumber), 'NMB account configured in settings');

    // 2. Payment Gateways: Only manual_mobile & manual_nmb; NO paid gateways (AzamPay, Stripe, Pesapal, Selcom)
    assert.equal(store.settings.officialRecipientName, 'MAHELA ISSA KISENA', 'Default official recipient is MAHELA ISSA KISENA');
    const gateways = getPaymentGatewaysStatus(store.settings);
    assert.equal(gateways.length, 2, 'Only 2 manual payment channels active for MVP');
    const mobileGw = gateways.find((g) => g.id === 'manual_mobile');
    const nmbGw = gateways.find((g) => g.id === 'manual_nmb');
    assert.ok(mobileGw?.enabledForCheckout, 'M-Pesa manual channel enabled');
    assert.equal(mobileGw?.accountDetails?.phone, store.settings.mpesaPhone);
    assert.equal(mobileGw?.accountDetails?.accountName, 'MAHELA ISSA KISENA');
    assert.ok(nmbGw?.enabledForCheckout, 'NMB Bank manual channel enabled');
    assert.equal(nmbGw?.accountDetails?.bankName, 'NMB Bank');
    assert.equal(nmbGw?.accountDetails?.bankAccount, store.settings.nmbAccountNumber);
    assert.equal(nmbGw?.accountDetails?.accountName, 'MAHELA ISSA KISENA');
    assert.equal(gateways.some((g) => g.id === 'stripe' || g.id === 'azampay' || g.id === 'pesapal'), false);

    // Ensure Super Admin updates propagate dynamically and blank phone/account never invent numbers
    const updatedRecipientGateways = getPaymentGatewaysStatus({
      ...store.settings,
      officialRecipientName: 'CUSTOM RECIPIENT LTD',
      mpesaAccountHolder: '',
      nmbAccountName: '',
      mpesaPhone: '',
    });
    assert.equal(updatedRecipientGateways.find((g) => g.id === 'manual_mobile')?.enabledForCheckout, false);
    assert.equal(updatedRecipientGateways.find((g) => g.id === 'manual_mobile')?.accountDetails?.phone, '');
    assert.equal(updatedRecipientGateways.find((g) => g.id === 'manual_mobile')?.accountDetails?.accountName, 'CUSTOM RECIPIENT LTD');
    assert.equal(updatedRecipientGateways.find((g) => g.id === 'manual_nmb')?.accountDetails?.accountName, 'CUSTOM RECIPIENT LTD');

    // Ensure disabling a channel in Admin settings disables it at checkout dynamically
    const disabledGateways = getPaymentGatewaysStatus({ ...store.settings, mpesaEnabled: false });
    assert.equal(
      disabledGateways.find((g) => g.id === 'manual_mobile')?.enabledForCheckout,
      false,
      'Admin toggle disables M-Pesa cleanly'
    );

    const integrations = getSupplierIntegrationsStatus();
    assert.ok(integrations.some((i) => i.id === 'local_manual'));

    // 3. Admin Markup pricing model & CSV utilities
    assert.equal(resolveCommissionRatePct(store, 'nonexistent_sup', 'Dresses'), 0);
    assert.equal(resolveCommissionRatePct(store, 'sup_kariakoo_atelier', 'Shirts'), 0);

    const csv = [
      'title,gender,category,brand,wholesalePriceUsd,sellingPriceUsd,size,color,stock,shippingFeeUsd,estimatedDaysMin,estimatedDaysMax,description,imageUrls',
      'Kariakoo Linen Jacket,MEN,Jackets,Atelier,45,65,L,Sand,12,5,2,4,Tailored linen jacket.,/src/assets/images/cat_mens_tailoring_1794751435522.jpg',
    ].join('\n');
    const parsed = parseCsvProducts(csv, 'sup_1', 'uid_1', 'Atelier', 'Tanzania', false);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].status, 'PENDING_APPROVAL');
    assert.equal(parsed[0].isPublished, false);
    assert.equal(parsed[0].totalStock, 12);

    const exported = toCsv([{ orderId: 'ord_1', totalUsd: 100 }]);
    assert.ok(exported.includes('orderId,totalUsd') && exported.includes('ord_1,100'));

    const earnings = calculateSupplierEarningsSummary(store, 'sup_kariakoo_atelier');
    assert.equal(earnings.availableEarningsUsd, 0);

    // 4. Manual Payment Verification Workflow & Security Checks
    const now = new Date().toISOString();
    const adminActor: UserAccount = {
      uid: 'test_admin_uid',
      email: 'admin-test@mik.local',
      displayName: 'Test Super Admin',
      role: 'super_admin',
      status: 'active',
      preferredCurrency: 'USD',
      preferredCountry: 'Tanzania',
      addresses: [],
      createdAt: now,
      updatedAt: now,
    };
    const customerActor: UserAccount = {
      uid: 'test_customer_uid',
      email: 'customer-test@mik.local',
      displayName: 'Amina Buyer',
      role: 'customer',
      status: 'active',
      preferredCurrency: 'TZS',
      preferredCountry: 'Tanzania',
      addresses: [],
      createdAt: now,
      updatedAt: now,
    };
    await upsertUser(adminActor);
    await upsertUser(customerActor);

    const makeTestOrder = async (orderId: string, payId: string, subId: string) => {
      const sub: SupplierSuborder = {
        id: subId,
        orderId,
        supplierId: 'sup_kariakoo_atelier',
        supplierOwnerUid: 'seed_uid_kariakoo',
        supplierName: 'Kariakoo Sartorial Atelier',
        supplierCountry: 'Tanzania',
        customerId: customerActor.uid,
        customerShippingName: 'Amina Buyer',
        customerShippingCity: 'Dar es Salaam',
        customerShippingCountry: 'Tanzania',
        customerShippingStreet: 'Masaki',
        customerShippingPhone: '+255700000111',
        items: [
          {
            productId: 'prod_1',
            title: 'Test Garment',
            sku: 'SKU-1',
            size: 'M',
            color: 'Ivory',
            quantity: 1,
            unitSellingPriceUsd: 50,
            unitWholesalePriceUsd: 35,
            lineTotalUsd: 50,
          },
        ],
        supplierSubtotalUsd: 50,
        supplierBaseCostUsd: 35,
        adminMarkupUsd: 15,
        shippingFeeUsd: 5,
        marketplaceCommissionRatePct: 0,
        marketplaceCommissionUsd: 15,
        supplierNetEarningsUsd: 40,
        fulfillmentReleased: false,
        status: 'Pending Payment',
        paymentStatus: 'PENDING',
        responseDeadlineAt: now,
        statusHistory: [],
        createdAt: now,
        updatedAt: now,
      };
      const order: Order = {
        id: orderId,
        customerId: customerActor.uid,
        customerEmail: customerActor.email,
        isGuestCheckout: false,
        currency: 'TZS',
        fxRate: 2650,
        subtotalUsd: 50,
        shippingUsd: 5,
        discountUsd: 0,
        taxUsd: 0,
        totalUsd: 55,
        totalDisplay: 145800,
        shippingAddress: {
          id: 'addr_1',
          label: 'Home',
          fullName: 'Amina Buyer',
          phone: '+255700000111',
          country: 'Tanzania',
          city: 'Dar es Salaam',
          street: 'Masaki',
        },
        isInternational: false,
        customsDisclaimerAccepted: true,
        paymentProvider: 'manual_mobile',
        paymentStatus: 'PENDING',
        suborderIds: [subId],
        overallStatus: 'Pending Payment',
        createdAt: now,
        updatedAt: now,
      };
      const pay: PaymentTransaction = {
        id: payId,
        orderId,
        provider: 'manual_mobile',
        mode: 'manual',
        reference: `MIK-${orderId}`,
        idempotencyKey: `idem_${orderId}`,
        amountUsd: 55,
        currency: 'TZS',
        amountDisplay: 145800,
        status: 'PENDING',
        webhookVerified: false,
        createdAt: now,
        updatedAt: now,
      };
      await upsertSuborder(sub);
      await upsertOrder(order);
      await upsertPayment(pay);
    };

    await makeTestOrder('test_ord_1', 'test_pay_1', 'test_sub_1');
    await makeTestOrder('test_ord_2', 'test_pay_2', 'test_sub_2');

    // Submit payment with amount mismatch + receipt image -> PENDING_VERIFICATION, receipt stripped on public return
    const subRes1 = await submitManualPaymentProof({
      orderId: 'test_ord_1',
      paymentMethod: 'manual_mobile',
      transactionId: 'MPESA-TEST-88991',
      amountSent: 140000, // underpaid vs 145800
      senderName: 'Amina Buyer',
      senderPhone: '+255700000111',
      transactionDate: '2026-11-15',
      receiptImageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      receiptFileName: 'receipt.png',
      actorUid: customerActor.uid,
      actorEmail: customerActor.email,
      actorRole: 'customer',
    });
    assert.ok(!('error' in subRes1), 'First submission succeeds');
    assert.equal(subRes1.submission.status, 'PENDING_VERIFICATION', 'Never auto-confirms payment');
    assert.equal(subRes1.order.paymentStatus, 'AWAITING_VERIFICATION');
    assert.equal(subRes1.submission.hasReceiptImage, true);
    assert.equal(subRes1.submission.receiptImageDataUrl, undefined, 'Receipt image stripped from client payload');
    assert.equal(subRes1.submission.amountMismatchFlag, true, 'Underpayment flagged');

    // Sanitization & binary payment receipt vault check (never stores raw base64 inside store JSON)
    const rawStored = store.paymentSubmissions[subRes1.submission.id];
    assert.equal(rawStored.receiptImageDataUrl, undefined, 'Raw receipt base64 omitted from store snapshot JSON');
    assert.ok(Boolean(rawStored.receiptStoragePath), 'Receipt storage path saved on submission');
    assert.equal(rawStored.receiptMimeType, 'image/png', 'Receipt MIME verified as image/png');
    const recoveredReceipt = await readPaymentReceiptDataUrl(rawStored);
    assert.equal(recoveredReceipt, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', 'Receipt reads back cleanly from binary receipt vault');
    assert.equal(sanitizeSubmissionForClient(rawStored).receiptImageDataUrl, undefined);

    // Cross-order duplicate pending ref -> allowed for admin review with isDuplicateSuspected flag
    const dupPending = await submitManualPaymentProof({
      orderId: 'test_ord_2',
      paymentMethod: 'manual_mobile',
      transactionId: 'mpesa-test-88991', // same normalized ref
      amountSent: 145800,
      senderName: 'Amina Buyer',
      transactionDate: '2026-11-15',
      actorUid: customerActor.uid,
      actorEmail: customerActor.email,
      actorRole: 'customer',
    });
    assert.ok(!('error' in dupPending));
    assert.equal(dupPending.submission.isDuplicateSuspected, true, 'Duplicate pending ref flagged');

    // Reject & Request Info enforce mandatory reason >= 5 chars
    const badReject = await reviewPaymentSubmission({
      submissionId: subRes1.submission.id,
      action: 'REJECT',
      reason: 'bad',
      actor: adminActor,
    });
    assert.ok('error' in badReject && badReject.status === 400, 'Reject requires >= 5 char reason');

    const badInfo = await reviewPaymentSubmission({
      submissionId: subRes1.submission.id,
      action: 'REQUEST_INFO',
      reason: 'hi',
      actor: adminActor,
    });
    assert.ok('error' in badInfo && badInfo.status === 400, 'Request Info requires >= 5 char message');

    // Request additional info keeps order unconfirmed & suborder locked
    const infoRes = await reviewPaymentSubmission({
      submissionId: subRes1.submission.id,
      action: 'REQUEST_INFO',
      reason: 'Please send clearer M-Pesa SMS showing full balance.',
      actor: adminActor,
    });
    assert.ok(!('error' in infoRes));
    assert.equal(infoRes.submission.status, 'INFO_REQUESTED');
    assert.equal(store.suborders['test_sub_1'].fulfillmentReleased, false);

    // Approve payment -> marks VERIFIED, CONFIRMED, releases suborders, records audit log & notifications
    const approveRes = await reviewPaymentSubmission({
      submissionId: subRes1.submission.id,
      action: 'APPROVE',
      adminNotes: 'Matched M-Pesa statement',
      actor: adminActor,
    });
    assert.ok(!('error' in approveRes));
    assert.equal(approveRes.submission.status, 'VERIFIED');
    assert.equal(approveRes.order.paymentStatus, 'CONFIRMED');
    assert.equal(store.suborders['test_sub_1'].fulfillmentReleased, true);

    // Reusing an ALREADY-VERIFIED transaction reference on another order is blocked with 409
    const blockedDup = await submitManualPaymentProof({
      orderId: 'test_ord_2',
      paymentMethod: 'manual_mobile',
      transactionId: 'MPESA-TEST-88991',
      amountSent: 145800,
      senderName: 'Amina Buyer',
      transactionDate: '2026-11-15',
      actorUid: customerActor.uid,
      actorEmail: customerActor.email,
      actorRole: 'customer',
    });
    assert.ok('error' in blockedDup && blockedDup.status === 409, 'Verified ref reuse blocked (409)');

    // 5. Notifications & Preferences
    await upsertNotificationPreferences({
      uid: customerActor.uid,
      inAppEnabled: true,
      emailEnabled: true,
      mutedTypes: ['product'],
      updatedAt: now,
    });
    const mutedNotif = await createNotification({
      recipientUid: customerActor.uid,
      type: 'product',
      title: 'Muted promo',
      message: 'Should be skipped',
    });
    assert.equal(mutedNotif, null, 'Muted category skipped cleanly');

    const activeNotif = await createNotification({
      recipientUid: customerActor.uid,
      type: 'payment',
      title: 'Payment Alert',
      message: 'Verification complete.',
      targetType: 'order',
      targetId: 'test_ord_1',
    });
    assert.ok(activeNotif !== null && activeNotif.read === false);
    const readRes = await markNotificationAsRead(customerActor.uid, activeNotif!.id);
    assert.equal(readRes?.read, true);
    assert.equal(getUserNotificationPreferences(store, customerActor.uid).mutedTypes.includes('product'), true);

    // 6. Bilingual EN / SW translation dictionary parity
    const enKeys = Object.keys(TRANSLATIONS.en).sort();
    const swKeys = Object.keys(TRANSLATIONS.sw).sort();
    assert.deepEqual(enKeys, swKeys, 'English and Kiswahili dictionaries have identical keys');

    // 7. Image Media Security, Storefront Visibility & Bulk CSV Validation
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const webpHeader = Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'binary');
    const svgPayload = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const htmlPayload = Buffer.from('<!DOCTYPE html><html><body>bad</body></html>');

    assert.equal(detectImageMimeFromBuffer(jpegHeader), 'image/jpeg');
    assert.equal(detectImageMimeFromBuffer(pngHeader), 'image/png');
    assert.equal(detectImageMimeFromBuffer(webpHeader), 'image/webp');
    assert.equal(detectImageMimeFromBuffer(svgPayload), null, 'SVG blocked cleanly');
    assert.equal(detectImageMimeFromBuffer(htmlPayload), null, 'HTML blocked cleanly');
    assert.equal(detectImageMimeFromBuffer(Buffer.from([0xff, 0xd8])), null, 'Too-small buffer rejected');

    // Binary image save/read/orphan-detection/delete
    const testSupplierDir = path.join(PRODUCT_IMAGES_DIR, 'sup_test_media');
    try {
      const saved = saveProductImageFile('sup_test_media', 'img_test_001', 'image/png', pngHeader);
      assert.ok(saved.sizeBytes === pngHeader.length);
      const testMeta: ProductImageMeta = {
        id: 'img_test_001',
        supplierId: 'sup_test_media',
        supplierOwnerUid: 'uid_test_media',
        url: '/api/media/products/img_test_001',
        fileName: 'front.png',
        mimeType: 'image/png',
        sizeBytes: pngHeader.length,
        isPrimary: true,
        sortOrder: 0,
        storageProvider: 'local_media',
        createdAt: now,
      };
      store.productImages[testMeta.id] = testMeta;
      const readBack = readProductImageFile(testMeta);
      assert.ok(readBack && readBack.equals(pngHeader), 'Saved image reads back identically');

      // Orphan detection ignores URLs not in products and flags unreferenced media IDs
      const orphans = findOrphanedMediaIds(store, ['/api/media/products/img_test_001']);
      assert.deepEqual(orphans, ['img_test_001']);

      assert.equal(deleteProductImageFile(testMeta), true);
      assert.equal(readProductImageFile(testMeta), null);
      delete store.productImages[testMeta.id];
    } finally {
      fs.rmSync(testSupplierDir, { recursive: true, force: true });
    }

    // Strict CSV image validation & SKU matching
    const badCsv = [
      'sku,title,gender,category,wholesalePriceUsd,stock,description,imageUrls',
      'SKU-BAD-1,No Image Dress,WOMEN,Dresses,40,10,Tailored silk wrap dress.,',
      'SKU-BAD-2,Blob Dress,WOMEN,Dresses,40,10,Tailored silk wrap dress.,blob:http://localhost:3000/1234',
    ].join('\n');
    const badPreview = validateAndPreviewCsvProducts(badCsv, 'sup_1', 'uid_1', 'Atelier', 'Tanzania', []);
    assert.equal(badPreview.errorCount, 2, 'CSV missing image and blob URI both fail validation');
    assert.equal(badPreview.validCount, 0);
    assert.throws(() => parseCsvProducts(badCsv, 'sup_1', 'uid_1', 'Atelier', 'Tanzania', true, []));

    const skuMatchCsv = [
      'sku,title,gender,category,wholesalePriceUsd,stock,sizes,colors,description',
      'SKU-10,Swahili Linen Dress,WOMEN,Dresses,55,8,S|M,Ivory|Terracotta,Breathable linen dress crafted in Dar es Salaam.',
    ].join('\n');
    const skuMatchPreview = validateAndPreviewCsvProducts(skuMatchCsv, 'sup_1', 'uid_1', 'Atelier', 'Tanzania', [
      { fileName: 'SKU-10_front.jpg', url: '/api/media/products/img_sku10_1', mimeType: 'image/jpeg' },
      { fileName: 'SKU-10_back.jpg', url: '/api/media/products/img_sku10_2', mimeType: 'image/jpeg' },
    ]);
    assert.equal(skuMatchPreview.errorCount, 0, 'SKU-matched local images pass validation');
    assert.equal(skuMatchPreview.validCount, 1);
    assert.deepEqual(skuMatchPreview.validProducts[0].images, [
      '/api/media/products/img_sku10_1',
      '/api/media/products/img_sku10_2',
    ]);
    assert.equal(skuMatchPreview.validProducts[0].status, 'PENDING_APPROVAL');
    assert.equal(skuMatchPreview.validProducts[0].isPublished, false);

    // Storefront visibility rules
    const sampleProd = Object.values(store.products)[0];
    assert.equal(isProductLiveOnStorefront({ ...sampleProd, status: 'DRAFT', isPublished: false } as Product), false);
    assert.equal(isProductLiveOnStorefront({ ...sampleProd, status: 'PENDING_APPROVAL', isPublished: false } as Product), false);
    assert.equal(isProductLiveOnStorefront({ ...sampleProd, status: 'REJECTED', isPublished: false } as Product), false);
    assert.equal(isProductLiveOnStorefront({ ...sampleProd, status: 'CHANGES_REQUESTED', isPublished: false } as Product), false);
    assert.equal(isProductLiveOnStorefront({ ...sampleProd, status: 'APPROVED', isPublished: false } as Product), false);
    assert.equal(isProductLiveOnStorefront({ ...sampleProd, status: 'PUBLISHED', isPublished: true } as Product), true);
    assert.equal(isProductLiveOnStorefront({ ...sampleProd, status: 'APPROVED', isPublished: undefined } as Product), true);

    // 8. Activity Tracking, Personalized Recommendations & Analytics Isolation
    const liveProds = Object.values(store.products).filter((p) => isProductLiveOnStorefront(p) && p.totalStock > 0);
    const primaryProd = liveProds[0];
    assert.ok(primaryProd, 'At least one live product available for recommendation tests');

    // Add an unpublished & out-of-stock product to ensure recommendations strictly exclude them
    const draftHiddenProd: Product = {
      ...primaryProd,
      id: 'prod_test_hidden_draft',
      title: 'Hidden Draft Garment',
      status: 'DRAFT',
      isPublished: false,
      totalStock: 10,
    };
    const zeroStockProd: Product = {
      ...primaryProd,
      id: 'prod_test_zero_stock',
      title: 'Sold Out Garment',
      status: 'PUBLISHED',
      isPublished: true,
      totalStock: 0,
      variants: [{ sku: 'ZERO-1', size: 'M', color: 'Black', stock: 0 }],
    };
    store.products[draftHiddenProd.id] = draftHiddenProd;
    store.products[zeroStockProd.id] = zeroStockProd;

    await recordActivityEvent(store, {
      userId: customerActor.uid,
      type: 'product_view',
      productId: primaryProd.id,
      supplierId: primaryProd.supplierId,
      category: primaryProd.category,
      gender: primaryProd.gender,
      priceUsd: primaryProd.sellingPriceUsd,
    });
    const pref = await rebuildUserPreferenceProfile(store, customerActor.uid);
    assert.ok(pref.favoriteCategories.some((c) => c.category === primaryProd.category), 'Preference profile learns viewed category');

    const recSet = await getRecommendationsForUser(store, {
      userId: customerActor.uid,
      anchorProductId: primaryProd.id,
    });
    const allRecIds = new Set([
      ...recSet.recommendedForYou.map((p) => p.id),
      ...recSet.similarProducts.map((p) => p.id),
      ...recSet.becauseYouViewed.products.map((p) => p.id),
      ...recSet.recentlyViewed.map((p) => p.id),
      ...recSet.trendingInCategory.products.map((p) => p.id),
      ...recSet.youMayAlsoLike.map((p) => p.id),
    ]);
    assert.equal(allRecIds.has(draftHiddenProd.id), false, 'Draft products never recommended');
    assert.equal(allRecIds.has(zeroStockProd.id), false, 'Out-of-stock products never recommended');

    // Opting out of personalization clears preference profile cleanly
    await upsertUser({ ...customerActor, personalizationEnabled: false });
    const clearedPref = await rebuildUserPreferenceProfile(store, customerActor.uid);
    assert.equal(clearedPref.personalizationEnabled, false);
    assert.equal(clearedPref.favoriteCategories.length, 0);
    assert.equal(clearedPref.recentlyViewedProductIds.length, 0);

    // Analytics & Supplier Isolation check
    const adminBi = computeAdminAnalytics(store, 'monthly');
    assert.ok(adminBi.totalOrdersCount >= 2);
    assert.ok(adminBi.productViewsCount >= 1);

    const supA = computeSupplierAnalytics(store, 'sup_kariakoo_atelier', 'monthly');
    const supB = computeSupplierAnalytics(store, 'sup_non_existent_isolated', 'monthly');
    assert.ok(supA.totalOrders >= 1, 'Supplier A sees its own suborders');
    assert.equal(supB.totalOrders, 0, 'Unrelated supplier never sees Supplier A orders');
    assert.equal(supB.grossSalesUsd, 0, 'Unrelated supplier never sees Supplier A revenue');
    assert.equal(supB.totalProductViews, 0, 'Unrelated supplier never sees Supplier A views');

    delete store.products[draftHiddenProd.id];
    delete store.products[zeroStockProd.id];

    // 7. Support Assistant honest error/unavailability & bilingual language detection
    const { generateSupportAssistantReply } = await import('../src/server/gemini-service.ts');
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const swOffline = await generateSupportAssistantReply({
        question: 'Je, mnapokea malipo ya M-Pesa?',
        history: [],
        groundedContext: 'M-Pesa Tanzania: 0795023200',
        language: 'en',
      });
      assert.equal(swOffline.unavailable, true);
      assert.equal(swOffline.aiPowered, false);
      assert.equal(swOffline.replyLanguage, 'sw');
      assert.ok(swOffline.reply.includes('Samahani, huduma ya AI haipatikani kwa sasa'));

      const enOffline = await generateSupportAssistantReply({
        question: 'Do you sell jeans?',
        history: [],
        groundedContext: 'Raw Indigo Wide-Leg Selvedge Jeans',
        language: 'sw',
      });
      assert.equal(enOffline.unavailable, true);
      assert.equal(enOffline.replyLanguage, 'en');
      assert.ok(enOffline.reply.includes('AI assistant service is currently unavailable'));
    } finally {
      if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    }

    // 9. Super Admin Bootstrap Security, Non-Secret Status & RBAC Guard Verification
    const prevBootstrapPw = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    try {
      delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
      const missingRes = await bootstrapSuperAdmin({ forceRetry: true });
      assert.equal(missingRes.attempted, false);
      assert.equal(missingRes.configured, false);
      assert.equal(missingRes.adminEmail, 'mahelaissa1@gmail.com');

      process.env.ADMIN_BOOTSTRAP_PASSWORD = 'Abc1!';
      const weakRes = await bootstrapSuperAdmin({ forceRetry: true });
      assert.equal(weakRes.errorCode, 'weak-bootstrap-password');
      assert.equal(weakRes.configured, false);

      const statusSnap = await getAdminBootstrapStatus();
      assert.equal(statusSnap.adminEmail, 'mahelaissa1@gmail.com');
      const serialized = JSON.stringify(statusSnap);
      assert.equal(serialized.includes('Abc1!'), false, 'Bootstrap status never exposes secret values');
    } finally {
      if (prevBootstrapPw !== undefined) {
        process.env.ADMIN_BOOTSTRAP_PASSWORD = prevBootstrapPw;
      } else {
        delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
      }
    }

    // RBAC payment verification permission checks
    assert.equal(hasPaymentVerificationAccess(adminActor), true);
    assert.equal(hasPaymentVerificationAccess(customerActor), false);
    assert.equal(
      hasPaymentVerificationAccess({
        ...customerActor,
        role: 'staff',
        permissions: { canVerifyPayments: true },
      }),
      true
    );
    assert.equal(
      hasPaymentVerificationAccess({
        ...customerActor,
        role: 'staff',
        permissions: { canVerifyPayments: false },
      }),
      false
    );
    assert.equal(
      hasPaymentVerificationAccess({
        ...adminActor,
        status: 'suspended',
      }),
      false,
      'Suspended admins cannot access payment verification'
    );

    // 10. Retention Policy Normalization, Checksummed Backups, Media Integrity, Sync Diagnostics & Mutex Lock
    const normPolicy = normalizeRetentionPolicy({
      auditLogRetentionDays: 3000,
      notificationRetentionDays: 180,
      maxBackupSnapshots: 20,
      autoBackupEnabled: false,
      anonymizeOrdersOnErasure: true,
    });
    assert.equal(normPolicy.auditLogsDays, 3000);
    assert.equal(normPolicy.auditLogRetentionDays, 3000);
    assert.equal(normPolicy.notificationsDays, 180);
    assert.equal(normPolicy.notificationRetentionDays, 180);
    assert.equal(normPolicy.backupsKeepCount, 20);
    assert.equal(normPolicy.maxBackupSnapshots, 20);
    assert.equal(normPolicy.autoBackupEnabled, false);

    const mediaReport = verifyProductMediaIntegrity(store);
    assert.equal(typeof mediaReport.totalMetadataRecords, 'number');
    assert.equal(typeof mediaReport.presentOnDisk, 'number');

    const syncDiag = getSyncDiagnostics();
    assert.ok(['connected', 'degraded', 'offline_fallback', 'unconfigured'].includes(syncDiag.status));
    const persistenceInfo = getLocalPersistenceInfo();
    assert.equal(typeof persistenceInfo.localDataDir, 'string');

    // Mutex lock guarantees strict sequential execution order under concurrent calls
    const lockOrder: string[] = [];
    await Promise.all([
      withStoreLock(async () => {
        lockOrder.push('start_1');
        await new Promise((r) => setTimeout(r, 15));
        lockOrder.push('end_1');
      }),
      withStoreLock(async () => {
        lockOrder.push('start_2');
        lockOrder.push('end_2');
      }),
    ]);
    assert.deepEqual(lockOrder, ['start_1', 'end_1', 'start_2', 'end_2'], 'withStoreLock serializes concurrent mutations');

    // Checksummed backup creation & SHA-256 verification
    const createdBak = await createStoreBackup({
      actor: adminActor,
      reason: 'Automated unit test snapshot',
      trigger: 'manual',
    });
    try {
      assert.equal(createdBak.meta.trigger, 'manual');
      const archive = readBackupArchive(createdBak.meta.id);
      assert.ok(archive !== null && archive.meta.sha256 === createdBak.meta.sha256);
      const latestCheck = verifyLatestBackupChecksum(await getStore());
      assert.equal(latestCheck.valid, true);
    } finally {
      const bakPath = path.join(BACKUPS_DIR, createdBak.meta.fileName);
      if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
    }

    // 11. Persistent Cart Sync, Newsletter Subscribers, Storage Diagnostics & Telemetry Redaction
    const savedCart = await upsertCartForUser(customerActor.uid, [
      {
        productId: primaryProd.id,
        supplierId: primaryProd.supplierId,
        supplierName: primaryProd.supplierName,
        title: primaryProd.title,
        sku: primaryProd.variants[0].sku,
        size: primaryProd.variants[0].size,
        color: primaryProd.variants[0].color,
        quantity: 2,
        unitPriceUsd: primaryProd.sellingPriceUsd,
        wholesalePriceUsd: primaryProd.wholesalePriceUsd,
        shippingFeeUsd: primaryProd.shippingFeeUsd,
        shippingOriginCountry: primaryProd.shippingOriginCountry,
        image: primaryProd.images[0],
        estimatedDaysMin: primaryProd.estimatedDaysMin,
        estimatedDaysMax: primaryProd.estimatedDaysMax,
      },
    ]);
    assert.equal(savedCart.uid, customerActor.uid);
    assert.equal(savedCart.items.length, 1);
    assert.equal(store.carts[customerActor.uid]?.items[0]?.quantity, 2);

    const nlSub = await upsertNewsletterSubscriber({
      email: 'Subscriber.Test@Example.com',
      market: 'Tanzania',
      createdAt: now,
    });
    assert.equal(nlSub.email, 'subscriber.test@example.com');
    assert.ok(store.newsletterSubscribers.some((s) => s.email === 'subscriber.test@example.com'));

    const savedReceiptMeta = await savePaymentReceiptFile(
      'test_ord_vault',
      'sub_vault_001',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
    );
    assert.ok(savedReceiptMeta && savedReceiptMeta.storagePath.includes('receipts/test_ord_vault/sub_vault_001.png'));

    const storageDiag = getStorageDiagnostics();
    assert.ok(Boolean(storageDiag.bucket), 'Firebase Storage bucket configured in diagnostics');
    assert.ok(['connected', 'offline_fallback', 'degraded'].includes(storageDiag.status));

    recordApiRequestMetric(42, 200);
    recordSystemError('unit_test', 'Auth failed with Bearer secret_token_12345 and key=AIzaSySecretKey123');
    const metricsSnap = getSystemMetricsSnapshot();
    assert.ok(metricsSnap.apiMetrics.totalRequests >= 1);
    const serializedMetrics = JSON.stringify(metricsSnap);
    assert.equal(serializedMetrics.includes('secret_token_12345'), false, 'Bearer tokens redacted from telemetry');
    assert.equal(serializedMetrics.includes('AIzaSySecretKey123'), false, 'API keys redacted from telemetry');

    console.log('All unit, image/receipt vault, cart sync, telemetry redaction, CSV validation, payment, notification, recommendation, BI, RBAC, admin bootstrap, sync, lock, backup & chatbot assertions passed.');
  } finally {
    // Clean up temporary test receipt files & restore original store snapshot on disk
    fs.rmSync(path.join(PAYMENT_RECEIPTS_DIR, 'test_ord_1'), { recursive: true, force: true });
    fs.rmSync(path.join(PAYMENT_RECEIPTS_DIR, 'test_ord_vault'), { recursive: true, force: true });
    if (hadDataFile && prevBackup !== null) {
      fs.writeFileSync(dataFile, prevBackup, 'utf-8');
    } else if (fs.existsSync(dataFile)) {
      fs.unlinkSync(dataFile);
    }
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
