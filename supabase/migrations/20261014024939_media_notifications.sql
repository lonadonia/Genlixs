-- Genlixs 04 · Media and notifications (§16, §21.2). Buckets are private; objects live under
-- "<user uuid>/..." paths chosen by the server. Customers upload references directly to Storage against a
-- pending upload intent; a server step validates the actual bytes before the asset can be quoted.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('generation-inputs', 'generation-inputs', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('generation-outputs', 'generation-outputs', false, 209715200, array['image/png', 'image/jpeg', 'image/webp', 'video/mp4']),
  ('support-attachments', 'support-attachments', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id),
  kind text not null check (kind in ('input', 'output', 'attachment')),
  job_id uuid,
  bucket text not null,
  object_path text not null,
  mime text,
  bytes bigint check (bytes >= 0),
  width int,
  height int,
  duration_ms int,
  sha256 text,
  original_name text check (char_length(original_name) <= 200),
  state text not null default 'pending' check (state in ('pending', 'validated', 'ready', 'quarantined', 'deleting', 'deleted', 'expired', 'rejected')),
  retention_until timestamptz,
  provider_task_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bucket, object_path),
  -- Owner-consistent composite key so children can reference (asset, owner) together (§8).
  unique (id, user_id)
);
create index assets_owner_idx on public.assets (user_id, created_at desc) where state in ('ready', 'validated');
create index assets_job_idx on public.assets (job_id);
create index assets_retention_idx on public.assets (retention_until) where state in ('ready', 'validated');
create trigger assets_touch before update on public.assets for each row execute function app_private.touch_updated_at();

create table public.upload_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id),
  purpose text not null check (purpose in ('reference', 'support')),
  bucket text not null,
  object_path text not null unique,
  expected_mime text not null,
  expected_bytes bigint not null check (expected_bytes > 0),
  original_name text,
  state text not null default 'pending' check (state in ('pending', 'validated', 'rejected', 'expired')),
  rejection_reason text,
  asset_id uuid references public.assets (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index upload_intents_owner_idx on public.upload_intents (user_id, created_at desc);

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  user_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (asset_id, user_id) references public.assets (id, user_id)
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id),
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.collection_assets (
  collection_id uuid not null,
  asset_id uuid not null,
  user_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (collection_id, asset_id),
  foreign key (collection_id, user_id) references public.collections (id, user_id) on delete cascade,
  foreign key (asset_id, user_id) references public.assets (id, user_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id),
  -- One notification per business event (§21.2).
  event_key text not null unique,
  kind text not null,
  title text not null,
  body text,
  link text check (link is null or link like '/%'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_owner_idx on public.notifications (user_id, created_at desc);

alter table public.assets enable row level security;
alter table public.upload_intents enable row level security;
alter table public.share_links enable row level security;
alter table public.collections enable row level security;
alter table public.collection_assets enable row level security;
alter table public.notifications enable row level security;

create policy assets_owner_read on public.assets for select to authenticated
  using ((select auth.uid()) = user_id and state in ('validated', 'ready', 'expired'));
create policy upload_intents_owner_read on public.upload_intents for select to authenticated using ((select auth.uid()) = user_id);
create policy share_links_owner_read on public.share_links for select to authenticated using ((select auth.uid()) = user_id);
create policy collections_owner_read on public.collections for select to authenticated using ((select auth.uid()) = user_id);
create policy collection_assets_owner_read on public.collection_assets for select to authenticated using ((select auth.uid()) = user_id);
create policy notifications_owner_read on public.notifications for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.assets, public.upload_intents, public.share_links, public.collections, public.collection_assets, public.notifications from anon, authenticated;
grant select on public.assets, public.upload_intents, public.share_links, public.collections, public.collection_assets, public.notifications to authenticated;

-- ------------------------------------------------------- storage access

-- Upload: only into the exact path of the caller's own pending, unexpired intent (no overwrite: no update policy).
create policy "inputs: owner uploads to a pending intent" on storage.objects for insert to authenticated
with check (
  bucket_id in ('generation-inputs', 'support-attachments')
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.upload_intents i
    where i.object_path = name and i.bucket = bucket_id and i.user_id = (select auth.uid())
      and i.state = 'pending' and i.expires_at > now()
  )
);

-- Read: owners read their own objects (used to sign short-lived download URLs with the user's session).
create policy "media: owner reads own objects" on storage.objects for select to authenticated
using (
  bucket_id in ('generation-inputs', 'generation-outputs', 'support-attachments')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- ------------------------------------------------------------ RPCs

create or replace function app_private.require_active_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    perform app_private.fail('UNAUTHENTICATED', 'Sign in to continue.');
  end if;
  select account_status into v_status from public.profiles where user_id = v_uid;
  if v_status is null then
    perform app_private.fail('PROFILE_NOT_FOUND', 'Your account is still being set up. Try again in a moment.');
  elsif v_status <> 'active' then
    perform app_private.fail('ACCOUNT_RESTRICTED', 'This account cannot start new actions. Contact support.');
  end if;
  return v_uid;
end;
$$;

create or replace function public.create_upload_intent(p_purpose text, p_mime text, p_bytes bigint, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_id uuid := gen_random_uuid();
  v_bucket text;
  v_ext text;
  v_path text;
  v_expires timestamptz := now() + interval '15 minutes';
begin
  if p_purpose not in ('reference', 'support') then
    perform app_private.fail('INVALID_PURPOSE', 'Unsupported upload purpose.');
  end if;
  v_bucket := case p_purpose when 'reference' then 'generation-inputs' else 'support-attachments' end;
  v_ext := case p_mime when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp'
                       when 'application/pdf' then case when p_purpose = 'support' then 'pdf' end end;
  if v_ext is null then
    perform app_private.fail('UNSUPPORTED_FILE_TYPE', 'Upload a PNG, JPEG or WebP image.');
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 10485760 then
    perform app_private.fail('FILE_TOO_LARGE', 'Files can be up to 10 MB.', jsonb_build_object('maxBytes', 10485760));
  end if;
  if (select count(*) from public.upload_intents where user_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    perform app_private.fail('RATE_LIMITED', 'Too many uploads in the last hour. Try again later.');
  end if;
  v_path := v_uid::text || '/' || v_id::text || '/source.' || v_ext;
  insert into public.upload_intents (id, user_id, purpose, bucket, object_path, expected_mime, expected_bytes, original_name, expires_at)
  values (v_id, v_uid, p_purpose, v_bucket, v_path, p_mime, p_bytes, left(p_name, 200), v_expires);
  return jsonb_build_object('intentId', v_id, 'bucket', v_bucket, 'path', v_path, 'expiresAt', v_expires);
end;
$$;
revoke execute on function public.create_upload_intent(text, text, bigint, text) from public, anon;
grant execute on function public.create_upload_intent(text, text, bigint, text) to authenticated;

-- Server-only: called after the backend has read the object and checked its real signature/size/dimensions.
create or replace function public.finalize_upload(p_intent_id uuid, p_verified jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_int public.upload_intents;
  v_asset uuid;
  v_days int := coalesce((app_private.setting('reference_retention_days'))::text, '7')::int;
begin
  select * into v_int from public.upload_intents where id = p_intent_id for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Upload not found.');
  end if;
  if v_int.state = 'validated' then
    return jsonb_build_object('assetId', v_int.asset_id, 'state', 'validated');
  end if;
  if v_int.state <> 'pending' then
    perform app_private.fail('UPLOAD_NOT_PENDING', 'This upload can no longer be completed.');
  end if;
  if coalesce((p_verified ->> 'ok')::boolean, false) is not true then
    update public.upload_intents set state = 'rejected', rejection_reason = left(p_verified ->> 'reason', 200) where id = v_int.id;
    return jsonb_build_object('state', 'rejected', 'reason', p_verified ->> 'reason');
  end if;
  insert into public.assets (user_id, kind, bucket, object_path, mime, bytes, width, height, sha256, original_name, state, retention_until)
  values (v_int.user_id, case v_int.purpose when 'reference' then 'input' else 'attachment' end, v_int.bucket, v_int.object_path,
          p_verified ->> 'mime', (p_verified ->> 'bytes')::bigint, (p_verified ->> 'width')::int, (p_verified ->> 'height')::int,
          p_verified ->> 'sha256', v_int.original_name, 'validated', now() + make_interval(days => v_days))
  returning id into v_asset;
  update public.upload_intents set state = 'validated', asset_id = v_asset where id = v_int.id;
  return jsonb_build_object('assetId', v_asset, 'state', 'validated');
end;
$$;
revoke execute on function public.finalize_upload(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_upload(uuid, jsonb) to service_role;

-- Owner download authorization: returns the storage location only for the caller's deliverable asset.
create or replace function public.authorize_asset_download(p_asset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('bucket', a.bucket, 'path', a.object_path, 'mime', a.mime, 'bytes', a.bytes::text)
  from public.assets a
  where a.id = p_asset_id and a.user_id = (select auth.uid()) and a.state in ('ready', 'validated');
$$;
revoke execute on function public.authorize_asset_download(uuid) from public, anon;
grant execute on function public.authorize_asset_download(uuid) to authenticated;

-- Explicit, revocable share. The plain token is generated by the server; only its hash is stored.
create or replace function public.create_share_link(p_asset_id uuid, p_token_hash text, p_expires_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_id uuid;
begin
  if not exists (select 1 from public.assets where id = p_asset_id and user_id = v_uid and state = 'ready' and kind = 'output') then
    perform app_private.fail('NOT_FOUND', 'File not found.');
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    perform app_private.fail('INVALID_TOKEN', 'Invalid share token.');
  end if;
  insert into public.share_links (asset_id, user_id, token_hash, expires_at)
  values (p_asset_id, v_uid, p_token_hash, p_expires_at) returning id into v_id;
  return jsonb_build_object('shareId', v_id, 'expiresAt', p_expires_at);
end;
$$;
revoke execute on function public.create_share_link(uuid, text, timestamptz) from public, anon;
grant execute on function public.create_share_link(uuid, text, timestamptz) to authenticated;

create or replace function public.revoke_share_link(p_share_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.share_links set revoked_at = coalesce(revoked_at, now())
  where id = p_share_id and user_id = auth.uid();
  if not found then
    perform app_private.fail('NOT_FOUND', 'Share link not found.');
  end if;
  return jsonb_build_object('shareId', p_share_id, 'revoked', true);
end;
$$;
revoke execute on function public.revoke_share_link(uuid) from public, anon;
grant execute on function public.revoke_share_link(uuid) to authenticated;

-- Public share resolution (server-only: the route signs the object URL with the backend client).
create or replace function public.resolve_share_link(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('bucket', a.bucket, 'path', a.object_path, 'mime', a.mime)
  from public.share_links s
  join public.assets a on a.id = s.asset_id
  where s.token_hash = p_token_hash and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
    and a.state = 'ready';
$$;
revoke execute on function public.resolve_share_link(text) from public, anon, authenticated;
grant execute on function public.resolve_share_link(text) to service_role;

-- Customer deletion request: access ends immediately; the object is removed by durable work.
create or replace function public.request_asset_deletion(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  update public.assets set state = 'deleting', deleted_at = now()
  where id = p_asset_id and user_id = v_uid and state in ('ready', 'validated', 'expired');
  if not found then
    perform app_private.fail('NOT_FOUND', 'File not found.');
  end if;
  update public.share_links set revoked_at = coalesce(revoked_at, now()) where asset_id = p_asset_id;
  delete from public.collection_assets where asset_id = p_asset_id;
  return jsonb_build_object('assetId', p_asset_id, 'state', 'deleting');
end;
$$;
revoke execute on function public.request_asset_deletion(uuid) from public, anon;
grant execute on function public.request_asset_deletion(uuid) to authenticated;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

create or replace function app_private.notify(p_user uuid, p_event_key text, p_kind text, p_title text, p_body text, p_link text)
returns void
language sql
set search_path = ''
as $$
  insert into public.notifications (user_id, event_key, kind, title, body, link)
  values (p_user, p_event_key, p_kind, p_title, p_body, p_link)
  on conflict (event_key) do nothing;
$$;

-- Collections: lightweight, owner-scoped.
create or replace function public.upsert_collection(p_name text, p_collection_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_id uuid;
begin
  if p_collection_id is null then
    insert into public.collections (user_id, name) values (v_uid, trim(p_name)) returning id into v_id;
  else
    update public.collections set name = trim(p_name) where id = p_collection_id and user_id = v_uid returning id into v_id;
    if v_id is null then perform app_private.fail('NOT_FOUND', 'Collection not found.'); end if;
  end if;
  return jsonb_build_object('collectionId', v_id);
end;
$$;
revoke execute on function public.upsert_collection(text, uuid) from public, anon;
grant execute on function public.upsert_collection(text, uuid) to authenticated;

create or replace function public.set_collection_membership(p_collection_id uuid, p_asset_id uuid, p_member boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.collections where id = p_collection_id and user_id = v_uid) then
    perform app_private.fail('NOT_FOUND', 'Collection not found.');
  end if;
  if p_member then
    if not exists (select 1 from public.assets where id = p_asset_id and user_id = v_uid and state = 'ready') then
      perform app_private.fail('NOT_FOUND', 'File not found.');
    end if;
    insert into public.collection_assets (collection_id, asset_id, user_id) values (p_collection_id, p_asset_id, v_uid) on conflict do nothing;
  else
    delete from public.collection_assets where collection_id = p_collection_id and asset_id = p_asset_id and user_id = v_uid;
  end if;
  return jsonb_build_object('collectionId', p_collection_id, 'assetId', p_asset_id, 'member', p_member);
end;
$$;
revoke execute on function public.set_collection_membership(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_collection_membership(uuid, uuid, boolean) to authenticated;
