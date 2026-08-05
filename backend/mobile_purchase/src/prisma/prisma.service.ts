import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../generated/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** SIGTERM drain: close the pool inside the shutdown window. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
