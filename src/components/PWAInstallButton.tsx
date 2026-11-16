import React, { useState } from 'react';
import { Download, WifiOff } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-2 border border-neutral-300 bg-white px-3.5 py-2 text-xs font-medium text-neutral-900 hover:bg-neutral-50 transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5" />
        Install App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-2 border border-neutral-300 bg-white px-3.5 py-2 text-xs font-medium text-neutral-900 hover:bg-neutral-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          Install on iOS
        </button>
        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm bg-white p-6 border border-neutral-200">
              <h3 className="text-lg font-semibold text-[#111322]">Install TANZANITE EXPRESS</h3>
              <p className="mt-2 text-sm text-neutral-600 leading-relaxed">
                1. Tap the <strong>Share</strong> icon in your Safari toolbar.
                <br />
                2. Scroll down and select <strong>Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full bg-[#2B3A9F] py-2.5 text-xs font-medium text-white hover:bg-[#5B3CC4] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;
  return (
    <div className="fixed bottom-16 left-3 right-3 sm:right-auto sm:left-4 z-50 max-w-[calc(100vw-1.5rem)] flex items-center gap-2 bg-amber-700 px-3.5 py-2 text-xs font-medium text-white shadow-md">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span className="min-w-0 break-words">Offline Mode — Browsing cached storefront data</span>
    </div>
  );
};
