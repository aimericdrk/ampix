import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SlidingWindowRateLimiter } from '../ingestion/rate-limiter';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { RecoveryCodeService } from './recovery-code.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';
import { TwoFactorAttemptLimiter } from './two-factor-attempt-limiter';

@Module({
  // Registered with no default secret: every sign/verify call in TokenService passes its own
  // secret explicitly (access vs mfa), so there is no shared module-level secret to misuse.
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    RefreshTokenService,
    TotpService,
    RecoveryCodeService,
    TwoFactorAttemptLimiter,
    SlidingWindowRateLimiter,
    JwtAuthGuard,
  ],
  exports: [JwtAuthGuard, TokenService],
})
export class AuthModule {}
