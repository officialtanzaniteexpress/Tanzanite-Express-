import firebaseConfig from '../../firebase-applet-config.json';
import { adminAuth, adminDb, BOOTSTRAP_ADMIN_EMAIL } from './firebase-admin.ts';
import { appendAuditLog, getStore, upsertUser } from './store.ts';
import { UserAccount } from '../types/marketplace.ts';

let bootstrapCompleted = false;
let lastBootstrapStatus: AdminBootstrapStatus | null = null;

export interface AdminBootstrapStatus {
  attempted: boolean;
  configured: boolean;
  firebaseAdminAvailable: boolean;
  storeProfileExists: boolean;
  adminEmail: string;
  createdNewAccount?: boolean;
  errorCode?: string;
  message: string;
}

async function callIdentityToolkit(
  endpoint: 'signInWithPassword' | 'signUp' | 'sendOobCode' | 'update',
  payload: Record<string, unknown>
): Promise<{ ok: boolean; data: any; errorMessage: string }> {
  const apiKey = firebaseConfig.apiKey;
  if (!apiKey) {
    return { ok: false, data: null, errorMessage: 'MISSING_API_KEY' };
  }
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const data = await resp.json().catch(() => ({}));
  const errorMessage = String(data?.error?.message || '');
  return { ok: resp.ok, data, errorMessage };
}

export async function getAdminBootstrapStatus(): Promise<AdminBootstrapStatus> {
  const configured = Boolean(process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim());
  const store = await getStore();
  const storeProfileExists = Object.values(store.users).some(
    (u) => u.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() && u.role === 'super_admin'
  );
  if (lastBootstrapStatus) {
    return {
      ...lastBootstrapStatus,
      configured,
      storeProfileExists,
    };
  }
  return {
    attempted: bootstrapCompleted,
    configured,
    firebaseAdminAvailable: false,
    storeProfileExists,
    adminEmail: BOOTSTRAP_ADMIN_EMAIL,
    message: configured
      ? 'Super Admin bootstrap is configured and awaiting verification.'
      : 'ADMIN_BOOTSTRAP_PASSWORD environment secret is not configured.',
  };
}

/**
 * Idempotent one-time Super Admin bootstrap.
 * Reads the initial password exclusively from process.env.ADMIN_BOOTSTRAP_PASSWORD.
 * Never hardcodes passwords, never logs plaintext credentials, never creates duplicates,
 * and never overwrites an existing changed password.
 */
export async function bootstrapSuperAdmin(options?: { forceRetry?: boolean }): Promise<AdminBootstrapStatus> {
  const storeSnapshot = await getStore();
  const hasStoredAdmin = Object.values(storeSnapshot.users).some(
    (u) => u.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() && u.role === 'super_admin'
  );

  if (bootstrapCompleted && !options?.forceRetry && lastBootstrapStatus) {
    return {
      ...lastBootstrapStatus,
      storeProfileExists: hasStoredAdmin,
    };
  }
  bootstrapCompleted = true;

  const initialPassword = (process.env.ADMIN_BOOTSTRAP_PASSWORD || '').trim();
  if (!initialPassword) {
    console.info(
      `[Bootstrap] ADMIN_BOOTSTRAP_PASSWORD is not set; skipping automatic creation of ${BOOTSTRAP_ADMIN_EMAIL}.`
    );
    lastBootstrapStatus = {
      attempted: false,
      configured: false,
      firebaseAdminAvailable: false,
      storeProfileExists: hasStoredAdmin,
      adminEmail: BOOTSTRAP_ADMIN_EMAIL,
      message: 'ADMIN_BOOTSTRAP_PASSWORD environment secret is not configured.',
    };
    return lastBootstrapStatus;
  }

  if (initialPassword.length < 8) {
    console.warn(
      '[Bootstrap] ADMIN_BOOTSTRAP_PASSWORD must be at least 8 characters. Skipping creation.'
    );
    lastBootstrapStatus = {
      attempted: false,
      configured: false,
      firebaseAdminAvailable: false,
      storeProfileExists: hasStoredAdmin,
      adminEmail: BOOTSTRAP_ADMIN_EMAIL,
      errorCode: 'weak-bootstrap-password',
      message: 'ADMIN_BOOTSTRAP_PASSWORD is shorter than 8 characters.',
    };
    return lastBootstrapStatus;
  }

  const persistVerifiedAdminRecord = async (params: {
    uid: string;
    displayName?: string;
    emailVerified: boolean;
    createdNew: boolean;
  }): Promise<boolean> => {
    const store = await getStore();
    const existingByUid = store.users[params.uid];
    const existingByEmail = Object.values(store.users).find(
      (u) => u.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
    );
    const existingUser = existingByUid || existingByEmail;
    const now = new Date().toISOString();

    // Security invariant: never grant super_admin until email_verified === true
    const canGrantSuperAdmin = params.emailVerified === true;

    const account: UserAccount = {
      uid: params.uid,
      email: BOOTSTRAP_ADMIN_EMAIL,
      displayName: existingUser?.displayName || params.displayName || 'Super Admin',
      phone: existingUser?.phone,
      role: canGrantSuperAdmin ? 'super_admin' : existingUser?.role || 'customer',
      status: 'active',
      preferredCurrency: existingUser?.preferredCurrency || 'TZS',
      preferredCountry: existingUser?.preferredCountry || 'Tanzania',
      addresses: existingUser?.addresses || [],
      ...(canGrantSuperAdmin
        ? {
            permissions: {
              canVerifyPayments: true,
              canManageSettings: true,
              canModerateCatalog: true,
            },
          }
        : {}),
      emailVerified: params.emailVerified,
      authProvider: existingUser?.authProvider || 'password',
      // Require initial password change when newly bootstrapped; preserve false once changed
      mustChangePassword: params.createdNew ? true : existingUser?.mustChangePassword ?? false,
      createdAt: existingUser?.createdAt || now,
      updatedAt: now,
    };

    await upsertUser(account);

    if (canGrantSuperAdmin) {
      try {
        await adminDb.collection('admins').doc(params.uid).set(
          {
            uid: params.uid,
            email: BOOTSTRAP_ADMIN_EMAIL,
            role: 'super_admin',
            updatedAt: now,
          },
          { merge: true }
        );
      } catch {
        // Ignore in offline/headless mode without GCP ADC
      }
    }

    if (params.createdNew) {
      await appendAuditLog({
        actorUid: params.uid,
        actorEmail: BOOTSTRAP_ADMIN_EMAIL,
        actorRole: canGrantSuperAdmin ? 'super_admin' : 'super_admin_candidate',
        action: 'SUPER_ADMIN_BOOTSTRAPPED',
        targetType: 'user',
        targetId: params.uid,
        details: canGrantSuperAdmin
          ? 'One-time Super Admin account provisioned via ADMIN_BOOTSTRAP_PASSWORD.'
          : 'Super Admin password account provisioned; awaiting email verification.',
      });
      console.info(`[Bootstrap] Provisioned Firebase Auth account for ${BOOTSTRAP_ADMIN_EMAIL}.`);
    } else if (canGrantSuperAdmin) {
      console.info(`[Bootstrap] Verified existing Super Admin account for ${BOOTSTRAP_ADMIN_EMAIL}.`);
    }

    return canGrantSuperAdmin;
  };

  try {
    let firebaseAdminRecord;
    let createdNew = false;

    try {
      firebaseAdminRecord = await adminAuth.getUserByEmail(BOOTSTRAP_ADMIN_EMAIL);
    } catch (lookupErr: any) {
      if (lookupErr?.code === 'auth/user-not-found') {
        firebaseAdminRecord = await adminAuth.createUser({
          email: BOOTSTRAP_ADMIN_EMAIL,
          password: initialPassword,
          displayName: 'Tanzanite Express Super Admin',
          emailVerified: true,
        });
        createdNew = true;
      } else {
        throw lookupErr;
      }
    }

    const granted = await persistVerifiedAdminRecord({
      uid: firebaseAdminRecord.uid,
      displayName: firebaseAdminRecord.displayName,
      emailVerified: Boolean(firebaseAdminRecord.emailVerified),
      createdNew,
    });

    lastBootstrapStatus = {
      attempted: true,
      configured: true,
      firebaseAdminAvailable: true,
      storeProfileExists: granted,
      adminEmail: BOOTSTRAP_ADMIN_EMAIL,
      createdNewAccount: createdNew,
      message: createdNew
        ? 'Super Admin account created; initial password change required on first login.'
        : 'Existing Super Admin account verified and linked to database profile.',
    };
    return lastBootstrapStatus;
  } catch (err: any) {
    const errCode = typeof err?.code === 'string' ? err.code : 'admin-sdk-unavailable';

    // When container ADC lacks Identity Toolkit permission on the target Firebase project,
    // use Firebase Identity Toolkit Web API + public JWT verification so bootstrap still works cleanly.
    try {
      const signInRes = await callIdentityToolkit('signInWithPassword', {
        email: BOOTSTRAP_ADMIN_EMAIL,
        password: initialPassword,
        returnSecureToken: true,
      });

      if (signInRes.ok && signInRes.data?.idToken) {
        const decoded = await adminAuth.verifyIdToken(signInRes.data.idToken);
        const verified = decoded.email_verified === true;
        if (!verified) {
          await callIdentityToolkit('sendOobCode', {
            requestType: 'VERIFY_EMAIL',
            idToken: signInRes.data.idToken,
          }).catch(() => {});
        }
        const granted = await persistVerifiedAdminRecord({
          uid: decoded.uid,
          displayName: typeof decoded.name === 'string' ? decoded.name : undefined,
          emailVerified: verified,
          createdNew: false,
        });

        lastBootstrapStatus = {
          attempted: true,
          configured: true,
          firebaseAdminAvailable: true,
          storeProfileExists: granted,
          adminEmail: BOOTSTRAP_ADMIN_EMAIL,
          createdNewAccount: false,
          ...(verified ? {} : { errorCode: 'admin-email-unverified' }),
          message: verified
            ? 'Super Admin password credentials verified and linked to database profile.'
            : 'Super Admin password credentials verified, but email verification is required before Admin access activates (check mahelaissa1@gmail.com inbox or sign in with Google).',
        };
        return lastBootstrapStatus;
      }

      if (
        signInRes.errorMessage.includes('OPERATION_NOT_ALLOWED') ||
        signInRes.errorMessage.includes('ADMIN_ONLY_OPERATION')
      ) {
        lastBootstrapStatus = {
          attempted: true,
          configured: true,
          firebaseAdminAvailable: false,
          storeProfileExists: hasStoredAdmin,
          adminEmail: BOOTSTRAP_ADMIN_EMAIL,
          errorCode: 'auth/operation-not-allowed',
          message:
            'Email/Password sign-in provider is disabled in Firebase Console for this project. Enable Email/Password under Authentication → Sign-in method, or sign in with Google.',
        };
        return lastBootstrapStatus;
      }

      if (
        signInRes.errorMessage.includes('INVALID_LOGIN_CREDENTIALS') ||
        signInRes.errorMessage.includes('EMAIL_NOT_FOUND') ||
        signInRes.errorMessage.includes('INVALID_PASSWORD')
      ) {
        const signUpRes = await callIdentityToolkit('signUp', {
          email: BOOTSTRAP_ADMIN_EMAIL,
          password: initialPassword,
          returnSecureToken: true,
        });

        if (signUpRes.ok && signUpRes.data?.idToken) {
          await callIdentityToolkit('update', {
            idToken: signUpRes.data.idToken,
            displayName: 'Tanzanite Express Super Admin',
            returnSecureToken: false,
          }).catch(() => {});
          await callIdentityToolkit('sendOobCode', {
            requestType: 'VERIFY_EMAIL',
            idToken: signUpRes.data.idToken,
          }).catch(() => {});

          const decoded = await adminAuth.verifyIdToken(signUpRes.data.idToken);
          await persistVerifiedAdminRecord({
            uid: decoded.uid,
            displayName: 'Tanzanite Express Super Admin',
            emailVerified: decoded.email_verified === true,
            createdNew: true,
          });

          lastBootstrapStatus = {
            attempted: true,
            configured: true,
            firebaseAdminAvailable: true,
            storeProfileExists: decoded.email_verified === true,
            adminEmail: BOOTSTRAP_ADMIN_EMAIL,
            createdNewAccount: true,
            ...(decoded.email_verified === true ? {} : { errorCode: 'admin-email-unverified' }),
            message:
              'Super Admin password account provisioned in Firebase Authentication. Verify the email link sent to mahelaissa1@gmail.com (or sign in via Google) to activate Super Admin privileges.',
          };
          return lastBootstrapStatus;
        }

        if (signUpRes.errorMessage.includes('EMAIL_EXISTS')) {
          lastBootstrapStatus = {
            attempted: true,
            configured: true,
            firebaseAdminAvailable: true,
            storeProfileExists: hasStoredAdmin,
            adminEmail: BOOTSTRAP_ADMIN_EMAIL,
            errorCode: 'account-exists-different-credential',
            message:
              'An account for mahelaissa1@gmail.com already exists in Firebase Authentication with a different password or Google-only sign-in. Sign in with Google or use Forgot Password to set a new password.',
          };
          return lastBootstrapStatus;
        }

        if (
          signUpRes.errorMessage.includes('OPERATION_NOT_ALLOWED') ||
          signUpRes.errorMessage.includes('ADMIN_ONLY_OPERATION')
        ) {
          lastBootstrapStatus = {
            attempted: true,
            configured: true,
            firebaseAdminAvailable: false,
            storeProfileExists: hasStoredAdmin,
            adminEmail: BOOTSTRAP_ADMIN_EMAIL,
            errorCode: 'auth/operation-not-allowed',
            message:
              'Email/Password sign-up is disabled in Firebase Console for this project. Enable Email/Password under Authentication → Sign-in method, or sign in with Google.',
          };
          return lastBootstrapStatus;
        }
      }
    } catch {
      // Fall through cleanly if network/offline
    }

    console.info(
      `[Bootstrap] Super Admin Firebase Auth bootstrap skipped (${errCode}: ${err?.message || 'Firebase Admin unavailable'}).`
    );
    lastBootstrapStatus = {
      attempted: true,
      configured: true,
      firebaseAdminAvailable: false,
      storeProfileExists: hasStoredAdmin,
      adminEmail: BOOTSTRAP_ADMIN_EMAIL,
      errorCode: errCode,
      message: `Bootstrap skipped: ${err?.message || 'Firebase Admin SDK unavailable in this environment.'}`,
    };
    return lastBootstrapStatus;
  }
}
