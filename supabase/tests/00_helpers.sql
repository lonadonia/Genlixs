-- Test helpers (session-scoped). Each test file is one DO block that ends with RAISE EXCEPTION 'PASS: …',
-- so every change it made is rolled back even on success. Run 00_helpers.sql first in the same session.

create or replace function pg_temp.t_user(p_email text, p_meta jsonb default '{}'::jsonb, p_confirmed boolean default true)
returns uuid
language plpgsql
as $$
declare
  v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v, 'authenticated', 'authenticated', p_email, p_meta, case when p_confirmed then now() end, now(), now());
  return v;
end;
$$;

-- Switch the current transaction to a signed-in customer (RLS and auth.uid() apply).
create or replace function pg_temp.t_as(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.t_service()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
end;
$$;

-- Enables one model with a published test price inside the test transaction only.
create or replace function pg_temp.t_enable_model(p_model text, p_rules jsonb)
returns void
language plpgsql
as $$
begin
  update app_private.price_versions set state = 'retired' where model_id = p_model and state = 'published';
  insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, cost_evidence, effective_at)
  values (p_model, (app_private.capability_for(p_model)).id,
          (select coalesce(max(version), 0) + 1 from app_private.price_versions where model_id = p_model), 'published', p_rules, 'TEST FIXTURE', now());
  update app_private.model_catalog set state = 'enabled', verified_at = now(), verification_note = 'TEST FIXTURE' where id = p_model;
end;
$$;

-- Claims the newest pending work item of a kind for a reference (as the worker would after dequeue).
create or replace function pg_temp.t_claim(p_ref uuid, p_kind text)
returns jsonb
language plpgsql
as $$
declare
  w app_private.job_work_items;
  v jsonb;
begin
  select * into w from app_private.job_work_items where ref_id = p_ref and kind = p_kind and state = 'pending' order by created_at desc limit 1;
  if w.id is null then
    raise exception 'no pending % work item for %', p_kind, p_ref;
  end if;
  update app_private.job_work_items set due_at = now() where id = w.id;
  v := public.worker_claim(w.queue, w.last_msg_id, w.id, 'test-worker');
  if v ->> 'status' <> 'claimed' then
    raise exception 'claim failed: %', v;
  end if;
  return v;
end;
$$;
