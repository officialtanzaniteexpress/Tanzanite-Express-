import {
  MarketplaceSettings,
  PaymentGatewayStatus,
  SupplierIntegrationStatus,
} from '../types/marketplace.ts';

/**
 * MVP Manual Payment Verification Channels.
 * Strictly driven by Admin-configured settings — no paid payment gateway APIs
 * (Pesapal, Selcom, AzamPay, Stripe) are required for launch.
 */
export function getPaymentGatewaysStatus(settings?: MarketplaceSettings): PaymentGatewayStatus[] {
  const officialRecipient =
    settings?.officialRecipientName?.trim() ||
    settings?.manualPaymentAccountName?.trim() ||
    'MAHELA ISSA KISENA';

  const mpesaEnabled = settings?.mpesaEnabled ?? true;
  const mpesaPhone = (settings?.mpesaPhone ?? settings?.manualPaymentPhone ?? '').trim();
  const mpesaAccountHolder =
    settings?.mpesaAccountHolder?.trim() || officialRecipient;
  const mpesaInstructions =
    settings?.mpesaInstructions?.trim() ||
    'Send the exact amount to the displayed M-Pesa number.';

  const nmbEnabled = settings?.nmbEnabled ?? true;
  const bankName = settings?.manualPaymentBankName?.trim() || 'NMB Bank';
  const nmbAccountNumber =
    (settings?.nmbAccountNumber ?? settings?.manualPaymentBankAccount ?? '').trim();
  const nmbAccountName =
    settings?.nmbAccountName?.trim() || officialRecipient;
  const nmbBranch = settings?.nmbBranch?.trim() || '';
  const nmbInstructions =
    settings?.nmbInstructions?.trim() ||
    'Transfer the exact amount to the displayed account.';

  return [
    {
      id: 'manual_mobile',
      name: 'M-Pesa',
      market: 'Tanzania',
      methods: ['M-Pesa', 'Tigo Pesa', 'Airtel Money', 'Halopesa'],
      credentialsConfigured: Boolean(mpesaPhone),
      merchantApproved: mpesaEnabled,
      mode: 'manual',
      sandboxAvailableInDev: false,
      enabledForCheckout: Boolean(mpesaEnabled && mpesaPhone),
      statusLabel: !mpesaEnabled
        ? 'Temporarily Disabled by Admin'
        : mpesaPhone
          ? 'Active — Manual Payment Verification by Admin'
          : 'Awaiting Super Admin M-Pesa Number',
      instructions: mpesaInstructions,
      accountDetails: {
        phone: mpesaPhone,
        accountName: mpesaAccountHolder,
      },
      requiredEnvVars: [],
    },
    {
      id: 'manual_nmb',
      name: 'NMB Bank Transfer',
      market: 'Tanzania',
      methods: ['NMB Bank Transfer', 'NMB Wakala / Branch Deposit'],
      credentialsConfigured: Boolean(nmbAccountNumber),
      merchantApproved: nmbEnabled,
      mode: 'manual',
      sandboxAvailableInDev: false,
      enabledForCheckout: Boolean(nmbEnabled && nmbAccountNumber),
      statusLabel: !nmbEnabled
        ? 'Temporarily Disabled by Admin'
        : nmbAccountNumber
          ? 'Active — Manual Bank Transfer Verification by Admin'
          : 'Awaiting Super Admin NMB Account Number',
      instructions: nmbInstructions,
      accountDetails: {
        bankName,
        bankAccount: nmbAccountNumber,
        bankBranch: nmbBranch,
        accountName: nmbAccountName,
      },
      requiredEnvVars: [],
    },
  ];
}

export function getSupplierIntegrationsStatus(): SupplierIntegrationStatus[] {
  return [
    {
      id: 'local_manual',
      name: 'Independent Atelier & Global Supplier Portal',
      type: 'manual_portal',
      credentialsConfigured: true,
      connectionStatus: 'MANUAL_ACTIVE',
      requiredEnvVars: [],
      capabilities: [
        'Free supplier registration with Admin KYC review & retail markup pricing',
        'Direct supplier dashboard & CSV bulk product upload',
        'Admin-verified suborder release & courier tracking submission',
        'Real-time in-app & email/WhatsApp order notifications',
      ],
      syncWarnings: [],
      documentationNote:
        'Active for Tanzanian and international independent fashion suppliers without external paid API dependencies.',
    },
  ];
}
