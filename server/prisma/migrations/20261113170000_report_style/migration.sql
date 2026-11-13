-- How the school's report cards and result slips look (layout, colour,
-- wording, which parts show). Null = the built-in defaults.
ALTER TABLE "SchoolSettings" ADD COLUMN "reportStyle" JSONB;
