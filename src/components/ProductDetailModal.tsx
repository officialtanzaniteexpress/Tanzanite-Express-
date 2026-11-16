import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Globe, Heart, ShieldCheck, Star, Truck, X, ZoomIn } from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext';
import { apiFetch } from '../lib/api';
import { Review } from '../types/marketplace';
import { SafeImage } from './SafeImage';

export const ProductDetailModal: React.FC = () => {
  const {
    selectedProduct,
    setSelectedProduct,
    products,
    reviews,
    formatMoney,
    t,
    addToCart,
    setIsCartOpen,
    wishlist,
    toggleWishlist,
    firebaseUser,
    openAuthModal,
    refreshBootstrap,
    recommendations,
    refreshRecommendations,
    trackActivity,
    toast,
  } = useMarketplace();

  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedSku, setSelectedSku] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  useEffect(() => {
    if (selectedProduct) {
      setActiveImageIdx(0);
      setLightboxOpen(false);
      setSelectedSku(selectedProduct.variants[0]?.sku || '');
      setQuantity(1);
      void trackActivity({
        type: 'product_view',
        productId: selectedProduct.id,
        supplierId: selectedProduct.supplierId,
        category: selectedProduct.category,
        gender: selectedProduct.gender,
        priceUsd: selectedProduct.sellingPriceUsd,
      });
      void refreshRecommendations(selectedProduct.id);
    }
  }, [selectedProduct?.id]);

  if (!selectedProduct) return null;

  const activeVariant =
    selectedProduct.variants.find((v) => v.sku === selectedSku) ||
    selectedProduct.variants[0];

  const productReviews: Review[] = reviews.filter(
    (r) => r.productId === selectedProduct.id
  );
  const fallbackRelated = products
    .filter(
      (p) =>
        p.id !== selectedProduct.id &&
        (p.category === selectedProduct.category || p.gender === selectedProduct.gender)
    )
    .slice(0, 4);
  const similarProducts =
    recommendations?.similarProducts && recommendations.similarProducts.length > 0
      ? recommendations.similarProducts
      : fallbackRelated;
  const becauseYouViewed =
    recommendations?.becauseYouViewed?.products && recommendations.becauseYouViewed.products.length > 0
      ? recommendations.becauseYouViewed.products
          .filter((p) => p.id !== selectedProduct.id)
          .slice(0, 3)
      : [];
  const becauseYouViewedAnchorTitle = recommendations?.becauseYouViewed?.anchorTitle;

  const handleAdd = (openCartAfter: boolean) => {
    if (!activeVariant || activeVariant.stock < quantity) {
      toast('Selected size/color is out of stock for that quantity.', 'error');
      return;
    }
    addToCart({
      productId: selectedProduct.id,
      supplierId: selectedProduct.supplierId,
      supplierName: selectedProduct.supplierName,
      title: selectedProduct.title,
      image: selectedProduct.images[0],
      sku: activeVariant.sku,
      size: activeVariant.size,
      color: activeVariant.color,
      quantity,
      unitPriceUsd: selectedProduct.sellingPriceUsd,
      wholesalePriceUsd: selectedProduct.wholesalePriceUsd,
      shippingFeeUsd: selectedProduct.shippingFeeUsd,
      estimatedDaysMin: selectedProduct.estimatedDaysMin,
      estimatedDaysMax: selectedProduct.estimatedDaysMax,
      shippingOriginCountry: selectedProduct.shippingOriginCountry,
    });
    if (openCartAfter) {
      setSelectedProduct(null);
      setIsCartOpen(true);
    }
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      openAuthModal('signin');
      toast('Sign in to post a customer review.', 'info');
      return;
    }
    setSubmittingReview(true);
    try {
      await apiFetch('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          productId: selectedProduct.id,
          rating: reviewRating,
          comment: reviewComment,
        }),
      });
      setReviewComment('');
      await refreshBootstrap();
      toast('Review published.', 'success');
    } catch (err: any) {
      toast(err.message || 'Unable to submit review', 'error');
    } finally {
      setSubmittingReview(false);
    }
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: selectedProduct.title,
    brand: { '@type': 'Brand', name: selectedProduct.brand },
    description: selectedProduct.description,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: selectedProduct.sellingPriceUsd,
      availability:
        selectedProduct.totalStock > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
    },
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 overflow-y-auto p-3 sm:p-6 flex justify-center items-start"
      role="dialog"
      aria-modal="true"
      aria-label={selectedProduct.title}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="bg-[#F8F9FC] border border-[#E2E5F0] w-full max-w-5xl my-2 sm:my-4">
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-b border-[#E2E5F0] bg-white">
          <span className="text-xs text-neutral-500 min-w-0 truncate">
            {selectedProduct.gender} · {selectedProduct.category} · {selectedProduct.supplierName}
          </span>
          <button
            type="button"
            onClick={() => setSelectedProduct(null)}
            aria-label="Close product detail"
            className="min-h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center text-neutral-600 hover:text-[#111322] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid lg:grid-cols-12 gap-6 lg:gap-8 p-4 sm:p-8">
          {/* Gallery with Thumbnail Strip & Zoom Lightbox */}
          <div className="lg:col-span-6 min-w-0 space-y-3">
            <div className="relative aspect-[4/3] bg-white border border-[#E2E5F0] overflow-hidden group">
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="w-full h-full block cursor-zoom-in"
                aria-label="Enlarge product image"
              >
                <SafeImage
                  src={selectedProduct.images[activeImageIdx] || selectedProduct.images[0]}
                  alt={selectedProduct.title}
                  className="w-full h-full object-cover"
                />
              </button>

              {selectedProduct.images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveImageIdx(
                        (idx) => (idx - 1 + selectedProduct.images.length) % selectedProduct.images.length
                      )
                    }
                    aria-label="Previous image"
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 bg-white/90 border border-[#E2E5F0] p-2 text-[#111322] hover:bg-white cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveImageIdx((idx) => (idx + 1) % selectedProduct.images.length)
                    }
                    aria-label="Next image"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-white/90 border border-[#E2E5F0] p-2 text-[#111322] hover:bg-white cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="absolute bottom-2.5 right-2.5 bg-white/95 border border-[#E2E5F0] px-2.5 py-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-[#111322] hover:border-[#2B3A9F] cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
                <span className="font-mono-tabular">
                  {activeImageIdx + 1}/{Math.max(1, selectedProduct.images.length)}
                </span>
              </button>
            </div>
            {selectedProduct.images.length > 1 && (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5">
                {selectedProduct.images.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveImageIdx(i)}
                    className={`aspect-[4/3] border overflow-hidden cursor-pointer ${
                      activeImageIdx === i ? 'border-[#2B3A9F] ring-1 ring-[#2B3A9F]' : 'border-[#E2E5F0]'
                    }`}
                  >
                    <SafeImage
                      src={img}
                      alt={`${selectedProduct.title} view ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Contiguous Purchase Module */}
          <div className="lg:col-span-6 min-w-0 flex flex-col justify-between space-y-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-neutral-500">
                {selectedProduct.brand} · Ships from {selectedProduct.shippingOriginCountry}
              </p>
              <h2 className="font-editorial text-2xl sm:text-3xl font-semibold text-[#111322] mt-1 break-words">
                {selectedProduct.title}
              </h2>
              <div className="mt-3 flex items-baseline gap-4">
                <span className="text-2xl font-semibold text-[#111322] tabular-nums">
                  {formatMoney(selectedProduct.sellingPriceUsd)}
                </span>
                {selectedProduct.compareAtPriceUsd && (
                  <span className="text-sm text-neutral-400 line-through tabular-nums">
                    {formatMoney(selectedProduct.compareAtPriceUsd)}
                  </span>
                )}
              </div>

              <p className="mt-4 text-sm text-neutral-700 leading-relaxed">
                {selectedProduct.description}
              </p>

              {(selectedProduct.material || selectedProduct.weightKg !== undefined) && (
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-600">
                  {selectedProduct.material && (
                    <span>
                      Material: <strong className="text-[#111322]">{selectedProduct.material}</strong>
                    </span>
                  )}
                  {selectedProduct.weightKg !== undefined && (
                    <span>
                      Weight: <strong className="text-[#111322] tabular-nums">{selectedProduct.weightKg} kg</strong>
                    </span>
                  )}
                </div>
              )}

              {/* Variants */}
              <div className="mt-6">
                <label className="block text-xs font-medium text-[#111322] mb-2">
                  {t('selectVariant')}
                </label>
                <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 gap-2">
                  {selectedProduct.variants.map((v) => (
                    <button
                      key={v.sku}
                      type="button"
                      disabled={v.stock <= 0}
                      onClick={() => setSelectedSku(v.sku)}
                      className={`px-3 py-2 text-xs border text-left transition-colors cursor-pointer ${
                        activeVariant?.sku === v.sku
                          ? 'border-[#2B3A9F] bg-[#2B3A9F] text-white'
                          : 'border-[#E2E5F0] bg-white text-[#111322] hover:border-[#2B3A9F]'
                      } ${v.stock <= 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <div className="font-medium">
                        {v.size} · {v.color}
                      </div>
                      <div className="text-[11px] opacity-80 tabular-nums">
                        {v.stock > 0 ? `${v.stock} ${t('available')}` : t('soldOut')}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity & Actions */}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <div className="flex items-center border border-[#E2E5F0] bg-white">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="px-3 py-2.5 text-xs font-medium cursor-pointer"
                  >
                    −
                  </button>
                  <span className="px-3 py-2.5 text-xs font-medium tabular-nums">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setQuantity((q) => Math.min(activeVariant?.stock || 1, q + 1))
                    }
                    className="px-3 py-2.5 text-xs font-medium cursor-pointer"
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleAdd(false)}
                  className="flex-1 min-w-[130px] min-h-[44px] bg-[#2B3A9F] text-white px-5 py-3 text-xs font-semibold uppercase tracking-wide hover:bg-[#5B3CC4] transition-colors cursor-pointer"
                >
                  {t('addToBag')}
                </button>
                <button
                  type="button"
                  onClick={() => handleAdd(true)}
                  className="min-h-[44px] border border-[#111322] bg-white text-[#111322] px-5 py-3 text-xs font-semibold uppercase tracking-wide hover:bg-[#EEF2FF] transition-colors cursor-pointer"
                >
                  {t('buyNow')}
                </button>
                <button
                  type="button"
                  onClick={() => toggleWishlist(selectedProduct.id)}
                  aria-label="Wishlist"
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-3 border border-[#E2E5F0] bg-white hover:border-[#2B3A9F] cursor-pointer"
                >
                  <Heart
                    className={`w-4 h-4 ${
                      wishlist.includes(selectedProduct.id)
                        ? 'fill-[#5B3CC4] text-[#5B3CC4]'
                        : ''
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Verified Logistics & Return Info */}
            <div className="border-t border-[#E2E5F0] pt-4 space-y-2.5 text-xs text-neutral-600">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#2B3A9F]" />
                <span>
                  {t('estDelivery')}: {selectedProduct.estimatedDaysMin}–
                  {selectedProduct.estimatedDaysMax} {t('businessDays')} · {t('baseShipping')}{' '}
                  {formatMoney(selectedProduct.shippingFeeUsd)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#2B3A9F]" />
                <span>
                  {t('destinations')}: {selectedProduct.shippingDestinations.join(', ')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#5B3CC4]" />
                <span>{t('returns')}: {selectedProduct.returnPolicySummary}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Reviews & Related */}
        <div className="border-t border-[#E2E5F0] bg-white p-4 sm:p-8 grid lg:grid-cols-12 gap-6 lg:gap-8">
          <div className="lg:col-span-7 min-w-0">
            <h3 className="font-editorial text-2xl font-semibold text-[#111322]">
              {t('customerReviews')} ({productReviews.length})
            </h3>
            {productReviews.length === 0 ? (
              <p className="text-xs text-neutral-500 mt-2">
                {t('noReviewsYet')}
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {productReviews.map((rev) => (
                  <div key={rev.id} className="border border-[#E2E5F0] p-4 bg-[#F8F9FC]">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1 text-[#5B3CC4]">
                        {Array.from({ length: rev.rating }).map((_, idx) => (
                          <Star key={idx} className="w-3 h-3 fill-current" />
                        ))}
                      </div>
                      <span className="text-neutral-500">
                        {rev.verifiedPurchase ? 'Verified Purchase' : 'Customer'}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-800 mt-2">{rev.comment}</p>
                    <p className="text-xs text-neutral-500 mt-2">{rev.customerName}</p>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleReviewSubmit} className="mt-6 border-t border-[#E2E5F0] pt-5 space-y-3">
              <p className="text-xs font-semibold text-[#111322]">{t('leaveReview')}</p>
              <div className="flex flex-wrap sm:flex-nowrap items-stretch gap-2">
                <select
                  value={reviewRating}
                  onChange={(e) => setReviewRating(Number(e.target.value))}
                  className="border border-[#E2E5F0] px-2.5 min-h-[40px] py-1.5 text-xs bg-[#F8F9FC]"
                >
                  {[5, 4, 3, 2, 1].map((r) => (
                    <option key={r} value={r}>
                      {r} ★
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="..."
                  className="flex-1 min-w-[140px] min-h-[40px] border border-[#E2E5F0] px-3 py-1.5 text-xs"
                />
                <button
                  type="submit"
                  disabled={submittingReview}
                  className="w-full sm:w-auto min-h-[40px] bg-[#2B3A9F] text-white px-4 py-1.5 text-xs font-medium cursor-pointer shrink-0"
                >
                  {t('postReview')}
                </button>
              </div>
            </form>
          </div>

          <div className="lg:col-span-5 min-w-0 space-y-6">
            <div>
              <h3 className="font-editorial text-2xl font-semibold text-[#111322]">
                {t('similarProducts')}
              </h3>
              <div className="mt-4 space-y-3">
                {similarProducts.map((rel) => (
                  <button
                    key={rel.id}
                    type="button"
                    onClick={() => {
                      void trackActivity({
                        type: 'recommendation_click',
                        productId: rel.id,
                        supplierId: rel.supplierId,
                        source: 'product_detail_similar',
                      });
                      setSelectedProduct(rel);
                    }}
                    className="w-full text-left flex items-center gap-3 border border-[#E2E5F0] p-2.5 hover:bg-[#F8F9FC] cursor-pointer"
                  >
                    <div className="w-16 h-12 bg-[#EEF2FF] shrink-0 overflow-hidden">
                      <SafeImage
                        src={rel.images[0]}
                        alt={rel.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[#111322] truncate">{rel.title}</p>
                      <p className="text-xs text-[#2B3A9F] font-semibold tabular-nums">
                        {formatMoney(rel.sellingPriceUsd)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {becauseYouViewed.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#5B3CC4]">
                  {t('becauseYouViewed')}
                  {becauseYouViewedAnchorTitle ? ` · ${becauseYouViewedAnchorTitle}` : ''}
                </h4>
                <div className="mt-2.5 space-y-2">
                  {becauseYouViewed.map((rel) => (
                    <button
                      key={rel.id}
                      type="button"
                      onClick={() => {
                        void trackActivity({
                          type: 'recommendation_click',
                          productId: rel.id,
                          supplierId: rel.supplierId,
                          source: 'because_you_viewed',
                        });
                        setSelectedProduct(rel);
                      }}
                      className="w-full text-left flex items-center gap-3 border border-[#E2E5F0] p-2 hover:bg-[#F8F9FC] cursor-pointer"
                    >
                      <div className="w-12 h-10 bg-[#EEF2FF] shrink-0 overflow-hidden">
                        <SafeImage
                          src={rel.images[0]}
                          alt={rel.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-[#111322] truncate">{rel.title}</p>
                        <p className="text-[11px] text-neutral-500 tabular-nums">
                          {formatMoney(rel.sellingPriceUsd)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen Lightbox Zoom Modal */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            aria-label="Close zoom viewer"
            className="absolute top-4 right-4 bg-white p-2 text-[#111111] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div
            className="relative max-w-5xl w-full max-h-[82vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {selectedProduct.images.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setActiveImageIdx(
                    (idx) => (idx - 1 + selectedProduct.images.length) % selectedProduct.images.length
                  )
                }
                aria-label="Previous zoomed image"
                className="absolute left-2 bg-white/90 p-2.5 text-[#111111] cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}

            <SafeImage
              src={selectedProduct.images[activeImageIdx] || selectedProduct.images[0]}
              alt={`${selectedProduct.title} enlarged`}
              className="max-w-full max-h-[80vh] object-contain"
            />

            {selectedProduct.images.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setActiveImageIdx((idx) => (idx + 1) % selectedProduct.images.length)
                }
                aria-label="Next zoomed image"
                className="absolute right-2 bg-white/90 p-2.5 text-[#111111] cursor-pointer"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>

          {selectedProduct.images.length > 1 && (
            <p className="text-xs text-neutral-300 mt-3 font-mono-tabular">
              Image {activeImageIdx + 1} of {selectedProduct.images.length} · {selectedProduct.title}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
