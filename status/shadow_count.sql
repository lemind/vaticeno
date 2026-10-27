-- The SC-005 count, one row per frozen candidate (003 T349a, data-model verifier_shadow, outcome_confirmations).
-- Read by the status page and by the resolver's integration test, so the rule lives in one place.
-- A claim counts by its latest attempt; claims about one event count once, and that event is wrong if any is.
with latest as (
  select distinct on (claim_id, model) claim_id, model, would_finalise, would_outcome, error_tag
  from verifier_shadow
  order by claim_id, model, created_at desc
),
per_event as (
  select l.model, c.event_key, bool_or(l.would_outcome is distinct from c.outcome) as wrong
  from latest l join outcome_confirmations c on c.claim_id = l.claim_id
  where l.would_finalise
  group by l.model, c.event_key
)
select
  l.model,
  count(*)::int as shadow_claims,
  count(*) filter (where l.error_tag is not null)::int as failed,
  count(*) filter (where l.would_finalise)::int as would_finalise,
  count(*) filter (
    where l.would_finalise
      and not exists (select 1 from outcome_confirmations c where c.claim_id = l.claim_id)
  )::int as to_confirm,
  (select count(*) from per_event e where e.model = l.model)::int as eligible_events,
  (select count(*) from per_event e where e.model = l.model and e.wrong)::int as wrong_events
from latest l
group by l.model
order by l.model
