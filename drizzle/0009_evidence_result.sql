-- The outcome in the judge's own words (e.g. a final score) for the verdict reply; never page text (FR-029).
ALTER TABLE "evidences" ADD COLUMN "result_summary" text;