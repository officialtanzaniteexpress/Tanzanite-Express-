import React from 'react';
import { Building2, Copy, ShieldCheck, Smartphone } from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext';
import { PaymentGatewayStatus } from '../types/marketplace';

interface PaymentInstructionCardProps {
  gateway: PaymentGatewayStatus;
  amountText: string;
  highlighted?: boolean;
  compact?: boolean;
}

export const PaymentInstructionCard: React.FC<PaymentInstructionCardProps> = ({
  gateway,
  amountText,
  highlighted = false,
  compact = false,
}) => {
  const { t, toast } = useMarketplace();
  const isMpesa = gateway.id === 'manual_mobile';
  const details = gateway.accountDetails || {};

  const copyValue = async (val: string) => {
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      toast(`Copied: ${val}`, 'info');
    } catch {
      toast(val, 'info');
    }
  };

  const primaryNumber = isMpesa ? details.phone : details.bankAccount;
  const recipientName = details.accountName || '';

  return (
    <div
      className={`border ${
        highlighted ? 'border-[#2B3A9F] bg-[#F8F9FC]' : 'border-[#E2E5F0] bg-[#F8F9FC]'
      } ${compact ? 'p-3.5 space-y-2.5' : 'p-4 space-y-3'} text-xs`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E2E5F0]">
        <div className="flex items-center gap-2 font-semibold text-[#111322]">
          {isMpesa ? (
            <Smartphone className="w-4 h-4 text-[#2B3A9F] shrink-0" />
          ) : (
            <Building2 className="w-4 h-4 text-[#5B3CC4] shrink-0" />
          )}
          <span>
            {t('paymentMethodTitle')}: {gateway.name}
          </span>
        </div>
        {primaryNumber && (
          <button
            type="button"
            onClick={() => copyValue(primaryNumber)}
            className="inline-flex items-center gap-1 border border-[#E2E5F0] bg-white px-2.5 py-1 text-[11px] font-medium hover:border-[#2B3A9F] cursor-pointer"
          >
            <Copy className="w-3 h-3" />
            Copy {isMpesa ? 'Number' : 'Account'}
          </button>
        )}
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-[11px] text-neutral-500">
            {isMpesa ? t('recipientNameLabel') : t('accountHolderLabel')}
          </dt>
          <dd className="font-semibold text-[#111322] flex items-center gap-1.5 mt-0.5 break-words">
            <ShieldCheck className="w-3.5 h-3.5 text-[#5B3CC4] shrink-0" />
            <span>{recipientName || '—'}</span>
          </dd>
        </div>

        {isMpesa ? (
          <div>
            <dt className="text-[11px] text-neutral-500">{t('receivingPhoneLabel')}</dt>
            <dd className="font-mono-tabular font-bold text-sm text-[#111322] mt-0.5 break-all">
              {details.phone || 'Not configured by Admin'}
            </dd>
          </div>
        ) : (
          <>
            <div>
              <dt className="text-[11px] text-neutral-500">{t('bankLabel')}</dt>
              <dd className="font-semibold text-[#111322] mt-0.5">
                {details.bankName || 'NMB Bank'}
                {details.bankBranch ? ` (${details.bankBranch})` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-neutral-500">{t('accountNumberLabel')}</dt>
              <dd className="font-mono-tabular font-bold text-sm text-[#111322] mt-0.5 break-all">
                {details.bankAccount || 'Not configured by Admin'}
              </dd>
            </div>
          </>
        )}

        <div>
          <dt className="text-[11px] text-neutral-500">{t('amountToPayLabel')}</dt>
          <dd className="font-mono-tabular font-bold text-sm text-[#2B3A9F] mt-0.5">
            {amountText}
          </dd>
        </div>
      </dl>

      <div className="pt-2 border-t border-[#E2E5F0] text-[11px] text-neutral-700 leading-relaxed">
        <span className="font-semibold text-[#111322]">{t('instructionsLabel')}: </span>
        {gateway.instructions ||
          (isMpesa ? t('mpesaDefaultInstruction') : t('nmbDefaultInstruction'))}
      </div>
    </div>
  );
};
