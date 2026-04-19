jest.mock('@grafana/runtime', () => ({
  config: {
    bootData: {
      user: null,
    },
  },
  hasPermission: jest.fn(() => false),
}));

import {
  canApproveTemplatesForRole,
  canPublishTemplatesForRole,
  getFallbackMarketplaceAccess,
  normalizeOrgRole,
} from './access';

describe('access', () => {
  it('normalizes Grafana roles to marketplace roles', () => {
    expect(normalizeOrgRole('Admin')).toBe('Admin');
    expect(normalizeOrgRole(' editor ')).toBe('Editor');
    expect(normalizeOrgRole('server admin')).toBe('Admin');
    expect(normalizeOrgRole('Viewer')).toBe('Viewer');
    expect(normalizeOrgRole('')).toBe('Viewer');
  });

  it('allows publishing only for editors and admins', () => {
    expect(canPublishTemplatesForRole('Admin')).toBe(true);
    expect(canPublishTemplatesForRole('Editor')).toBe(true);
    expect(canPublishTemplatesForRole('Viewer')).toBe(false);
    expect(canPublishTemplatesForRole(undefined)).toBe(false);
  });

  it('allows approving only for admins', () => {
    expect(canApproveTemplatesForRole('Admin')).toBe(true);
    expect(canApproveTemplatesForRole('Editor')).toBe(false);
    expect(canApproveTemplatesForRole('Viewer')).toBe(false);
    expect(canApproveTemplatesForRole(undefined)).toBe(false);
  });

  it('builds fallback marketplace access from org roles', () => {
    expect(getFallbackMarketplaceAccess('Viewer')).toMatchObject({
      read: true,
      publish: false,
      review: false,
      approve: false,
      delete: false,
      initialize: false,
      orgRole: 'Viewer',
    });

    expect(getFallbackMarketplaceAccess('Editor')).toMatchObject({
      read: true,
      publish: true,
      review: false,
      approve: false,
      delete: false,
      initialize: false,
      orgRole: 'Editor',
    });
  });
});
