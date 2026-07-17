import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { MembersService } from './members.service';

/**
 * Focused UNIT tests (mocked Prisma) for two guarantees that a real-Postgres harness cannot
 * express deterministically:
 *   1. `runSerializable` retries a serialization failure EXACTLY ONCE — a second consecutive
 *      P2034 must propagate (an unbounded retry would be a hang/DoS risk). You can't force two
 *      back-to-back genuine write-skew aborts on demand against real Postgres, so this is asserted
 *      here with a `$transaction` mock that throws P2034 twice.
 *   2. Malformed (non-UUID-shaped) `userId` short-circuits to 404 WITHOUT touching the database
 *      (no `$transaction`, no `findUnique`) — verified with spies, which a real client has no clean
 *      hook for.
 * The behavioural/invariant coverage lives in `members.service.spec.ts` against real Postgres.
 */

const ORG_ID = '018f6b2e-0000-7000-8000-0000000000aa';
const USER_1 = '018f6b2e-0000-7000-8000-000000000001';

interface FakePrisma {
  membership: {
    findUnique: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makePrisma(overrides: { membership?: Partial<FakePrisma['membership']> } = {}): FakePrisma {
  const base = {
    membership: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      delete: jest.fn(),
    },
  } as FakePrisma;
  if (overrides.membership) Object.assign(base.membership, overrides.membership);
  base.$transaction = jest.fn(async (fn: (tx: FakePrisma) => unknown) => fn(base));
  return base;
}

function makeService(prisma: unknown) {
  return new MembersService(prisma as unknown as PrismaService);
}

/** A `PrismaClientKnownRequestError` shaped like the real Postgres serialization failure
 *  (SQLSTATE 40001 / Prisma P2034) raised under SERIALIZABLE isolation on a write-skew conflict. */
function serializationFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
    { code: 'P2034', clientVersion: '6.8.0' },
  );
}

describe('MembersService (unit — mocked Prisma)', () => {
  describe('runSerializable retry bound — SECURITY-CRITICAL', () => {
    it('does not retry more than once — a SECOND serialization failure propagates', async () => {
      const prisma = makePrisma();
      prisma.$transaction = jest.fn(async () => {
        throw serializationFailure();
      });
      const service = makeService(prisma);

      await expect(service.changeRole(ORG_ID, USER_1, USER_1, 'viewer')).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('malformed userId short-circuits without touching the database', () => {
    it('changeRole: 404s for a non-UUID-shaped userId without querying Postgres', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);

      await expect(service.changeRole(ORG_ID, USER_1, 'not-a-uuid', 'admin')).rejects.toMatchObject(
        {
          problem: { status: 404 },
        },
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.membership.findUnique).not.toHaveBeenCalled();
    });

    it('remove: 404s for a non-UUID-shaped userId without querying Postgres', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);

      await expect(service.remove(ORG_ID, 'not-a-uuid')).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.membership.findUnique).not.toHaveBeenCalled();
    });
  });
});
