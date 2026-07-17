import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../auth/schemas/auth.schemas';
import { JwtAuthGuard } from '../auth/tokens/jwt-auth.guard';
import { Roles } from '../authz/roles.decorator';
import { RolesGuard } from '../authz/roles.guard';
import { createInvitationSchema } from './invitations.schemas';
import { InvitationsService } from './invitations.service';
import type { CreatedInvitation, InvitationListItem } from './invitations.types';

/** Org-scoped invitation management (contracts §13) — admin only, throughout. */
@Controller('api/v1/orgs/:orgId/invitations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class OrgInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  async create(@Param('orgId') orgId: string, @Body() body: unknown): Promise<CreatedInvitation> {
    const dto = parseOrThrow(createInvitationSchema, body);
    return this.invitations.create(orgId, dto.role);
  }

  @Get()
  async list(@Param('orgId') orgId: string): Promise<{ invitations: InvitationListItem[] }> {
    const invitations = await this.invitations.listPending(orgId);
    return { invitations };
  }

  @Delete(':invitationId')
  @HttpCode(204)
  async remove(
    @Param('orgId') orgId: string,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    await this.invitations.remove(orgId, invitationId);
  }
}
