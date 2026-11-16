import React, { useEffect, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { auth } from '../lib/firebase';

interface SafeImageProps {
  src?: string;
  alt: string;
  className?: string;
  requiresAuth?: boolean;
}

export const SafeImage: React.FC<SafeImageProps> = ({
  src,
  alt,
  className = '',
  requiresAuth = false,
}) => {
  const [failed, setFailed] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(
    requiresAuth && src?.startsWith('/api/media/products/') ? undefined : src
  );

  useEffect(() => {
    setFailed(false);
    if (!src) {
      setResolvedSrc(undefined);
      return;
    }
    const isProtectedMedia = requiresAuth && src.startsWith('/api/media/products/');
    if (!isProtectedMedia) {
      setResolvedSrc(src);
      return;
    }

    let cancelled = false;
    let createdObjectUrl: string | null = null;

    (async () => {
      try {
        const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
        const res = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const blob = await res.blob();
        createdObjectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setResolvedSrc(createdObjectUrl);
        } else {
          URL.revokeObjectURL(createdObjectUrl);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (createdObjectUrl) {
        URL.revokeObjectURL(createdObjectUrl);
      }
    };
  }, [src, requiresAuth]);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#F4F2EE] to-[#E5E2DC] text-neutral-600 p-4 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <ShoppingBag className="w-6 h-6 mb-2 text-[#8B6F47]" />
        <span className="text-xs font-medium line-clamp-2 max-w-[16ch]">{alt}</span>
      </div>
    );
  }

  if (!resolvedSrc) {
    return <div className={`bg-[#F4F2EE] animate-pulse ${className}`} aria-label={alt} />;
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
