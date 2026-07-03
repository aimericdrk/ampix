import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** Cloud Run SIGTERM drain: close the pool inside the 10 s window. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
