-- Isolina · esquema de base de datos (etapa 1: pedidos, menú, retiros)
-- Se ejecuta una vez en el SQL Editor de Supabase.

-- Admin: los mails que pueden entrar al panel
create table if not exists public.admins (email text primary key);
insert into public.admins(email) values ('isolinauy@gmail.com') on conflict do nothing;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.admins where email = (auth.jwt() ->> 'email'));
$$;

-- Menú: un plato por día
create table if not exists public.menu (
  fecha date primary key,
  plato text not null,
  descripcion text,
  activo boolean not null default true
);

-- Ajustes (precios, datos de pago, franjas)
create table if not exists public.ajustes (
  clave text primary key,
  valor text not null
);
insert into public.ajustes(clave, valor) values
  ('precio_vianda','390'),
  ('precio_cuponera','2800'),
  ('viandas_cuponera','9'),
  ('hora_corte','11'),
  ('franjas','11:00 a 12:00|12:00 a 13:00|13:00 a 14:00|14:00 a 15:00'),
  ('datos_pago','')
on conflict do nothing;

-- Pedidos
create table if not exists public.pedidos (
  id bigint generated always as identity (start with 1001) primary key,
  creado timestamptz not null default now(),
  nombre text not null,
  apellido text not null,
  whatsapp text not null,
  franja text not null,
  notas text,
  tipo text not null check (tipo in ('suelta','cuponera')),
  total integer not null,
  medio text not null default 'transfer' check (medio in ('transfer','mp')),
  pago text not null default 'pendiente' check (pago in ('pendiente','comprobante','pagado')),
  estado text not null default 'nuevo' check (estado in ('nuevo','confirmado','cancelado')),
  comprobante text,
  recibe_menu boolean not null default false
);

create table if not exists public.pedido_items (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos(id) on delete cascade,
  fecha date not null,
  cantidad integer not null check (cantidad between 1 and 20),
  retirado boolean not null default false
);
create index if not exists pedido_items_fecha on public.pedido_items(fecha);

-- Seguridad: todo cerrado salvo lo que se abre explícitamente
alter table public.admins enable row level security;
alter table public.menu enable row level security;
alter table public.ajustes enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;

drop policy if exists menu_publico on public.menu;
create policy menu_publico on public.menu for select to anon, authenticated using (activo or public.es_admin());
drop policy if exists menu_admin on public.menu;
create policy menu_admin on public.menu for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists ajustes_admin on public.ajustes;
create policy ajustes_admin on public.ajustes for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists pedidos_admin on public.pedidos;
create policy pedidos_admin on public.pedidos for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists items_admin on public.pedido_items;
create policy items_admin on public.pedido_items for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists admins_admin on public.admins;
create policy admins_admin on public.admins for select to authenticated using (public.es_admin());

grant usage on schema public to anon, authenticated;
grant select on public.menu to anon, authenticated;
grant select, insert, update, delete on public.menu, public.ajustes, public.pedidos, public.pedido_items to authenticated;
grant select on public.admins to authenticated;

-- Ajustes visibles para la web pública (solo los que hacen falta)
create or replace function public.config_publica() returns json
language sql stable security definer set search_path = public as $$
  select json_object_agg(clave, valor) from public.ajustes
  where clave in ('precio_vianda','precio_cuponera','viandas_cuponera','hora_corte','franjas');
$$;

-- Crear pedido desde la web: valida días, corte y precios en el servidor
create or replace function public.crear_pedido(p json) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; v_total int; v_cant int := 0; it json;
  v_tipo text := p->>'tipo';
  ahora timestamp := (now() at time zone 'America/Montevideo');
  corte int := (select valor::int from ajustes where clave='hora_corte');
  pv int := (select valor::int from ajustes where clave='precio_vianda');
  pc int := (select valor::int from ajustes where clave='precio_cuponera');
  nc int := (select valor::int from ajustes where clave='viandas_cuponera');
begin
  if v_tipo not in ('suelta','cuponera') then raise exception 'Tipo de pedido inválido'; end if;
  if coalesce(trim(p->>'nombre'),'')='' or coalesce(trim(p->>'apellido'),'')='' then raise exception 'Faltan nombre y apellido'; end if;
  if length(regexp_replace(coalesce(p->>'whatsapp',''),'\D','','g')) < 8 then raise exception 'WhatsApp incompleto'; end if;
  if length(coalesce(p->>'notas','')) > 500 then raise exception 'Aclaración demasiado larga'; end if;

  for it in select * from json_array_elements(coalesce(p->'items','[]'::json)) loop
    if not exists(select 1 from menu where fecha=(it->>'fecha')::date and activo) then
      raise exception 'Ese día no tiene menú: %', it->>'fecha'; end if;
    if ((it->>'fecha')::date + make_interval(hours => corte)) <= ahora then
      raise exception 'Ese día ya cerró: %', it->>'fecha'; end if;
    if (it->>'cantidad')::int < 1 or (it->>'cantidad')::int > 20 then raise exception 'Cantidad inválida'; end if;
    v_cant := v_cant + (it->>'cantidad')::int;
  end loop;

  if v_tipo='suelta' then
    if v_cant=0 then raise exception 'Elegí al menos una vianda'; end if;
    v_total := v_cant * pv;
  else
    if v_cant > nc then raise exception 'La cuponera es de % viandas', nc; end if;
    v_total := pc;
  end if;

  insert into pedidos(nombre, apellido, whatsapp, franja, notas, tipo, total, recibe_menu)
  values (trim(p->>'nombre'), trim(p->>'apellido'), trim(p->>'whatsapp'), coalesce(p->>'franja',''),
          nullif(trim(coalesce(p->>'notas','')),''), v_tipo, v_total, coalesce((p->>'recibe_menu')::boolean,false))
  returning id into v_id;

  insert into pedido_items(pedido_id, fecha, cantidad)
  select v_id, (x->>'fecha')::date, (x->>'cantidad')::int from json_array_elements(coalesce(p->'items','[]'::json)) x;

  return json_build_object('id', v_id, 'total', v_total,
    'datos_pago', (select valor from ajustes where clave='datos_pago'));
end;
$$;

-- Marcar que el cliente subió comprobante (solo cambia ese campo)
create or replace function public.adjuntar_comprobante(p_id bigint, p_ruta text) returns void
language sql security definer set search_path = public as $$
  update pedidos set comprobante = p_ruta, pago = case when pago='pendiente' then 'comprobante' else pago end
  where id = p_id and comprobante is null and p_ruta like (p_id::text || '/%');
$$;

revoke all on function public.crear_pedido(json) from public;
revoke all on function public.adjuntar_comprobante(bigint, text) from public;
revoke all on function public.config_publica() from public;
grant execute on function public.crear_pedido(json) to anon, authenticated;
grant execute on function public.adjuntar_comprobante(bigint, text) to anon, authenticated;
grant execute on function public.config_publica() to anon, authenticated;
grant execute on function public.es_admin() to anon, authenticated;

-- Comprobantes: bucket privado; la web solo puede subir, el panel puede ver
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes','comprobantes', false, 5242880, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

drop policy if exists comprobantes_subir on storage.objects;
create policy comprobantes_subir on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'comprobantes');
drop policy if exists comprobantes_ver on storage.objects;
create policy comprobantes_ver on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and public.es_admin());

-- Avisos en tiempo real al panel
do $$ begin
  alter publication supabase_realtime add table public.pedidos;
exception when duplicate_object then null; end $$;

-- Menú de esta semana
insert into public.menu(fecha, plato, descripcion) values
  ('2026-11-16','Churrasco con puré',null),
  ('2026-11-17','Albóndigas en salsa con arroz',null),
  ('2026-11-18','Milanesa napolitana con guarnición',null),
  ('2026-11-19','Bife de pescado con ensalada primavera',null),
  ('2026-11-20','Hamburguesa Isolina','Cheddar, panceta, huevo frito y papas fritas')
on conflict (fecha) do nothing;
