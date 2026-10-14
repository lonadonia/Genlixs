-- Genlixs 02 · Catalog: tools, provider accounts, model catalog, immutable capability and price
-- versions, products (credit packs and plans). The browser only ever sees safe projections through
-- get_catalog() / get_products(); provider IDs, supplier costs and operational flags stay private (§9.1).

create table public.tools (
  id text primary key check (id in ('image', 'edit', 'video')),
  label text not null,
  job_kind text not null check (job_kind in ('text_to_image', 'image_edit', 'text_to_video')),
  enabled boolean not null default true,
  sort_order int not null default 0
);
alter table public.tools enable row level security;
create policy tools_public_read on public.tools for select to anon, authenticated using (true);
grant select on public.tools to anon, authenticated;

insert into public.tools (id, label, job_kind, sort_order) values
  ('image', 'Image', 'text_to_image', 1),
  ('edit', 'Edit image', 'image_edit', 2),
  ('video', 'Video', 'text_to_video', 3);

create table app_private.provider_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('kie', 'fake')),
  label text not null,
  enabled boolean not null default true,
  paused boolean not null default false,
  -- Name of the runtime secret, never its value (§8).
  secret_ref text not null,
  last_balance numeric,
  last_balance_at timestamptz,
  low_balance_threshold numeric,
  created_at timestamptz not null default now(),
  unique (provider, label)
);

insert into app_private.provider_accounts (provider, label, secret_ref)
values ('kie', 'primary', 'KIE_API_KEY');

create table app_private.model_catalog (
  id text primary key,
  tool text not null references public.tools (id),
  public_name text not null,
  purpose text not null,
  provider_account_id uuid not null references app_private.provider_accounts (id),
  provider_model_id text not null,
  adapter text not null,
  adapter_version int not null default 1,
  -- disabled until a verified paid test exists; experimental/maintenance are visible with a notice.
  state text not null default 'disabled' check (state in ('enabled', 'experimental', 'maintenance', 'disabled')),
  availability_note text,
  sort_order int not null default 0,
  verified_at timestamptz,
  verification_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger model_catalog_touch before update on app_private.model_catalog
  for each row execute function app_private.touch_updated_at();

-- Immutable once referenced: a change creates a new version (§11.1).
create table app_private.model_capability_versions (
  id uuid primary key default gen_random_uuid(),
  model_id text not null references app_private.model_catalog (id),
  version int not null,
  spec jsonb not null,
  created_at timestamptz not null default now(),
  unique (model_id, version)
);
create trigger model_capability_versions_immutable before update or delete on app_private.model_capability_versions
  for each row execute function app_private.forbid_mutation();

-- Price rules map an allowed option combination to customer credit units.
-- rules = {"base": <units>, "add": {"<option>": {"<value>": <units>}}}
create table app_private.price_versions (
  id uuid primary key default gen_random_uuid(),
  model_id text not null references app_private.model_catalog (id),
  capability_version_id uuid not null references app_private.model_capability_versions (id),
  version int not null,
  state text not null default 'draft' check (state in ('draft', 'published', 'retired')),
  rules jsonb not null,
  supplier_cost_snapshot jsonb,
  cost_evidence text,
  effective_at timestamptz,
  published_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (model_id, version)
);
-- At most one current price per model.
create unique index price_versions_one_published on app_private.price_versions (model_id) where state = 'published';

create or replace function app_private.price_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.state <> 'draft' then
      raise exception 'only draft price versions can be deleted';
    end if;
    return old;
  end if;
  if old.state <> 'draft' and (new.rules is distinct from old.rules or new.capability_version_id is distinct from old.capability_version_id) then
    raise exception 'published or retired price rules are immutable; create a new version';
  end if;
  if old.state = 'retired' and new.state <> 'retired' then
    raise exception 'a retired price version cannot be republished';
  end if;
  return new;
end;
$$;
create trigger price_versions_guard before update or delete on app_private.price_versions
  for each row execute function app_private.price_versions_guard();

-- --------------------------------------------------------------- products

create table app_private.product_versions (
  id uuid primary key default gen_random_uuid(),
  product_key text not null,
  version int not null,
  kind text not null check (kind in ('credit_pack', 'subscription')),
  name text not null,
  description text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  credits bigint not null check (credits > 0),
  billing_interval text check (billing_interval in ('month')),
  -- null = purchased credits do not expire (proposed launch policy)
  credit_expiry_days int check (credit_expiry_days > 0),
  max_active_jobs int,
  gateway_mapping jsonb not null default '{}'::jsonb,
  state text not null default 'draft' check (state in ('draft', 'published', 'retired')),
  sort_order int not null default 0,
  effective_at timestamptz,
  published_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (product_key, version),
  check ((kind = 'subscription') = (billing_interval is not null))
);
create unique index product_versions_one_published on app_private.product_versions (product_key) where state = 'published';

create or replace function app_private.product_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.state <> 'draft' then raise exception 'only draft products can be deleted'; end if;
    return old;
  end if;
  if old.state <> 'draft' and (new.amount_minor <> old.amount_minor or new.credits <> old.credits or new.currency <> old.currency
      or new.kind <> old.kind or new.credit_expiry_days is distinct from old.credit_expiry_days) then
    raise exception 'published product terms are immutable; create a new version';
  end if;
  return new;
end;
$$;
create trigger product_versions_guard before update or delete on app_private.product_versions
  for each row execute function app_private.product_versions_guard();

-- ------------------------------------------------------- seed (disabled)

-- Launch mapping candidates from the backend guide §12.2. They stay DISABLED with DRAFT prices until
-- the owner's account access, a paid test, measured cost and an approved price exist (§11.2, §24).
insert into app_private.model_catalog (id, tool, public_name, purpose, provider_account_id, provider_model_id, adapter, sort_order)
select v.id, v.tool, v.public_name, v.purpose, (select id from app_private.provider_accounts where provider = 'kie' and label = 'primary'), v.provider_model_id, v.adapter, v.sort_order
from (values
  ('gpt-flare-image', 'image', 'Flare image', 'Text-to-image for drafts, social posts and product scenes.', 'gpt-image-2-5-flare-text-to-image', 'kie-market-image', 1),
  ('gpt-flare-edit', 'edit', 'Flare reference edit', 'Changes a reference image with a written instruction.', 'gpt-image-2-5-flare-image-to-image', 'kie-market-image-edit', 2),
  ('veo-3-1', 'video', 'Veo 3.1', 'Text-to-video clips with model-generated background audio.', 'veo-3-1', 'kie-market-veo', 3)
) as v(id, tool, public_name, purpose, provider_model_id, adapter, sort_order);

insert into app_private.model_capability_versions (model_id, version, spec) values
  -- Verified against docs.kie.ai on 14 Oct 2026: aspect_ratio enum, resolution 1K/2K/4K (the 1K-only ratios
  -- 27:16, 16:27, 9:8 and 8:9 are deliberately not offered), prompt max 20000 (product cap 4000).
  ('gpt-flare-image', 1, '{
    "jobKind": "text_to_image",
    "prompt": {"min": 3, "max": 4000},
    "options": {
      "aspect_ratio": {"values": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"], "default": "3:2", "label": "Aspect ratio"},
      "resolution": {"values": ["1K", "2K", "4K"], "default": "1K", "label": "Resolution"}
    },
    "references": {"min": 0, "max": 0},
    "output": {"kind": "image", "count": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 52428800}
  }'::jsonb),
  -- input_urls accepts up to 16 URLs; the product offers one reference at launch.
  ('gpt-flare-edit', 1, '{
    "jobKind": "image_edit",
    "prompt": {"min": 3, "max": 4000},
    "options": {
      "aspect_ratio": {"values": ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"], "default": "auto", "label": "Aspect ratio"},
      "resolution": {"values": ["1K", "2K", "4K"], "default": "1K", "label": "Resolution"}
    },
    "references": {"min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760},
    "output": {"kind": "image", "count": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 52428800}
  }'::jsonb),
  -- Veo 3.1 (jobs/createTask, model "veo-3-1"): input.model veo3_fast|veo3_lite|veo3, aspect 16:9|9:16|Auto,
  -- resolution 720p|1080p|4k, duration 4|6|8 (default 8). Background audio is always included by the model.
  ('veo-3-1', 1, '{
    "jobKind": "text_to_video",
    "prompt": {"min": 3, "max": 2000},
    "options": {
      "variant": {"values": ["veo3_fast", "veo3_lite", "veo3"], "default": "veo3_fast", "label": "Quality tier", "labels": {"veo3_fast": "Fast", "veo3_lite": "Lite", "veo3": "Quality"}},
      "aspect_ratio": {"values": ["16:9", "9:16"], "default": "16:9", "label": "Aspect ratio"},
      "resolution": {"values": ["720p", "1080p"], "default": "720p", "label": "Resolution"},
      "duration": {"values": [4, 6, 8], "default": 8, "label": "Length (seconds)"}
    },
    "fixed": {"audio": "Background audio is generated by the model and is not guaranteed for every prompt."},
    "references": {"min": 0, "max": 0},
    "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 209715200}
  }'::jsonb);

-- Draft price rules are placeholders for the owner's review; they cannot be quoted while draft.
insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, cost_evidence)
select m.id, c.id, 1, 'draft', r.rules, 'DRAFT — replace with the approved price and a paid-test cost record'
from app_private.model_catalog m
join app_private.model_capability_versions c on c.model_id = m.id and c.version = 1
join (values
  ('gpt-flare-image', '{"base": 4, "add": {"resolution": {"2K": 2, "4K": 6}}}'::jsonb),
  ('gpt-flare-edit', '{"base": 6, "add": {"resolution": {"2K": 2, "4K": 6}}}'::jsonb),
  ('veo-3-1', '{"base": 60, "add": {"variant": {"veo3": 60}, "resolution": {"1080p": 20}, "duration": {"4": -20, "6": -10}}}'::jsonb)
) as r(model_id, rules) on r.model_id = m.id;

insert into app_private.product_versions (product_key, version, kind, name, description, currency, amount_minor, credits, sort_order)
values
  ('starter', 1, 'credit_pack', 'Starter', 'DRAFT pack — price awaiting owner approval', 'USD', 900, 200, 1),
  ('creator', 1, 'credit_pack', 'Creator', 'DRAFT pack — price awaiting owner approval', 'USD', 2400, 600, 2),
  ('studio', 1, 'credit_pack', 'Studio', 'DRAFT pack — price awaiting owner approval', 'USD', 6900, 2000, 3);

-- ------------------------------------------------------ safe projections

create or replace function app_private.capability_for(p_model_id text)
returns app_private.model_capability_versions
language sql
stable
set search_path = ''
as $$
  select c.* from app_private.model_capability_versions c
  where c.model_id = p_model_id
  order by c.version desc limit 1;
$$;

create or replace function public.get_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'generationPaused', coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true',
    'tools', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'enabled', t.enabled) order by t.sort_order), '[]') from public.tools t),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'tool', m.tool,
        'name', m.public_name,
        'purpose', m.purpose,
        'state', m.state,
        'note', m.availability_note,
        'capabilityVersion', c.version,
        'options', c.spec -> 'options',
        'prompt', c.spec -> 'prompt',
        'references', c.spec -> 'references',
        'output', jsonb_build_object('kind', c.spec -> 'output' -> 'kind', 'count', c.spec -> 'output' -> 'count'),
        'fixed', c.spec -> 'fixed',
        'priced', p.id is not null,
        'priceRules', case when p.id is not null then p.rules end
      ) order by m.sort_order)
      from app_private.model_catalog m
      cross join lateral app_private.capability_for(m.id) c
      left join app_private.price_versions p on p.model_id = m.id and p.state = 'published'
      where m.state <> 'disabled'
    ), '[]')
  );
$$;
revoke execute on function public.get_catalog() from public;
grant execute on function public.get_catalog() to anon, authenticated;

create or replace function public.get_products()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', p.product_key,
    'version', p.version,
    'kind', p.kind,
    'name', p.name,
    'description', p.description,
    'currency', p.currency,
    'amountMinor', p.amount_minor::text,
    'credits', p.credits::text,
    'interval', p.billing_interval,
    'creditExpiryDays', p.credit_expiry_days
  ) order by p.sort_order), '[]')
  from app_private.product_versions p
  where p.state = 'published';
$$;
revoke execute on function public.get_products() from public;
grant execute on function public.get_products() to anon, authenticated;
