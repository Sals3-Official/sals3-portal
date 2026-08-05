import { describe, expect, it } from 'vitest';
import {
  can,
  permissionsOf,
  PORTAL_PERMISSIONS,
  PORTAL_ROLES,
  type PortalRole,
} from './permissions';

describe('can', () => {
  it('gives an administrator every permission', () => {
    expect(
      PORTAL_PERMISSIONS.every((permission) => can('admin', permission)),
    ).toBe(true);
  });

  it('lets a viewer only read', () => {
    expect(can('viewer', 'product:read')).toBe(true);
    expect(can('viewer', 'product:edit')).toBe(false);
    expect(can('viewer', 'product:delete')).toBe(false);
    expect(can('viewer', 'product:publish')).toBe(false);
  });

  it('lets seller staff submit for review but never approve or publish', () => {
    expect(can('seller_staff', 'product:submit')).toBe(true);
    expect(can('seller_staff', 'product:approve')).toBe(false);
    expect(can('seller_staff', 'product:publish')).toBe(false);
    expect(can('seller_staff', 'product:delete')).toBe(false);
  });

  it('lets a catalogue reviewer approve but never create or edit', () => {
    expect(can('catalogue_reviewer', 'product:approve')).toBe(true);
    expect(can('catalogue_reviewer', 'product:create')).toBe(false);
    expect(can('catalogue_reviewer', 'product:edit')).toBe(false);
  });

  it('lets a seller manager publish and delete', () => {
    expect(can('seller_manager', 'product:publish')).toBe(true);
    expect(can('seller_manager', 'product:delete')).toBe(true);
  });

  it('never grants approval rights outside admin and reviewer roles', () => {
    const approvers = PORTAL_ROLES.filter((role: PortalRole) =>
      can(role, 'product:approve'),
    );

    expect(approvers).toEqual(['admin', 'catalogue_reviewer']);
  });
});

describe('permissionsOf', () => {
  it('returns only permissions from the known list', () => {
    PORTAL_ROLES.forEach((role) => {
      permissionsOf(role).forEach((permission) => {
        expect(PORTAL_PERMISSIONS).toContain(permission);
      });
    });
  });

  it('gives every role the right to read', () => {
    expect(PORTAL_ROLES.every((role) => can(role, 'product:read'))).toBe(true);
  });
});
