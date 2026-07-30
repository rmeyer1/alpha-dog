-- Fix: exclude parity observations from incomplete/failed batches
-- from the 14-market-day observation gate metrics.
-- The prior RPC counted all observations regardless of batch completion
-- status, allowing an incomplete or failed batch to inflate the gate.
--
-- This version also enforces cohort integrity: a batch is only admitted
-- when the parity observation count matches the expected consumer count
-- (batch.snapshot_count), preventing partial cohorts from counting.

create or replace function public.get_wheel_scanner_parity_metrics(
  p_since date default (current_date - 30)
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  with cohort as (
    select
      obs.batch_id,
      batches.snapshot_count as expected_count,
      count(*) as observation_count
    from public.wheel_scanner_parity_observations as obs
    join public.wheel_market_batches as batches
      on batches.id = obs.batch_id
    where obs.observed_at::date >= coalesce(p_since, current_date - 30)
      and batches.status = 'complete'
    group by obs.batch_id, batches.snapshot_count
  ),
  observations as (
    select obs.*
    from public.wheel_scanner_parity_observations as obs
    join cohort
      on cohort.batch_id = obs.batch_id
     and cohort.observation_count = cohort.expected_count
  )
  select pg_catalog.jsonb_build_object(
    'since', coalesce(p_since, current_date - 30),
    'market_days_observed', count(
      distinct observed_at::date
    ) filter (where market_day),
    'observation_count', count(*),
    'exact_count', count(*) filter (where exact_match),
    'mismatch_count', count(*) filter (where not exact_match),
    'exact_ratio', case
      when count(*) = 0 then 0
      else round(
        count(*) filter (where exact_match)::numeric / count(*),
        6
      )
    end,
    'financial_mismatch_count', coalesce(
      sum(financial_mismatch_count),
      0
    ),
    'eligibility_mismatch_count', coalesce(
      sum(eligibility_mismatch_count),
      0
    ),
    'score_mismatch_count', coalesce(sum(score_mismatch_count), 0),
    'warning_mismatch_count', coalesce(sum(warning_mismatch_count), 0),
    'ordering_mismatch_count', coalesce(sum(ordering_mismatch_count), 0)
  )
  from observations;
$$;

revoke all on function public.get_wheel_scanner_parity_metrics(date)
  from public, anon, authenticated;

grant execute on function public.get_wheel_scanner_parity_metrics(date)
  to service_role;