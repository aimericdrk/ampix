import { Injectable } from '@nestjs/common';
import { parseOrThrow } from '../../../auth/schemas/auth.schemas';
import { ClickHouseService } from '../../../clickhouse/clickhouse.service';
import { CohortsService } from '../../../cohorts/cohorts.service';
import { ProjectsService } from '../../../projects/core/projects.service';
import { compileExperimentQuery } from './experiment.compiler';
import { experimentQuerySchema } from './experiment.schema';
import { compareVariant, conversionRate, MIN_SAMPLE_PER_VARIANT } from './experiment-stats';
import type { ExperimentResponse, ExperimentVariantResult } from './experiment.types';

interface VariantRow {
  variant: string;
  exposed: string | number;
  converted: string | number;
}

/**
 * `POST /query/experiment` — the A/B-test readout (per-variant conversion + statistical
 * significance).
 *
 * Deliberately its own endpoint rather than a funnel with a breakdown. A breakdown can show you two
 * conversion rates side by side; it cannot tell you whether the gap between them is a result or
 * noise, and that judgement is the entire reason to run a test. The arithmetic lives in
 * `experiment-stats.ts`; this service is the membership check, the query, and the control-arm
 * choice.
 *
 * Same contract as every other query service: the request body is re-validated with the zod schema
 * on EVERY run (including when it arrives as a stored saved-report definition), so the
 * injection-safe compiler is the only path to ClickHouse.
 */
@Injectable()
export class ExperimentsService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
    private readonly cohorts: CohortsService,
  ) {}

  async runExperimentQuery(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<ExperimentResponse> {
    await this.projects.assertMembership(userId, projectId);
    const query = parseOrThrow(experimentQuerySchema, body);

    const cohort = query.cohort_id
      ? await this.cohorts.resolveCohortPredicate(projectId, query.cohort_id)
      : undefined;

    const compiled = compileExperimentQuery(query, projectId, cohort);
    const rows = await this.clickhouse.query<VariantRow>(
      compiled.sql,
      compiled.params,
      compiled.settings,
    );

    const arms = rows.map((row) => ({
      variant: row.variant,
      exposed: Number(row.exposed),
      converted: Number(row.converted),
    }));

    // The baseline. An explicitly named `control_variant` wins — but only if it actually turned up
    // in the results; naming an arm that has no participants would leave every other arm compared
    // against an empty control and reported as "cannot tell". Otherwise the largest arm is used
    // (see the schema's note).
    const namedControl = query.control_variant
      ? arms.find((arm) => arm.variant === query.control_variant)
      : undefined;
    // `arms` is ordered by exposure DESC by the compiled query, so [0] is the largest.
    const control = namedControl ?? arms[0];

    const variants: ExperimentVariantResult[] = arms.map((arm) => ({
      variant: arm.variant,
      exposed: arm.exposed,
      converted: arm.converted,
      conversion_rate: conversionRate(arm.converted, arm.exposed),
      is_control: control !== undefined && arm.variant === control.variant,
      underpowered: arm.exposed < MIN_SAMPLE_PER_VARIANT,
      comparison:
        control === undefined || arm.variant === control.variant
          ? null
          : compareVariant(control, arm),
    }));

    return {
      control_variant: control?.variant ?? null,
      total_exposed: arms.reduce((sum, arm) => sum + arm.exposed, 0),
      total_converted: arms.reduce((sum, arm) => sum + arm.converted, 0),
      variants,
      // Vacuously true for zero arms would be a lie the UI would render as "decision-grade"; an
      // experiment with no participants has nothing like enough data.
      has_enough_data: arms.length > 0 && arms.every((arm) => arm.exposed >= MIN_SAMPLE_PER_VARIANT),
    };
  }
}
