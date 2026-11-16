import { NextFunction, Request, Response } from 'express';
import { adminAuth, BOOTSTRAP_ADMIN_EMAIL } from './firebase-admin.ts';
import { getStore, upsertUser } from './store.ts';
import { UserAccount } from '../types/marketplace.ts';

export interface AuthRequest extends Request {
  authUser?: UserAccount;
  adminEmailUnverified?: boolean;
}

export async function resolveUserFromToken(token: string): Promise<UserAccount | null> {
  const decoded = await adminAuth.verifyIdToken(token);
  const store = await getStore();
  const existing = store.users[decoded.uid];

  const isBootstrapEmailMatch =
    decoded.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
  const isBootstrapAdmin = isBootstrapEmailMatch && decoded.email_verified === true;
  const providerRaw = (decoded.firebase?.sign_in_provider || '').toLowerCase();
  const authProvider: 'password' | 'google' =
    providerRaw === 'password' ? 'password' : 'google';

  if (isBootstrapEmailMatch && decoded.email_verified !== true) {
    console.warn(
      `[Auth] Token for bootstrap admin email ${BOOTSTRAP_ADMIN_EMAIL} lacks email_verified=true; withholding super_admin privileges until email is verified.`
    );
  }

  if (existing) {
    let changed = false;
    // Ensure bootstrap owner always retains super_admin if verified
    if (isBootstrapAdmin && existing.role !== 'super_admin') {
      existing.role = 'super_admin';
      existing.permissions = {
        canVerifyPayments: true,
        canManageSettings: true,
        canModerateCatalog: true,
      };
      changed = true;
    }
    if (decoded.email_verified === true && existing.emailVerified !== true) {
      existing.emailVerified = true;
      changed = true;
    }
    if (!existing.authProvider) {
      existing.authProvider = authProvider;
      changed = true;
    }
    if (existing.personalizationEnabled === undefined) {
      existing.personalizationEnabled = true;
      changed = true;
    }
    if (existing.analyticsConsent === undefined) {
      existing.analyticsConsent = true;
      changed = true;
    }
    if (changed) {
      existing.updatedAt = new Date().toISOString();
      await upsertUser(existing);
    }
    return existing;
  }

  // Check if user owns an approved/registered supplier profile
  const ownedSupplier = Object.values(store.suppliers).find(
    (s) => s.ownerUid === decoded.uid
  );

  // Preserve profile metadata (e.g. mustChangePassword) if a previous bootstrap entry existed under the same verified email
  const priorEmailRecord =
    isBootstrapAdmin && decoded.email
      ? Object.values(store.users).find(
          (u) => u.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
        )
      : undefined;

  const now = new Date().toISOString();
  const created: UserAccount = {
    uid: decoded.uid,
    email: decoded.email || '',
    displayName:
      priorEmailRecord?.displayName ||
      decoded.name ||
      decoded.email?.split('@')[0] ||
      'Customer',
    phone: priorEmailRecord?.phone,
    role: isBootstrapAdmin ? 'super_admin' : ownedSupplier ? 'supplier' : 'customer',
    status: 'active',
    preferredCurrency: priorEmailRecord?.preferredCurrency || 'TZS',
    preferredCountry: priorEmailRecord?.preferredCountry || 'Tanzania',
    addresses: priorEmailRecord?.addresses || [],
    emailVerified: Boolean(decoded.email_verified),
    authProvider,
    personalizationEnabled: true,
    analyticsConsent: true,
    ...(isBootstrapAdmin
      ? {
          permissions: {
            canVerifyPayments: true,
            canManageSettings: true,
            canModerateCatalog: true,
          },
          mustChangePassword: priorEmailRecord?.mustChangePassword ?? false,
        }
      : {}),
    createdAt: priorEmailRecord?.createdAt || now,
    updatedAt: now,
  };
  await upsertUser(created);
  return created;
}

export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.split('Bearer ')[1];
    try {
      const user = await resolveUserFromToken(token);
      if (user) req.authUser = user;
    } catch {
      // Optional auth ignores invalid tokens and treats as guest
    }
  }
  next();
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.split('Bearer ')[1];
  try {
    const user = await resolveUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Invalid user identity' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended. Contact marketplace support.' });
    }
    if (
      user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() &&
      !user.emailVerified &&
      user.role !== 'super_admin'
    ) {
      req.adminEmailUnverified = true;
    }
    req.authUser = user;
    next();
  } catch (err) {
    console.error('Token verification failed:', err);
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

export function requireRoles(...allowedRoles: UserAccount['role'][]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      return res.status(403).json({ error: 'Insufficient permissions for this operation' });
    }
    next();
  };
}

export function hasPaymentVerificationAccess(user?: UserAccount): boolean {
  if (!user) return false;
  if (user.status !== 'active') return false;
  if (user.role === 'super_admin') return true;
  if (user.role === 'staff' && user.permissions?.canVerifyPayments === true) return true;
  return false;
}

export function requirePaymentVerifier(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!hasPaymentVerificationAccess(req.authUser)) {
    return res.status(403).json({
      error: 'Only authorized administrators with payment verification access may perform this action.',
    });
  }
  next();
}
