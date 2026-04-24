import { hostApiFetch } from '@/lib/host-api';
import type {
  ProviderAccount,
  ProviderType,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
} from '@/lib/providers';

export interface ProviderSnapshot {
  accounts: ProviderAccount[];
  statuses: ProviderWithKeyInfo[];
  vendors: ProviderVendorInfo[];
  defaultAccountId: string | null;
}

export const SYSTEM_DEFAULT_PROVIDER_ACCOUNT_ID = 'boostclaw-system-default';
const SYSTEM_DEFAULT_PROVIDER_TIMESTAMP = '9999-12-31T23:59:59.999Z';
const SYSTEM_DEFAULT_PROVIDER_DEFAULT_MODEL_ID = 'qwen-plus';

export interface SystemDefaultModelProviderInfo {
  available: boolean;
  accountId: string;
  label: string;
  baseUrl: string;
  apiProtocol: 'openai-completions';
  apiKey?: string;
  keyMasked?: string;
  userId?: string;
  error?: string;
}

export interface ProviderListItem {
  account: ProviderAccount;
  vendor?: ProviderVendorInfo;
  status?: ProviderWithKeyInfo;
}

function buildSystemDefaultProviderSnapshot(
  info: SystemDefaultModelProviderInfo,
  existingAccount?: ProviderAccount,
  existingStatus?: ProviderWithKeyInfo,
): Pick<ProviderSnapshot, 'accounts' | 'statuses'> | null {
  if (!info.available) return null;

  return {
    accounts: [{
      id: existingAccount?.id || info.accountId,
      vendorId: existingAccount?.vendorId || 'custom',
      label: existingAccount?.label || info.label,
      authMode: existingAccount?.authMode || 'api_key',
      baseUrl: existingAccount?.baseUrl || info.baseUrl,
      apiProtocol: existingAccount?.apiProtocol || info.apiProtocol,
      model: existingAccount?.model || SYSTEM_DEFAULT_PROVIDER_DEFAULT_MODEL_ID,
      headers: existingAccount?.headers,
      fallbackModels: existingAccount?.fallbackModels,
      fallbackAccountIds: existingAccount?.fallbackAccountIds,
      enabled: existingAccount?.enabled ?? true,
      isDefault: existingAccount?.isDefault ?? false,
      metadata: existingAccount?.metadata,
      createdAt: existingAccount?.createdAt || SYSTEM_DEFAULT_PROVIDER_TIMESTAMP,
      updatedAt: SYSTEM_DEFAULT_PROVIDER_TIMESTAMP,
    }],
    statuses: [{
      id: existingStatus?.id || info.accountId,
      name: existingAccount?.label || existingStatus?.name || info.label,
      type: existingStatus?.type || 'custom',
      baseUrl: existingStatus?.baseUrl || existingAccount?.baseUrl || info.baseUrl,
      apiProtocol: existingStatus?.apiProtocol || existingAccount?.apiProtocol || info.apiProtocol,
      model: existingStatus?.model || existingAccount?.model || SYSTEM_DEFAULT_PROVIDER_DEFAULT_MODEL_ID,
      headers: existingStatus?.headers,
      fallbackModels: existingStatus?.fallbackModels,
      fallbackProviderIds: existingStatus?.fallbackProviderIds,
      enabled: existingStatus?.enabled ?? true,
      createdAt: existingStatus?.createdAt || SYSTEM_DEFAULT_PROVIDER_TIMESTAMP,
      updatedAt: SYSTEM_DEFAULT_PROVIDER_TIMESTAMP,
      hasKey: true,
      keyMasked: info.keyMasked || '****',
    }],
  };
}

export async function fetchProviderSnapshot(
  options?: { includeSystemDefaultProvider?: boolean },
): Promise<ProviderSnapshot> {
  const includeSystemDefaultProvider = options?.includeSystemDefaultProvider ?? true;
  const [accounts, statuses, vendors, defaultInfo, systemDefaultProvider] = await Promise.all([
    hostApiFetch<ProviderAccount[]>('/api/provider-accounts'),
    hostApiFetch<ProviderWithKeyInfo[]>('/api/providers'),
    hostApiFetch<ProviderVendorInfo[]>('/api/provider-vendors'),
    hostApiFetch<{ accountId: string | null }>('/api/provider-accounts/default'),
    includeSystemDefaultProvider
      ? hostApiFetch<SystemDefaultModelProviderInfo>('/api/auth/system-default-model-provider').catch(() => null)
      : Promise.resolve(null),
  ]);

  const existingSystemAccount = accounts.find((account) => account.id === SYSTEM_DEFAULT_PROVIDER_ACCOUNT_ID);
  const existingSystemStatus = statuses.find((status) => status.id === SYSTEM_DEFAULT_PROVIDER_ACCOUNT_ID);
  const systemSnapshot = systemDefaultProvider
    ? buildSystemDefaultProviderSnapshot(systemDefaultProvider, existingSystemAccount, existingSystemStatus)
    : null;

  return {
    accounts: systemSnapshot ? [...systemSnapshot.accounts, ...accounts.filter((account) => account.id !== systemSnapshot.accounts[0].id)] : accounts,
    statuses: systemSnapshot ? [...systemSnapshot.statuses, ...statuses.filter((status) => status.id !== systemSnapshot.statuses[0].id)] : statuses,
    vendors,
    defaultAccountId: defaultInfo.accountId,
  };
}

export function hasConfiguredCredentials(
  account: ProviderAccount,
  status?: ProviderWithKeyInfo,
): boolean {
  if (account.authMode === 'oauth_device' || account.authMode === 'oauth_browser' || account.authMode === 'local') {
    return true;
  }
  return status?.hasKey ?? false;
}

export function pickPreferredAccount(
  accounts: ProviderAccount[],
  defaultAccountId: string | null,
  vendorId: ProviderType | string,
  statusMap: Map<string, ProviderWithKeyInfo>,
): ProviderAccount | null {
  const sameVendor = accounts.filter((account) => account.vendorId === vendorId);
  if (sameVendor.length === 0) return null;

  return (
    (defaultAccountId ? sameVendor.find((account) => account.id === defaultAccountId) : undefined)
    || sameVendor.find((account) => hasConfiguredCredentials(account, statusMap.get(account.id)))
    || sameVendor[0]
  );
}

export function buildProviderAccountId(
  vendorId: ProviderType,
  existingAccountId: string | null,
  vendors: ProviderVendorInfo[],
): string {
  if (existingAccountId) {
    return existingAccountId;
  }

  const vendor = vendors.find((candidate) => candidate.id === vendorId);
  return vendor?.supportsMultipleAccounts ? `${vendorId}-${crypto.randomUUID()}` : vendorId;
}

export function legacyProviderToAccount(provider: ProviderWithKeyInfo): ProviderAccount {
  return {
    id: provider.id,
    vendorId: provider.type,
    label: provider.name,
    authMode: provider.type === 'ollama' ? 'local' : 'api_key',
    baseUrl: provider.baseUrl,
    headers: provider.headers,
    model: provider.model,
    fallbackModels: provider.fallbackModels,
    fallbackAccountIds: provider.fallbackProviderIds,
    enabled: provider.enabled,
    isDefault: false,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

export function buildProviderListItems(
  accounts: ProviderAccount[],
  statuses: ProviderWithKeyInfo[],
  vendors: ProviderVendorInfo[],
  defaultAccountId: string | null,
): ProviderListItem[] {
  const safeAccounts = accounts ?? [];
  const safeStatuses = statuses ?? [];
  const safeVendors = vendors ?? [];
  const vendorMap = new Map(safeVendors.map((vendor) => [vendor.id, vendor]));
  const statusMap = new Map(safeStatuses.map((status) => [status.id, status]));

  if (safeAccounts.length > 0) {
    return safeAccounts
      .map((account) => ({
        account,
        vendor: vendorMap.get(account.vendorId),
        status: statusMap.get(account.id),
      }))
      .sort((left, right) => {
        if (left.account.id === defaultAccountId) return -1;
        if (right.account.id === defaultAccountId) return 1;
        return right.account.updatedAt.localeCompare(left.account.updatedAt);
      });
  }

  return safeStatuses.map((status) => ({
    account: legacyProviderToAccount(status),
    vendor: vendorMap.get(status.type),
    status,
  }));
}
