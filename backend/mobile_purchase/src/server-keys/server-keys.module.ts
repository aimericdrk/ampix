import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { ServerKeysController } from './server-keys.controller';
import { ServerKeysService } from './server-keys.service';
import { ServerKeyGuard } from './server-key.guard';
import { ErasureCapabilityGuard } from './erasure-capability.guard';

/**
 * Server keys: the per-project backend credential and the guards that read it. AuthzModule
 * provides ProjectAccessGuard for the dashboard-facing management routes; PrismaModule is
 * @Global() so PrismaService needs no import. Both guards are exported so the routes they protect
 * (CustomerWritesModule's subscriber erasure) can use them without re-mounting this module —
 * the same shape CatalogModule uses to share PublicApiKeyGuard.
 */
@Module({
  imports: [AuthzModule],
  controllers: [ServerKeysController],
  providers: [ServerKeysService, ServerKeyGuard, ErasureCapabilityGuard],
  exports: [ServerKeyGuard, ErasureCapabilityGuard],
})
export class ServerKeysModule {}
