import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import { ProjectRolesGuard } from '../../authz/project-roles.guard';
import { PROJECT_ROLES_KEY } from '../../authz/project-roles.decorator';
import { RcAdminController } from './rc-admin.controller';

describe('RcAdminController authz metadata', () => {
  it('is JWT-guarded at class level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RcAdminController)).toEqual([JwtAuthGuard]);
  });

  it.each(['getStatus', 'upsert', 'disconnect', 'listJournal', 'replay', 'resync'] as const)(
    '%s requires project admin via ProjectRolesGuard',
    (method) => {
      const handler = RcAdminController.prototype[method];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([ProjectRolesGuard]);
      expect(Reflect.getMetadata(PROJECT_ROLES_KEY, handler)).toBe('admin');
    },
  );

  it.each(['refreshUser'] as const)(
    '%s requires project analyst via ProjectRolesGuard',
    (method) => {
      const handler = RcAdminController.prototype[method];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([ProjectRolesGuard]);
      expect(Reflect.getMetadata(PROJECT_ROLES_KEY, handler)).toBe('analyst');
    },
  );

  it('getUserSubscription has no role gate (assertMembership in service)', () => {
    const handler = RcAdminController.prototype.getUserSubscription;
    expect(Reflect.getMetadata(PROJECT_ROLES_KEY, handler)).toBeUndefined();
  });
});
