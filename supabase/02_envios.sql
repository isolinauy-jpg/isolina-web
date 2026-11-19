-- Isolina · etapa 1b: envíos dentro de Pocitos
alter table public.pedidos add column if not exists entrega text not null default 'retiro';
alter table public.pedidos add column if not exists direccion text;
alter table public.pedidos add column if not exists costo_envio integer not null default 0;
do $$ begin
  alter table public.pedidos add constraint pedidos_entrega_chk check (entrega in ('retiro','envio'));
exception when duplicate_object then null; end $$;

insert into public.ajustes(clave, valor) values ('costo_envio',''), ('franjas_envio','11:00 a 12:00|12:00 a 13:00|13:00 a 14:00') on conflict do nothing;

create or replace function public.config_publica() returns json
language sql stable security definer set search_path = public as $$
  select json_object_agg(clave, valor) from public.ajustes
  where clave in ('precio_vianda','precio_cuponera','viandas_cuponera','hora_corte','franjas','costo_envio','franjas_envio');
$$;

create or replace function public.crear_pedido(p json) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; v_total int; v_cant int := 0; v_dias int := 0; v_envio int := 0; it json;
  v_tipo text := p->>'tipo';
  v_entrega text := coalesce(p->>'entrega','retiro');
  v_dir text := nullif(trim(coalesce(p->>'direccion','')),'');
  ahora timestamp := (now() at time zone 'America/Montevideo');
  corte int := (select valor::int from ajustes where clave='hora_corte');
  pv int := (select valor::int from ajustes where clave='precio_vianda');
  pc int := (select valor::int from ajustes where clave='precio_cuponera');
  nc int := (select valor::int from ajustes where clave='viandas_cuponera');
  ce int := coalesce((select nullif(regexp_replace(valor,'\D','','g'),'')::int from ajustes where clave='costo_envio'), 0);
begin
  if v_tipo not in ('suelta','cuponera') then raise exception 'Tipo de pedido inválido'; end if;
  if v_entrega not in ('retiro','envio') then raise exception 'Forma de entrega inválida'; end if;
  if v_entrega = 'envio' and coalesce(length(v_dir),0) < 5 then raise exception 'Falta la dirección de entrega'; end if;
  if v_entrega = 'envio' and not (coalesce(p->>'franja','') = any(string_to_array((select valor from ajustes where clave='franjas_envio'),'|'))) then raise exception 'Elegí un horario de envío válido'; end if;
  if length(coalesce(v_dir,'')) > 200 then raise exception 'Dirección demasiado larga'; end if;
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
  select count(distinct (x->>'fecha')) into v_dias from json_array_elements(coalesce(p->'items','[]'::json)) x;

  if v_tipo='suelta' then
    if v_cant=0 then raise exception 'Elegí al menos una vianda'; end if;
    v_total := v_cant * pv;
  else
    if v_cant > nc then raise exception 'La cuponera es de % viandas', nc; end if;
    v_total := pc;
  end if;
  if v_entrega = 'envio' then v_envio := ce * v_dias; v_total := v_total + v_envio; end if;

  insert into pedidos(nombre, apellido, whatsapp, franja, notas, tipo, total, recibe_menu, entrega, direccion, costo_envio)
  values (trim(p->>'nombre'), trim(p->>'apellido'), trim(p->>'whatsapp'), coalesce(p->>'franja',''),
          nullif(trim(coalesce(p->>'notas','')),''), v_tipo, v_total, coalesce((p->>'recibe_menu')::boolean,false),
          v_entrega, case when v_entrega='envio' then v_dir end, v_envio)
  returning id into v_id;

  insert into pedido_items(pedido_id, fecha, cantidad)
  select v_id, (x->>'fecha')::date, (x->>'cantidad')::int from json_array_elements(coalesce(p->'items','[]'::json)) x;

  return json_build_object('id', v_id, 'total', v_total, 'envio', v_envio,
    'datos_pago', (select valor from ajustes where clave='datos_pago'));
end;
$$;
revoke all on function public.crear_pedido(json) from public;
grant execute on function public.crear_pedido(json) to anon, authenticated;
revoke all on function public.config_publica() from public;
grant execute on function public.config_publica() to anon, authenticated;
update public.ajustes set valor='40' where clave='costo_envio' and valor='';
