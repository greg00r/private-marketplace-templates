import { config } from '@grafana/runtime';

export type MarketplaceOrgRole = 'Admin' | 'Editor' | 'Viewer';

export function normalizeOrgRole(role: string | undefined | null): MarketplaceOrgRole {
  const normalized = String(role ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  if (normalized === 'admin' || normalized === 'grafanaadmin' || normalized === 'serveradmin') {
    return 'Admin';
  }

  if (normalized === 'editor') {
    return 'Editor';
  }

  return 'Viewer';
}

export function getCurrentOrgRole(): MarketplaceOrgRole {
  return normalizeOrgRole(config.bootData?.user?.orgRole);
}

export function getCurrentUserDisplayName(): string {
  const currentUser = config.bootData?.user;

  if (currentUser?.name?.trim()) {
    return currentUser.name.trim();
  }

  if (currentUser?.login?.trim()) {
    return currentUser.login.trim();
  }

  if (currentUser?.email?.trim()) {
    return currentUser.email.trim();
  }

  return 'Current user';
}

export function canPublishTemplatesForRole(role: string | undefined | null): boolean {
  const normalized = normalizeOrgRole(role);
  return normalized === 'Admin' || normalized === 'Editor';
}

export function canCurrentUserPublishTemplates(): boolean {
  return canPublishTemplatesForRole(getCurrentOrgRole());
}

export function canApproveTemplatesForRole(role: string | undefined | null): boolean {
  return normalizeOrgRole(role) === 'Admin';
}

export function canCurrentUserApproveTemplates(): boolean {
  return canApproveTemplatesForRole(getCurrentOrgRole());
}
