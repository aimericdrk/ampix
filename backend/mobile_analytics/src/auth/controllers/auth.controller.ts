import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { ProblemException } from '../../common/problem-details';
import { requireAuthConfig } from '../services/auth-config.util';
import { AuthService } from '../services/auth.service';
import {
  changePasswordSchema,
  codeSchema,
  loginSchema,
  parseOrThrow,
  signupSchema,
  updateMeSchema,
  verify2faSchema,
} from '../schemas/auth.schemas';
import type { AuthRequest } from '../auth.types';
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from '../tokens/cookies';
import { JwtAuthGuard } from '../tokens/jwt-auth.guard';
import { RecoveryCodeService } from '../two-factor/recovery-code.service';
import { RefreshTokenService } from '../tokens/refresh-token.service';
import { TokenService } from '../tokens/token.service';
import { TotpService } from '../two-factor/totp.service';
import { TwoFactorAttemptLimiter } from '../two-factor/two-factor-attempt-limiter';

function unauthorized(detail: string): ProblemException {
  return new ProblemException({ status: 401, title: 'Unauthorized', detail });
}

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly totp: TotpService,
    private readonly recoveryCodes: RecoveryCodeService,
    private readonly attemptLimiter: TwoFactorAttemptLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('signup')
  @HttpCode(200)
  async signup(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const dto = parseOrThrow(signupSchema, body);
    const session = await this.authService.signup(dto);
    setRefreshCookie(res, session.refreshToken, requireAuthConfig(this.config));
    return { access_token: session.accessToken, user: session.user };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const dto = parseOrThrow(loginSchema, body);
    const result = await this.authService.login(dto);
    if ('mfaToken' in result) {
      return { mfa_required: true as const, mfa_token: result.mfaToken };
    }
    setRefreshCookie(res, result.refreshToken, requireAuthConfig(this.config));
    return { access_token: result.accessToken, user: result.user };
  }

  @Post('2fa/verify')
  @HttpCode(200)
  async verify2fa(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const dto = parseOrThrow(verify2faSchema, body);
    let userId: string;
    try {
      userId = this.tokens.verifyMfaToken(dto.mfa_token).sub;
    } catch {
      throw unauthorized('Missing, invalid, or expired mfa_token');
    }
    await this.attemptLimiter.assertAllowed('verify', userId);
    const session = await this.authService.completeMfaLogin(userId, dto.code);
    if (!session) {
      throw unauthorized('Invalid or expired code');
    }
    setRefreshCookie(res, session.refreshToken, requireAuthConfig(this.config));
    return { access_token: session.accessToken, user: session.user };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    const auth = requireAuthConfig(this.config);
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    if (!raw) {
      throw unauthorized('Missing refresh cookie');
    }
    const rotated = await this.refreshTokens.rotate(raw);
    if (!rotated) {
      clearRefreshCookie(res, auth);
      throw unauthorized('Invalid, expired, or revoked refresh token');
    }
    const user = await this.authService.getUserById(rotated.userId);
    if (!user) {
      clearRefreshCookie(res, auth);
      throw unauthorized('User no longer exists');
    }
    setRefreshCookie(res, rotated.token, auth);
    const accessToken = this.tokens.signAccessToken({
      id: user.id,
      email: user.email,
      name: user.name,
    });
    return { access_token: accessToken, user: { id: user.id, email: user.email, name: user.name } };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    if (raw) {
      await this.refreshTokens.revoke(raw);
    }
    clearRefreshCookie(res, requireAuthConfig(this.config));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: AuthRequest) {
    const user = await this.authService.getUserById(req.user!.id);
    if (!user) {
      throw unauthorized('User no longer exists');
    }
    return {
      user: { id: user.id, email: user.email, name: user.name },
      two_factor_enabled: user.twoFactorEnabled,
    };
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(@Req() req: AuthRequest, @Body() body: unknown) {
    const dto = parseOrThrow(updateMeSchema, body);
    return this.authService.updateName(req.user!.id, dto.name);
  }

  @Post('password')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async changePassword(@Req() req: AuthRequest, @Body() body: unknown) {
    const dto = parseOrThrow(changePasswordSchema, body);
    await this.authService.changePassword(req.user!.id, dto.current_password, dto.new_password);
  }

  @Post('2fa/setup')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async setup2fa(@Req() req: AuthRequest) {
    const user = await this.authService.getUserById(req.user!.id);
    if (!user) {
      throw unauthorized('User no longer exists');
    }
    const secret = this.totp.generateSecret();
    await this.totp.storePending(user.id, secret);
    const otpauthUrl = this.totp.keyUri(user.email, secret);
    const qrDataUrl = await this.totp.qrDataUrl(otpauthUrl);
    return { otpauth_url: otpauthUrl, secret, qr_data_url: qrDataUrl };
  }

  @Post('2fa/activate')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async activate2fa(@Req() req: AuthRequest, @Body() body: unknown) {
    const dto = parseOrThrow(codeSchema, body);
    const userId = req.user!.id;
    await this.attemptLimiter.assertAllowed('activate', userId);

    const user = await this.authService.getUserById(userId);
    if (!user) {
      throw unauthorized('User no longer exists');
    }
    if (user.twoFactorEnabled) {
      throw new ProblemException({
        status: 409,
        title: 'Conflict',
        detail: 'Two-factor authentication is already enabled',
      });
    }

    const pendingSecret = await this.totp.getPending(userId);
    if (!pendingSecret) {
      throw new ProblemException({
        status: 400,
        title: 'Bad Request',
        detail: 'No pending 2FA setup — call /2fa/setup first',
      });
    }
    if (!(await this.totp.verify(dto.code, pendingSecret))) {
      throw unauthorized('Invalid code');
    }

    await this.authService.persistTotpSecret(userId, pendingSecret);
    await this.totp.clearPending(userId);
    const recoveryCodes = await this.recoveryCodes.generateAndStore(userId);
    return { recovery_codes: recoveryCodes };
  }

  @Post('2fa/disable')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async disable2fa(@Req() req: AuthRequest, @Body() body: unknown) {
    const dto = parseOrThrow(codeSchema, body);
    const userId = req.user!.id;
    await this.attemptLimiter.assertAllowed('disable', userId);

    const valid = await this.authService.verifyActiveCode(userId, dto.code);
    if (!valid) {
      throw unauthorized('Invalid code');
    }
    await this.authService.disableTwoFactor(userId);
  }
}
