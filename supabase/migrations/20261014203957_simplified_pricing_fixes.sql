-- Genlixs 15d · Fix found by the rolled-back SQL tests: partner terms have published_at (not effective_at).

create or replace function public.admin_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('admin.access');
begin
  return jsonb_build_object(
    'settings', (select coalesce(jsonb_agg(jsonb_build_object('key', s.key, 'value', s.value, 'description', s.description, 'updatedAt', s.updated_at)
        order by s.key), '[]')
      from app_private.settings s
      where s.key in ('generation_paused', 'quote_ttl_seconds', 'reservation_deadline_hours', 'delayed_after_minutes', 'max_active_jobs_per_user',
        'max_quotes_per_minute', 'provider_create_budget_per_10s', 'output_retention_days', 'reference_retention_days', 'promo_credit_days',
        'signup_promo_units')),
    'agreements', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'state', v.state, 'baseBps', v.base_rate_bps,
        'upliftBps', v.uplift_rate_bps, 'threshold', v.uplift_threshold, 'publishedAt', v.published_at) order by v.version desc), '[]')
      from public.affiliate_agreement_versions v),
    'access', jsonb_build_object('canOperate', app_private.has_capability(v_actor, 'catalog.operate'),
      'canManageSettings', app_private.has_capability(v_actor, 'settings.manage'),
      'canPublish', app_private.has_capability(v_actor, 'catalog.publish'))
  );
end;
$$;
revoke execute on function public.admin_settings() from public, anon;
grant execute on function public.admin_settings() to authenticated;
