/* Isolina · web de pedidos (conectada a la base de datos) */
const sb = window.supabase.createClient("https://ywhwelrwfzezpqleaxiz.supabase.co", "sb_publishable_Dm7mdWGSL5A43TVdfijm3A_pBI7nRf0");
const WA_ISOLINA = "59898101066";
const DAYS = ["Lunes","Martes","Miércoles","Jueves","Viernes"];
const pad = n => String(n).padStart(2,"0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const mondayOf = d => { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; };
const dm = s => { const [y,m,d] = s.split("-").map(Number); return `${d}/${m}`; };
const fmt = n => "$" + Number(n).toLocaleString("es-UY");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

let P = { dia: 390, cupo: 2800, cupoN: 9, corte: 11, envio: 0 };
let entrega = "retiro", hayEnvios = false;
const SEMANAS_ADELANTE = 4; // semana actual + 4 hacia adelante; se corre sola cada lunes
let FRANJAS = ["11:00 a 12:00","12:00 a 13:00","13:00 a 14:00","14:00 a 15:00"];
let FRANJAS_ENVIO = ["11:00 a 12:00","12:00 a 13:00","13:00 a 14:00"];
let WEEKS = [];           // [{id, label, dates:[iso x5], menu:[{plato,descripcion}|null x5]}]
const qty = {};           // qty[weekId][dayIdx] = cantidad
let plan = "suelta", cur = null, loaded = false;

async function load() {
  const mon = mondayOf(new Date());
  const desde = iso(mon), hasta = iso(addDays(mon, 7*SEMANAS_ADELANTE + 6));
  const [cfg, menu] = await Promise.all([
    sb.rpc("config_publica"),
    sb.from("menu").select("fecha,plato,descripcion").gte("fecha", desde).lte("fecha", hasta).order("fecha")
  ]);
  if (!cfg.error && cfg.data) {
    const c = cfg.data;
    P = { dia: +c.precio_vianda || 390, cupo: +c.precio_cuponera || 2800, cupoN: +c.viandas_cuponera || 9, corte: +c.hora_corte || 11, envio: parseInt(String(c.costo_envio||"").replace(/\D/g,""),10) || 0 };
    if (c.franjas) FRANJAS = c.franjas.split("|");
    if (c.franjas_envio) { FRANJAS_ENVIO = c.franjas_envio.split("|"); hayEnvios = true; }
  }
  const byDate = Object.fromEntries((menu.data || []).map(r => [r.fecha, r]));
  // Siempre se ven esta semana y la próxima; las siguientes aparecen cuando tienen menú cargado.
  WEEKS = Array.from({ length: SEMANAS_ADELANTE + 1 }, (_, k) => {
    const m = addDays(mon, 7*k);
    const dates = [0,1,2,3,4].map(i => iso(addDays(m, i)));
    return { id: "w"+k, label: `Semana del ${dm(dates[0])}`, dates, menu: dates.map(f => byDate[f] || null) };
  }).filter((w, k) => k < 2 || w.menu.some(Boolean));
  WEEKS.forEach(w => qty[w.id] = [0,0,0,0,0]);
  const firstOpen = WEEKS.find(w => w.dates.some((_, i) => !closed(w.id, i)));
  cur = (firstOpen || WEEKS[0]).id;
  loaded = !menu.error;
  renderAll();
}

function closed(wid, i) {
  const w = WEEKS.find(x => x.id === wid); if (!w || !w.menu[i]) return true;
  const [y,m,d] = w.dates[i].split("-").map(Number);
  return new Date() >= new Date(y, m-1, d, P.corte, 0);
}
const weekCount = w => qty[w].reduce((a,x) => a+x, 0);
function calc() {
  const count = WEEKS.reduce((a,w) => a + weekCount(w.id), 0);
  const dias = WEEKS.reduce((a,w) => a + qty[w.id].filter(q => q > 0).length, 0);
  const envio = entrega === "envio" ? P.envio * dias : 0;
  if (plan === "cuponera") return { count, dias, envio, total: P.cupo + envio, rest: P.cupoN - count, save: P.dia*P.cupoN - P.cupo, sellos: 0, ok: true };
  const lines = WEEKS.map(w => ({ label: w.label, count: weekCount(w.id) })).filter(l => l.count);
  return { count, dias, envio, total: count*P.dia + envio, rest: 0, lines, save: 0, sellos: count, ok: count > 0 };
}
const unitCupo = () => Math.round(P.cupo / P.cupoN);

function renderTabs() {
  document.getElementById("tabs").innerHTML = WEEKS.map(w => `<button class="tab ${weekCount(w.id)?"full":""}" role="tab" aria-selected="${w.id===cur}" data-w="${w.id}"><span class="ok"></span>${w.label}</button>`).join("");
}
function renderDays() {
  const el = document.getElementById("days");
  if (!WEEKS.length) { el.innerHTML = `<div class="day closed"><div class="dname">Cargando…</div><div class="opts"></div></div>`; return; }
  const w = WEEKS.find(x => x.id === cur);
  if (!loaded) { el.innerHTML = `<div class="day"><div class="dname">Ups</div><div class="opts"><div class="oname">No pudimos cargar el menú. Probá recargar la página o escribinos al 098 101 066.</div></div></div>`; return; }
  if (w.menu.every(x => !x)) { el.innerHTML = `<div class="day closed"><div class="dname">Pronto<small>${dm(w.dates[0])} al ${dm(w.dates[4])}</small></div><div class="opts"><div class="oname">Estamos armando el menú de esta semana. Lo publicamos en estos días.</div></div></div>`; return; }
  el.innerHTML = w.menu.map((m, i) => {
    const off = closed(cur, i), has = qty[cur][i] > 0, name = m ? m.plato : "Menú a confirmar";
    return `<div class="day ${has?"has":""} ${off?"closed":""}"><div class="dname">${DAYS[i]}<small>${dm(w.dates[i])}</small></div><div class="opts">
      <div class="opt"><div><div class="olabel">${off?"Cerrado":"Plato del día"}</div><div class="oname">${esc(name)}</div>${m&&m.descripcion?`<div class="odesc">${esc(m.descripcion)}</div>`:""}</div>
      ${off?`<span class="olabel">${m?`Pedidos hasta las ${P.corte}:00`:""}</span>`:`<div class="qty"><button type="button" aria-label="Quitar ${esc(name)}" data-d="${i}" data-s="-1" ${qty[cur][i]?"":"disabled"}>−</button><output>${qty[cur][i]}</output><button type="button" aria-label="Agregar ${esc(name)}" data-d="${i}" data-s="1" ${plan==="cuponera"&&calc().rest<=0?"disabled":""}>+</button></div>`}</div>
    </div></div>`; }).join("");
}
function renderNudge() {
  const c = calc(); let t;
  if (plan === "cuponera") t = c.rest > 0 ? `Elegiste <b>${c.count} de ${P.cupoN}</b>. Las que no elijas ahora las reservás después, dentro de los 15 días hábiles.` : `<b>Elegiste las ${P.cupoN} viandas</b> de tu cuponera.`;
  else if (c.count >= 6) t = `Si vas a pedir 8 o más, la <b>cuponera anticipada</b> te sale ${fmt(unitCupo())} cada vianda.`;
  else t = "Marcá cuántas viandas querés cada día. Cada una suma un sello.";
  document.getElementById("nudge").innerHTML = t;
}
function stampsHTML(n) { const k = Math.min(n,8); let h = ""; for (let i=0;i<8;i++) h += `<i class="${i<k?"on":""}"></i>`; return `<span class="stamps" aria-label="${k} de 8 sellos">${h}<i class="gift ${k>=8?"on":""}" title="La 9.ª de regalo">9</i></span>`; }
function renderSummary() {
  const c = calc(), el = document.getElementById("sumBody");
  if (plan === "cuponera") el.innerHTML = `<div class="srow"><span>Cuponera anticipada</span><span>${P.cupoN} viandas</span></div><div class="srow sub"><span>Elegidas ahora</span><span>${c.count} · quedan ${c.rest}</span></div>${entrega==="envio"&&P.envio&&c.dias?`<div class="srow sub"><span>Envío en Pocitos</span><span>${c.dias} × ${fmt(P.envio)}</span></div>`:""}<div class="total"><span>Total</span><span class="v">${fmt(c.total)}</span></div><div class="save">Ahorrás ${fmt(c.save)}: cada vianda te sale ${fmt(unitCupo())}</div><div class="srow sub"><span>Válida por</span><span>15 días hábiles</span></div>`;
  else if (!c.count) el.innerHTML = '<p class="empty">Todavía no elegiste platos.</p>';
  else el.innerHTML = c.lines.map(l => `<div class="srow"><span>${l.label}</span><span>${l.count} × ${fmt(P.dia)}</span></div>`).join("") + `<div class="total"><span>Total</span><span class="v">${fmt(c.total)}</span></div><div class="srow sub" style="align-items:center"><span>${Math.min(c.sellos,8)} de 8 sellos</span>${stampsHTML(c.sellos)}</div>`;
  if (c.count && entrega === "envio") el.innerHTML += `<div class="srow sub"><span>Envío en Pocitos</span><span>${P.envio ? (c.dias ? `${c.dias} × ${fmt(P.envio)}` : fmt(P.envio)+" por día") : "Te confirmamos el costo"}</span></div>`;
  el.innerHTML += entrega === "envio" ? `<div class="srow sub"><span>Envío a domicilio</span><span>Dentro de Pocitos</span></div>` : `<div class="srow sub"><span>Retiro en el local</span><span>Plácido Ellauri 3369</span></div>`;
  document.getElementById("mCount").textContent = plan === "cuponera" ? `Cuponera · ${P.cupoN} viandas` : c.count + (c.count===1 ? " vianda" : " viandas");
  document.getElementById("mTotal").textContent = fmt(c.total);
  document.getElementById("mbar").hidden = !(c.count > 0 || plan === "cuponera");
}
function renderAll() { renderTabs(); renderDays(); renderNudge(); renderSummary(); }

document.getElementById("plan").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; plan = b.dataset.v;
  document.querySelectorAll("#plan button").forEach(x => x.setAttribute("aria-pressed", x.dataset.v === plan));
  if (plan === "cuponera") { let left = P.cupoN; WEEKS.forEach(w => qty[w.id].forEach((q,i) => { const k = Math.min(q,left); qty[w.id][i] = k; left -= k; })); }
  renderAll(); });
document.getElementById("tabs").addEventListener("click", e => { const b = e.target.closest(".tab"); if (!b) return; cur = b.dataset.w; renderAll(); });
document.getElementById("days").addEventListener("click", e => { const b = e.target.closest("button[data-s]"); if (!b) return;
  const d = +b.dataset.d; if (closed(cur, d)) return; qty[cur][d] = Math.max(0, Math.min(20, qty[cur][d] + +b.dataset.s)); renderAll(); });
document.getElementById("pago").addEventListener("click", () => {});
function setEntrega(v) {
  entrega = v;
  document.querySelectorAll("#modo button").forEach(x => x.setAttribute("aria-pressed", x.dataset.v === v));
  document.getElementById("fDir").hidden = v !== "envio";
  const sel = document.getElementById("hora"), prev = sel.value, list = v === "envio" ? FRANJAS_ENVIO : FRANJAS;
  sel.innerHTML = list.map(h => `<option>${esc(h)}</option>`).join(""); if (list.includes(prev)) sel.value = prev;
  document.getElementById("horaLbl").textContent = v === "envio" ? "¿En qué horario te lo llevamos?" : "¿A qué hora pasás?";
  document.getElementById("modoHint").textContent = v === "envio" ? (P.envio ? `Solo dentro de Pocitos, de 11:00 a 14:00. Costo de envío: ${fmt(P.envio)} por día de entrega.` : "Solo dentro de Pocitos, de 11:00 a 14:00. El costo del envío te lo confirmamos por WhatsApp.") : "Plácido Ellauri 3369, Pocitos.";
  renderSummary();
}
document.getElementById("modo").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setEntrega(b.dataset.v); });
document.getElementById("pagoHint").textContent = "Te pasamos los datos de la cuenta y nos mandás el comprobante. Sin recargo.";
document.getElementById("submitBtn").textContent = "Hacer pedido";

document.getElementById("form").addEventListener("submit", async e => {
  e.preventDefault();
  const v = id => document.getElementById(id).value.trim(), err = document.getElementById("err"), btn = document.getElementById("submitBtn");
  const c = calc();
  if (!c.ok) { err.textContent = "Elegí al menos una vianda en el menú."; return; }
  if (!v("nombre") || !v("apellido")) { err.textContent = "Completá nombre y apellido."; return; }
  if (v("wa").replace(/\D/g,"").length < 8) { err.textContent = "Revisá el número de WhatsApp, parece incompleto."; return; }
  if (entrega === "envio" && v("dir").length < 5) { err.textContent = "Poné la dirección de entrega (calle, número y apartamento u oficina)."; return; }
  err.textContent = "";
  const items = []; WEEKS.forEach(w => qty[w.id].forEach((q,i) => { if (q) items.push({ fecha: w.dates[i], cantidad: q }); }));
  btn.disabled = true; btn.textContent = "Enviando…";
  const { data, error } = await sb.rpc("crear_pedido", { p: { tipo: plan, nombre: v("nombre"), apellido: v("apellido"), whatsapp: v("wa"), franja: v("hora"), entrega, direccion: entrega === "envio" ? v("dir") : "", notas: v("notas"), recibe_menu: document.getElementById("okMenu").checked, items } });
  btn.disabled = false; btn.textContent = "Hacer pedido";
  if (error) { err.textContent = (error.message || "No pudimos tomar el pedido.") + " Si el problema sigue, escribinos al 098 101 066."; if (/cerró/.test(error.message||"")) { renderAll(); } return; }
  showDone(data, items, c);
});

function showDone(res, items, c) {
  const v = id => document.getElementById(id).value.trim();
  const lines = items.map(it => { const w = WEEKS.find(x => x.dates.includes(it.fecha)); const i = w.dates.indexOf(it.fecha); return `${DAYS[i]} ${dm(it.fecha)}: ${it.cantidad} × ${w.menu[i].plato}`; });
  let msg = `Hola Isolina, hice el pedido #${res.id} en la web.\n\n${lines.join("\n") || "Cuponera anticipada: elijo los días después"}\n\nTotal: ${fmt(res.total)}\n${entrega === "envio" ? `Envío a: ${v("dir")}\nHorario: ${v("hora")}` : `Retiro: ${v("hora")}`}\n${v("nombre")} ${v("apellido")}`;
  const pago = (res.datos_pago || "").trim();
  const f0 = document.getElementById("form"); f0.querySelectorAll(".done").forEach(x => x.remove());
  const box = document.createElement("div"); box.className = "done";
  box.innerHTML = `<h3>Pedido #${res.id} recibido</h3>
   <p style="margin:0">Para confirmarlo, transferí <strong>${fmt(res.total)}</strong> y mandanos el comprobante.</p>
   ${pago ? `<div class="bankbox"><span class="flabel">Datos para transferir</span><pre></pre><span style="font-size:.85rem">Concepto: Pedido #${res.id}</span></div>` : `<p style="margin:0;font-size:.92rem">Te pasamos los datos para transferir por WhatsApp.</p>`}
   <div class="up"><label for="comp" class="flabel">Adjuntá el comprobante</label><input type="file" id="comp" accept="image/*,application/pdf"><span id="compOk" class="okmsg" role="status"></span></div>
   <p style="margin:0;font-size:.88rem">También podés mandarlo por WhatsApp. Apenas lo veamos te confirmamos.</p>
   <div class="actions"><a class="btn btn-orange" target="_blank" rel="noopener" href="https://wa.me/${WA_ISOLINA}?text=${encodeURIComponent(msg)}">Escribir por WhatsApp</a></div>`;
  if (pago) box.querySelector(".bankbox pre").textContent = pago;
  f0.appendChild(box);
  box.querySelector("#comp").addEventListener("change", async ev => {
    const f = ev.target.files[0], out = box.querySelector("#compOk"); if (!f) return;
    if (f.size > 5*1024*1024) { out.textContent = "El archivo es muy pesado (máximo 5 MB). Probá con una captura."; return; }
    out.textContent = "Subiendo…";
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,5);
    const path = `${res.id}/${Date.now()}.${ext}`;
    const up = await sb.storage.from("comprobantes").upload(path, f, { contentType: f.type || undefined });
    if (up.error) { out.textContent = "No se pudo subir. Mandalo por WhatsApp, por favor."; return; }
    await sb.rpc("adjuntar_comprobante", { p_id: res.id, p_ruta: path });
    out.textContent = "Recibimos tu comprobante. Te escribimos para confirmar.";
    ev.target.disabled = true;
  });
  WEEKS.forEach(w => qty[w.id] = [0,0,0,0,0]); renderAll();
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* fijar en el inicio del celular */
(function(){const ua=navigator.userAgent||"";const ios=/iPhone|iPad|iPod/.test(ua),and=/Android/.test(ua);
  const mark=id=>{const b=document.getElementById(id);b.classList.add("me");b.querySelector(".yours").hidden=false;b.parentNode.insertBefore(b,b.parentNode.querySelector(".pinbox"))};
  if(ios)mark("pinIos");else if(and)mark("pinAnd");
  let ev=null;const btn=document.getElementById("installBtn");
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();ev=e;btn.hidden=false});
  btn.addEventListener("click",async()=>{if(!ev)return;ev.prompt();try{await ev.userChoice}catch(_){}ev=null;btn.hidden=true});
  window.addEventListener("appinstalled",()=>{btn.hidden=true});
  if(window.matchMedia&&matchMedia("(display-mode: standalone)").matches)document.getElementById("app").hidden=true;
})();

renderAll();
load().then(() => { document.getElementById("fModo").hidden = !hayEnvios; setEntrega(entrega); });
