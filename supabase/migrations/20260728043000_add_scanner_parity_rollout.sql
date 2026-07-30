create table public.wheel_scanner_rollout_control (
  id boolean primary key default true,
  read_source text not null default 'legacy',
  observation_started_on date,
  updated_at timestamptz not null default now(),
  constraint wheel_scanner_rollout_control_singleton check (id),
  constraint wheel_scanner_rollout_control_source_valid
    check (read_source in ('legacy', 'replacement'))
);

insert into public.wheel_scanner_rollout_control (
  id,
  read_source
) values (
  true,
  'legacy'
);

alter table public.wheel_scanner_rollout_control enable row level security;
alter table public.wheel_scanner_rollout_control force row level security;

revoke all on public.wheel_scanner_rollout_control
  from public, anon, authenticated;
grant select, insert, update, delete on public.wheel_scanner_rollout_control
  to service_role;

create table public.wheel_scanner_parity_observations (
  id bigint generated always as identity primary key,
  batch_id uuid not null
    references public.wheel_market_batches(id) on delete cascade,
  persona text not null,
  strategy text not null,
  filter_key text not null,
  format_version integer not null,
  exact_match boolean not null,
  market_day boolean not null,
  candidate_count_legacy integer not null,
  candidate_count_replacement integer not null,
  mismatch_count integer not null,
  eligibility_mismatch_count integer not null,
  financial_mismatch_count integer not null,
  score_mismatch_count integer not null,
  warning_mismatch_count integer not null,
  ordering_mismatch_count integer not null,
  samples jsonb not null default '[]'::jsonb,
  observed_at timestamptz not null default now(),
  unique (batch_id, persona, strategy, filter_key, format_version),
  constraint wheel_scanner_parity_observations_persona_valid
    check (
      persona in (
        'conservative_wheel',
        'balanced_wheel',
        'aggressive_yield',
        'weekly_theta',
        'high_iv_hunter'
      )
    ),
  constraint wheel_scanner_parity_observations_strategy_valid
    check (
      strategy in (
        'short_put',
        'covered_call',
        'put_credit_spread',
        'call_credit_spread'
      )
    ),
  constraint wheel_scanner_parity_observations_counts_valid
    check (
      format_version > 0 and
      candidate_count_legacy >= 0 and
      candidate_count_replacement >= 0 and
      mismatch_count >= 0 and
      eligibility_mismatch_count >= 0 and
      financial_mismatch_count >= 0 and
      score_mismatch_count >= 0 and
      warning_mismatch_count >= 0 and
      ordering_mismatch_count >= 0 and
      mismatch_count =
        eligibility_mismatch_count +
        financial_mismatch_count +
        score_mismatch_count +
        warning_mismatch_count +
        ordering_mismatch_count and
      exact_match = (mismatch_count = 0)
    ),
  constraint wheel_scanner_parity_observations_samples_bounded
    check (
      pg_catalog.jsonb_typeof(samples) = 'array' and
      pg_catalog.jsonb_array_length(samples) <= 10
    )
);

create index wheel_scanner_parity_observations_observed_idx
  on public.wheel_scanner_parity_observations (observed_at desc);

create index wheel_scanner_parity_observations_failures_idx
  on public.wheel_scanner_parity_observations (observed_at desc)
  where not exact_match;

alter table public.wheel_scanner_parity_observations
  enable row level security;
alter table public.wheel_scanner_parity_observations
  force row level security;

revoke all on public.wheel_scanner_parity_observations
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.wheel_scanner_parity_observations
  to service_role;
grant usage, select
  on sequence public.wheel_scanner_parity_observations_id_seq
  to service_role;

create or replace function public.set_wheel_scanner_read_source(
  p_read_source text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.wheel_scanner_rollout_control%rowtype;
begin
  if p_read_source not in ('legacy', 'replacement') then
    raise exception 'Invalid wheel scanner read source.'
      using errcode = '22023';
  end if;

  update public.wheel_scanner_rollout_control
  set
    read_source = p_read_source,
    observation_started_on = case
      when p_read_source = 'replacement'
        then coalesce(observation_started_on, current_date)
      else observation_started_on
    end,
    updated_at = clock_timestamp()
  where id
  returning * into v_row;

  if not found then
    raise exception 'Wheel scanner rollout control is missing.'
      using errcode = 'P0001';
  end if;

  return pg_catalog.jsonb_build_object(
    'read_source', v_row.read_source,
    'observation_started_on', v_row.observation_started_on,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.get_wheel_scanner_parity_metrics(
  p_since date default (current_date - 30)
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  with observations as (
    select obs.*
    from public.wheel_scanner_parity_observations as obs
    join public.wheel_market_batches as batches
      on batches.id = obs.batch_id
    where obs.observed_at::date >= coalesce(p_since, current_date - 30)
      and batches.status = 'complete'
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

revoke all on function public.set_wheel_scanner_read_source(text)
  from public, anon, authenticated;
revoke all on function public.get_wheel_scanner_parity_metrics(date)
  from public, anon, authenticated;

grant execute on function public.set_wheel_scanner_read_source(text)
  to service_role;
grant execute on function public.get_wheel_scanner_parity_metrics(date)
  to service_role;
