import { Injectable } from '@nestjs/common';
import type { Cohort } from '@prisma/client';
import { parseOrThrow } from '../auth/auth.schemas';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { ProblemException } from '../common/problem-details';
import { isUuidShaped } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { compileCohort, CompiledCohort } from './cohort.compiler';
import {
  CohortDefinition,
  CreateCohortDto,
  UpdateCohortDto,
  cohortDefinitionSchema,
} from './cohort.schema';
import type { CohortDetail, CohortListItem, CohortPreview } from './cohort.types';

const PREVIEW_SAMPLE_LIMIT = 20;

interface CountRow {
  count: string | number;
}
interface SampleRow {
  distinct_id: string;
}

/**
 * Cohort CRUD + preview + the reusable `cohort_id` predicate (contracts §16). Every row is
 * project-scoped: reads/writes always filter by `projectId`, so a cohort from another project can
 * never be reached (404) — RolesGuard already gates project membership at the controller. Stored
 * definitions are re-validated with the SAME zod schema before EVERY run (preview / cohort_id filter),
 * so the injection-safe {@link compileCohort} engine is the only path to ClickHouse.
 */
@Injectable()
export class CohortsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
  ) {}

  async list(projectId: string): Promise<CohortListItem[]> {
    const cohorts = await this.prisma.cohort.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return cohorts.map((cohort) => this.toListItem(cohort));
  }

  async create(projectId: string, userId: string, dto: CreateCohortDto): Promise<CohortDetail> {
    const cohort = await this.prisma.cohort.create({
      data: { projectId, name: dto.name, definition: dto.definition, createdBy: userId },
    });
    return this.toDetail(cohort);
  }

  async get(projectId: string, id: string): Promise<CohortDetail> {
    return this.toDetail(await this.load(projectId, id));
  }

  async update(projectId: string, id: string, dto: UpdateCohortDto): Promise<CohortDetail> {
    await this.load(projectId, id); // 404 before mutating
    const updated = await this.prisma.cohort.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.definition !== undefined && { definition: dto.definition }),
      },
    });
    return this.toDetail(updated);
  }

  async remove(projectId: string, id: string): Promise<void> {
    await this.load(projectId, id); // 404 before deleting
    await this.prisma.cohort.delete({ where: { id } });
  }

  /** Runs the cohort and returns its size (`uniqExact`) plus a bounded, ordered id sample. */
  async preview(projectId: string, id: string): Promise<CohortPreview> {
    const cohort = await this.load(projectId, id);
    const { sql, params } = this.compile(projectId, cohort.definition);

    const [countRows, sampleRows] = await Promise.all([
      this.clickhouse.query<CountRow>(`SELECT uniqExact(distinct_id) AS count FROM (\n${sql}\n)`, params),
      this.clickhouse.query<SampleRow>(
        `SELECT distinct_id FROM (\n${sql}\n) ORDER BY distinct_id LIMIT ${PREVIEW_SAMPLE_LIMIT}`,
        params,
      ),
    ]);
    return {
      count: Number(countRows[0]?.count ?? 0),
      sample: sampleRows.map((row) => row.distinct_id),
    };
  }

  /**
   * Loads a cohort (project-scoped), re-validates its stored definition, and compiles it to a
   * parameterized `distinct_id`-producing subquery — the reusable `cohort_id` filter predicate for
   * §14 insights / §15 funnels / §15 retention. `now` pins the `within_days` windows deterministically.
   */
  async resolveCohortPredicate(
    projectId: string,
    cohortId: string,
    now?: number,
  ): Promise<CompiledCohort> {
    const cohort = await this.load(projectId, cohortId);
    return this.compile(projectId, cohort.definition, now);
  }

  /** Fetches a cohort scoped to the project, or throws 404. */
  private async load(projectId: string, id: string): Promise<Cohort> {
    if (!isUuidShaped(id)) throw this.notFound();
    const cohort = await this.prisma.cohort.findUnique({ where: { id } });
    if (!cohort || cohort.projectId !== projectId) throw this.notFound();
    return cohort;
  }

  /** Re-validates a stored definition (never trust stored JSON) and compiles it. */
  private compile(projectId: string, storedDefinition: unknown, now?: number): CompiledCohort {
    const definition = parseOrThrow(cohortDefinitionSchema, storedDefinition);
    return compileCohort(definition, projectId, now !== undefined ? { now } : {});
  }

  private toListItem(cohort: Cohort): CohortListItem {
    return {
      id: cohort.id,
      name: cohort.name,
      created_by: cohort.createdBy,
      created_at: cohort.createdAt.toISOString(),
      updated_at: cohort.updatedAt.toISOString(),
    };
  }

  private toDetail(cohort: Cohort): CohortDetail {
    return {
      ...this.toListItem(cohort),
      definition: cohort.definition as unknown as CohortDefinition,
    };
  }

  private notFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Cohort not found' });
  }
}
