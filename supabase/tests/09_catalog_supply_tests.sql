-- Catalog supply view (admin_catalog_supply; run after its migration). One DO block rolled back by the final exception.
-- It changes no shared rows (no table-wide updates), so it can also run on production inside its transaction.
--  S1 customers cannot read it; operations staff (provider.read) can
--  S2 every model appears once with its original route among the quotes, and the quote marked current is the router's
--     own choice at the same cost
--  S3 quotes are computed exactly as the router computes costs: documented USD, illustrative CNY, card fee, and an
--     offer that cannot take the default settings has no cost
--  S4 each quote names the first missing step (integration, price, key, test, switch)
--  S5 each product outside the catalog appears once with all its suppliers' quotes and their USD rates
--  S6 no key material in the reply
do $$
declare
  cust uuid := pg_temp.t_user('t-cs-cust-' || gen_random_uuid() || '@genlixs.test');
  ops uuid := pg_temp.t_user('t-cs-ops-' || gen_random_uuid() || '@genlixs.test');
  r jsonb;
  m jsonb;
  q jsonb;
  p jsonb;
  v_n int;
  v_ok int := 0;
begin
  insert into app_private.staff_memberships (user_id, role) values (ops, 'operations');

  -- S1 ------------------------------------------------------------------ access
  perform pg_temp.t_as(cust);
  begin
    perform public.admin_catalog_supply();
    raise exception 'S1 customer allowed';
  exception when others then
    if sqlerrm not in ('FORBIDDEN', 'UNAUTHENTICATED') then raise exception 'S1 customer → %', sqlerrm; end if;
  end;
  execute 'reset role';
  perform pg_temp.t_as(ops);
  r := public.admin_catalog_supply();
  execute 'reset role';
  v_ok := v_ok + 1;

  -- S2 ------------------------------------------------------- one entry per model
  if jsonb_array_length(r -> 'models') <> (select count(*) from app_private.model_catalog) then
    raise exception 'S2 models % vs %', jsonb_array_length(r -> 'models'), (select count(*) from app_private.model_catalog);
  end if;
  if (select count(distinct x ->> 'id') from jsonb_array_elements(r -> 'models') x) <> jsonb_array_length(r -> 'models') then
    raise exception 'S2 a model is listed twice';
  end if;
  for m in select value from jsonb_array_elements(r -> 'models') loop
    if (select count(*) from jsonb_array_elements(m -> 'quotes') x where (x ->> 'legacy')::boolean) <> 1 then
      raise exception 'S2 % has no single original route', m ->> 'id';
    end if;
    select count(*) into v_n from jsonb_array_elements(m -> 'quotes') x where (x ->> 'current')::boolean;
    if m -> 'route' ->> 'status' = 'ok' then
      select x into q from jsonb_array_elements(m -> 'quotes') x where (x ->> 'current')::boolean;
      if v_n <> 1 or q ->> 'offerId' <> m -> 'route' ->> 'offerId' or q ->> 'stage' <> 'serving'
         or (q ->> 'usd')::numeric is distinct from (m -> 'route' ->> 'usd')::numeric then
        raise exception 'S2 % current quote % vs route %', m ->> 'id', q, m -> 'route';
      end if;
    elsif v_n <> 0 then
      raise exception 'S2 % marks a current quote without a route', m ->> 'id';
    end if;
  end loop;
  v_ok := v_ok + 1;

  -- S3 ---------------------------------------------- costs as the router computes
  m := (select x from jsonb_array_elements(r -> 'models') x where x ->> 'id' = 'nano-banana-pro-image');
  if m -> 'route' ->> 'status' = 'ok' and ((m -> 'route' ->> 'provider') <> 'kie' or (m -> 'route' ->> 'usd')::numeric <> 0.09) then
    raise exception 'S3 KIE route at 1K should be $0.09: %', m -> 'route';
  end if;
  q := (select x from jsonb_array_elements(m -> 'quotes') x where x ->> 'provider' = 'nezhagate');
  if (q ->> 'usd')::numeric <> 0.02 or q ->> 'unit' <> 'usd' then raise exception 'S3 NezhaGate 1K %', q; end if;
  q := (select x from jsonb_array_elements(m -> 'quotes') x where x ->> 'provider' = 'duomi');
  if round((q ->> 'usd')::numeric, 8) <> round(0.15 / 6.7, 8) or q ->> 'unitBasis' <> 'illustrative' then raise exception 'S3 Duomi CNY %', q; end if;
  for m in select value from jsonb_array_elements(r -> 'models') loop
    for q in select value from jsonb_array_elements(m -> 'quotes') loop
      if q ->> 'incompatible' is not null and q ->> 'usd' is not null then
        raise exception 'S3 % % priced although incompatible', m ->> 'id', q ->> 'provider';
      end if;
    end loop;
  end loop;
  v_ok := v_ok + 1;

  -- S4 ------------------------------------------------------ first missing step
  m := (select x from jsonb_array_elements(r -> 'models') x where x ->> 'id' = 'nano-banana-pro-image');
  if (select x ->> 'stage' from jsonb_array_elements(m -> 'quotes') x where x ->> 'provider' = 'poyo') <> 'needs_integration' then
    raise exception 'S4 PoYo (no integration) %', m -> 'quotes';
  end if;
  if not exists (select 1 from app_private.provider_accounts where provider = 'nezhagate' and (credential_version > 0 or secret_ref = 'KIE_API_KEY'))
     and (select x ->> 'stage' from jsonb_array_elements(m -> 'quotes') x where x ->> 'provider' = 'nezhagate') <> 'needs_key' then
    raise exception 'S4 NezhaGate without a key %', m -> 'quotes';
  end if;
  v_ok := v_ok + 1;

  -- S5 ------------------------------------------------- products outside the catalog
  if jsonb_array_length(r -> 'products') <> (select count(distinct product_key) from app_private.provider_offers where model_id is null) then
    raise exception 'S5 products %', jsonb_array_length(r -> 'products');
  end if;
  p := (select x from jsonb_array_elements(r -> 'products') x where x ->> 'productKey' = 'pixverse-v6');
  if jsonb_array_length(p -> 'offers') <> 3
     or (select (x ->> 'fromUsd')::numeric from jsonb_array_elements(p -> 'offers') x where x ->> 'provider' = 'apimart') <> 0.016
     or (select (x ->> 'fromUsd')::numeric from jsonb_array_elements(p -> 'offers') x where x ->> 'provider' = 'kie') <> 0.02
     or (select (x ->> 'fromUsd')::numeric from jsonb_array_elements(p -> 'offers') x where x ->> 'provider' = 'cuddler') <> 0.0332325
     or (select (x -> 'ratesUsd' ->> '1080p|on')::numeric from jsonb_array_elements(p -> 'offers') x where x ->> 'provider' = 'kie') <> 0.092 then
    raise exception 'S5 PixVerse %', p;
  end if;
  v_ok := v_ok + 1;

  -- S6 ------------------------------------------------------------ no key material
  if r::text ~* '"(secret|secretRef|key_hint|keyHint|credential)"' then raise exception 'S6 key material in the reply'; end if;
  v_ok := v_ok + 1;

  raise exception 'PASS: % catalog supply test groups', v_ok;
end;
$$;
