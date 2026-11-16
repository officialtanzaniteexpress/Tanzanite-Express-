/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthModal, MandatoryPasswordChangeModal } from './components/AuthModal';
import { CartCheckoutDrawer } from './components/CartCheckoutDrawer';
import { CustomerDashboard } from './components/CustomerDashboard';
import { Header } from './components/Header';
import { SupportAndLegalPage, TrackOrderPage } from './components/LegalSupportPages';
import { NotificationsPage } from './components/NotificationsPage';
import { ProductDetailModal } from './components/ProductDetailModal';
import { OfflineBanner } from './components/PWAInstallButton';
import { StorefrontView } from './components/StorefrontView';
import { SupplierDashboard } from './components/SupplierDashboard';
import { SupportAssistantWidget } from './components/SupportAssistantWidget';
import { MarketplaceProvider, useMarketplace } from './context/MarketplaceContext';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class MarketplaceErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected rendering error occurred.',
    };
  }

  componentDidCatch(error: Error): void {
    console.error('TANZANITE EXPRESS ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8F9FC] text-[#111322] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#E2E5F0] p-6 sm:p-8 space-y-4 text-center">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-[#5B3CC4]">
              TANZANITE EXPRESS
            </p>
            <h1 className="font-editorial text-2xl font-semibold text-[#111322]">
              Something interrupted your workspace
            </h1>
            <p className="text-xs text-neutral-600 break-words">
              {this.state.message}
            </p>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, message: '' })}
                className="bg-[#2B3A9F] hover:bg-[#1E2A78] text-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wide cursor-pointer"
              >
                Recover Workspace
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="border border-[#E2E5F0] hover:border-[#2B3A9F] px-5 py-2.5 text-xs font-semibold uppercase tracking-wide cursor-pointer"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const MarketplaceShell: React.FC = () => {
  const { activePage, toasts, dismissToast } = useMarketplace();
  const [genderFilter, setGenderFilter] = useState<'ALL' | 'MEN' | 'WOMEN'>('ALL');

  return (
    <div className="min-h-screen bg-[#F8F9FC] text-[#111322]">
      <Header onSelectGender={setGenderFilter} />

      {activePage === 'storefront' && (
        <StorefrontView genderFilter={genderFilter} setGenderFilter={setGenderFilter} />
      )}
      {activePage === 'customer' && <CustomerDashboard />}
      {activePage === 'supplier' && <SupplierDashboard />}
      {activePage === 'admin' && <AdminDashboard />}
      {activePage === 'track' && <TrackOrderPage />}
      {activePage === 'support' && <SupportAndLegalPage />}
      {activePage === 'notifications' && <NotificationsPage />}

      <ProductDetailModal />
      <CartCheckoutDrawer />
      <AuthModal />
      <MandatoryPasswordChangeModal />
      <SupportAssistantWidget />
      <OfflineBanner />

      {/* Toast Queue */}
      <div className="fixed bottom-16 left-3 right-3 sm:left-auto sm:bottom-4 sm:right-4 z-50 space-y-2 sm:w-full sm:max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-3 text-xs border shadow-md flex items-center justify-between gap-3 ${
              t.type === 'error'
                ? 'bg-red-950 text-white border-red-800'
                : t.type === 'success'
                  ? 'bg-[#111322] text-white border-[#2B3A9F]'
                  : 'bg-white text-[#111322] border-[#E2E5F0]'
            }`}
          >
            <span className="min-w-0 break-words">{t.text}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center shrink-0 opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function App() {
  return (
    <MarketplaceErrorBoundary>
      <MarketplaceProvider>
        <MarketplaceShell />
      </MarketplaceProvider>
    </MarketplaceErrorBoundary>
  );
}
