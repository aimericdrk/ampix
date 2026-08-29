-- Full-page captures now stitch like a phone's own "long screenshot": the first frame keeps the
-- fixed chrome above the scrollable (status bar, app bar with the exit button), so content space
-- no longer starts at the image's top row. `content_top` records where it does start — the heatmap
-- places a tap's `$content_y` at row `content_top + $content_y`.
--
-- NULLable, NULL for existing rows: captures taken before this change contain no top chrome, so
-- the read path treats NULL as 0 — which is exactly correct for them.

-- AlterTable
ALTER TABLE "screen_captures" ADD COLUMN "content_top" DOUBLE PRECISION;
