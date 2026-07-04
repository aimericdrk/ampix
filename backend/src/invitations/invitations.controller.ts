import { Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InvitationsService } from './invitations.service';
import type { AcceptedInvitation, PublicInvitation } from './invitations.types';

/**
 * Public invitation lookup + authenticated accept (contracts §13). Deliberately NOT
 * `@UseGuards(JwtAuthGuard)` at the class level — `GET :token` must be reachable by a
 * not-yet-signed-up invitee.
 */
@Controller('api/v1/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get(':token')
  async getByToken(@Param('token') token: string): Promise<PublicInvitation> {
    return this.invitations.getByToken(token);
  }

  @Post(':token/accept')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async accept(
    @Req() req: AuthRequest,
    @Param('token') token: string,
  ): Promise<AcceptedInvitation> {
    return this.invitations.accept(token, req.user!.id);
  }
}
