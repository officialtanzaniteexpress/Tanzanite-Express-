import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Globe,
  Heart,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Truck,
} from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext';
import { apiFetch } from '../lib/api';
import { Product } from '../types/marketplace';
import { PWAInstallButton } from './PWAInstallButton';
import { SafeImage } from './SafeImage';
import { TanzaniteLogo } from './TanzaniteBrand';

interface StorefrontViewProps {
  genderFilter: 'ALL' | 'MEN' | 'WOMEN';
  setGenderFilter: (g: 'ALL' | 'MEN' | 'WOMEN') => void;
}

export const StorefrontView: React.FC<StorefrontViewProps> = ({
  genderFilter,
  setGenderFilter,
}) => {
  const {
    isDevelopmentMode,
    settings,
    language,
    t,
    categories,
    suppliers,
    products,
    reviews,
    formatMoney,
    wishlist,
    toggleWishlist,
    setSelectedProduct,
    setActivePage,
    toast,
    loadingStorefront,
    recommendations,
    trackActivity,
  } = useMarketplace();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedCountry, setSelectedCountry] = useState('ALL');
  const [selectedSupplierId, setSelectedSupplierId] = useState('ALL');
  const [selectedSize, setSelectedSize] = useState('ALL');
  const [selectedColor, setSelectedColor] = useState('ALL');
  const [maxPriceUsd, setMaxPriceUsd] = useState<number>(300);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [collectionTab, setCollectionTab] = useState<'ALL' | 'NEW' | 'BEST' | 'FEATURED'>('ALL');
  const [showFilters, setShowFilters] = useState(false);

  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [submittingNewsletter, setSubmittingNewsletter] = useState(false);

  const lastTrackedSearchRef = useRef('');
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 3 || trimmed === lastTrackedSearchRef.current) return;
    const timer = window.setTimeout(() => {
      lastTrackedSearchRef.current = trimmed;
      void trackActivity({ type: 'search', query: trimmed });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [searchQuery, trackActivity]);

  const availableCategories = useMemo(() => {
    if (genderFilter === 'MEN') return categories.MEN;
    if (genderFilter === 'WOMEN') return categories.WOMEN;
    return Array.from(new Set([...categories.MEN, ...categories.WOMEN]));
  }, [categories, genderFilter]);

  const allCountries = useMemo(
    () => Array.from(new Set(products.map((p) => p.shippingOriginCountry))),
    [products]
  );

  const allSizes = useMemo(
    () => Array.from(new Set(products.flatMap((p) => p.variants.map((v) => v.size)))),
    [products]
  );

  const allColors = useMemo(
    () => Array.from(new Set(products.flatMap((p) => p.variants.map((v) => v.color)))),
    [products]
  );

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (genderFilter !== 'ALL' && p.gender !== genderFilter && p.gender !== 'UNISEX') {
        return false;
      }
      if (selectedCategory !== 'ALL' && p.category !== selectedCategory) return false;
      if (selectedCountry !== 'ALL' && p.shippingOriginCountry !== selectedCountry) return false;
      if (selectedSupplierId !== 'ALL' && p.supplierId !== selectedSupplierId) return false;
      if (p.sellingPriceUsd > maxPriceUsd) return false;
      if (inStockOnly && p.totalStock <= 0) return false;
      if (minRating > 0 && p.ratingAvg < minRating) return false;
      if (collectionTab === 'NEW' && !p.isNewArrival) return false;
      if (collectionTab === 'BEST' && !p.isBestSeller) return false;
      if (collectionTab === 'FEATURED' && !p.featured) return false;
      if (selectedSize !== 'ALL' && !p.variants.some((v) => v.size === selectedSize)) return false;
      if (selectedColor !== 'ALL' && !p.variants.some((v) => v.color === selectedColor)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          p.title.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.supplierName.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [
    products,
    genderFilter,
    selectedCategory,
    selectedCountry,
    selectedSupplierId,
    maxPriceUsd,
    inStockOnly,
    minRating,
    collectionTab,
    selectedSize,
    selectedColor,
    searchQuery,
  ]);

  const handleNewsletterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newsletterEmail.trim()) return;
    setSubmittingNewsletter(true);
    try {
      await apiFetch('/api/newsletter/subscribe', {
        method: 'POST',
        body: JSON.stringify({ email: newsletterEmail }),
      });
      toast('Subscribed to TANZANITE EXPRESS dispatches.', 'success');
      setNewsletterEmail('');
    } catch (err: any) {
      toast(err.message || 'Subscription failed', 'error');
    } finally {
      setSubmittingNewsletter(false);
    }
  };

  const handleCategoryClick = (cat: string) => {
    setSelectedCategory(cat);
    if (cat !== 'ALL') {
      void trackActivity({
        type: 'category_visit',
        category: cat,
        gender: genderFilter === 'ALL' ? undefined : genderFilter,
      });
    }
  };

  const handleRecommendationSelect = (product: Product, source: string) => {
    void trackActivity({
      type: 'recommendation_click',
      productId: product.id,
      supplierId: product.supplierId,
      category: product.category,
      gender: product.gender,
      source,
    });
    setSelectedProduct(product);
  };

  const recommendedShelf = recommendations?.recommendedForYou || [];
  const trendingShelf = recommendations?.trendingInCategory?.products || [];
  const recentlyViewedShelf = recommendations?.recentlyViewed || [];

  return (
    <main className="min-h-screen">
      {/* Development Mode Transparency Notice */}
      {isDevelopmentMode && (
        <div className="bg-[#EEF2FF] border-b border-[#E2E5F0] px-4 sm:px-8 py-2 text-xs text-neutral-700">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>{t('devBannerNotice')}</span>
            <button
              type="button"
              onClick={() => setActivePage('supplier')}
              className="font-semibold text-[#2B3A9F] underline underline-offset-4 cursor-pointer"
            >
              {t('onboardSupplierCta')}
            </button>
          </div>
        </div>
      )}

      {/* 1. Editorial Hero Showcase */}
      <section className="relative bg-[#111322] text-white overflow-hidden">
        <div className="max-w-[1440px] mx-auto grid lg:grid-cols-12 items-stretch lg:min-h-[600px]">
          <div className="lg:col-span-5 min-w-0 px-4 sm:px-10 lg:px-12 py-10 sm:py-14 lg:py-20 flex flex-col justify-center z-10">
            <p className="text-xs uppercase tracking-[0.18em] text-[#A5B4FC] mb-3 sm:mb-4">
              {t('heroKicker')}
            </p>
            <h1 className="font-editorial text-[clamp(1.85rem,6vw,3.75rem)] font-normal leading-[1.08] tracking-tight text-balance break-words">
              {(language === 'sw' ? settings?.heroTitleSw : settings?.heroTitle) ||
                'Fashion You Love, Delivered to You'}
            </h1>
            <p className="mt-4 sm:mt-5 text-sm sm:text-base text-neutral-300 leading-relaxed max-w-md">
              {(language === 'sw' ? settings?.heroSubtitleSw : settings?.heroSubtitle) ||
                'Connecting independent Tanzanian ateliers and vetted international fashion suppliers directly to your wardrobe.'}
            </p>
            <div className="mt-6 sm:mt-8 flex flex-wrap items-center gap-3 sm:gap-4">
              <button
                type="button"
                onClick={() =>
                  document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' })
                }
                className="inline-flex items-center justify-center gap-2 bg-[#2B3A9F] text-white px-5 sm:px-6 min-h-[44px] py-3 text-xs font-semibold tracking-wide uppercase hover:bg-[#5B3CC4] transition-colors cursor-pointer"
              >
                <span>
                  {(language === 'sw' ? settings?.heroCtaTextSw : settings?.heroCtaText) ||
                    t('exploreCollections')}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setActivePage('supplier')}
                className="inline-flex items-center justify-center gap-2 border border-neutral-500 px-5 min-h-[44px] py-3 text-xs font-medium text-neutral-100 hover:border-white hover:text-white transition-colors cursor-pointer"
              >
                {t('becomeSupplier')}
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 min-w-0 relative min-h-[220px] sm:min-h-[340px] lg:min-h-full">
            <SafeImage
              src="/src/assets/images/hero_fashion_editorial_1794751434706.jpg"
              alt="TANZANITE EXPRESS editorial tailoring campaign"
              className="w-full h-full object-cover lg:absolute lg:inset-0"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#111322] via-[#111322]/35 to-transparent lg:block hidden" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#111322]/70 via-transparent to-transparent lg:hidden" />
          </div>
        </div>
      </section>

      {/* Dual-Market Editorial Split Strip */}
      <section className="border-b border-[#E2E5F0] bg-white">
        <div className="max-w-[1440px] mx-auto grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#E2E5F0]">
          <button
            type="button"
            onClick={() => {
              setGenderFilter('MEN');
              setSelectedCategory('ALL');
              void trackActivity({ type: 'category_visit', gender: 'MEN' });
              document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="group text-left p-4 sm:p-8 flex items-center gap-3.5 sm:gap-6 hover:bg-[#F8F9FC] transition-colors cursor-pointer min-w-0"
          >
            <div className="w-16 h-16 sm:w-24 sm:h-24 shrink-0 overflow-hidden bg-[#EEF2FF]">
              <SafeImage
                src="/src/assets/images/cat_mens_tailoring_1794751435522.jpg"
                alt={t('shopMensCollection')}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-neutral-500">{t('mensSub')}</p>
              <h2 className="font-editorial text-xl sm:text-2xl font-semibold text-[#111322] mt-1">
                {t('shopMensCollection')}
              </h2>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2B3A9F] mt-2">
                {t('browseMenswear')} <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setGenderFilter('WOMEN');
              setSelectedCategory('ALL');
              void trackActivity({ type: 'category_visit', gender: 'WOMEN' });
              document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="group text-left p-4 sm:p-8 flex items-center gap-3.5 sm:gap-6 hover:bg-[#F8F9FC] transition-colors cursor-pointer min-w-0"
          >
            <div className="w-16 h-16 sm:w-24 sm:h-24 shrink-0 overflow-hidden bg-[#EEF2FF]">
              <SafeImage
                src="/src/assets/images/cat_womens_atelier_1794751435891.jpg"
                alt={t('shopWomensCollection')}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-neutral-500">{t('womensSub')}</p>
              <h2 className="font-editorial text-xl sm:text-2xl font-semibold text-[#111322] mt-1">
                {t('shopWomensCollection')}
              </h2>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5B3CC4] mt-2">
                {t('browseWomenswear')} <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </button>
        </div>
      </section>

      {/* Personalized Recommendation Shelves (Live Published Products Only) */}
      {(recommendedShelf.length > 0 || recentlyViewedShelf.length > 0 || trendingShelf.length > 0) && (
        <section className="max-w-[1440px] mx-auto px-4 sm:px-8 pt-10 space-y-8">
          {recommendedShelf.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#5B3CC4]" />
                  <h2 className="font-editorial text-2xl font-semibold text-[#111322]">
                    {t('recommendedForYou')}
                  </h2>
                </div>
                <span className="text-[11px] text-neutral-500 uppercase tracking-wider">
                  {t('curatedEdit')}
                </span>
              </div>
              <div className="grid grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                {recommendedShelf.slice(0, 4).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleRecommendationSelect(item, 'recommended_for_you')}
                    className="group text-left bg-white border border-[#E2E5F0] hover:border-[#2B3A9F] transition-colors cursor-pointer flex flex-col"
                  >
                    <div className="aspect-[4/3] bg-[#F8F9FC] overflow-hidden">
                      <SafeImage
                        src={item.images[0]}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <div className="p-3.5">
                      <p className="text-[10px] uppercase tracking-wider text-[#5B3CC4]">
                        {item.category}
                      </p>
                      <p className="text-xs font-semibold text-[#111322] line-clamp-1 mt-0.5">
                        {item.title}
                      </p>
                      <p className="text-xs font-semibold text-[#2B3A9F] tabular-nums mt-1">
                        {formatMoney(item.sellingPriceUsd)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {recentlyViewedShelf.length > 0 && (
            <div>
              <h2 className="font-editorial text-xl font-semibold text-[#111322] mb-3">
                {t('recentlyViewed')}
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {recentlyViewedShelf.slice(0, 6).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleRecommendationSelect(item, 'recently_viewed')}
                    className="w-44 shrink-0 text-left bg-white border border-[#E2E5F0] hover:border-[#2B3A9F] p-2.5 cursor-pointer"
                  >
                    <div className="aspect-[4/3] bg-[#F8F9FC] overflow-hidden mb-2">
                      <SafeImage
                        src={item.images[0]}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <p className="text-xs font-medium text-[#111322] line-clamp-1">{item.title}</p>
                    <p className="text-[11px] font-semibold text-[#2B3A9F] tabular-nums mt-0.5">
                      {formatMoney(item.sellingPriceUsd)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {trendingShelf.length > 0 && recommendedShelf.length === 0 && (
            <div>
              <h2 className="font-editorial text-2xl font-semibold text-[#111322] mb-4">
                {t('trendingInCategory')}
                {recommendations?.trendingInCategory?.category
                  ? ` · ${recommendations.trendingInCategory.category}`
                  : ''}
              </h2>
              <div className="grid grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                {trendingShelf.slice(0, 4).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleRecommendationSelect(item, 'trending_now')}
                    className="group text-left bg-white border border-[#E2E5F0] hover:border-[#2B3A9F] transition-colors cursor-pointer"
                  >
                    <div className="aspect-[4/3] bg-[#F8F9FC] overflow-hidden">
                      <SafeImage
                        src={item.images[0]}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-3.5">
                      <p className="text-xs font-semibold text-[#111322] line-clamp-1">
                        {item.title}
                      </p>
                      <p className="text-xs font-semibold text-[#2B3A9F] tabular-nums mt-1">
                        {formatMoney(item.sellingPriceUsd)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 2. Featured Collection & Multi-Faceted Catalog */}
      <section id="catalog-section" className="max-w-[1440px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 border-b border-[#E2E5F0]">
          <div>
            <p className="text-xs text-[#5B3CC4] uppercase tracking-[0.14em] font-semibold">
              {t('curatedEdit')}
            </p>
            <h2 className="font-editorial text-3xl sm:text-4xl font-semibold text-[#111322] mt-1">
              {genderFilter === 'ALL'
                ? t('allMarketplace')
                : genderFilter === 'MEN'
                  ? t('mensEditorial')
                  : t('womensEditorial')}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 w-full lg:w-auto min-w-0">
            <div className="w-full sm:w-auto max-w-full overflow-x-auto flex items-center gap-1 p-1 bg-[#EEF2FF] border border-[#E2E5F0]">
              {(['ALL', 'NEW', 'BEST', 'FEATURED'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setCollectionTab(tab)}
                  className={`px-3 py-1.5 min-h-[36px] text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    collectionTab === tab
                      ? 'bg-[#2B3A9F] text-white shadow-xs'
                      : 'text-neutral-700 hover:text-[#111322]'
                  }`}
                >
                  {tab === 'ALL'
                    ? t('allItems')
                    : tab === 'NEW'
                      ? t('newArrivals')
                      : tab === 'BEST'
                        ? t('bestSellers')
                        : t('featured')}
                </button>
              ))}
            </div>

            <div className="relative w-full min-[420px]:w-auto min-[420px]:flex-1 sm:flex-initial min-w-0">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="pl-8 pr-3 py-2 min-h-[40px] text-xs bg-white border border-[#E2E5F0] w-full sm:w-64 focus:outline-none focus:border-[#2B3A9F]"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowFilters((f) => !f)}
              className="inline-flex items-center justify-center gap-1.5 border border-[#E2E5F0] bg-white px-3.5 min-h-[40px] py-2 text-xs font-medium text-[#111322] hover:border-[#2B3A9F] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {t('filters')}
            </button>
          </div>
        </div>

        {/* Category Segmented Bar */}
        <div className="flex items-center gap-2 overflow-x-auto py-4 border-b border-[#E2E5F0]">
          <button
            type="button"
            onClick={() => handleCategoryClick('ALL')}
            className={`px-3 py-1.5 text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedCategory === 'ALL'
                ? 'bg-[#111322] text-white border-[#111322]'
                : 'bg-white text-neutral-700 border-[#E2E5F0] hover:border-[#2B3A9F]'
            }`}
          >
            {t('allCategories')}
          </button>
          {availableCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => handleCategoryClick(cat)}
              className={`px-3 py-1.5 text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-[#2B3A9F] text-white border-[#2B3A9F]'
                  : 'bg-white text-neutral-700 border-[#E2E5F0] hover:border-[#2B3A9F]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Expandable Multi-Faceted Filter Matrix */}
        {showFilters && (
          <div className="bg-white border border-[#E2E5F0] p-5 mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">
                Gender
              </label>
              <select
                value={genderFilter}
                onChange={(e) => setGenderFilter(e.target.value as 'ALL' | 'MEN' | 'WOMEN')}
                className="w-full border border-[#E2E5F0] px-2.5 py-2 text-xs bg-[#F8F9FC]"
              >
                <option value="ALL">All Genders</option>
                <option value="MEN">Men</option>
                <option value="WOMEN">Women</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">
                Origin Country
              </label>
              <select
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                className="w-full border border-[#E2E5F0] px-2.5 py-2 text-xs bg-[#F8F9FC]"
              >
                <option value="ALL">All Countries</option>
                {allCountries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">
                Supplier House
              </label>
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="w-full border border-[#E2E5F0] px-2.5 py-2 text-xs bg-[#F8F9FC]"
              >
                <option value="ALL">All Verified Suppliers</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.businessName} ({s.country})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">
                Size & Color
              </label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={selectedSize}
                  onChange={(e) => setSelectedSize(e.target.value)}
                  className="border border-[#E2E5F0] px-2 py-2 text-xs bg-[#F8F9FC]"
                >
                  <option value="ALL">Size</option>
                  {allSizes.map((sz) => (
                    <option key={sz} value={sz}>
                      {sz}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedColor}
                  onChange={(e) => setSelectedColor(e.target.value)}
                  className="border border-[#E2E5F0] px-2 py-2 text-xs bg-[#F8F9FC]"
                >
                  <option value="ALL">Color</option>
                  {allColors.map((cl) => (
                    <option key={cl} value={cl}>
                      {cl}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">
                Max Price ({formatMoney(maxPriceUsd)})
              </label>
              <input
                type="range"
                min={20}
                max={300}
                step={10}
                value={maxPriceUsd}
                onChange={(e) => setMaxPriceUsd(Number(e.target.value))}
                className="w-full accent-[#2B3A9F]"
              />
            </div>

            <div className="flex flex-col justify-between">
              <label className="inline-flex items-center gap-2 text-xs text-neutral-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inStockOnly}
                  onChange={(e) => setInStockOnly(e.target.checked)}
                  className="accent-[#2B3A9F]"
                />
                {t('inStockOnly')}
              </label>
              <select
                value={minRating}
                onChange={(e) => setMinRating(Number(e.target.value))}
                className="border border-[#E2E5F0] px-2 py-1.5 text-xs bg-[#F8F9FC]"
              >
                <option value={0}>Any Rating</option>
                <option value={4}>4+ Stars</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setGenderFilter('ALL');
                  setSelectedCategory('ALL');
                  setSelectedCountry('ALL');
                  setSelectedSupplierId('ALL');
                  setSelectedSize('ALL');
                  setSelectedColor('ALL');
                  setMaxPriceUsd(300);
                  setInStockOnly(false);
                  setMinRating(0);
                  setSearchQuery('');
                }}
                className="text-left text-xs text-[#2B3A9F] underline cursor-pointer"
              >
                {t('resetFilters')}
              </button>
            </div>
          </div>
        )}

        {/* Product Grid */}
        {loadingStorefront ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pt-8">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="bg-white border border-[#E2E5F0] p-4 animate-pulse">
                <div className="aspect-[4/3] bg-[#EEF2FF]" />
                <div className="h-4 bg-[#EEF2FF] mt-4 w-2/3" />
                <div className="h-4 bg-[#EEF2FF] mt-2 w-1/3" />
              </div>
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="py-16 text-center bg-white border border-[#E2E5F0] mt-8">
            <p className="font-editorial text-2xl text-[#111322]">
              {t('noPiecesFound')}
            </p>
            <p className="text-xs text-neutral-500 mt-2">
              {t('resetFilters')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pt-8">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                priceLabel={formatMoney(product.sellingPriceUsd)}
                inStockText={`${product.totalStock} ${t('inStock')}`}
                outOfStockText={t('outOfStock')}
                isSaved={wishlist.includes(product.id)}
                onToggleSave={() => toggleWishlist(product.id)}
                onSelect={() => setSelectedProduct(product)}
              />
            ))}
          </div>
        )}
      </section>

      {/* 3. Featured Suppliers & Dual-Market Logistics Story */}
      <section className="bg-white border-y border-[#E2E5F0] py-14 sm:py-16">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8">
          <div className="grid lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-5">
              <p className="text-xs text-[#5B3CC4] uppercase tracking-[0.14em] font-semibold">
                {t('verifiedNetwork')}
              </p>
              <h2 className="font-editorial text-3xl sm:text-4xl font-semibold text-[#111322] mt-2">
                {t('suppliersTitle')}
              </h2>
              <p className="mt-4 text-sm text-neutral-600 leading-relaxed">
                {settings?.promoBannerSubtitle ||
                  'Every supplier on TANZANITE EXPRESS undergoes document verification. Multi-supplier baskets automatically split into supplier-specific suborders with individual courier tracking.'}
              </p>

              <div className="mt-6 space-y-4 border-t border-[#E2E5F0] pt-6">
                <div className="flex items-start gap-3">
                  <Truck className="w-4 h-4 text-[#2B3A9F] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-[#111322]">
                      Tanzania Domestic Dispatch (TZS) · M-Pesa & NMB Bank
                    </p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {language === 'sw'
                        ? 'Usafirishaji ndani ya Tanzania siku 1–3 za kazi baada ya Admin kuhakiki malipo.'
                        : 'Local Dar es Salaam & regional courier delivery within 1–3 business days after Admin verifies payment.'}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Globe className="w-4 h-4 text-[#5B3CC4] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-[#111322]">
                      International Direct Sourcing (USD / GBP / EUR)
                    </p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {language === 'sw'
                        ? 'Bidhaa kutoka Italy, UK, USA & Asia zikiwa na uwazi wa usafirishaji na forodha.'
                        : 'Vetted houses in Italy, UK, USA & Asia with upfront customs & import duty transparency.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 grid sm:grid-cols-2 gap-4">
              {suppliers.map((sup) => (
                <div
                  key={sup.id}
                  className="border border-[#E2E5F0] bg-[#F8F9FC] p-5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
                      <span>{sup.country}</span>
                      <span>{sup.category}</span>
                    </div>
                    <h3 className="font-editorial text-xl font-semibold text-[#111322] mt-2">
                      {sup.businessName}
                    </h3>
                    <p className="text-xs text-neutral-600 mt-2 leading-relaxed line-clamp-3">
                      {sup.description}
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#E2E5F0] flex items-center justify-between">
                    <span className="text-[11px] text-neutral-500">
                      {sup.shippingOrigin}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSupplierId(sup.id);
                        document
                          .getElementById('catalog-section')
                          ?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="text-xs font-semibold text-[#2B3A9F] underline underline-offset-4 cursor-pointer"
                    >
                      {t('viewStore')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Verified Customer Reviews (Strictly from real DB submissions) */}
          <div className="mt-12 pt-10 border-t border-[#E2E5F0]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-editorial text-2xl font-semibold text-[#111322]">
                {t('verifiedReviews')}
              </h3>
              <span className="text-xs text-neutral-500 tabular-nums">
                {reviews.length}
              </span>
            </div>
            {reviews.length === 0 ? (
              <p className="text-xs text-neutral-600">{t('noReviewsYet')}</p>
            ) : (
              <div className="grid md:grid-cols-3 gap-6">
                {reviews.slice(0, 3).map((rev) => (
                  <div key={rev.id} className="border border-[#E2E5F0] p-5 bg-[#F8F9FC]">
                    <div className="flex items-center gap-1 text-[#5B3CC4]">
                      {Array.from({ length: rev.rating }).map((_, idx) => (
                        <Star key={idx} className="w-3.5 h-3.5 fill-current" />
                      ))}
                    </div>
                    <p className="text-sm text-neutral-800 mt-3 leading-relaxed">
                      “{rev.comment}”
                    </p>
                    <p className="text-xs text-neutral-500 mt-3">
                      {rev.customerName} · {rev.verifiedPurchase ? 'Verified Buyer' : 'Customer'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 4. Newsletter & Complete Footer */}
      <footer className="bg-[#111322] text-[#F8F9FC] pt-14 pb-10">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8">
          <div className="grid lg:grid-cols-12 gap-10 pb-12 border-b border-neutral-800">
            <div className="lg:col-span-5">
              <TanzaniteLogo inverted />
              <p className="text-xs text-[#A5B4FC] mt-2 font-medium">
                Fashion You Love, Delivered to You
              </p>
              <p className="text-xs text-neutral-400 mt-2 max-w-sm leading-relaxed">
                Curated multi-vendor fashion marketplace bridging Tanzanian designers and verified global suppliers with transparent commission and direct fulfillment.
              </p>
              <form
                onSubmit={handleNewsletterSubmit}
                className="mt-5 flex flex-col min-[380px]:flex-row max-w-sm gap-2 min-[380px]:gap-0"
              >
                <input
                  type="email"
                  required
                  value={newsletterEmail}
                  onChange={(e) => setNewsletterEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  className="flex-1 min-w-0 min-h-[44px] bg-[#1A1D36] border border-neutral-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-[#A5B4FC]"
                />
                <button
                  type="submit"
                  disabled={submittingNewsletter}
                  className="min-h-[44px] bg-[#2B3A9F] text-white px-4 py-2 text-xs font-semibold hover:bg-[#5B3CC4] transition-colors cursor-pointer shrink-0"
                >
                  {t('subscribe')}
                </button>
              </form>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 gap-6 sm:gap-8 text-xs">
              <div>
                <p className="text-neutral-400 uppercase tracking-wider mb-3">Marketplace</p>
                <ul className="space-y-2 text-neutral-300">
                  <li>
                    <button
                      type="button"
                      onClick={() => setGenderFilter('MEN')}
                      className="hover:text-white cursor-pointer"
                    >
                      Men’s Fashion
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => setGenderFilter('WOMEN')}
                      className="hover:text-white cursor-pointer"
                    >
                      Women’s Fashion
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => setActivePage('supplier')}
                      className="hover:text-white cursor-pointer"
                    >
                      {t('sellOnMik')}
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => setActivePage('track')}
                      className="hover:text-white cursor-pointer"
                    >
                      Track Suborders
                    </button>
                  </li>
                </ul>
              </div>

              <div>
                <p className="text-neutral-400 uppercase tracking-wider mb-3">Policies & Help</p>
                <ul className="space-y-2 text-neutral-300">
                  <li>
                    <button
                      type="button"
                      onClick={() => setActivePage('support')}
                      className="hover:text-white cursor-pointer"
                    >
                      Return & Refund Policy
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => setActivePage('support')}
                      className="hover:text-white cursor-pointer"
                    >
                      Shipping & Customs Policy
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => setActivePage('support')}
                      className="hover:text-white cursor-pointer"
                    >
                      Privacy Policy & Terms
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => setActivePage('support')}
                      className="hover:text-white cursor-pointer"
                    >
                      Contact Support & FAQ
                    </button>
                  </li>
                </ul>
              </div>

              <div>
                <p className="text-neutral-400 uppercase tracking-wider mb-3">Connect & App</p>
                <ul className="space-y-2 text-neutral-300 mb-4">
                  <li>
                    <a
                      href={settings?.socialLinks?.instagram || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-white"
                    >
                      Instagram
                    </a>
                  </li>
                  <li>
                    <a
                      href={settings?.socialLinks?.tiktok || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-white"
                    >
                      TikTok
                    </a>
                  </li>
                  <li>
                    <a
                      href={settings?.socialLinks?.whatsapp || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-white"
                    >
                      WhatsApp Concierge
                    </a>
                  </li>
                </ul>
                <PWAInstallButton />
              </div>
            </div>
          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-400">
            <p>© {new Date().getFullYear()} TANZANITE EXPRESS. Dar es Salaam & Global.</p>
            <p>Multi-Currency Checkout: TZS · USD · GBP · EUR · KES</p>
          </div>
        </div>
      </footer>
    </main>
  );
};

interface ProductCardProps {
  product: Product;
  priceLabel: string;
  inStockText: string;
  outOfStockText: string;
  isSaved: boolean;
  onToggleSave: () => void;
  onSelect: () => void;
}

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  priceLabel,
  inStockText,
  outOfStockText,
  isSaved,
  onToggleSave,
  onSelect,
}) => {
  const hasSecondary = Boolean(product.images && product.images.length > 1);
  return (
    <article className="group bg-white border border-[#E2E5F0] flex flex-col transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-sm">
      <div className="relative aspect-[4/3] bg-[#F8F9FC] overflow-hidden">
        <button
          type="button"
          onClick={onSelect}
          className="w-full h-full block cursor-pointer relative"
          aria-label={`View ${product.title}`}
        >
          <SafeImage
            src={product.images[0]}
            alt={product.title}
            className={`w-full h-full object-cover transition-all duration-300 ${
              hasSecondary ? 'group-hover:opacity-0' : 'group-hover:scale-[1.03]'
            }`}
          />
          {hasSecondary && (
            <SafeImage
              src={product.images[1]}
              alt={`${product.title} alternate view`}
              className="w-full h-full object-cover absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            />
          )}
        </button>
        <button
          type="button"
          onClick={onToggleSave}
          aria-label={isSaved ? 'Remove from wishlist' : 'Save to wishlist'}
          className="absolute top-3 right-3 p-2.5 bg-white/90 border border-[#E2E5F0] text-[#111322] hover:bg-white cursor-pointer"
        >
          <Heart className={`w-3.5 h-3.5 ${isSaved ? 'fill-[#5B3CC4] text-[#5B3CC4]' : ''}`} />
        </button>
      </div>

      <div className="p-5 flex-1 flex flex-col justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
            <span className="text-[#2B3A9F] font-medium">{product.category}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{product.shippingOriginCountry}</span>
            {product.images.length > 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">{product.images.length} photos</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onSelect}
            className="text-left block mt-1.5 cursor-pointer"
          >
            <h3 className="text-base font-semibold text-[#111322] group-hover:underline underline-offset-4 line-clamp-1">
              {product.title}
            </h3>
          </button>
          <p className="text-xs text-neutral-500 mt-1 truncate">
            {product.supplierName}
          </p>
        </div>

        <div className="mt-4 pt-3 border-t border-[#E2E5F0] flex items-center justify-between">
          <span className="text-sm font-semibold text-[#111322] tabular-nums">
            {priceLabel}
          </span>
          <span className="text-xs text-neutral-500 tabular-nums">
            {product.totalStock > 0 ? inStockText : outOfStockText}
          </span>
        </div>
      </div>
    </article>
  );
};
