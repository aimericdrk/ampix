-- Full-page reference screenshots: a screen taller than its viewport is captured by stitching
-- several viewports, so the image no longer necessarily IS one screen. These record what the image
-- actually covers, which is what a tap's `$content_y` has to be normalized against.
--
-- Both NULLable and both left NULL for existing rows: every capture taken so far is a single
-- viewport, and NULL is how the read path recognises that and falls back to the old geometry.
-- Nothing is backfilled, because a value would be a guess.

-- AlterTable
ALTER TABLE "screen_captures" ADD COLUMN "content_height" DOUBLE PRECISION;
ALTER TABLE "screen_captures" ADD COLUMN "viewport_height" DOUBLE PRECISION;
