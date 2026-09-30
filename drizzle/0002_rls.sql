-- Access model (data-model.md): the backend connects as the database owner through the Supabase session
-- pooler, which RLS does not restrict. RLS is on with NO policies, so Supabase's public REST/GraphQL API
-- (anon / authenticated roles) sees nothing. Browsers only ever talk to Fastify.
ALTER TABLE "claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "positions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "resolutions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cost_events" ENABLE ROW LEVEL SECURITY;
