-- The A/B-test readout joins the saved-report kinds, so an experiment result can be saved as a
-- report and pinned to a dashboard tile like the other four analyses.

-- AlterEnum
ALTER TYPE "ReportKind" ADD VALUE 'experiment';
