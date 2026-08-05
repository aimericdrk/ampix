import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { JwtAuthGuard } from './tokens/jwt-auth.guard';
import { PasswordService } from './crypto/password.service';
import { RecoveryCodeService } from './two-factor/recovery-code.service';
import { RefreshTokenService } from './tokens/refresh-token.service';
import { TokenService } from './tokens/token.service';
import { TotpService } from './two-factor/totp.service';
import { TwoFactorAttemptLimiter } from './two-factor/two-factor-attempt-limiter';

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
    JwtAuthGuard,
  ],
  exports: [JwtAuthGuard, TokenService],
})
export class AuthModule {}
