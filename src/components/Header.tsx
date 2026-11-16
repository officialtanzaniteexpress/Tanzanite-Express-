import React, { useState } from 'react';
import {
  Bell,
  ChevronDown,
  Menu,
  ShieldCheck,
  ShoppingBag,
  Store,
  User,
  X,
} from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext';
import { CurrencyCode } from '../types/marketplace';
import { TanzaniteLogo } from './TanzaniteBrand';

interface HeaderProps {
  onSelectGender: (gender: 'ALL' | 'MEN' | 'WOMEN') => void;
}

export const Header: React.FC<HeaderProps> = ({ onSelectGender }) => {
  const {
    settings,
    language,
    setLanguage,
    t,
    currency,
    setCurrency,
    cart,
    setIsCartOpen,
    firebaseUser,
    userAccount,
    openAuthModal,
    logout,
    activePage,
    setActivePage,
    notifications,
    unreadNotificationCount,
    markAllNotificationsRead,
    hideNotification,
    navigateFromNotification,
  } = useMarketplace();

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [bellMenuOpen, setBellMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const bagCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const isAdminOrStaff =
    userAccount?.role === 'super_admin' || userAccount?.role === 'staff';

  const navigateStorefront = (gender: 'ALL' | 'MEN' | 'WOMEN') => {
    setActivePage('storefront');
    onSelectGender(gender);
    setMobileMenuOpen(false);
    setTimeout(() => {
      document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 60);
  };

  const announcement =
    language === 'sw'
      ? settings?.announcementTextSw || settings?.announcementText
      : settings?.announcementText;

  return (
    <div className="sticky top-0 z-40 w-full bg-[#F8F9FC]/95 backdrop-blur-sm border-b border-[#E2E5F0]">
      {!bannerDismissed && announcement && (
        <div className="bg-[#111322] text-[#F8F9FC] px-3 sm:px-4 min-h-8 py-1.5 flex items-center justify-between gap-2 text-[11px] sm:text-xs">
          <span className="flex-1 min-w-0 text-center leading-snug break-words">{announcement}</span>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss announcement"
            className="text-neutral-400 hover:text-white min-h-[28px] min-w-[28px] inline-flex items-center justify-center shrink-0 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <header className="max-w-[1440px] mx-auto px-2.5 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-1.5 sm:gap-4 min-w-0">
        {/* Zone 1: Brand Crest + Single-line Wordmark */}
        <button
          type="button"
          onClick={() => {
            setActivePage('storefront');
            onSelectGender('ALL');
            setMobileMenuOpen(false);
          }}
          className="min-w-0 shrink cursor-pointer min-h-[44px] flex items-center"
          aria-label="TANZANITE EXPRESS Home"
        >
          <TanzaniteLogo
            iconClassName="w-5 h-5 min-[375px]:w-6 min-[375px]:h-6 sm:w-7 sm:h-7 shrink-0"
            wordmarkClassName="font-editorial text-[12px] min-[375px]:text-[15px] sm:text-xl font-semibold tracking-tight whitespace-nowrap truncate"
          />
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav className="hidden lg:flex items-center gap-5 xl:gap-6 text-sm font-medium text-neutral-700 shrink-0">
          <button
            type="button"
            onClick={() => navigateStorefront('MEN')}
            className="hover:text-[#2B3A9F] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t('shopMen')}
          </button>
          <button
            type="button"
            onClick={() => navigateStorefront('WOMEN')}
            className="hover:text-[#2B3A9F] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t('shopWomen')}
          </button>
          <button
            type="button"
            onClick={() => setActivePage('supplier')}
            className={`hover:text-[#2B3A9F] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePage === 'supplier' ? 'text-[#2B3A9F] underline' : ''
            }`}
          >
            {t('sellOnMik')}
          </button>
          <button
            type="button"
            onClick={() => setActivePage('track')}
            className={`hover:text-[#2B3A9F] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePage === 'track' ? 'text-[#2B3A9F] underline' : ''
            }`}
          >
            {t('trackOrder')}
          </button>
          <button
            type="button"
            onClick={() => setActivePage('support')}
            className={`hover:text-[#2B3A9F] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePage === 'support' ? 'text-[#2B3A9F] underline' : ''
            }`}
          >
            {t('support')}
          </button>
        </nav>

        {/* Zone 3: Language Switcher, Currency, Bag, Notifications & Account */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <div
            role="group"
            aria-label="Language switcher"
            className="hidden min-[480px]:inline-flex border border-[#E2E5F0] bg-white text-[11px] font-semibold shrink-0"
          >
            <button
              type="button"
              onClick={() => setLanguage('sw')}
              className={`px-2 py-2 min-h-[38px] cursor-pointer transition-colors ${
                language === 'sw' ? 'bg-[#2B3A9F] text-white' : 'text-neutral-600 hover:text-[#111322]'
              }`}
            >
              SW
            </button>
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className={`px-2 py-2 min-h-[38px] cursor-pointer transition-colors ${
                language === 'en' ? 'bg-[#2B3A9F] text-white' : 'text-neutral-600 hover:text-[#111322]'
              }`}
            >
              EN
            </button>
          </div>

          <label className="sr-only" htmlFor="currency-switcher">
            Select currency
          </label>
          <select
            id="currency-switcher"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
            className="hidden sm:block border border-[#E2E5F0] bg-white px-2.5 py-2 min-h-[38px] text-xs font-medium text-[#111322] focus:outline-none focus:border-[#2B3A9F] cursor-pointer"
          >
            <option value="TZS">TZS (Tanzania)</option>
            <option value="USD">USD ($)</option>
            <option value="GBP">GBP (£)</option>
            <option value="EUR">EUR (€)</option>
            <option value="KES">KES</option>
          </select>

          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            aria-label="Open shopping bag"
            className="inline-flex items-center gap-1 sm:gap-1.5 border border-[#E2E5F0] bg-white px-2 sm:px-3 min-h-[40px] sm:min-h-[38px] text-[11px] sm:text-xs font-medium text-[#111322] hover:border-[#2B3A9F] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ShoppingBag className="w-3.5 h-3.5 text-[#2B3A9F] shrink-0" />
            <span className="tabular-nums">
              <span className="hidden min-[400px]:inline">{t('bag')} </span>({bagCount})
            </span>
          </button>

          {firebaseUser && (
            <div className="relative hidden min-[375px]:block">
              <button
                type="button"
                aria-label="Open notifications"
                onClick={() => {
                  setBellMenuOpen((o) => !o);
                  setAccountMenuOpen(false);
                  setMobileMenuOpen(false);
                }}
                className="inline-flex items-center gap-1 border border-[#E2E5F0] bg-white px-2 sm:px-2.5 min-h-[40px] sm:min-h-[38px] text-xs font-medium text-[#111322] hover:border-[#2B3A9F] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Bell className="w-3.5 h-3.5" />
                {unreadNotificationCount > 0 && (
                  <span className="font-mono-tabular font-semibold text-[#5B3CC4]">
                    {unreadNotificationCount}
                  </span>
                )}
              </button>

              {bellMenuOpen && (
                <div className="fixed left-2.5 right-2.5 top-[4.25rem] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 bg-white border border-[#E2E5F0] shadow-lg z-50">
                  <div className="px-4 py-2.5 border-b border-[#E2E5F0] flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#111322]">
                      {t('notifications')} ({unreadNotificationCount})
                    </span>
                    <button
                      type="button"
                      onClick={() => markAllNotificationsRead()}
                      className="text-[11px] text-[#2B3A9F] underline cursor-pointer"
                    >
                      {t('markAllRead')}
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-[#E2E5F0]">
                    {notifications.length === 0 ? (
                      <p className="px-4 py-6 text-xs text-neutral-500 text-center">
                        {t('noNotificationsYet')}
                      </p>
                    ) : (
                      notifications.slice(0, 6).map((n) => (
                        <div
                          key={n.id}
                          className={`flex items-start gap-2 px-4 py-3 text-xs hover:bg-[#F8F9FC] transition-colors ${
                            n.read ? 'bg-white' : 'bg-[#EEF2FF]/60'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setBellMenuOpen(false);
                              navigateFromNotification(n);
                            }}
                            className="flex-1 min-w-0 text-left cursor-pointer"
                          >
                            <div className="flex items-center justify-between gap-2 text-[10px] text-neutral-500">
                              <span className="uppercase font-semibold text-[#2B3A9F]">
                                {n.type}
                              </span>
                              <span className="font-mono-tabular">
                                {new Date(n.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="font-semibold text-[#111322] mt-0.5 line-clamp-1">
                              {n.title}
                            </p>
                            <p className="text-neutral-600 mt-0.5 line-clamp-2">{n.message}</p>
                          </button>
                          <button
                            type="button"
                            aria-label="Hide notification"
                            title="Hide notification"
                            onClick={(e) => {
                              e.stopPropagation();
                              void hideNotification(n.id);
                            }}
                            className="p-1 text-neutral-400 hover:text-red-700 cursor-pointer shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setBellMenuOpen(false);
                      setActivePage('notifications');
                    }}
                    className="w-full border-t border-[#E2E5F0] bg-[#F8F9FC] hover:bg-[#EEF2FF] px-4 py-2.5 min-h-[44px] text-xs font-semibold text-[#111322] text-center cursor-pointer"
                  >
                    {t('viewAllNotifications')}
                  </button>
                </div>
              )}
            </div>
          )}

          {firebaseUser ? (
            <div className="relative">
              <button
                type="button"
                aria-label="Open account menu"
                onClick={() => {
                  setAccountMenuOpen((o) => !o);
                  setBellMenuOpen(false);
                  setMobileMenuOpen(false);
                }}
                className="inline-flex items-center gap-1 sm:gap-1.5 bg-[#111322] text-white px-2.5 sm:px-3 min-h-[40px] sm:min-h-[38px] text-xs font-medium hover:bg-[#2B3A9F] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <User className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline max-w-[96px] truncate">
                  {userAccount?.displayName || t('account')}
                </span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              </button>

              {accountMenuOpen && (
                <div className="fixed left-2.5 right-2.5 top-[4.25rem] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-64 bg-white border border-[#E2E5F0] shadow-lg py-1.5 z-50">
                  <div className="px-3.5 py-2 border-b border-[#E2E5F0]">
                    <p className="text-xs font-medium text-[#111322] truncate">
                      {userAccount?.email || firebaseUser.email}
                    </p>
                    <p className="text-[11px] text-neutral-500 capitalize">
                      {userAccount?.role?.replace('_', ' ') || 'signed in'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActivePage('customer');
                      setAccountMenuOpen(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 min-h-[40px] text-xs text-neutral-800 hover:bg-[#F8F9FC] flex items-center gap-2 cursor-pointer"
                  >
                    <User className="w-3.5 h-3.5" />
                    {t('customerDashboard')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActivePage('supplier');
                      setAccountMenuOpen(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 min-h-[40px] text-xs text-neutral-800 hover:bg-[#F8F9FC] flex items-center gap-2 cursor-pointer"
                  >
                    <Store className="w-3.5 h-3.5" />
                    {t('supplierPortal')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActivePage('notifications');
                      setAccountMenuOpen(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 min-h-[40px] text-xs text-neutral-800 hover:bg-[#F8F9FC] flex items-center justify-between cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Bell className="w-3.5 h-3.5" />
                      {t('notifications')}
                    </span>
                    {unreadNotificationCount > 0 && (
                      <span className="font-mono-tabular text-[11px] font-semibold text-[#5B3CC4]">
                        {unreadNotificationCount}
                      </span>
                    )}
                  </button>
                  {isAdminOrStaff && (
                    <button
                      type="button"
                      onClick={() => {
                        setActivePage('admin');
                        setAccountMenuOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2.5 min-h-[40px] text-xs font-semibold text-[#2B3A9F] hover:bg-[#EEF2FF] flex items-center gap-2 cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {t('superAdminConsole')}
                    </button>
                  )}
                  <div className="border-t border-[#E2E5F0] mt-1 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        logout();
                      }}
                      className="w-full text-left px-3.5 py-2.5 min-h-[40px] text-xs text-red-700 hover:bg-red-50 cursor-pointer"
                    >
                      {t('signOut')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => openAuthModal('register')}
                className="hidden md:inline-flex items-center border border-[#E2E5F0] bg-white text-[#111322] px-3 min-h-[38px] text-xs font-medium hover:border-[#2B3A9F] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {t('createAccount')}
              </button>
              <button
                type="button"
                onClick={() => openAuthModal('signin')}
                className="bg-[#2B3A9F] text-white px-2.5 min-[375px]:px-3.5 min-h-[40px] sm:min-h-[38px] text-[11px] sm:text-xs font-semibold hover:bg-[#5B3CC4] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {t('signIn')}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen((o) => !o);
              setAccountMenuOpen(false);
              setBellMenuOpen(false);
            }}
            aria-label="Toggle mobile menu"
            aria-expanded={mobileMenuOpen}
            className="lg:hidden relative min-h-[40px] min-w-[40px] flex items-center justify-center border border-[#E2E5F0] bg-white text-[#111322] cursor-pointer shrink-0"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            {firebaseUser && unreadNotificationCount > 0 && !mobileMenuOpen && (
              <span
                aria-hidden="true"
                className="min-[375px]:hidden absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#5B3CC4]"
              />
            )}
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-[#E2E5F0] bg-white px-3.5 sm:px-4 py-4 space-y-3 max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E2E5F0]">
            <div className="inline-flex border border-[#E2E5F0] bg-[#F8F9FC] text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setLanguage('sw')}
                className={`px-3 min-h-[40px] cursor-pointer transition-colors ${
                  language === 'sw' ? 'bg-[#2B3A9F] text-white' : 'text-neutral-600'
                }`}
              >
                SW
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-3 min-h-[40px] cursor-pointer transition-colors ${
                  language === 'en' ? 'bg-[#2B3A9F] text-white' : 'text-neutral-600'
                }`}
              >
                EN
              </button>
            </div>

            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] text-neutral-500 hidden min-[380px]:inline">
                {t('marketCurrency')}
              </span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                aria-label={t('marketCurrency')}
                className="border border-[#E2E5F0] bg-[#F8F9FC] px-2.5 min-h-[40px] text-xs font-medium max-w-full"
              >
                <option value="TZS">TZS (Tanzania)</option>
                <option value="USD">USD ($)</option>
                <option value="GBP">GBP (£)</option>
                <option value="EUR">EUR (€)</option>
                <option value="KES">KES</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2 text-xs font-medium">
            <button
              type="button"
              onClick={() => navigateStorefront('MEN')}
              className="text-left px-3 py-3 border border-[#E2E5F0] min-h-[44px] cursor-pointer"
            >
              {t('shopMen')}
            </button>
            <button
              type="button"
              onClick={() => navigateStorefront('WOMEN')}
              className="text-left px-3 py-3 border border-[#E2E5F0] min-h-[44px] cursor-pointer"
            >
              {t('shopWomen')}
            </button>
            <button
              type="button"
              onClick={() => {
                setActivePage('supplier');
                setMobileMenuOpen(false);
              }}
              className="text-left px-3 py-3 border border-[#E2E5F0] min-h-[44px] cursor-pointer"
            >
              {t('supplierPortal')}
            </button>
            <button
              type="button"
              onClick={() => {
                setActivePage('track');
                setMobileMenuOpen(false);
              }}
              className="text-left px-3 py-3 border border-[#E2E5F0] min-h-[44px] cursor-pointer"
            >
              {t('trackOrder')}
            </button>
            <button
              type="button"
              onClick={() => {
                setActivePage('support');
                setMobileMenuOpen(false);
              }}
              className="text-left px-3 py-3 border border-[#E2E5F0] min-h-[44px] cursor-pointer"
            >
              {t('support')}
            </button>
            {!firebaseUser ? (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openAuthModal('register');
                }}
                className="text-left px-3 py-3 border border-[#2B3A9F] text-[#2B3A9F] font-semibold min-h-[44px] cursor-pointer"
              >
                {t('createAccount')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setActivePage('customer');
                    setMobileMenuOpen(false);
                  }}
                  className="text-left px-3 py-3 border border-[#E2E5F0] min-h-[44px] cursor-pointer"
                >
                  {t('customerDashboard')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActivePage('notifications');
                    setMobileMenuOpen(false);
                  }}
                  className="text-left px-3 py-3 border border-[#E2E5F0] min-h-[44px] cursor-pointer"
                >
                  {t('notifications')} ({unreadNotificationCount})
                </button>
                {isAdminOrStaff && (
                  <button
                    type="button"
                    onClick={() => {
                      setActivePage('admin');
                      setMobileMenuOpen(false);
                    }}
                    className="text-left px-3 py-3 border border-[#2B3A9F] bg-[#EEF2FF] text-[#2B3A9F] font-semibold min-h-[44px] cursor-pointer"
                  >
                    {t('superAdminConsole')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    logout();
                  }}
                  className="text-left px-3 py-3 border border-red-200 text-red-700 font-medium min-h-[44px] cursor-pointer"
                >
                  {t('signOut')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
