/**
 * Manual account creation — the operator path when SIGNUP_ENABLED=false (SETUP.md §7).
 *
 *   node dist/scripts/create-account.js --email you@example.com --name "You" [--password '…']
 *
 * Boots the Nest application context (no HTTP server) and calls the SAME AuthService.signup the
 * public endpoint uses, so the full provisioning transaction applies: user + personal org (admin)
 * + default project (owner) + SDK token. Deliberately ignores SIGNUP_ENABLED — this script IS the
 * closed-instance escape hatch. Prints a generated password when none is supplied.
 * Exit codes: 0 created · 1 bad usage · 2 creation failed (e.g. email already registered).
 */
import { randomBytes } from 'node:crypto';

// Local dev parity with main.ts: backend/.env is loaded when present; real env always wins.
try {
  process.loadEnvFile();
} catch {
  // No .env file — the environment is already configured.
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuthService } from '../auth/services/auth.service';
import { parseOrThrow, signupSchema } from '../auth/schemas/auth.schemas';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = argValue('--email');
  const name = argValue('--name');
  const supplied = argValue('--password');
  if (!email || !name) {
    console.error(
      'usage: node dist/scripts/create-account.js --email <email> --name <display name> [--password <password>]',
    );
    process.exitCode = 1;
    return;
  }
  const password = supplied ?? randomBytes(12).toString('base64url');
  const dto = parseOrThrow(signupSchema, { email, password, name });

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const session = await app.get(AuthService).signup(dto);
    console.log('Account created:');
    console.log(`  email: ${session.user.email}`);
    console.log(`  name:  ${session.user.name}`);
    if (!supplied) {
      console.log(`  password (generated, shown once): ${password}`);
      console.log('  → sign in with it and change it under Account settings.');
    }
  } catch (err) {
    const detail =
      err && typeof err === 'object' && 'problem' in err
        ? (err as { problem: { detail?: string; title?: string } }).problem
        : null;
    console.error(`Account creation failed: ${detail?.detail ?? detail?.title ?? String(err)}`);
    process.exitCode = 2;
  } finally {
    await app.close();
  }
}

void main();
