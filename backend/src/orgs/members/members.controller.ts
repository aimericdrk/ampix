import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { parseOrThrow } from '../../auth/auth.schemas';
import type { AuthRequest } from '../../auth/auth.types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../authz/roles.decorator';
import { RolesGuard } from '../../authz/roles.guard';
import { changeMemberRoleSchema } from './members.schemas';
import { MembersService } from './members.service';
import type { MemberListItem, UpdatedMember } from './members.types';

@Controller('api/v1/orgs/:orgId/members')
@UseGuards(JwtAuthGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('viewer')
  async list(@Param('orgId') orgId: string): Promise<{ members: MemberListItem[] }> {
    const members = await this.members.list(orgId);
    return { members };
  }

  @Patch(':userId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async changeRole(
    @Req() req: AuthRequest,
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<UpdatedMember> {
    const dto = parseOrThrow(changeMemberRoleSchema, body);
    return this.members.changeRole(orgId, req.user!.id, userId, dto.role);
  }

  @Delete(':userId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(204)
  async remove(@Param('orgId') orgId: string, @Param('userId') userId: string): Promise<void> {
    await this.members.remove(orgId, userId);
  }
}
