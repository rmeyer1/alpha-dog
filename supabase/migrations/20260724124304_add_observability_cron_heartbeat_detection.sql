revoke all on public.observability_readiness_state,
  public.observability_alert_rules,
  public.observability_alert_samples,
  public.observability_alert_state,
  public.observability_alert_events
from public, anon, authenticated, service_role;
grant select, insert, update on public.observability_readiness_state
  to service_role;
grant select on public.observability_alert_rules,
  public.observability_alert_state,
  public.observability_alert_events
to service_role;
grant select, insert, delete on public.observability_alert_samples
  to service_role;
grant insert, update on public.observability_alert_state
  to service_role;
grant insert on public.observability_alert_events
  to service_role;

revoke all on sequence public.observability_alert_samples_id_seq
  from public, anon, authenticated, service_role;
grant usage, select on sequence public.observability_alert_samples_id_seq
  to service_role;

create or replace function public.evaluate_observability_alerts(
  p_now timestamptz default now()
)
returns table (
  event_id uuid,
  alert_key text,
  outcome text,
  severity text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rule record;
  v_state public.observability_alert_state%rowtype;
  v_sample_count integer;
  v_metric_value numeric;
  v_should_trigger boolean;
  v_event_id uuid;
begin
  if p_now is null then
    raise exception 'evaluation timestamp is required';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('alpha-dog-observability-alert-evaluator', 0)
  ) then
    return;
  end if;

  for v_rule in
    select r.*
    from public.observability_alert_rules as r
    order by r.alert_key
  loop
    if v_rule.alert_key = 'cron_refresh_missing' then
      select s.value
      into v_metric_value
      from public.observability_alert_samples as s
      where s.alert_key = v_rule.alert_key
        and s.occurred_at >
          p_now - pg_catalog.make_interval(secs => v_rule.window_seconds)
        and s.occurred_at <= p_now
      order by s.occurred_at desc, s.id desc
      limit 1;

      v_sample_count := 1;
      v_metric_value := coalesce(v_metric_value, 0);

      if not exists (
        select 1
        from public.observability_readiness_state as r
        where r.state_key = 'current'
          and r.updated_at >
            p_now - pg_catalog.make_interval(secs => v_rule.window_seconds)
          and r.updated_at <= p_now
      ) then
        v_metric_value := greatest(v_metric_value, 1::numeric);
      end if;
    elsif v_rule.metric_kind = 'ratio' then
      select count(*)::integer, avg(s.value)
      into v_sample_count, v_metric_value
      from public.observability_alert_samples as s
      where s.alert_key = v_rule.alert_key
        and s.occurred_at >
          p_now - pg_catalog.make_interval(secs => v_rule.window_seconds)
        and s.occurred_at <= p_now;
    else
      select 1, s.value
      into v_sample_count, v_metric_value
      from public.observability_alert_samples as s
      where s.alert_key = v_rule.alert_key
        and s.occurred_at >
          p_now - pg_catalog.make_interval(secs => v_rule.window_seconds)
        and s.occurred_at <= p_now
      order by s.occurred_at desc, s.id desc
      limit 1;
    end if;

    if coalesce(v_sample_count, 0) < v_rule.minimum_samples
      or v_metric_value is null
    then
      continue;
    end if;

    v_should_trigger := v_metric_value >= v_rule.threshold;

    select s.*
    into v_state
    from public.observability_alert_state as s
    where s.alert_key = v_rule.alert_key
    for update;

    if v_should_trigger then
      update public.observability_alert_state
      set
        consecutive_healthy_samples = 0,
        updated_at = p_now
      where observability_alert_state.alert_key = v_rule.alert_key;

      if not v_state.active
        and (
          v_state.last_triggered_at is null
          or v_state.last_triggered_at <=
            p_now - pg_catalog.make_interval(secs => v_rule.cooldown_seconds)
        )
      then
        update public.observability_alert_state
        set
          active = true,
          last_triggered_at = p_now,
          updated_at = p_now
        where observability_alert_state.alert_key = v_rule.alert_key;

        insert into public.observability_alert_events (
          alert_key,
          outcome,
          severity,
          metric_value,
          sample_count,
          threshold,
          window_seconds,
          destination,
          occurred_at
        )
        values (
          v_rule.alert_key,
          'triggered',
          v_rule.severity,
          v_metric_value,
          v_sample_count,
          v_rule.threshold,
          v_rule.window_seconds,
          v_rule.destination,
          p_now
        )
        returning id into v_event_id;

        perform pg_catalog.pg_notify(
          'alpha_dog_observability_alerts',
          pg_catalog.json_build_object(
            'alertKey',
            v_rule.alert_key,
            'eventId',
            v_event_id,
            'outcome',
            'triggered',
            'severity',
            v_rule.severity
          )::text
        );

        event_id := v_event_id;
        alert_key := v_rule.alert_key;
        outcome := 'triggered';
        severity := v_rule.severity;
        return next;
      end if;
    elsif v_state.active then
      update public.observability_alert_state
      set
        consecutive_healthy_samples = consecutive_healthy_samples + 1,
        updated_at = p_now
      where observability_alert_state.alert_key = v_rule.alert_key
      returning * into v_state;

      if v_state.consecutive_healthy_samples >=
        v_rule.recovery_consecutive_samples
      then
        update public.observability_alert_state
        set
          active = false,
          consecutive_healthy_samples = 0,
          last_recovered_at = p_now,
          updated_at = p_now
        where observability_alert_state.alert_key = v_rule.alert_key;

        insert into public.observability_alert_events (
          alert_key,
          outcome,
          severity,
          metric_value,
          sample_count,
          threshold,
          window_seconds,
          destination,
          occurred_at
        )
        values (
          v_rule.alert_key,
          'recovered',
          'info',
          v_metric_value,
          v_sample_count,
          v_rule.threshold,
          v_rule.window_seconds,
          v_rule.destination,
          p_now
        )
        returning id into v_event_id;

        perform pg_catalog.pg_notify(
          'alpha_dog_observability_alerts',
          pg_catalog.json_build_object(
            'alertKey',
            v_rule.alert_key,
            'eventId',
            v_event_id,
            'outcome',
            'recovered',
            'severity',
            'info'
          )::text
        );

        event_id := v_event_id;
        alert_key := v_rule.alert_key;
        outcome := 'recovered';
        severity := 'info';
        return next;
      end if;
    else
      update public.observability_alert_state
      set
        consecutive_healthy_samples = 0,
        updated_at = p_now
      where observability_alert_state.alert_key = v_rule.alert_key;
    end if;
  end loop;

  delete from public.observability_alert_samples
  where occurred_at < p_now - interval '24 hours';
end;
$$;

revoke all on function public.evaluate_observability_alerts(timestamptz)
  from public, anon, authenticated;
grant execute on function public.evaluate_observability_alerts(timestamptz)
  to service_role;
