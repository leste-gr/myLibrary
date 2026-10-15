-- Endpoint-only MCP setup: Supabase registers the OAuth client; each browser user
-- explicitly approves a pending authorization before that client can access data.
begin;

create table private.assistant_oauth_settings (
  singleton boolean primary key default true check (singleton),
  resource_url text not null check (resource_url ~ '^https://[^/]+/api/mcp$')
);
revoke all on private.assistant_oauth_settings from public, anon, authenticated;
-- Existing installations with one resource can retain their canonical endpoint.
-- New/multi-resource installations must configure this single value explicitly.
insert into private.assistant_oauth_settings(singleton, resource_url)
select true, min(resource_url) from public.assistant_oauth_clients
having count(distinct resource_url) = 1;

create function public.assistant_authorization_allowed(target_authorization_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and auth.jwt()->>'client_id' is null and exists (
    select 1 from auth.oauth_authorizations a
    join auth.oauth_clients c on c.id = a.client_id and c.deleted_at is null
    cross join private.assistant_oauth_settings s
    left join public.assistant_oauth_clients enabled on enabled.client_id = c.id::text
    where a.authorization_id = target_authorization_id
      and (a.user_id is null or a.user_id = auth.uid())
      and a.status::text = 'pending' and a.expires_at > now()
      and a.code_challenge is not null and a.code_challenge <> ''
      and a.code_challenge_method::text = 's256'
      and (a.resource is null or a.resource = '' or a.resource = s.resource_url)
      and not exists (
        select 1 from unnest(regexp_split_to_array(coalesce(a.scope, ''), '\s+')) scope
        where scope not in ('', 'openid', 'email', 'offline_access')
      )
      and (enabled.client_id is null or (enabled.enabled and enabled.resource_url = s.resource_url))
  );
$$;
revoke all on function public.assistant_authorization_allowed(text) from public, anon;
grant execute on function public.assistant_authorization_allowed(text) to authenticated;

create function public.authorize_assistant_connection(target_authorization_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_client text; target_resource text;
begin
  if not public.assistant_authorization_allowed(target_authorization_id) then
    raise exception 'Assistant authorization is invalid, expired, or disabled.';
  end if;
  select a.client_id::text, s.resource_url into target_client, target_resource
  from auth.oauth_authorizations a cross join private.assistant_oauth_settings s
  where a.authorization_id = target_authorization_id;
  insert into public.assistant_oauth_clients(client_id, resource_url)
    values(target_client, target_resource) on conflict(client_id) do nothing;
  -- This preserves administrator disablement and grants only the browser's owner.
  perform public.set_assistant_connection(target_client, true);
end;
$$;
revoke all on function public.authorize_assistant_connection(text) from public, anon;
grant execute on function public.authorize_assistant_connection(text) to authenticated;
commit;
