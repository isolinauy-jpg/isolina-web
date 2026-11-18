/* Isolina · panel de gestión (etapa 1) */
const SB_URL = "https://ywhwelrwfzezpqleaxiz.supabase.co";
const SB_KEY = "sb_publishable_Dm7mdWGSL5A43TVdfijm3A_pBI7nRf0";
const sb = window.supabase.createClient(SB_URL, SB_KEY);

const DAYS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const DS = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const PAGO = {pendiente:["Falta pago","p-bad"],comprobante:["Revisar comprobante","p-warn"],pagado:["Pago recibido","p-ok"]};
const EST = {nuevo:["Nuevo","p-info"],confirmado:["Confirmado","p-ok"],cancelado:["Cancelado","p-bad"]};
const DIRECCION = "Plácido Ellauri 3369";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = n => "$" + Number(n).toLocaleString("es-UY");
const pill = ([t,c]) => `<span class="pill ${c}">${t}</span>`;
const iso = d => { const z = new Date(d.getTime() - d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); };
const parseD = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };
const dm = s => { const d = parseD(s); return `${d.getDate()}/${d.getMonth()+1}`; };
const dayName = s => DAYS[parseD(s).getDay()];
const dayShort = s => `${DS[parseD(s).getDay()]} ${dm(s)}`;
const mondayOf = d => { const x = new Date(d); const k = (x.getDay()+6)%7; x.setDate(x.getDate()-k); x.setHours(0,0,0,0); return x; };
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const weekDates = mon => [0,1,2,3,4].map(i => iso(addDays(mon,i)));
const hora = ts => new Date(ts).toLocaleString("es-UY",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
const waLink = (num, txt) => `https://wa.me/598${String(num).replace(/\D/g,"").replace(/^0/,"")}?text=${encodeURIComponent(txt)}`;

let state = { pedidos: [], menu: {}, ajustes: {}, tab: "pedidos", filter: "activos", week: iso(mondayOf(new Date())), rDay: null, unseen: 0, fresh: new Set() };
let audio = null, sndOn = false;

/* ---------- auth ---------- */
let starting = false, started = false;
async function init() {
  if (starting || started) return; starting = true;
  try { await start(); } finally { starting = false; }
}
async function start() {
  if (loginMode === "newpass") { showLogin(); setLoginMode("newpass"); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  const { data: ok, error } = await sb.rpc("es_admin");
  if (error || !ok) return showLogin(`La cuenta ${esc(session.user.email)} no tiene permiso para entrar al panel.`, true);
  $("#login").hidden = true; $("#app").hidden = false;
  $("#who").textContent = session.user.email;
  await loadAll();
  if (!started) subscribe();
  started = true;
  render();
}
function showLogin(msg, signedIn) {
  $("#app").hidden = true; $("#login").hidden = false;
  $("#loginMsg").innerHTML = msg || "";
  $("#logoutBad").hidden = !signedIn;
}
let loginMode = new URLSearchParams(location.hash.slice(1)).get("type") === "recovery" ? "newpass" : "login";
function setLoginMode(m) {
  loginMode = m;
  const L = { login: ["Panel de pedidos", "Contraseña", "Entrar", "current-password", false],
              first: ["Elegí una contraseña de al menos 8 caracteres. Te va a llegar un mail para confirmar la cuenta (es una sola vez).", "Contraseña nueva", "Crear contraseña", "new-password", false],
              forgot: ["Te mandamos un mail con un link para elegir una contraseña nueva.", "", "Enviar mail", "", true],
              newpass: ["Elegí tu contraseña nueva.", "Contraseña nueva", "Guardar contraseña", "new-password", false] }[m];
  $("#loginIntro").textContent = L[0]; $("#passLbl").textContent = L[1]; $("#loginBtn").textContent = L[2];
  $("#pass").autocomplete = L[3] || "off"; $("#pass").hidden = $("#passLbl").hidden = L[4]; $("#pass").required = !L[4];
  $("#email").disabled = m === "newpass"; $("#loginMsg").textContent = "";
  $("#toLogin").hidden = m === "login"; $("#toForgot").hidden = m !== "login";
}
$("#toLogin").addEventListener("click", e => { e.preventDefault(); setLoginMode("login"); });
$("#toForgot").addEventListener("click", e => { e.preventDefault(); setLoginMode("forgot"); });
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#email").value.trim(), pass = $("#pass").value, btn = $("#loginBtn"), msg = $("#loginMsg");
  btn.disabled = true; msg.textContent = "";
  try {
    if (loginMode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) msg.textContent = "Mail o contraseña incorrectos.";
      else { msg.textContent = "Entrando…"; return init(); }
    } else if (loginMode === "first") {
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: location.origin + "/panel/" } });
      if (error && /registered|already/i.test(error.message)) { msg.textContent = "Ese mail ya tiene cuenta. Tocá «Olvidé mi contraseña» para elegir una nueva."; }
      else if (error) msg.textContent = "No se pudo crear: " + error.message;
      else if (data.session) return init();
      else msg.innerHTML = `Listo. Te mandamos un mail a <b>${esc(email)}</b>: tocá el link para confirmar la cuenta y después entrá con tu mail y contraseña.`;
    } else if (loginMode === "forgot") {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/panel/" });
      msg.innerHTML = error ? "No se pudo enviar: " + esc(error.message) : `Te mandamos un mail a <b>${esc(email)}</b> con un link para elegir la contraseña.`;
    } else if (loginMode === "newpass") {
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) msg.textContent = "No se pudo guardar: " + error.message;
      else { history.replaceState(null, "", location.pathname); setLoginMode("login"); return init(); }
    }
  } finally { btn.disabled = false; }
});
$("#logoutBad").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });
// Nota: no llamar a Supabase dentro de este callback (se traba); se difiere con setTimeout.
sb.auth.onAuthStateChange((ev) => { setTimeout(() => { if (ev === "PASSWORD_RECOVERY") { $("#app").hidden = true; $("#login").hidden = false; setLoginMode("newpass"); return; } if (ev === "SIGNED_IN" && $("#app").hidden && loginMode !== "newpass") init(); if (ev === "SIGNED_OUT") location.reload(); }, 0); });

/* ---------- data ---------- */
async function loadAll() {
  const desde = iso(addDays(mondayOf(new Date()), -42));
  const [p, m, a] = await Promise.all([
    sb.from("pedidos").select("*, pedido_items(*)").gte("creado", desde).order("id", { ascending: false }).limit(500),
    sb.from("menu").select("*").gte("fecha", desde).order("fecha"),
    sb.from("ajustes").select("*")
  ]);
  if (p.error || m.error || a.error) { toast("No se pudieron cargar los datos. Revisá la conexión."); return; }
  state.pedidos = p.data;
  state.menu = Object.fromEntries(m.data.map(r => [r.fecha, r]));
  state.ajustes = Object.fromEntries(a.data.map(r => [r.clave, r.valor]));
}
function subscribe() {
  sb.channel("pedidos").on("postgres_changes", { event: "INSERT", schema: "public", table: "pedidos" }, async payload => {
    state.fresh.add(payload.new.id); state.unseen++; setTitle(); chime();
    toast(`Nuevo pedido #${payload.new.id} · ${payload.new.nombre} ${payload.new.apellido}`);
    const h = document.querySelector("header"); h.classList.remove("flash"); void h.offsetWidth; h.classList.add("flash");
    await loadAll(); render();
  }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos" }, async () => { await loadAll(); render(); }).subscribe();
}
const plato = f => state.menu[f]?.plato || "Menú a confirmar";
const nItems = o => o.pedido_items.reduce((a,i) => a + i.cantidad, 0);
const itemsTxt = o => o.pedido_items.slice().sort((a,b)=>a.fecha.localeCompare(b.fecha)).map(i => `${dayShort(i.fecha)} · ${plato(i.fecha)} ×${i.cantidad}`).join("\n");
const activo = o => o.estado !== "cancelado";

/* ---------- messages ---------- */
const pagoTxt = () => (state.ajustes.datos_pago || "").trim();
function contactMsg(o) {
  let m = `Hola ${o.nombre}, te escribimos de Isolina por tu pedido #${o.id}.\n\nResumen:\n${itemsTxt(o) || "Cuponera: días a reservar"}\nRetiro en ${DIRECCION}, de ${o.franja}\nTotal: ${fmt(o.total)}`;
  if (o.pago === "pendiente") m += `\n\nPara confirmarlo nos falta el comprobante de la transferencia. Nos lo podés mandar por acá.` + (pagoTxt() ? `\n\nDatos para transferir:\n${pagoTxt()}\nConcepto: Pedido #${o.id}` : "");
  else if (o.pago === "comprobante") m += `\n\nRecibimos tu comprobante, lo estamos revisando y te confirmamos enseguida.`;
  return m;
}
function confirmMsg(o) {
  return `Hola ${o.nombre}, ¡gracias por elegir Isolina! Tu pedido #${o.id} está confirmado.\n\n${itemsTxt(o) || "Cuponera anticipada: avisanos qué días querés tus viandas."}\nTotal: ${fmt(o.total)}\nRetiro en ${DIRECCION}, de ${o.franja}\n\nCualquier cambio, escribinos por acá.`;
}

/* ---------- render ---------- */
function setTitle() { document.title = state.unseen ? `(${state.unseen}) Nuevo pedido · Isolina Panel` : "Isolina Panel"; }
function header() {
  const rev = state.pedidos.filter(o => activo(o) && (o.pago !== "pagado" || o.estado === "nuevo")).length;
  const T = [["pedidos","Pedidos",rev],["semana","Semana"],["retiros","Retiros"],["menu","Menú"],["ajustes","Ajustes"]];
  $("#tabs").innerHTML = T.map(([k,l,b]) => `<button role="tab" aria-selected="${k===state.tab}" data-t="${k}">${l}${b?`<span class="badge">${b}</span>`:""}</button>`).join("");
}
function render() { header(); $("#view").innerHTML = ({pedidos:vPedidos,semana:vSemana,retiros:vRetiros,menu:vMenu,ajustes:vAjustes})[state.tab](); afterRender(); }

function vPedidos() {
  const F = { activos: o => activo(o) && (o.pago !== "pagado" || o.estado === "nuevo"), revisar: o => o.pago === "comprobante" && activo(o), pendiente: o => o.pago === "pendiente" && activo(o), confirmado: o => o.estado === "confirmado", todos: () => true };
  const cnt = k => state.pedidos.filter(F[k]).length;
  const rows = state.pedidos.filter(F[state.filter]).map(o => {
    const dias = o.pedido_items.slice().sort((a,b)=>a.fecha.localeCompare(b.fecha)).map(i => dayShort(i.fecha)).join(", ");
    return `<tr class="click ${state.fresh.has(o.id)?"fresh":""}" data-id="${o.id}"><td class="id">#${o.id}<span class="sub">${hora(o.creado)}</span></td>
    <td><strong>${esc(o.nombre)} ${esc(o.apellido)}</strong><span class="sub">${esc(o.whatsapp)}</span></td>
    <td>${o.tipo==="cuponera"?`<span class="pill p-info">Cuponera</span> `:""}${dias || "<span class='sub'>Días a reservar</span>"}<span class="sub">${nItems(o)} vianda${nItems(o)===1?"":"s"}</span></td>
    <td>${esc(o.franja)}</td><td class="num"><strong>${fmt(o.total)}</strong></td><td>${pill(PAGO[o.pago])}</td><td>${pill(EST[o.estado])}</td></tr>`;
  }).join("");
  const ch = (k,l) => `<button class="chip" aria-pressed="${state.filter===k}" data-f="${k}">${l} · ${cnt(k)}</button>`;
  return `<div class="sec-h"><div><h2>Pedidos</h2><p>Los pedidos de la web entran acá solos. Tocá uno para revisarlo, marcar el pago y confirmarlo.</p></div>
   <div class="filters">${ch("activos","Para revisar")}${ch("revisar","Con comprobante")}${ch("pendiente","Falta pago")}${ch("confirmado","Confirmados")}${ch("todos","Todos")}</div></div>
   <div class="card tscroll"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Días</th><th>Retiro</th><th class="num">Total</th><th>Pago</th><th>Estado</th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="muted">No hay pedidos en esta lista.</td></tr>`}</tbody></table></div>`;
}

function weekOptions() {
  const mon = mondayOf(new Date());
  return [-1,0,1,2].map(k => iso(addDays(mon, 7*k)));
}
function weekSel() {
  return `<div class="filters">${weekOptions().map(w => `<button class="chip" aria-pressed="${w===state.week}" data-w="${w}">Semana ${dm(w)}</button>`).join("")}</div>`;
}
function dayCounts(f) {
  let ok = 0, pend = 0;
  state.pedidos.filter(activo).forEach(o => o.pedido_items.filter(i => i.fecha === f).forEach(i => { if (o.pago === "pagado") ok += i.cantidad; else pend += i.cantidad; }));
  return { ok, pend };
}
function vSemana() {
  const dates = weekDates(parseD(state.week));
  const tot = dates.reduce((a,f) => { const c = dayCounts(f); a.ok += c.ok; a.pend += c.pend; return a; }, { ok:0, pend:0 });
  const cobrado = state.pedidos.filter(o => activo(o) && o.pago === "pagado").reduce((a,o) => a + o.total, 0);
  const porCobrar = state.pedidos.filter(o => activo(o) && o.pago !== "pagado").reduce((a,o) => a + o.total, 0);
  const cols = dates.map(f => { const c = dayCounts(f);
    return `<button class="wday" data-day="${f}" title="Ver retiros del ${dayName(f)}"><div class="dh"><strong>${dayName(f)}</strong><span>${dm(f)}</span></div>
     <div class="big">${c.ok}<small> viandas</small></div><div class="pend">${c.pend?`+${c.pend} sin pago confirmado`:""}</div>
     <div class="dish"><div><em>Plato del día</em>${esc(plato(f))}</div></div></button>`; }).join("");
  return `<div class="kpis">
   <div class="kpi"><span>Viandas confirmadas</span><b>${tot.ok}</b><small>esta semana</small></div>
   <div class="kpi alert"><span>Sin pago confirmado</span><b>${tot.pend}</b><small>esta semana</small></div>
   <div class="kpi"><span>Cobrado</span><b>${fmt(cobrado)}</b><small>últimas semanas</small></div>
   <div class="kpi alert"><span>Por cobrar</span><b>${fmt(porCobrar)}</b><small>pedidos sin pago</small></div></div>
   <div class="sec-h"><div><h2>Producción por día</h2><p>El número grande es lo pagado. Lo naranja todavía no pagó.</p></div><div style="display:flex;gap:8px;flex-wrap:wrap">${weekSel()}<button class="btn btn-blue" id="cocina">Copiar lista para cocina</button></div></div>
   <div class="week">${cols}</div>`;
}
function cocinaTxt() {
  const dates = weekDates(parseD(state.week));
  let out = `COCINA ISOLINA · Semana del ${dm(state.week)}`;
  dates.forEach(f => { const c = dayCounts(f); const notes = [];
    state.pedidos.filter(o => activo(o) && o.notas && o.pedido_items.some(i => i.fecha === f)).forEach(o => notes.push(`#${o.id} ${o.nombre}: ${o.notas}`));
    out += `\n\n${dayName(f).toUpperCase()} ${dm(f)} · ${plato(f)}\nConfirmadas: ${c.ok}${c.pend?` (+${c.pend} a confirmar)`:""}` + (notes.length ? `\n  Aclaraciones:\n  - ${notes.join("\n  - ")}` : ""); });
  return out;
}

function vRetiros() {
  const dates = weekDates(parseD(state.week));
  const today = iso(new Date());
  if (!state.rDay || !dates.includes(state.rDay)) state.rDay = dates.includes(today) ? today : dates[0];
  const f = state.rDay;
  const lista = state.pedidos.filter(o => activo(o) && o.pago === "pagado" && o.pedido_items.some(i => i.fecha === f));
  const hold = state.pedidos.filter(o => activo(o) && o.pago !== "pagado" && o.pedido_items.some(i => i.fecha === f)).length;
  const fr = [...new Set(lista.map(o => o.franja))].sort();
  const card = o => { const its = o.pedido_items.filter(i => i.fecha === f); const n = its.reduce((a,i)=>a+i.cantidad,0); const done = its.every(i => i.retirado);
    return `<div class="stop ${done?"done":""}"><div class="addr">${esc(o.nombre)} ${esc(o.apellido)}</div>
     <div class="who"><a href="${waLink(o.whatsapp,"")}" target="_blank" rel="noopener">${esc(o.whatsapp)}</a> · Pedido #${o.id}</div>
     <div class="what"><b>${n}</b> vianda${n>1?"s":""} · ${esc(plato(f))}</div>${o.notas?`<div class="note">${esc(o.notas)}</div>`:""}
     <div class="row"><label class="check"><input type="checkbox" data-ret="${its.map(i=>i.id).join(",")}" ${done?"checked":""}> Retirado</label></div></div>`; };
  const listos = lista.filter(o => o.pedido_items.filter(i => i.fecha === f).every(i => i.retirado)).length;
  const vi = lista.reduce((a,o) => a + o.pedido_items.filter(i => i.fecha === f).reduce((x,i)=>x+i.cantidad,0), 0);
  return `<div class="sec-h"><div><h2>Retiros · ${dayName(f)} ${dm(f)}</h2><p>${vi} viandas para preparar, ${listos} de ${lista.length} ya retirados.</p></div>
   <div style="display:flex;gap:8px;flex-wrap:wrap">${weekSel()}<button class="btn btn-blue" id="ruta">Copiar lista del día</button></div></div>
   <div class="days">${dates.map(d => `<button aria-pressed="${d===f}" data-rd="${d}">${dayName(d)}<small>${dm(d)} · ${state.pedidos.filter(o=>activo(o)&&o.pago==="pagado"&&o.pedido_items.some(i=>i.fecha===d)).length} retiros</small></button>`).join("")}</div>
   ${hold?`<div class="flag">${hold} pedido${hold>1?"s":""} de este día sin pago confirmado. No figuran en la lista.</div>`:""}
   ${fr.map(x => `<div class="franja"><h3>De ${esc(x)} · ${lista.filter(o=>o.franja===x).length}</h3><div class="stops">${lista.filter(o=>o.franja===x).map(card).join("")}</div></div>`).join("") || `<p class="muted">No hay retiros este día.</p>`}`;
}
function rutaTxt() {
  const f = state.rDay;
  const lista = state.pedidos.filter(o => activo(o) && o.pago === "pagado" && o.pedido_items.some(i => i.fecha === f)).sort((a,b) => a.franja.localeCompare(b.franja));
  return `RETIROS ISOLINA · ${dayName(f)} ${dm(f)}\n` + lista.map((o,k) => { const n = o.pedido_items.filter(i=>i.fecha===f).reduce((a,i)=>a+i.cantidad,0); return `\n${k+1}. ${o.nombre} ${o.apellido} · ${o.franja}\n   ${n} vianda${n>1?"s":""}${o.notas?"\n   OJO: "+o.notas:""}`; }).join("");
}

function vMenu() {
  const dates = weekDates(parseD(state.week));
  const rows = dates.map(f => { const m = state.menu[f] || {};
    return `<div class="mrow"><div class="mday"><strong>${dayName(f)}</strong><span>${dm(f)}</span></div>
     <input id="pl-${f}" placeholder="Plato del día" value="${esc(m.plato||"")}">
     <input id="de-${f}" placeholder="Descripción (opcional)" value="${esc(m.descripcion||"")}">
     <label class="check"><input type="checkbox" id="ac-${f}" ${m.plato && m.activo===false?"":"checked"}> Se vende</label></div>`; }).join("");
  return `<div class="sec-h"><div><h2>Menú · semana del ${dm(state.week)}</h2><p>Lo que cargues acá aparece en la web al guardar. Si un día no tiene plato, la web lo muestra como "a confirmar" y no se puede pedir.</p></div>${weekSel()}</div>
   <div class="card mcard">${rows}<div class="acts"><button class="btn btn-blue" id="saveMenu">Guardar menú</button></div></div>`;
}
function vAjustes() {
  const a = state.ajustes;
  return `<div class="sec-h"><div><h2>Ajustes</h2><p>Datos que usa la web y los mensajes de WhatsApp.</p></div></div>
   <div class="card mcard">
    <label class="fl" for="aj-pago">Datos para transferir<small>Se muestran al cliente después de hacer el pedido y van en los mensajes de contacto.</small></label>
    <textarea id="aj-pago" rows="3" placeholder="Ej.: Prex · Cuenta 0000000 · Titular Nombre Apellido">${esc(a.datos_pago||"")}</textarea>
    <div class="grid2">
     <div><label class="fl" for="aj-pv">Precio vianda suelta ($)</label><input id="aj-pv" inputmode="numeric" value="${esc(a.precio_vianda||"")}"></div>
     <div><label class="fl" for="aj-pc">Precio cuponera anticipada ($)</label><input id="aj-pc" inputmode="numeric" value="${esc(a.precio_cuponera||"")}"></div>
     <div><label class="fl" for="aj-nc">Viandas de la cuponera</label><input id="aj-nc" inputmode="numeric" value="${esc(a.viandas_cuponera||"")}"></div>
     <div><label class="fl" for="aj-hc">Hora de corte para pedir en el día</label><input id="aj-hc" inputmode="numeric" value="${esc(a.hora_corte||"")}"></div>
    </div>
    <label class="fl" for="aj-fr">Franjas de retiro<small>Separadas por |</small></label>
    <input id="aj-fr" value="${esc(a.franjas||"")}">
    <div class="acts"><button class="btn btn-blue" id="saveAj">Guardar ajustes</button></div>
   </div>`;
}

async function drawer(id) {
  const o = state.pedidos.find(x => x.id === id); if (!o) return;
  state.fresh.delete(id);
  const its = o.pedido_items.slice().sort((a,b)=>a.fecha.localeCompare(b.fecha)).map(i => `<div><span>${dayShort(i.fecha)} · ${esc(plato(i.fecha))}</span><b>×${i.cantidad}</b></div>`).join("");
  let rc = `<div class="receipt"><span class="ic">—</span><span>Todavía no mandó comprobante por la web. Puede llegar por WhatsApp.</span></div>`;
  if (o.comprobante) rc = `<div class="receipt"><span class="ic">${esc(o.comprobante.split(".").pop().toUpperCase().slice(0,4))}</span><span><strong>Comprobante adjunto</strong><span class="sub"><a href="#" data-comp="${esc(o.comprobante)}">Abrir comprobante</a></span></span></div>`;
  $("#layer").innerHTML = `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-label="Pedido ${o.id}">
   <div class="dhead"><div><span class="id">#${o.id} · ${hora(o.creado)}</span><h3>${esc(o.nombre)} ${esc(o.apellido)}</h3><div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${pill(PAGO[o.pago])}${pill(EST[o.estado])}${o.tipo==="cuponera"?pill(["Cuponera","p-info"]):""}</div></div><button class="x" data-close aria-label="Cerrar">×</button></div>
   <dl class="kv"><dt>WhatsApp</dt><dd>${esc(o.whatsapp)}</dd><dt>Retiro</dt><dd>${esc(o.franja)}</dd>${o.notas?`<dt>Para la cocina</dt><dd>${esc(o.notas)}</dd>`:""}<dt>Menú semanal</dt><dd>${o.recibe_menu?"Quiere recibirlo":"No"}</dd></dl>
   <div><div class="lbl">Viandas</div><div class="items">${its || `<div><span>Cuponera: días a reservar</span></div>`}</div>
   <div class="kv" style="margin-top:8px"><dt>Total</dt><dd style="font-size:1.2rem;font-weight:700">${fmt(o.total)}</dd></div></div>
   <div><div class="lbl">Comprobante</div>${rc}</div>
   <div class="acts"><a class="btn btn-wa" target="_blank" rel="noopener" href="${waLink(o.whatsapp, contactMsg(o))}">Contactar</a>
    ${o.pago!=="pagado"?`<button class="btn btn-ok" data-act="pagar" data-id="${o.id}">Marcar pago recibido</button>`:""}
    ${o.estado==="nuevo"?`<button class="btn btn-blue" data-act="confirmar" data-id="${o.id}" ${o.pago!=="pagado"?"disabled style='opacity:.4'":""}>Confirmar pedido</button>`:""}</div>
   ${o.estado==="confirmado"?`<div><div class="lbl">Mensaje de confirmación</div><pre class="msg">${esc(confirmMsg(o))}</pre><div class="acts" style="margin-top:8px"><a class="btn btn-wa" target="_blank" rel="noopener" href="${waLink(o.whatsapp, confirmMsg(o))}">Enviar por WhatsApp</a></div></div>`:o.pago!=="pagado"?`<p class="muted">Para confirmar, primero marcá el pago como recibido.</p>`:""}
   ${o.estado!=="cancelado"?`<details><summary class="lbl" style="cursor:pointer">Más opciones</summary><div class="acts" style="margin-top:8px"><button class="btn btn-line" data-act="cancelar" data-id="${o.id}">Cancelar pedido</button></div></details>`:""}
  </aside>`;
}

function afterRender() {}

/* ---------- actions ---------- */
async function upd(id, patch, msg) {
  const { error } = await sb.from("pedidos").update(patch).eq("id", id);
  if (error) return toast("No se pudo guardar: " + error.message);
  toast(msg); await loadAll(); render(); drawer(id);
}
document.addEventListener("click", async e => {
  const t = e.target;
  const tb = t.closest("[data-t]"); if (tb) { state.tab = tb.dataset.t; if (state.tab === "pedidos") { state.unseen = 0; setTitle(); } render(); return; }
  const f = t.closest("[data-f]"); if (f) { state.filter = f.dataset.f; render(); return; }
  const w = t.closest("[data-w]"); if (w) { state.week = w.dataset.w; render(); return; }
  const wd = t.closest(".wday"); if (wd) { state.rDay = wd.dataset.day; state.tab = "retiros"; render(); return; }
  const rd = t.closest("[data-rd]"); if (rd) { state.rDay = rd.dataset.rd; render(); return; }
  const row = t.closest("tr.click"); if (row) { drawer(+row.dataset.id); return; }
  if (t.closest("[data-close]")) { $("#layer").innerHTML = ""; return; }
  const cp = t.closest("[data-comp]"); if (cp) { e.preventDefault(); const { data, error } = await sb.storage.from("comprobantes").createSignedUrl(cp.dataset.comp, 300); if (error) return toast("No se pudo abrir el comprobante."); window.open(data.signedUrl, "_blank", "noopener"); return; }
  const a = t.closest("[data-act]"); if (a) { const id = +a.dataset.id;
    if (a.dataset.act === "pagar") return upd(id, { pago: "pagado" }, `Pago de #${id} marcado como recibido`);
    if (a.dataset.act === "confirmar") return upd(id, { estado: "confirmado" }, `Pedido #${id} confirmado`);
    if (a.dataset.act === "cancelar") return upd(id, { estado: "cancelado" }, `Pedido #${id} cancelado`); }
  if (t.closest("#cocina")) return copy(cocinaTxt(), "Lista para cocina copiada");
  if (t.closest("#ruta")) return copy(rutaTxt(), "Lista del día copiada");
  if (t.closest("#saveMenu")) return saveMenu();
  if (t.closest("#saveAj")) return saveAjustes();
  if (t.closest("#snd")) { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); sndOn = !sndOn; const b = $("#snd"); b.setAttribute("aria-pressed", sndOn); b.textContent = sndOn ? "Sonido activado" : "Activar sonido"; if (sndOn) chime(); } catch (_) { toast("Este navegador no permite sonido"); } return; }
  if (t.closest("#logout")) { await sb.auth.signOut(); location.reload(); }
});
document.addEventListener("change", async e => {
  const r = e.target.dataset.ret; if (!r) return;
  const ids = r.split(",").map(Number);
  const { error } = await sb.from("pedido_items").update({ retirado: e.target.checked }).in("id", ids);
  if (error) return toast("No se pudo guardar.");
  await loadAll(); render();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") $("#layer").innerHTML = ""; });

async function saveMenu() {
  const dates = weekDates(parseD(state.week));
  const up = [], del = [];
  dates.forEach(f => { const p = $(`#pl-${f}`).value.trim(); if (p) up.push({ fecha: f, plato: p, descripcion: $(`#de-${f}`).value.trim() || null, activo: $(`#ac-${f}`).checked }); else if (state.menu[f]) del.push(f); });
  if (up.length) { const { error } = await sb.from("menu").upsert(up); if (error) return toast("No se pudo guardar el menú: " + error.message); }
  if (del.length) await sb.from("menu").delete().in("fecha", del);
  toast("Menú guardado. Ya se ve en la web."); await loadAll(); render();
}
async function saveAjustes() {
  const num = id => String(parseInt($(id).value, 10) || "");
  const rows = [
    { clave: "datos_pago", valor: $("#aj-pago").value.trim() },
    { clave: "precio_vianda", valor: num("#aj-pv") }, { clave: "precio_cuponera", valor: num("#aj-pc") },
    { clave: "viandas_cuponera", valor: num("#aj-nc") }, { clave: "hora_corte", valor: num("#aj-hc") },
    { clave: "franjas", valor: $("#aj-fr").value.split("|").map(s => s.trim()).filter(Boolean).join("|") }
  ];
  if (rows.slice(1, 5).some(r => !r.valor)) return toast("Revisá los números: hay un campo vacío.");
  const { error } = await sb.from("ajustes").upsert(rows);
  if (error) return toast("No se pudo guardar: " + error.message);
  toast("Ajustes guardados."); await loadAll(); render();
}

/* ---------- utils ---------- */
function chime() { if (!audio || !sndOn) return; const t = audio.currentTime; [[880,0],[1175,.16],[1568,.32]].forEach(([f,d]) => { const o = audio.createOscillator(), g = audio.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0,t+d); g.gain.linearRampToValueAtTime(.35,t+d+.02); g.gain.exponentialRampToValueAtTime(.001,t+d+.5); o.connect(g).connect(audio.destination); o.start(t+d); o.stop(t+d+.55); }); }
function toast(t) { const e = $("#toast"); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 2600); }
function copy(txt, ok) { navigator.clipboard.writeText(txt).then(() => toast(ok)).catch(() => toast("No se pudo copiar desde acá")); }

init();
