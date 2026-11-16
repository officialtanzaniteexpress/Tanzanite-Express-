import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck, Store, User, X } from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext';
import { TanzaniteLogo } from './TanzaniteBrand';

export const AuthModal: React.FC = () => {
  const {
    authModalOpen,
    setAuthModalOpen,
    authModalTab,
    setAuthModalTab,
    signInWithEmail,
    signInWithGoogle,
    registerWithEmail,
    sendPasswordReset,
    setActivePage,
    t,
  } = useMarketplace();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [accountType, setAccountType] = useState<'customer' | 'supplier'>('customer');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [adminHint, setAdminHint] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  useEffect(() => {
    setErrorMsg('');
    setAdminHint('');
    setInfoMsg('');
  }, [authModalTab, authModalOpen]);

  useEffect(() => {
    if (!authModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAuthModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authModalOpen, setAuthModalOpen]);

  if (!authModalOpen) return null;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setAdminHint('');
    setBusy(true);
    try {
      await signInWithEmail(email, password);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Sign in failed.');
      if (email.trim().toLowerCase() === 'mahelaissa1@gmail.com') {
        fetch('/api/auth/admin-status')
          .then((r) => (r.ok ? r.json() : null))
          .then((status) => {
            if (status?.message) {
              setAdminHint(String(status.message));
            }
          })
          .catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!displayName.trim() || displayName.trim().length < 2) {
      setErrorMsg('Please enter your full name.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (!acceptedTerms) {
      setErrorMsg('Please accept the TANZANITE EXPRESS Terms & Conditions and Privacy Policy.');
      return;
    }
    setBusy(true);
    try {
      await registerWithEmail({
        displayName,
        email,
        phone,
        password,
        accountType,
        acceptedTerms,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Account creation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setInfoMsg(`Password reset instructions sent to ${email.trim()}. Check your inbox.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to send reset link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#111322]/65 backdrop-blur-xs overflow-y-auto p-2.5 sm:p-4 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="TANZANITE EXPRESS Authentication"
      onClick={() => setAuthModalOpen(false)}
    >
      <div
        className="bg-white border border-[#E2E5F0] w-full max-w-md shadow-xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-[#F8F9FC] border-b border-[#E2E5F0] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <TanzaniteLogo
              iconClassName="w-5 h-5 sm:w-6 sm:h-6 shrink-0"
              wordmarkClassName="font-editorial text-base sm:text-lg font-semibold tracking-tight truncate"
            />
            <p className="text-[11px] text-neutral-500 mt-0.5 truncate">Fashion You Love, Delivered to You</p>
          </div>
          <button
            type="button"
            onClick={() => setAuthModalOpen(false)}
            aria-label="Close sign in dialog"
            className="min-h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center text-neutral-500 hover:text-[#111322] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="grid grid-cols-2 border-b border-[#E2E5F0] bg-[#F8F9FC] text-xs font-semibold">
          <button
            type="button"
            onClick={() => setAuthModalTab('signin')}
            className={`min-h-[44px] py-3 border-b-2 transition-colors cursor-pointer ${
              authModalTab === 'signin'
                ? 'border-[#2B3A9F] text-[#2B3A9F] bg-white'
                : 'border-transparent text-neutral-500 hover:text-[#111322]'
            }`}
          >
            {t('signIn')}
          </button>
          <button
            type="button"
            onClick={() => setAuthModalTab('register')}
            className={`min-h-[44px] py-3 border-b-2 transition-colors cursor-pointer ${
              authModalTab === 'register'
                ? 'border-[#2B3A9F] text-[#2B3A9F] bg-white'
                : 'border-transparent text-neutral-500 hover:text-[#111322]'
            }`}
          >
            {t('createAccount')}
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 text-xs">
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-3.5 py-2.5 leading-relaxed break-words space-y-1.5">
              <p>{errorMsg}</p>
              {adminHint && (
                <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-1.5">
                  {adminHint}
                </p>
              )}
              {authModalTab === 'signin' &&
                email.trim().toLowerCase() === 'mahelaissa1@gmail.com' && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setAuthModalTab('reset')}
                      className="underline font-semibold text-[#2B3A9F] cursor-pointer"
                    >
                      Send Password Reset Link
                    </button>
                  </div>
                )}
            </div>
          )}
          {infoMsg && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3.5 py-2.5 leading-relaxed">
              {infoMsg}
            </div>
          )}

          {authModalTab === 'signin' && (
            <form onSubmit={handleSignIn} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                  {t('emailLabel')}
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full min-h-[44px] border border-[#E2E5F0] pl-9 pr-3 py-2 bg-[#F8F9FC] text-[#111322]"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-medium text-neutral-600">
                    {t('passwordLabel')}
                  </label>
                  <button
                    type="button"
                    onClick={() => setAuthModalTab('reset')}
                    className="text-[11px] text-[#2B3A9F] hover:text-[#5B3CC4] underline cursor-pointer"
                  >
                    {t('forgotPassword')}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] border border-[#E2E5F0] pl-9 pr-10 py-2 bg-[#F8F9FC] text-[#111322]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-neutral-500 hover:text-[#111322] cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[44px] bg-[#2B3A9F] hover:bg-[#1E2A78] text-white font-semibold uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Signing in...' : t('signIn')}
              </button>
            </form>
          )}

          {authModalTab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3">
              <div>
                <p className="text-[11px] font-medium text-neutral-600 mb-1.5">Account Role</p>
                <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAccountType('customer')}
                    className={`min-h-[44px] flex items-center justify-center gap-2 border px-3 py-2 font-medium transition-colors cursor-pointer ${
                      accountType === 'customer'
                        ? 'border-[#2B3A9F] bg-[#F8F9FC] text-[#2B3A9F]'
                        : 'border-[#E2E5F0] text-neutral-600'
                    }`}
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>Customer</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('supplier')}
                    className={`min-h-[44px] flex items-center justify-center gap-2 border px-3 py-2 font-medium transition-colors cursor-pointer ${
                      accountType === 'supplier'
                        ? 'border-[#2B3A9F] bg-[#F8F9FC] text-[#2B3A9F]'
                        : 'border-[#E2E5F0] text-neutral-600'
                    }`}
                  >
                    <Store className="w-3.5 h-3.5" />
                    <span>Supplier (Free)</span>
                  </button>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                    {t('fullNameLabel')} *
                  </label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Amina Hassan"
                    className="w-full min-h-[44px] border border-[#E2E5F0] px-3 py-2 bg-[#F8F9FC]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                    {t('phoneLabel')}
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+255 7XX..."
                    className="w-full min-h-[44px] border border-[#E2E5F0] px-3 py-2 bg-[#F8F9FC]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                  {t('emailLabel')} *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full min-h-[44px] border border-[#E2E5F0] px-3 py-2 bg-[#F8F9FC]"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                    {t('passwordLabel')} *
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 chars"
                    className="w-full min-h-[44px] border border-[#E2E5F0] px-3 py-2 bg-[#F8F9FC]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                    {t('confirmPasswordLabel')} *
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm"
                    className="w-full min-h-[44px] border border-[#E2E5F0] px-3 py-2 bg-[#F8F9FC]"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2 text-[11px] text-neutral-600 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 accent-[#2B3A9F]"
                />
                <span>
                  {t('termsAgreeLabel')}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setAuthModalOpen(false);
                      setActivePage('support');
                    }}
                    className="text-[#2B3A9F] underline cursor-pointer"
                  >
                    Read Policies
                  </button>
                </span>
              </label>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[44px] bg-[#2B3A9F] hover:bg-[#1E2A78] text-white font-semibold uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Creating Account...' : t('createAccount')}
              </button>
            </form>
          )}

          {authModalTab === 'reset' && (
            <form onSubmit={handleReset} className="space-y-3.5">
              <div className="flex items-center gap-2 text-[#111322] font-semibold">
                <KeyRound className="w-4 h-4 text-[#5B3CC4]" />
                <span>{t('resetPasswordTitle')}</span>
              </div>
              <p className="text-neutral-600 leading-relaxed">
                Enter the email address registered with TANZANITE EXPRESS and we will send a password reset link.
              </p>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full min-h-[44px] border border-[#E2E5F0] px-3 py-2 bg-[#F8F9FC]"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAuthModalTab('signin')}
                  className="min-h-[44px] border border-[#E2E5F0] px-4 py-2 font-medium cursor-pointer"
                >
                  {t('back')}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 min-h-[44px] bg-[#2B3A9F] hover:bg-[#1E2A78] text-white font-semibold uppercase tracking-wide cursor-pointer disabled:opacity-50"
                >
                  {busy ? 'Sending...' : 'Send Reset Link'}
                </button>
              </div>
            </form>
          )}

          {authModalTab !== 'reset' && (
            <>
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#E2E5F0]" />
                </div>
                <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                  <span className="bg-white px-2.5 text-neutral-400">or</span>
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => signInWithGoogle()}
                className="w-full min-h-[44px] border border-[#E2E5F0] bg-[#F8F9FC] hover:border-[#2B3A9F] text-[#111322] font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4 text-[#2B3A9F]" />
                <span>{t('signInGoogle')}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const MandatoryPasswordChangeModal: React.FC = () => {
  const { firebaseUser, userAccount, changePassword, logout } = useMarketplace();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNew, setConfirmNew] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);

  if (!firebaseUser || !userAccount?.mustChangePassword) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (newPassword.length < 10) {
      setErrorMsg('New Super Admin password must be at least 10 characters.');
      return;
    }
    if (newPassword !== confirmNew) {
      setErrorMsg('New passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setErrorMsg('New password must differ from the bootstrap password.');
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Password update failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-[#111322]/75 backdrop-blur-xs overflow-y-auto p-3 sm:p-4 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Mandatory Super Admin Password Update"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-[#2B3A9F] w-full max-w-md p-4 sm:p-6 space-y-4 text-xs shadow-2xl my-auto"
      >
        <div className="flex items-center gap-2 text-[#2B3A9F] font-semibold uppercase tracking-wider text-[11px]">
          <ShieldCheck className="w-4 h-4" />
          <span>Security Requirement · First Admin Login</span>
        </div>
        <h2 className="font-editorial text-2xl font-semibold text-[#111322]">
          Update Super Admin Password
        </h2>
        <p className="text-neutral-600 leading-relaxed">
          You signed in with the initial bootstrap credentials ({userAccount.email}). For security, please set a new private password before accessing marketplace controls.
        </p>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2">{errorMsg}</div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-neutral-600 mb-1">
              Current Password
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full min-h-[44px] border border-[#E2E5F0] px-3 py-2 bg-[#F8F9FC]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-600 mb-1">
              New Password (min 10 characters)
            </label>
            <input
              type="password"
              required
              minLength={10}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full min-h-[44px] border border-[#E2E5F0] px-3 py-2 bg-[#F8F9FC]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-600 mb-1">
              Confirm New Password
            </label>
            <input
              type="password"
              required
              minLength={10}
              value={confirmNew}
              onChange={(e) => setConfirmNew(e.target.value)}
              className="w-full min-h-[44px] border border-[#E2E5F0] px-3 py-2 bg-[#F8F9FC]"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => logout()}
            className="min-h-[44px] border border-[#E2E5F0] px-4 py-2 font-medium text-neutral-700 cursor-pointer"
          >
            Sign Out
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex-1 min-h-[44px] bg-[#2B3A9F] hover:bg-[#1E2A78] text-white font-semibold uppercase tracking-wide cursor-pointer disabled:opacity-50"
          >
            {busy ? 'Updating...' : 'Save New Password'}
          </button>
        </div>
      </form>
    </div>
  );
};
