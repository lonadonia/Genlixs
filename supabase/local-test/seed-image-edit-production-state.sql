-- Production-like state of the five Image Edit models (read on 18 Oct 2026, read-only): enabled, capability v1 with one
-- reference image, a published price per model (source bulk) with the same rules as production.
do $$
declare
  r record;
begin
  for r in select * from (values
    ('gpt-flare-edit', '{"dims": ["resolution"], "units": {"1K": 3, "2K": 5, "4K": 8}, "format": "table"}'),
    ('gpt-sunburst-edit', '{"dims": ["resolution"], "units": {"1K": 3, "2K": 5, "4K": 8}, "format": "table"}'),
    ('nano-banana-pro-edit', '{"dims": ["resolution"], "units": {"1K": 9, "2K": 9, "4K": 12}, "format": "table"}'),
    ('flux-2-pro-edit', '{"dims": ["resolution"], "units": {"1K": 3, "2K": 4}, "format": "table"}'),
    ('seedream-5-flash-edit', '{"dims": ["resolution"], "units": {"1K": 2, "2K": 2, "1.5K": 2}, "format": "table"}')
  ) v(model_id, rules) loop
    update app_private.price_versions set state = 'retired' where model_id = r.model_id and state = 'published';
    insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, cost_evidence, effective_at, source)
    values (r.model_id, (app_private.capability_for(r.model_id)).id,
            (select coalesce(max(version), 0) + 1 from app_private.price_versions where model_id = r.model_id),
            'published', r.rules::jsonb, 'LOCAL FIXTURE (production rules)', now(), 'bulk');
    update app_private.model_catalog set state = 'enabled', verified_at = now(), verification_note = 'LOCAL FIXTURE' where id = r.model_id;
  end loop;
end;
$$;
select p.model_id, p.version, p.state, p.source, c.version as cap_version, c.spec -> 'references' ->> 'max' as max_refs, p.rules::text as rules,
  (select count(*) from app_private.admin_audit_logs l where l.target_id = p.model_id and l.action like 'capability.%') as cap_audits
from app_private.price_versions p cross join lateral app_private.capability_for(p.model_id) c
where p.state = 'published' and p.model_id like '%-edit' order by 1;
