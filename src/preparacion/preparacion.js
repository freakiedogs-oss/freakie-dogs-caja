/* ═══════════════════════════════════════════════════════════════════════
   Estación de preparación · Casa Matriz
   freakie-dogs-caja.vercel.app/preparacion.html

   Quien prepara elige las recetas, pistolea (o toca) los insumos que usa y cierra
   la tanda. Todo queda guardado en la base (prep_lotes / prep_lote_insumos) a
   nombre de quien entró con su PIN. Cada persona entra con su PIN: la sesión se
   cierra sola al terminar la tanda o al volver atrás, para que nadie imprima ni
   registre a nombre de otro.

   Modo observación: no bloquea por cantidades. Se junta data primero y después
   el encargado enciende límites desde «Encargado» (ver fn_prep_datos).

   Imprimir etiquetas pasa por la tablet de etiquetado (con PIN); si el lote de
   esas etiquetas no tiene insumos registrados queda una deuda que se cobra al
   marcar la salida en Mi Asistencia. Ver supabase/migrations/20261003_prep_*.
   ═══════════════════════════════════════════════════════════════════════ */

import { db } from '../supabase'
import catalogoBundled from './catalogo.json'
import './preparacion.css'


let DATA = catalogoBundled;
const INS = {}, REC = {};
function indexar(){
  Object.keys(INS).forEach(k => { delete INS[k]; }); Object.keys(REC).forEach(k => { delete REC[k]; });
  DATA.insumos.forEach(i => { INS[i.code] = i; }); DATA.recetas.forEach(r => { REC[r.id] = r; });
}
indexar();

const UNITS = {
  g:{l:'gramos (g)',fam:'m',k:1}, kg:{l:'kilogramos (kg)',fam:'m',k:1000}, lb:{l:'libras (lb)',fam:'m',k:453.592}, oz:{l:'onzas (oz)',fam:'m',k:28.3495},
  ml:{l:'mililitros (ml)',fam:'v',k:1}, l:{l:'litros (l)',fam:'v',k:1000}, gal:{l:'galones',fam:'v',k:3785.41}, floz:{l:'onzas líquidas',fam:'v',k:29.5735},
  cda:{l:'cucharadas',fam:'v',k:15}, taza:{l:'tazas',fam:'v',k:236.588}, cgal:{l:'cuartos de galón',fam:'v',k:946.353}, cdta:{l:'cucharaditas',fam:'v',k:5},
  unidad:{l:'unidades',fam:'u'}, lata:{l:'latas',fam:'u'}, bolsa:{l:'bolsas',fam:'u'}, saco:{l:'sacos',fam:'u'}, paquete:{l:'paquetes',fam:'u'},
  sobre:{l:'sobres',fam:'u'}, hoja:{l:'hojas',fam:'u'}, botella:{l:'botellas',fam:'u'}, bote:{l:'botes',fam:'u'}, envase:{l:'envases',fam:'u'},
};
const unitOptions = (sel) => Object.keys(UNITS).map(k => `<option value="${k}" ${k===sel?'selected':''}>${UNITS[k].l}</option>`).join('');
const fmt = (n) => { if(n==null||isNaN(n)) return '—'; const a=Math.abs(n); const d=a>=100?0:a>=10?1:a>=1?2:4; return String(+n.toFixed(d)); };
const esc = (s) => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let cfg = { tol:10, alertas:false, exigirTodo:false, fueraReceta:true, pedirCantidad:true, nuevos:true, bloquearSalida:true };
let operador = null;          // { id, n } quien entró con su PIN. Se borra al cerrar la tanda o volver atrás
let loteActual = null;        // { id, lote }: solo cuando se abre un lote ya existente (deuda) o se reabre uno cerrado
let ALIAS = {};               // código de fábrica que alguien ligó a un insumo de la lista (se guarda en la base)
let step = 1;
let restringido = false;     // personas de producción: solo ven lo que pesaron e imprimieron (los encargados ven todo)
let permitidas = new Set();   // ids de receta que esa persona puede registrar
let resumenImp = '';          // texto: qué imprimió
let bloqT = null;
let impreso = {};             // receta -> { unidades, gramos, nombre }: lo que esa persona pesó e imprimió
let catalogoListo = null;
const ENC = ['jefe_casa_matriz','admin','superadmin','ejecutivo'];
const RECETA_DE = { pepinillotritura:'pepinillo' };   // clave de etiquetado -> id de receta, cuando no coinciden
let sel = {};                 // recipeId -> tandas
let uses = [];                // {id, code, rid, qty, unit, envases, extra}
let uid = 1;
let lastCode = null, cerrado = null;

function recLine(rid, code){ return REC[rid].lineas.find(l => l.code === code); }
function expected(u){
  const ln = recLine(u.rid, u.code); if(!ln) return null;
  return { qty: ln.qty * (sel[u.rid]||1), unit: ln.unit };
}
function ratio(u){
  const e = expected(u); if(!e) return null;
  const a = UNITS[u.unit], b = UNITS[e.unit];
  if(a.fam===b.fam && a.fam!=='u') return (u.qty*a.k)/(e.qty*b.k);
  if(u.unit===e.unit) return u.qty/e.qty;
  return null;
}
/* ---------- coherencia con lo que se pesó ---------- */
// Lo registrado tiene que parecerse a lo pesado: si pesaste 10 bolsitas de queso frito (3 lb),
// no se puede registrar 0.3 lb de queso. Se calcula cuántas tandas corresponden a lo impreso y
// se compara. Solo bloquea lo grueso; las diferencias normales de una cocina quedan como datos.
const AJ_TANDAS = [0.65, 1.5];   // tandas registradas / tandas que corresponden a lo pesado
const AJ_INSUMO = [0.5, 2];      // cantidad registrada / cantidad esperada para lo pesado
const RINDE_BASE = { quesofrito:1, sal:1, salchicha:1 };   // unidades de producto por tanda cuando la receta no lo dice
function masaReceta(r){ let g=0; r.lineas.forEach(l => { const u=UNITS[l.unit]; if(u && (u.fam==='m' || u.fam==='v')) g += l.qty*u.k; }); return g; }
function referencia(rid){
  const imp = impreso[rid], r = REC[rid]; if(!imp || !r) return null;
  let R = (cfg.rendimientos && cfg.rendimientos[rid]) || RINDE_BASE[rid] || null;
  if(!R){ const bag = r.lineas.find(l => l.unit==='unidad' && INS[l.code] && /^AB-BVNT/i.test(INS[l.code].nombre)); if(bag) R = bag.qty; }
  if(R && imp.unidades>0) return { t: imp.unidades/R, imp, via:'unidades' };
  const M = masaReceta(r); if(M>=300 && imp.gramos>0) return { t: imp.gramos/M, imp, via:'masa' };
  return null;
}
const queSePeso = (imp) => `${imp.unidades} ${imp.unidades===1?'unidad':'unidades'}${imp.gramos?` (${Math.round(imp.gramos).toLocaleString('en-US')} g)`:''}`;
function refNota(rid){
  const imp = impreso[rid]; if(!imp) return '';
  const ref = referencia(rid);
  const st = 'order:5;flex-basis:100%;font-size:12px;';
  return ref ? `<div style="${st}color:var(--dim)">Pesaste ${esc(queSePeso(imp))} → equivale a <b style="color:var(--txt)">${fmt(ref.t)} tanda${Math.abs(ref.t-1)<0.005?'':'s'}</b>.</div>`
             : `<div style="${st}color:var(--warn)">Pesaste ${esc(queSePeso(imp))}. Esta receta todavía no tiene cómo compararse con lo pesado: se registra sin validar.</div>`;
}
function incoherencias(){
  const out = [];
  Object.keys(sel).forEach(rid => {
    if(restringido && permitidas.has(rid) && !uses.some(u => u.rid===rid)){ out.push({ rid, tipo:'vacio', texto:`${REC[rid].nombre}: lo imprimiste pero todavía no registraste ningún insumo.` }); return; }
    const ref = referencia(rid); if(!ref) return; const r = REC[rid];
    const rt = sel[rid]/ref.t;
    if(rt<AJ_TANDAS[0] || rt>AJ_TANDAS[1]) out.push({ rid, tipo:'tandas', texto:`${r.nombre}: pesaste ${queSePeso(ref.imp)}, que equivale a unas ${fmt(ref.t)} tandas, pero registraste ${fmt(sel[rid])}.` });
    uses.filter(u => u.rid===rid && !u.extra).forEach(u => {
      const ln = recLine(rid, u.code); if(!ln) return; const a=UNITS[u.unit], b=UNITS[ln.unit]; let q=null;
      if(a.fam===b.fam && a.fam!=='u') q = (u.qty*a.k)/(ln.qty*ref.t*b.k); else if(u.unit===ln.unit) q = u.qty/(ln.qty*ref.t);
      if(q==null || (q>=AJ_INSUMO[0] && q<=AJ_INSUMO[1])) return;
      out.push({ rid, tipo:'insumo', code:u.code, texto:`${INS[u.code].nombre}: registraste ${fmt(u.qty)} ${UNITS[u.unit].l.split(' ')[0]} y para lo que pesaste (${queSePeso(ref.imp)}) se esperan unos ${fmt(ln.qty*ref.t)} ${UNITS[ln.unit].l.split(' ')[0]}.` });
    });
  });
  return out;
}

function statusChip(u){
  if(u.extra) return '<span class="chip fr">fuera de receta</span>';
  const r = ratio(u); if(r==null) return '<span class="chip">sin comparar</span>';
  if(!cfg.alertas){ const d=Math.round((r-1)*100); return `<span class="chip">${d===0?'igual que la receta':(d>0?'+':'')+d+'% vs receta'}</span>`; }
  const t = cfg.tol/100;
  if(Math.abs(r-1)<=t) return '<span class="chip ok">dentro de lo esperado</span>';
  const p = Math.round(Math.abs(r-1)*100);
  return r>1 ? `<span class="chip hi">${p}% de más</span>` : `<span class="chip lo">${p}% de menos</span>`;
}

/* ---------- utilidades ---------- */
function beep(f=880,ms=90){ try{ const a=new (window.AudioContext||window.webkitAudioContext)(); const o=a.createOscillator(); const g=a.createGain(); o.frequency.value=f; g.gain.value=.05; o.connect(g); g.connect(a.destination); o.start(); setTimeout(()=>{o.stop();a.close()},ms);}catch(e){} }
function toast(msg,kind=''){ const t=document.createElement('div'); t.className='toast '+kind; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2600); }
function openModal(html){ document.getElementById('layer').innerHTML = `<div class="overlay" id="ov"><div class="modal">${html}</div></div>`; }
function closeModal(){ document.getElementById('layer').innerHTML=''; refocus(); }
function refocus(){ const s=document.getElementById('scan'); if(s && !document.getElementById('ov')) s.focus(); }

/* ---------- pasos ---------- */
function renderSteps(){
  const n=['1 · Qué preparás','2 · Pistolear insumos','3 · Revisar y cerrar'];
  document.getElementById('steps').innerHTML = n.map((t,i)=>`<span class="${i+1===step?'on':i+1<step?'done':''}">${t}</span>`).join('');
}
function drawWho(){ const w=document.getElementById('who'); if(!w) return; w.innerHTML = operador? `<span class="who">👤 ${esc(operador.n)} <button id="w-x">cerrar sesión</button></span>` : ''; const b=document.getElementById('w-x'); if(b) b.onclick=()=>{ operador=null; sel={}; uses=[]; loteActual=null; restringido=false; step=1; drawWho(); toast('Sesión cerrada','ok'); if(!cerrado) render(); }; }
function render(){ if(!operador && !cerrado){ drawWho(); pedirEntrada(); return; } drawWho(); renderSteps(); if(step===1) renderStep1(); else if(step===2) renderStep2(); else renderStep3(); window.scrollTo(0,0); armarBloqueo(); }

/* ---------- paso 1 ---------- */
function renderStep1(){
  const libres = DATA.recetas.filter(r=>r.libre);
  const tiles = DATA.recetas.filter(r => !restringido || permitidas.has(r.id)).map(r => `<button class="tile ${sel[r.id]?'on':''}" data-rec="${r.id}"><b>${esc(r.nombre)}</b><small>${r.lineas.length? r.lineas.length+' insumos en la receta' : 'sin ingredientes cargados — se arman al pistolear'}</small></button>`).join('');
  const picked = Object.keys(sel);
  const rows = picked.map(id => { const r=REC[id]; const opts=r.lineas.map(l=>`<option value="${l.code}">${esc(INS[l.code].nombre)}</option>`).join('');
    return `<div class="selrow" style="display:block"><div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap"><b>${esc(r.nombre)}</b>${refNota(id)}
      <span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><label>Tandas</label>
      <button class="btn sm" data-q-t="${id}|0.5">½</button><button class="btn sm" data-q-t="${id}|1">1</button><button class="btn sm" data-q-t="${id}|1.5">1½</button><button class="btn sm" data-q-t="${id}|2">2</button>
      <input class="num" type="number" min="0" step="any" value="${sel[id]}" data-tanda="${id}" id="t-${id}"></span></div>
      ${r.lineas.length?`<details style="margin-top:8px"><summary class="link" style="cursor:pointer">…o decime cuánto tenés de un insumo y calculo la tanda</summary>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center"><select class="num" id="an-i-${id}" style="max-width:240px">${opts}</select><input class="num" type="number" step="any" min="0" placeholder="cantidad" id="an-q-${id}"><select class="num" id="an-u-${id}">${unitOptions('lb')}</select><button class="btn sm acc" data-anc="${id}">Calcular</button><span id="an-r-${id}" style="font-size:12px;color:var(--ok)"></span></div></details>`:'<div style="font-size:12px;color:var(--dim);margin-top:6px">Sin receta cargada: no hay tanda que calcular, solo se registra lo que uses.</div>'}</div>`; }).join('');
  document.getElementById('stage').innerHTML = `
    <h2>${restringido?'Lo que pesaste e imprimiste':'¿Qué estás preparando?'}</h2>
    ${restringido?`<p class="lead"><b>${esc(loteActual?loteActual.lote:'')}</b> · ${esc(resumenImp)}. Solo se pueden registrar los insumos de esto. Si hiciste más de una tanda, cambiá el número de tandas.</p>`:''}
    <p class="lead" ${restringido?'style="display:none"':''}>Tocá una o varias recetas. Si hacés más de una tanda, cambiá el número: las cantidades esperadas se multiplican solas. Podés cambiar de idea y volver a este paso cuando quieras.</p>
    <div class="tiles">${tiles}${restringido?'':'<button class="tile" id="libre" style="border-style:dashed"><b>＋ Otra preparación</b><small>Algo que no está en la lista: le ponés nombre y listo</small></button>'}</div>
    <div class="selbar">${rows}</div>
    <div style="margin-top:16px"><button class="btn big ${picked.length?'ok':'off'}" id="go1">${picked.length?'Empezar a pistolear insumos →':'Elegí al menos una receta'}</button></div>
    <div class="notes"><b>Pensado para que nada se trabe:</b> aunque una receta no tenga ingredientes cargados (Ranch, Mermelada, Truffa), igual se puede preparar: lo que pistoleen queda registrado y después se ajusta la receta.</div>`;
  document.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => { const id=b.dataset.rec; if(restringido && permitidas.has(id)){ toast('Esto lo imprimiste: tiene que quedar registrado','bad'); return; } if(sel[id]) delete sel[id]; else sel[id]=1; renderStep1(); });
  document.querySelectorAll('[data-tanda]').forEach(i => i.oninput = () => { const v=parseFloat(i.value); if(v>0) sel[i.dataset.tanda]=v; });
  document.querySelectorAll('[data-q-t]').forEach(b => b.onclick = () => { const [id,v]=b.dataset.qT.split('|'); sel[id]=parseFloat(v); document.getElementById('t-'+id).value=v; });
  document.querySelectorAll('[data-anc]').forEach(b => b.onclick = () => { const id=b.dataset.anc; const code=document.getElementById('an-i-'+id).value; const q=parseFloat(document.getElementById('an-q-'+id).value); const u=document.getElementById('an-u-'+id).value; const ln=recLine(id,code);
    if(!(q>0)) return; const a=UNITS[u], c=UNITS[ln.unit]; let t=null;
    if(a.fam===c.fam && a.fam!=='u') t=(q*a.k)/(ln.qty*c.k); else if(u===ln.unit) t=q/ln.qty;
    const out=document.getElementById('an-r-'+id); if(t==null){ out.style.color='var(--warn)'; out.textContent='Esa unidad no se puede comparar con la de la receta'; return; }
    t=Math.round(t*100)/100; sel[id]=t; document.getElementById('t-'+id).value=t; out.style.color='var(--ok)'; out.textContent='= '+t+' tandas (las demás cantidades se ajustan solas)'; });
  const libreBtn = document.getElementById('libre'); if(libreBtn) libreBtn.onclick = () => { openModal(`<h3>Otra preparación</h3><div class="sub">Escribí cómo se llama. No necesita receta: se registra lo que uses y después se puede convertir en receta.</div><input class="search" id="ln" placeholder="Ej. Salsa de prueba, Mezcla especial…" autocomplete="off"><div style="display:flex;gap:8px"><button class="btn" id="l-x">Cancelar</button><button class="btn ok" style="flex:1" id="l-ok">Crear y elegir</button></div>`); document.getElementById('ln').focus();
    document.getElementById('l-x').onclick=closeModal; document.getElementById('l-ok').onclick=()=>{ const n=document.getElementById('ln').value.trim(); if(!n) return; const id='libre'+(uid++); const r={id,nombre:n,lineas:[],libre:true}; DATA.recetas.push(r); REC[id]=r; sel[id]=1; closeModal(); renderStep1(); }; };
  document.getElementById('go1').onclick = () => { if(!Object.keys(sel).length) return; step=2; render(); };
}

/* ---------- paso 2 ---------- */
function renderStep2(){
  document.getElementById('stage').innerHTML = `
    <div class="scanbar"><span class="dot"></span><input id="scan" autocomplete="off" placeholder="Pistoleá un código aquí…" inputmode="none"><span class="hint">La pistola escribe aquí sola</span><button class="btn sm" id="find">🔍 Buscar sin código</button><button class="btn sm acc" id="nuevo">＋ Insumo nuevo</button></div>
    <div class="cols">
      <div><div id="hint"></div><p class="h3">Lo que ya pistoleaste</p><div id="list"></div></div>
      <div><p class="h3">Según la receta</p><div class="card" id="check"></div></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="btn" id="back2">← Cambiar recetas</button><button class="btn ok" style="flex:1;min-width:220px" id="go2">Revisar y cerrar →</button></div>
    <details class="sim" open><summary>👆 ¿Sin pistola o el código no lee? Tocá el insumo</summary>
      <div style="font-size:12px;color:var(--dim);margin-top:6px">Queda igual de registrado. Aquí están los insumos de lo que preparás; el resto, con “Ver todos”.</div>
      <div class="wall" id="wall"></div><div style="margin-top:8px"><button class="btn sm" id="wall-all">Ver todos los insumos</button></div></details>`;
  const dibujarWall = (todos) => {
    const delasrecetas = new Set(); Object.keys(sel).forEach(rid => REC[rid].lineas.forEach(l => delasrecetas.add(l.code)));
    const lista = todos || !delasrecetas.size ? DATA.insumos : DATA.insumos.filter(i => delasrecetas.has(i.code));
    document.getElementById('wall').innerHTML = lista.map(i => `<button data-sc="${esc(i.code)}"><div class="bars"></div><b>${esc(i.code)}</b>${esc(i.nombre)}</button>`).join('');
    document.querySelectorAll('[data-sc]').forEach(b => b.onclick = () => scan(b.dataset.sc));
  };
  dibujarWall(false);
  document.getElementById('wall-all').onclick = () => { dibujarWall(true); document.getElementById('wall-all').remove(); };
  const s=document.getElementById('scan');
  s.onkeydown = e => { if(e.key==='Enter'){ const v=s.value.trim(); s.value=''; if(v) scan(v); } };
  s.onblur = () => setTimeout(()=>{ if(step===2 && !document.getElementById('ov') && !document.activeElement.matches('input,select,textarea,button,summary')) s.focus(); },150);
  document.getElementById('find').onclick = () => openSearch();
  document.getElementById('nuevo').onclick = () => { if(cfg.nuevos) openNewInsumo(null); else toast('El encargado tiene bloqueado agregar insumos nuevos','bad'); };
  document.getElementById('back2').onclick = () => { step=1; render(); };
  document.getElementById('go2').onclick = () => { step=3; render(); };
  drawList(); drawCheck(); s.focus();
}
function drawList(flashCode){
  guardarBorrador();
  const el=document.getElementById('list'); if(!el) return;
  const codes=[...new Set(uses.map(u=>u.code))];
  if(!codes.length){ el.innerHTML='<div class="empty">Todavía no hay nada.<br>Pistoleá el primer insumo y aparece aquí.</div>'; return; }
  el.innerHTML = codes.map(code => {
    const i=INS[code], us=uses.filter(u=>u.code===code);
    const rows = us.map(u => {
      const e=expected(u);
      return `<div class="use" data-u="${u.id}">
        <div><div class="rn">${esc(REC[u.rid].nombre)} ${statusChip(u)}</div><div class="exp">${e?`Receta: ${fmt(e.qty)} ${UNITS[e.unit].l.split(' ')[0]}`:'No está en la receta de esta tanda'}</div><input class="num" style="width:100%;text-align:left;margin-top:6px;font-size:12px;font-weight:500" placeholder="Nota (opcional): ¿por qué esta cantidad?" value="${esc(u.nota||'')}" data-nota="${u.id}"></div>
        <div class="qrow">${(cfg.pedirCantidad||u.edit||u.extra)?`<input class="num" type="number" step="any" min="0" value="${fmt(u.qty)}" data-q="${u.id}"><select class="num" data-un="${u.id}">${unitOptions(u.unit)}</select>`:`<span style="font-weight:700">${fmt(u.qty)} ${UNITS[u.unit].l.split(' ')[0]}</span><button class="link" data-edit="${u.id}">Corregir</button>`}<button class="x" data-del="${u.id}" title="Quitar">✕</button></div></div>`;
    }).join('');
    const env = Math.max(...us.map(u=>u.envases));
    return `<div class="ins ${flashCode===code?'flash':''}"><div class="insh"><div><b>${esc(i.nombre)}</b><div class="code">${i.nuevo?'<span class="chip fr">nuevo · lo revisa el encargado</span> ':''}${i.nuevo?esc(i.code):i.code} · ${i.discreto?'se cuenta por pieza':'a granel: pistoleás al abrir el envase'}${env>1?` · <b style="color:var(--ok)">${env} pistoleos</b>`:''}</div></div><button class="link" data-split="${code}">Cambiar receta</button></div>${rows}</div>`;
  }).join('');
  el.querySelectorAll('[data-q]').forEach(inp => inp.oninput = () => { const u=uses.find(x=>x.id==inp.dataset.q); u.qty=parseFloat(inp.value)||0; softStatus(u,inp); });
  el.querySelectorAll('[data-un]').forEach(sl => sl.onchange = () => { const u=uses.find(x=>x.id==sl.dataset.un); u.unit=sl.value; drawList(); drawCheck(); });
  el.querySelectorAll('[data-nota]').forEach(inp => inp.oninput = () => { uses.find(x=>x.id==inp.dataset.nota).nota=inp.value; });
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { uses.find(x=>x.id==b.dataset.edit).edit=true; drawList(); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { uses=uses.filter(x=>x.id!=b.dataset.del); drawList(); drawCheck(); toast('Quitado','') });
  el.querySelectorAll('[data-split]').forEach(b => b.onclick = () => openAssign(b.dataset.split, true));
}
function softStatus(u,inp){ const row=inp.closest('.use'); const rn=row.querySelector('.rn'); rn.innerHTML = esc(REC[u.rid].nombre)+' '+statusChip(u); drawCheck(); }
function sugerencias(){
  // ¿lo que llevan se parece a otra cantidad de tandas? se mira la mediana de lo registrado contra la receta de 1 tanda
  const out=[];
  Object.keys(sel).forEach(rid=>{
    if(referencia(rid)) return;   // con lo pesado como referencia no se sugiere otra cantidad de tandas
    const rs=uses.filter(u=>u.rid===rid && !u.extra).map(u=>{ const ln=recLine(rid,u.code); if(!ln) return null; const a=UNITS[u.unit], b=UNITS[ln.unit]; if(a.fam===b.fam&&a.fam!=='u') return (u.qty*a.k)/(ln.qty*b.k); if(u.unit===ln.unit) return u.qty/ln.qty; return null; }).filter(x=>x!=null&&x>0);
    if(rs.length<2) return; rs.sort((a,b)=>a-b); const med=rs[Math.floor(rs.length/2)]; const cur=sel[rid];
    if(Math.abs(med/cur-1)>0.15) out.push({rid, t:Math.round(med*100)/100});
  });
  return out;
}
function drawCheck(){
  guardarBorrador();
  const el=document.getElementById('check'); if(!el) return;
  el.innerHTML = Object.keys(sel).map(rid => {
    const r=REC[rid]; const done=r.lineas.filter(l=>uses.some(u=>u.rid===rid&&u.code===l.code)).length;
    const pct=r.lineas.length?Math.round(done/r.lineas.length*100):100;
    const items = r.lineas.length ? r.lineas.map(l => {
      const d=uses.some(u=>u.rid===rid&&u.code===l.code);
      return `<div class="chk ${d?'done':''}"><span class="nm">${esc(INS[l.code].nombre)}</span><span class="q">${d?'':`${fmt(l.qty*sel[rid])} ${UNITS[l.unit].l.split(' ')[0]} `}${d?'':`<button class="link" data-manual="${rid}|${l.code}">sin pistola</button>`}</span></div>`;
    }).join('') : '<div class="empty" style="padding:12px">Esta receta no tiene ingredientes cargados.<br>Pistoleá lo que uses y después se guarda como su receta.</div>';
    return `<div style="margin-bottom:14px"><b style="font-size:14px">${esc(r.nombre)}</b> <span class="q" style="font-size:11px;color:var(--dim)">× ${fmt(sel[rid])} tanda${sel[rid]===1?'':'s'}</span><div class="prog"><i style="width:${pct}%"></i></div>${items}</div>`;
  }).join('');
  const sg=sugerencias(); const hint=document.getElementById('hint');
  if(hint) hint.innerHTML = sg.map(g=>`<div class="warnbox" style="background:#1e293b;border-color:#1e3a8a;color:#93c5fd">Lo que llevás de <b>${esc(REC[g.rid].nombre)}</b> se parece a <b>${fmt(g.t)} tanda${g.t===1?'':'s'}</b>, no ${fmt(sel[g.rid])}. <button class="link" data-apt="${g.rid}|${g.t}">Usar ${fmt(g.t)}</button> · <span style="color:var(--dim)">o dejalo así, no pasa nada.</span></div>`).join('');
  if(hint){ const inc=incoherencias(); if(inc.length) hint.innerHTML += `<div class="warnbox" style="background:#2a0e0e;border-color:#7f1d1d;color:#fca5a5"><b>Esto no cuadra con lo que pesaste:</b><br>${inc.map(i=>esc(i.texto)).join('<br>')}</div>`; }
  if(hint) hint.querySelectorAll('[data-apt]').forEach(b=>b.onclick=()=>{ const [r,t]=b.dataset.apt.split('|'); sel[r]=parseFloat(t); drawList(); drawCheck(); });
  el.querySelectorAll('[data-manual]').forEach(b => b.onclick = () => { const [rid,code]=b.dataset.manual.split('|'); addUse(code,rid,null); toast('Agregado sin pistola','ok'); drawList(code); drawCheck(); });
}

/* ---------- lógica de pistoleo ---------- */
function defaultUse(code,rid){
  const ln=recLine(rid,code);
  if(ln) return { qty: +(ln.qty*(sel[rid]||1)).toPrecision(6)*1, unit: ln.unit, extra:false };
  const i=INS[code]; const guess = i.unit || (i.discreto ? 'unidad' : 'g');
  return { qty:(i.nuevo && i.discreto)?1:0, unit:guess, extra:true };
}
function addUse(code,rid,qty){
  let u=uses.find(x=>x.code===code&&x.rid===rid);
  if(u) return u;
  const d=defaultUse(code,rid);
  u={ id:uid++, code, rid, qty: qty!=null?qty:d.qty, unit:d.unit, envases:1, extra:d.extra };
  uses.push(u); return u;
}
function scan(raw){
  const rawU=String(raw).trim().toUpperCase().replace(/^FDI(\d)/,'FDI-$1');
  const code=ALIAS[rawU]||rawU;
  const i=INS[code];
  if(!i){ beep(220,200);
    if(!cfg.nuevos){ toast('Código desconocido. El encargado tiene bloqueado agregar insumos nuevos.','bad'); return; }
    openModal(`<h3>No conozco este código</h3><div class="sub">Se leyó <b>${esc(raw)}</b>. No tiene que frenarte: decime qué es y queda aprendido para la próxima.</div><div style="display:grid;gap:8px"><button class="btn ok" id="m-link">Es un insumo que ya está en la lista</button><button class="btn acc" id="m-new">Es un insumo nuevo</button><button class="btn" id="m-x">Ignorar y seguir</button></div>`);
    document.getElementById('m-link').onclick=()=>{ closeModal(); openSearch(rawU); };
    document.getElementById('m-new').onclick=()=>{ closeModal(); openNewInsumo(rawU); };
    document.getElementById('m-x').onclick=closeModal; return; }
  beep(); lastCode=code;
  const existing=uses.filter(u=>u.code===code);
  if(existing.length){
    existing.forEach(u=>u.envases++);
    // pieza entera (lata, paquete, bolsa…): cada pistoleo suma una pieza
    if(i.discreto && existing.length===1 && UNITS[existing[0].unit].fam==='u') existing[0].qty = +(existing[0].qty+1).toFixed(4);
    const n=Math.max(...existing.map(u=>u.envases));
    toast(i.discreto && existing.length===1 ? `${i.nombre}: ${fmt(existing[0].qty)} pieza${existing[0].qty===1?'':'s'}` : `${i.nombre}: ${n} pistoleos (corregí la cantidad si hace falta)`,'ok');
    drawList(code); drawCheck(); return;
  }
  openAssign(code,false);
}
function openAssign(code,editing){
  const i=INS[code];
  const withLine=Object.keys(sel).filter(rid=>recLine(rid,code));
  const others=Object.keys(sel).filter(rid=>!recLine(rid,code));
  if(!editing){
    if(withLine.length===1){ // una sola receta de las elegidas lo usa: va directo, sin preguntar
      const u=addUse(code,withLine[0],null); drawList(code); drawCheck(); toast(`${i.nombre} → ${REC[withLine[0]].nombre}`,'ok'); if(cfg.pedirCantidad) focusQty(u.id); return; }
    if(withLine.length===0 && !cfg.fueraReceta){ beep(220,200); toast('Ese insumo no es de esta receta (el encargado lo tiene bloqueado)','bad'); return; }
  }
  const pool = withLine.length ? withLine : Object.keys(sel);
  const cur = uses.filter(u=>u.code===code).map(u=>u.rid);
  const rows = Object.keys(sel).map(rid => {
    const ln=recLine(rid,code); const on = editing? cur.includes(rid) : (withLine.length? !!ln : Object.keys(sel).length===1);
    const q = ln? fmt(ln.qty*sel[rid])+' '+UNITS[ln.unit].l.split(' ')[0] : 'no está en esta receta';
    return `<div class="opt"><label><input type="checkbox" data-ar="${rid}" ${on?'checked':''}> ${esc(REC[rid].nombre)}</label><span style="font-size:12px;color:var(--dim)">receta: ${q}</span></div>`;
  }).join('');
  openModal(`<h3>${esc(i.nombre)}</h3><div class="sub">${withLine.length>1?'Este insumo lo usan varias de las recetas que preparás. Marcá en cuáles lo vas a usar; la cantidad de cada una sale de su receta y la podés corregir después.':withLine.length===0?'Este insumo no está en la receta de lo que preparás. Podés agregarlo igual: queda marcado como “fuera de receta” para que el encargado lo vea.':'Marcá en qué receta lo usás.'}</div>${rows}<div style="display:flex;gap:8px;margin-top:6px"><button class="btn" id="a-no">Cancelar</button><button class="btn ok" style="flex:1" id="a-ok">Listo</button></div>`);
  document.getElementById('a-no').onclick=()=>{ closeModal(); };
  document.getElementById('a-ok').onclick=()=>{
    const chosen=[...document.querySelectorAll('[data-ar]')].filter(c=>c.checked).map(c=>c.dataset.ar);
    if(!chosen.length){ toast('Marcá al menos una receta','bad'); return; }
    if(editing){ uses=uses.filter(u=>u.code!==code||chosen.includes(u.rid)); }
    chosen.forEach(rid=>addUse(code,rid,null));
    closeModal(); drawList(code); drawCheck(); toast(`${i.nombre} registrado`,'ok');
  };
}
function focusQty(id){ setTimeout(()=>{ const q=document.querySelector(`[data-q="${id}"]`); if(q){ q.scrollIntoView({block:'center',behavior:'smooth'}); } },60); }
function openNewInsumo(rawCode){
  const cats=[...new Set(DATA.insumos.map(i=>i.cat))];
  openModal(`<h3>Insumo nuevo</h3><div class="sub">Solo necesitás el nombre. Queda marcado como “nuevo” para que el encargado lo revise y le asigne código y receta después.${rawCode?` El código <b>${esc(rawCode)}</b> queda ligado a este insumo.`:''}</div>
    <input class="search" id="ni-n" placeholder="Nombre (ej. Tocino de otra marca)" autocomplete="off">
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap"><select class="num" id="ni-u" style="flex:1">${unitOptions('unidad')}</select><select class="num" id="ni-c" style="flex:1">${cats.map(c=>`<option>${esc(c)}</option>`).join('')}<option>Otro</option></select></div>
    <div style="display:flex;gap:8px"><button class="btn" id="ni-x">Cancelar</button><button class="btn ok" style="flex:1" id="ni-ok">Crear y usarlo</button></div>`);
  document.getElementById('ni-n').focus();
  document.getElementById('ni-x').onclick=closeModal;
  document.getElementById('ni-ok').onclick=()=>{ const n=document.getElementById('ni-n').value.trim(); if(!n){ toast('Falta el nombre','bad'); return; }
    const u=document.getElementById('ni-u').value; const code=rawCode||('NUEVO-'+Date.now().toString(36).toUpperCase());
    const rec={code,nombre:n,cat:document.getElementById('ni-c').value,pieza:UNITS[u].l,discreto:UNITS[u].fam==='u',nuevo:true,unit:u};
    INS[code]=rec; DATA.insumos.push(rec); enSegundoPlano(db.rpc('fn_prep_insumo_nuevo',{p_usuario:operador?.id,p_codigo:code,p_nombre:n,p_categoria:rec.cat,p_unidad:u,p_discreto:rec.discreto})); closeModal(); beep(); toast('Insumo nuevo creado','ok'); scan(code); };
}
function openSearch(linkRaw){
  openModal(`<h3>${linkRaw?'¿Cuál insumo es?':'Buscar insumo'}</h3><div class="sub">${linkRaw?`Elegilo y el código <b>${esc(linkRaw)}</b> queda ligado a ese insumo para siempre.`:'Para cuando el código no lee, la etiqueta se rompió o no tiene código. Queda igual de registrado.'}</div><input class="search" id="q" placeholder="Escribí el nombre…" autocomplete="off"><div class="res" id="res"></div><button class="btn" id="s-x" style="margin-top:8px;width:100%">Cerrar</button>`);
  const draw=()=>{ const t=document.getElementById('q').value.toLowerCase(); const l=DATA.insumos.filter(i=>i.nombre.toLowerCase().includes(t)||i.cat.toLowerCase().includes(t)||i.code.toLowerCase().includes(t)).slice(0,40);
    document.getElementById('res').innerHTML=l.map(i=>`<button data-pk="${i.code}"><span>${esc(i.nombre)}</span><span class="c">${i.code}</span></button>`).join('')||'<div class="empty">Nada con ese nombre.</div>';
    document.querySelectorAll('[data-pk]').forEach(b=>b.onclick=()=>{ closeModal(); if(linkRaw){ ALIAS[linkRaw]=b.dataset.pk; enSegundoPlano(db.rpc('fn_prep_alias_guardar',{p_usuario:operador?.id,p_codigo:linkRaw,p_insumo_codigo:b.dataset.pk})); toast(`Aprendido: ${linkRaw} = ${INS[b.dataset.pk].nombre}`,'ok'); } scan(b.dataset.pk); }); };
  if(cfg.nuevos){ const nb=document.createElement('button'); nb.className='btn acc'; nb.style.cssText='width:100%;margin-top:8px'; nb.textContent='＋ No está en la lista: crear insumo nuevo'; nb.onclick=()=>{ closeModal(); openNewInsumo(linkRaw||null); }; document.getElementById('s-x').before(nb); }
  document.getElementById('q').oninput=draw; draw(); document.getElementById('q').focus(); document.getElementById('s-x').onclick=closeModal;
}

/* ---------- paso 3 ---------- */
function renderStep3(){
  const rids=Object.keys(sel);
  let faltan=0;
  const blocks = rids.map(rid => {
    const r=REC[rid]; const us=uses.filter(u=>u.rid===rid);
    const falt=r.lineas.filter(l=>!us.some(u=>u.code===l.code));
    faltan+=falt.length;
    const lines=us.map(u=>`<div class="line"><span>${esc(INS[u.code].nombre)} ${INS[u.code].nuevo?'<span class="chip fr">nuevo</span> ':''}${statusChip(u)}</span><span class="q">${fmt(u.qty)} ${UNITS[u.unit].l.split(' ')[0]}</span></div>`).join('') || '<div class="line"><span style="color:var(--dim)">Nada registrado</span></div>';
    const miss = falt.length? `<div class="warnbox" style="margin-top:8px;${cfg.alertas?'':'background:#1a1a1e;border-color:var(--line);color:var(--dim)'}">No se registraron ${falt.length} insumo${falt.length===1?'':'s'} de la receta: ${falt.map(l=>esc(INS[l.code].nombre)).join(', ')}.</div>`:'';
    return `<div class="sumrec card"><h4>${esc(r.nombre)} <span style="font-size:12px;color:var(--dim);font-weight:600">× ${fmt(sel[rid])} tanda${sel[rid]===1?'':'s'}</span></h4>${lines}${miss}</div>`;
  }).join('');
  const inc = incoherencias();
  const bloquea = (cfg.exigirTodo && faltan>0) || inc.length>0;
  document.getElementById('stage').innerHTML = `
    <h2>Revisá antes de cerrar</h2>
    <p class="lead">Esto es lo que va a quedar guardado con el lote. Lo que falte no te frena: queda anotado como pendiente.${cfg.exigirTodo?' <b style="color:var(--warn)">(El encargado activó “exigir todos los insumos”.)</b>':''}</p>
    ${blocks}
    ${inc.length?`<div class="warnbox" style="background:#2a0e0e;border-color:#7f1d1d;color:#fca5a5"><b>Esto no cuadra con lo que pesaste e imprimiste:</b><br>${inc.map(i=>'• '+esc(i.texto)).join('<br>')}<br><span style="font-size:12.5px;opacity:.9">Volvé y corregilo. Si de verdad es así, un encargado puede autorizar el cierre con su PIN y un motivo.</span></div>`:''}
    ${cfg.exigirTodo&&faltan>0?`<div class="warnbox">Faltan ${faltan} insumos y el encargado pidió que estén todos para cerrar. Volvé y registralos (o márcalos “sin pistola”).</div>`:''}
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="back3">← Seguir pistoleando</button><button class="btn big ${bloquea?'off':'ok'}" style="flex:1;min-width:240px" id="close3">${inc.length?'No cuadra con lo pesado':bloquea?'Faltan insumos':'Cerrar tanda y pasar a pesar →'}</button>${inc.length?'<button class="btn" id="force3" style="flex-basis:100%;color:var(--warn)">Cerrar de todos modos (autoriza un encargado)</button>':''}</div>`;
  document.getElementById('back3').onclick=()=>{ step=2; render(); };
  document.getElementById('close3').onclick=()=>{ if(bloquea) return; cerrarTanda(faltan); };
  const f3=document.getElementById('force3'); if(f3) f3.onclick=()=>forzarCierre(inc, faltan);
}

/* ---------- red: nada de esto puede frenar a quien está cocinando ---------- */
function enSegundoPlano(p){ (async () => { try { await p } catch { /* sin red: se reintenta en otra ocasión */ } })() }
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sin storage */ } }
const leer = (k, def = null) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v } catch { return def } }
const quitar = (k) => { try { localStorage.removeItem(k) } catch { /* sin storage */ } }

/* ---------- PIN ---------- */
// El PIN se valida en el servidor (fn_prep_actor, con el mismo freno de intentos
// que el login). Aquí solo vive en memoria mientras dura la pantalla.
function askPin(title, sub, cb, encargado, sinCancelar){
  openModal(`<h3>${esc(title)}</h3><div class="sub">${esc(sub)}</div><input class="pinin" id="pin-in" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="••••"><div id="pin-err" style="color:#fca5a5;font-size:13px;min-height:18px;text-align:center;margin-top:6px"></div>
    <div class="pad">${[1,2,3,4,5,6,7,8,9,'⌫',0,'OK'].map(k=>`<button data-k="${k}">${k}</button>`).join('')}</div>
    ${sinCancelar?'':'<button class="btn" id="pin-x" style="width:100%">Cancelar</button>'}`);
  const inp=document.getElementById('pin-in'); inp.focus();
  let ocupado=false, t=null;
  const go=async()=>{
    clearTimeout(t); const v=inp.value; if(v.length<4||ocupado) return; ocupado=true;
    document.getElementById('pin-err').textContent='';
    try{
      const { data, error } = await db.rpc('fn_prep_actor', { p_pin: v, p_solo_encargado: !!encargado });
      if(error) throw error;
      if(data){ closeModal(); beep(); cb({ id:data.id, n:data.nombre, rol:data.rol, pin: encargado ? v : undefined }); }
      else { beep(220,200); document.getElementById('pin-err').textContent = encargado ? 'Ese PIN no es de un encargado' : 'PIN incorrecto'; inp.value=''; inp.focus(); }
    }catch(e){ document.getElementById('pin-err').textContent = e.message || 'No hay conexión. Intentá de nuevo.'; inp.value=''; }
    finally{ ocupado=false; }
  };
  const programar=()=>{ inp.value=inp.value.replace(/\D/g,''); clearTimeout(t); if(inp.value.length>=6) go(); else if(inp.value.length>=4) t=setTimeout(go,450); };
  inp.oninput=programar;
  inp.onkeydown=e=>{ if(e.key==='Enter') go(); };
  document.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{ const k=b.dataset.k; if(k==='⌫') inp.value=inp.value.slice(0,-1); else if(k==='OK') { go(); return; } else if(inp.value.length<6) inp.value+=k; programar(); inp.focus(); });
  const px=document.getElementById('pin-x'); if(px) px.onclick=()=>{ clearTimeout(t); closeModal(); };
}

/* ---------- guardar la tanda ---------- */
const BUZON = 'prep_buzon_v1', BORRADOR = 'prep_borrador_v1';
const num = (x) => (typeof x === 'number' && Number.isFinite(x)) ? x : null;

function armarInsumos(){
  const out = [];
  uses.forEach(u => { const e = expected(u);
    out.push({ receta_id:u.rid, codigo:u.code, insumo:INS[u.code].nombre, cantidad:num(u.qty), unidad:u.unit,
      cantidad_receta: e ? num(e.qty) : null, unidad_receta: e ? e.unit : null, ratio: num(ratio(u)),
      fuera_receta: !!u.extra, nuevo: !!INS[u.code].nuevo, nota: u.nota || null, pistoleos: u.envases }); });
  Object.keys(sel).forEach(rid => REC[rid].lineas.forEach(l => {
    if(!uses.some(u => u.rid===rid && u.code===l.code))
      out.push({ receta_id:rid, codigo:l.code, insumo:INS[l.code].nombre, cantidad:null, unidad:null,
        cantidad_receta: num(l.qty*sel[rid]), unidad_receta:l.unit, ratio:null, falto:true }); }));
  return out;
}
// Abre el lote (si no existe) y guarda los insumos. Si el segundo paso falla, el
// id del lote ya quedó en `p` para que el reintento no cree otro.
async function enviarTanda(p){
  if(!p.loteId){
    const { data, error } = await db.rpc('fn_prep_lote_abrir', { p_usuario:p.usuario, p_recetas:p.recetas, p_sin_preparacion:false });
    if(error) throw error; p.loteId = data.id; p.loteTxt = data.lote;
  }
  const { error } = await db.rpc('fn_prep_lote_guardar', { p_usuario:p.usuario, p_lote_id:p.loteId, p_recetas:p.recetas, p_insumos:p.insumos, p_cerrar:true });
  if(error) throw error;
  return { id:p.loteId, lote:p.loteTxt };
}
async function vaciarBuzon(){
  let cola = leer(BUZON, []); if(!cola.length) return;
  const quedan = [];
  for(const p of cola){ try{ await enviarTanda(p) }catch{ quedan.push(p) } }
  guardar(BUZON, quedan);
  if(quedan.length < cola.length) toast('Se subieron tandas que estaban guardadas en la tablet','ok');
}
function forzarCierre(inc, faltan){
  const pedirMotivo = (por) => {
    openModal(`<h3>Motivo</h3><div class="sub">Autoriza ${esc(por)}. Escribí por qué esto no coincide con lo que se pesó. Queda anotado en el lote.</div><input class="search" id="fm" placeholder="Ej. se usó producto del día anterior…" autocomplete="off"><div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="fm-x">Cancelar</button><button class="btn ok" id="fm-ok" style="flex:1">Cerrar de todos modos</button></div>`);
    document.getElementById('fm').focus();
    document.getElementById('fm-x').onclick = closeModal;
    document.getElementById('fm-ok').onclick = () => { const m=document.getElementById('fm').value.trim(); if(m.length<4){ toast('Escribí el motivo','bad'); return; } closeModal(); cerrarTanda(faltan, { por, motivo:m, detalle:inc.map(i => i.texto) }); };
  };
  if(ENC.includes(operador.rol)) pedirMotivo(operador.n);
  else askPin('Autorización del encargado','Lo registrado no coincide con lo que se pesó. Un encargado puede autorizar el cierre con su PIN y queda anotado.', enc => pedirMotivo(enc.n), true);
}
async function cerrarTanda(faltan, forzado){
  const nuevas = await refrescarImpresas();
  if(nuevas.length){ step=1; render(); return; }
  const btn=document.getElementById('close3'); if(btn){ btn.disabled=true; btn.textContent='Guardando…'; }
  const pack = { usuario:operador.id, recetas:Object.keys(sel).map(id=>{ const ref=referencia(id); const o={ id, nombre:REC[id].nombre, tandas:sel[id] }; if(ref){ o.tandas_esperadas=Math.round(ref.t*100)/100; o.pesado={ unidades:ref.imp.unidades, gramos:Math.round(ref.imp.gramos) }; } if(forzado){ o.forzado_por=forzado.por; o.forzado_motivo=forzado.motivo; o.forzado_detalle=forzado.detalle; } return o; }), insumos:armarInsumos(),
                 loteId:loteActual?.id||null, loteTxt:loteActual?.lote||null };
  let res=null;
  try{ res = await enviarTanda(pack); }
  catch{ guardar(BUZON, [...leer(BUZON, []), pack]); }   // sin internet: queda en la tablet y se sube sola
  cerrado = { lote: res ? res.lote : null, n: uses.length, faltan, subir: !res };
  loteActual = res ? { id:res.id, lote:res.lote } : null;
  quitar(BORRADOR); renderDone();
}

/* ---------- borrador: si la tablet se reinicia a mitad de tanda ---------- */
function guardarBorrador(){
  if(!operador || cerrado || (!uses.length && step<2)){ return; }
  guardar(BORRADOR, { t:Date.now(), usuario:operador.id, nombre:operador.n, sel, uses, uid, step, loteActual, nuevos:DATA.insumos.filter(i => i.nuevo), libres:DATA.recetas.filter(r => r.libre) });
}

function renderDone(){
  operador=null; drawWho();
  document.getElementById('steps').innerHTML='<span class="done">1 · Qué preparás</span><span class="done">2 · Pistolear insumos</span><span class="done">3 · Revisar y cerrar</span>';
  document.getElementById('stage').innerHTML = `
    <div class="okbox" style="text-align:center;padding:26px"><div style="font-size:13px;font-weight:700;color:#6ee7b7">Tanda registrada</div><div class="big-lote">${cerrado.lote?esc(cerrado.lote):'Guardada en la tablet'}</div><div style="font-weight:600;font-size:14px;margin-top:4px">${cerrado.n} registro${cerrado.n===1?'':'s'} de insumos${cerrado.faltan?` · ${cerrado.faltan} pendiente${cerrado.faltan===1?'':'s'} de la receta`:''}</div></div>
    ${cerrado.subir?'<div class="warnbox" style="margin-top:12px">No hay internet: la tanda quedó guardada en esta tablet y se sube sola cuando vuelva. El número de lote aparece entonces.</div>':''}
    <p class="lead" style="margin-top:14px">La sesión se cerró sola: la siguiente persona entra con su propio PIN. Tus etiquetas de este lote ya tienen sus insumos registrados y podés marcar tu salida.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="edit4" ${cerrado.subir?'disabled':''}>✏️ Corregir esta tanda</button><button class="btn acc" style="flex:1" id="new4">Listo · cerrar sesión</button></div>`;
  document.getElementById('edit4').onclick=()=>{ askPin('Corregir la tanda','Para volver a abrir una tanda cerrada hay que entrar con PIN otra vez. La versión anterior queda en el historial.',op=>{ operador=op; cerrado=null; step=3; render(); }); };
  document.getElementById('new4').onclick=()=>{ sel={}; uses=[]; cerrado=null; loteActual=null; step=1; render(); };
}

/* ---------- datos y ajustes (solo encargado) ---------- */
function openDatos(d){
  const pct = (x) => x==null ? '—' : ((x-1)*100>=0?'+':'')+Math.round((x-1)*100)+'%';
  const filas = (d.insumos||[]).map(x => { const r=REC[x.receta_id]; const w=x.prom==null?0:Math.min(100,Math.abs(Math.round((x.prom-1)*100)));
    return `<div class="line" style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(x.insumo)} <span style="color:var(--dim);font-size:12px">en ${esc(r?r.nombre:x.receta_id)}</span></span><b>${pct(x.prom)}</b></div>
      <div style="height:6px;background:#23232b;border-radius:4px;margin:5px 0"><i style="display:block;height:6px;width:${w}%;background:${x.prom>1?'#f59e0b':'#3b82f6'};border-radius:4px"></i></div>
      <div style="font-size:11.5px;color:var(--dim)">${x.n} registro${x.n===1?'':'s'}${x.minimo!=null?` · de ${pct(x.minimo)} a ${pct(x.maximo)}`:''}${x.faltas?` · faltó ${x.faltas} vez${x.faltas===1?'':'es'}`:''}${x.fuera?` · fuera de receta ${x.fuera}`:''}</div></div>`; }).join('');
  const pers = (d.personas||[]).map(p => `<div class="line"><span>👤 ${esc(p.nombre)} · ${p.lotes} tanda${p.lotes==1?'':'s'}</span><span class="q">${p.registros?Math.round(100*p.exactos/p.registros):0}% idénticos a la receta</span></div>`).join('');
  const bit = (d.bitacora||[]).map(b => `<div class="line"><span>${esc(b.actor||'')} · ${esc(b.accion)}</span><span class="q">${esc(b.hora)}</span></div>`).join('');
  openModal(`<h3>📊 Datos de los últimos 30 días</h3><div class="sub">${d.lotes} tanda${d.lotes==1?'':'s'} cerrada${d.lotes==1?'':'s'} · ${d.deudas_abiertas} deuda${d.deudas_abiertas==1?'':'s'} abierta${d.deudas_abiertas==1?'':'s'}. Ordenado por lo que más se aleja de la receta; con unas 20 tandas por receta ya hay base para proponer topes.</div>
    ${filas||'<div class="empty">Todavía no hay tandas cerradas.</div>'}
    <p class="h3" style="margin-top:14px">Por persona</p>${pers||'<div class="empty">Todavía nada.</div>'}<div style="font-size:11.5px;color:var(--dim);margin-top:4px">Si alguien registra siempre «idéntico a la receta», conviene mirarlo: puede ser buen pulso o que solo toca «igual» para poder irse.</div>
    <p class="h3" style="margin-top:14px">Bitácora</p>${bit||'<div class="empty">Sin movimientos.</div>'}
    <button class="btn" id="d-x" style="margin-top:10px;width:100%">Cerrar</button>`);
  document.getElementById('d-x').onclick=closeModal;
}
document.getElementById('datos').onclick = () => askPin('PIN del encargado','Los datos y los ajustes son solo para el encargado.', async enc => {
  try{ const { data, error } = await db.rpc('fn_prep_datos', { p_pin_encargado:enc.pin, p_dias:30 }); if(error) throw error; openDatos(data); }
  catch(e){ toast(e.message || 'No se pudieron cargar los datos','bad'); }
}, true);

let guardandoAjustes = null;
function guardarAjustes(pin){ clearTimeout(guardandoAjustes); guardandoAjustes = setTimeout(async () => {
  try{ const { error } = await db.rpc('fn_prep_ajustes_guardar', { p_pin_encargado:pin, p_valor:cfg }); if(error) throw error; toast('Ajustes guardados para todas las tablets','ok'); }
  catch(e){ toast(e.message || 'No se pudieron guardar los ajustes','bad'); } }, 600); }
document.getElementById('gear').onclick = () => askPin('PIN del encargado','Los ajustes son solo para el encargado.', enc => {
  const d=document.createElement('div'); d.className='drawer'; d.id='drw';
  d.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><h3>Ajustes del encargado</h3><button class="x" id="dx">✕</button></div><div class="okbox" style="font-size:13px;padding:10px 12px;margin:10px 0">Modo observación: nada bloquea y los operadores no ven alarmas. Solo se junta información. Cuando haya datos, aquí se encienden los límites uno por uno. Los cambios se guardan solos para todas las tablets.</div><div style="font-size:12.5px;color:var(--dim)">Todo esto se cambia desde la pantalla, sin llamar a nadie ni tocar código.</div>
  <div class="set"><div class="sw"><div><div class="t">Mostrar alertas de color a los operadores</div><div class="d">Apagado = solo ven “+50% vs receta” en gris. Encendido = “de más / de menos” en rojo y amarillo.</div></div><input type="checkbox" id="s0" ${cfg.alertas?'checked':''}></div></div>
  <div class="set"><div class="t">Margen para marcar “de más / de menos”</div><div class="d">Qué tan lejos de la receta puede quedar una cantidad antes de avisar.</div><div class="sw"><input class="num" id="s1" type="number" min="0" max="100" value="${cfg.tol}" style="width:80px"> <span>% de margen</span></div></div>
  <div class="set"><div class="sw"><div><div class="t">Exigir todos los insumos para cerrar</div><div class="d">Apagado = lo que falte solo queda anotado. Encendido = no deja cerrar hasta registrar todo.</div></div><input type="checkbox" id="s2" ${cfg.exigirTodo?'checked':''}></div></div>
  <div class="set"><div class="sw"><div><div class="t">Permitir insumos que no son de la receta</div><div class="d">Encendido = se pueden agregar y quedan marcados “fuera de receta”. Apagado = se bloquean.</div></div><input type="checkbox" id="s3" ${cfg.fueraReceta?'checked':''}></div></div>
  <div class="set"><div class="sw"><div><div class="t">Permitir agregar insumos nuevos al pistolear</div><div class="d">Encendido = si pistolean algo que no conocemos, pueden ligarlo a uno de la lista o crearlo. Apagado = solo lo que ya está cargado.</div></div><input type="checkbox" id="s5" ${cfg.nuevos?'checked':''}></div></div>
  <div class="set"><div class="sw"><div><div class="t">Bloquear la salida si imprimieron etiquetas sin registrar insumos</div><div class="d">Encendido = al marcar salida se pide registrar primero (con salida de emergencia por PIN del encargado). Apagado = solo queda anotado.</div></div><input type="checkbox" id="s6" ${cfg.bloquearSalida?'checked':''}></div></div>
  <div class="set"><div class="sw"><div><div class="t">Mostrar la cantidad al pistolear</div><div class="d">Encendido = al pistolear se ve la cantidad para corregirla. Apagado = se usa la de la receta sin preguntar.</div></div><input type="checkbox" id="s4" ${cfg.pedirCantidad?'checked':''}></div></div>
  <div class="set" style="border:0"><div class="t">Recetas, insumos y unidades</div><div class="d">Las recetas y los insumos viven en la base (tabla prep_config, fila «catalogo»). Los insumos que crea cocina al pistolear aparecen con la etiqueta «nuevo» hasta que se revisen.</div></div>`;
  document.body.appendChild(d);
  const close=()=>{ d.remove(); if(step===2){ drawList(); drawCheck(); } else if(step===3) renderStep3(); refocus(); };
  d.querySelector('#dx').onclick=close;
  const on=(id,fn)=>{ d.querySelector(id).onchange=e=>{ fn(e); guardarAjustes(enc.pin); }; };
  on('#s0',e=>cfg.alertas=e.target.checked);
  d.querySelector('#s1').oninput=e=>{ cfg.tol=Math.max(0,Math.min(100,parseFloat(e.target.value)||0)); guardarAjustes(enc.pin); };
  on('#s2',e=>cfg.exigirTodo=e.target.checked);
  on('#s3',e=>cfg.fueraReceta=e.target.checked);
  on('#s5',e=>cfg.nuevos=e.target.checked);
  on('#s6',e=>cfg.bloquearSalida=e.target.checked);
  on('#s4',e=>cfg.pedirCantidad=e.target.checked);
}, true);

/* ---------- arranque ---------- */
const CACHE_CAT = 'prep_catalogo_cache_v1';
function aplicarCatalogo(c){
  const base = c.catalogo || catalogoBundled;
  const codigos = new Set(base.insumos.map(i => i.code));
  DATA = { insumos:[...base.insumos, ...(c.nuevos||[]).filter(n => !codigos.has(n.code))], recetas:base.recetas.map(r => ({ ...r })) };
  ALIAS = c.alias || {};
  indexar();
}
async function cargarCatalogo(){
  try{
    const { data, error } = await db.rpc('fn_prep_catalogo'); if(error) throw error;
    guardar(CACHE_CAT, data); aplicarCatalogo(data); return 'base';
  }catch{
    const c = leer(CACHE_CAT); if(c){ aplicarCatalogo(c); return 'cache'; }
    return 'respaldo';
  }
}
async function cargarAjustes(){
  try{ const { data, error } = await db.rpc('fn_prep_ajustes'); if(error) throw error; if(data) cfg = { ...cfg, ...data }; }
  catch{ /* se usan los de siempre */ }
}
// Compuerta: sin PIN no se ve nada. Con PIN: las personas de producción solo
// pueden registrar insumos de lo que ellas pesaron e imprimieron (lote del día);
// los encargados ven todo.
function pedirEntrada(aviso){
  clearTimeout(bloqT);
  document.getElementById('steps').innerHTML='';
  document.getElementById('stage').innerHTML = `<div style="text-align:center;margin-top:70px"><div style="font-size:42px">🔒</div><h2>Registro de insumos</h2><p class="lead">${esc(aviso||'Entrá con tu PIN para registrar los insumos de lo que pesaste e imprimiste.')}</p></div>`;
  if(document.getElementById('ov')) return;
  askPin('¿Quién va a registrar insumos?','Solo vas a ver lo que pesaste e imprimiste con tu PIN. Todo queda a tu nombre.', op => { resolverAcceso(op); }, false, true);
}
function avisoEntrada(titulo, texto){
  openModal(`<h3>${esc(titulo)}</h3><div class="sub">${esc(texto)}</div><button class="btn ok" id="av-ok" style="width:100%">Entendido</button>`);
  document.getElementById('av-ok').onclick=()=>{ closeModal(); pedirEntrada(); };
}
async function resolverAcceso(op){
  try{ await catalogoListo; }catch{}
  sel={}; uses=[]; loteActual=null; permitidas=new Set(); resumenImp=''; impreso={};
  if(ENC.includes(op.rol)){ operador=op; restringido=false; step=1; aplicarBorrador(op); render(); return; }
  let lista;
  try{ const { data, error } = await db.rpc('fn_prep_pendientes_detalle', { p_usuario:op.id }); if(error) throw error; lista = data||[]; }
  catch{ avisoEntrada('Sin conexión','No pude ver lo que imprimiste. Esperá unos segundos y entrá de nuevo con tu PIN.'); return; }
  const want = new URLSearchParams(location.search).get('lote');
  const l = lista.find(x => x.lote_id===want) || lista[0];
  if(!l){ avisoEntrada('No tenés nada pendiente', op.n.split(' ')[0]+', no hay etiquetas tuyas sin insumos. Primero se pesa e imprime; los insumos se registran al final del turno.'); return; }
  impreso = armarImpreso(l);
  // Las tandas arrancan en lo que corresponde a lo pesado, no en 1.
  Object.keys(impreso).forEach(rid => { permitidas.add(rid); sel[rid] = tandasIniciales(rid); });
  resumenImp = textoImpreso(l);
  operador=op; restringido=true; loteActual={ id:l.lote_id, lote:l.lote }; step=1; aplicarBorrador(op); render();
}
// Convierte lo impreso de un lote (productos) en un mapa receta → {unidades, gramos, nombre}.
function armarImpreso(l){
  const out = {};
  (l.productos||[]).forEach(p => {
    let rid = RECETA_DE[p.clave] || p.clave;
    if(!rid || !REC[rid]){ rid = 'prod-'+p.producto_id; if(!REC[rid]){ const r={ id:rid, nombre:p.nombre, lineas:[], libre:true }; DATA.recetas.push(r); REC[rid]=r; } }
    const im = out[rid] = out[rid] || { unidades:0, gramos:0, nombre:p.nombre };
    im.unidades += Number(p.unidades)||0;
    im.gramos += p.gramos!=null ? Number(p.gramos) : (p.gramos_objetivo ? Number(p.gramos_objetivo)*(Number(p.unidades)||0) : 0);
  });
  return out;
}
function textoImpreso(l){ return 'Imprimiste ' + (l.productos||[]).map(p => p.nombre+' ('+p.unidades+' etiqueta'+(p.unidades==1?'':'s')+')').join(', '); }
function tandasIniciales(rid){ const ref=referencia(rid); return ref ? Math.max(0.01, Math.round(ref.t*100)/100) : 1; }
// Si mientras la persona registra insumos se imprime algo más (otra tablet, otra pestaña), se suma a su lista:
// si no, al cerrar el lote ese producto quedaría como "con insumos" sin tenerlos.
let refrescando = false;
async function refrescarImpresas(){
  if(refrescando || !operador || !restringido || cerrado || !loteActual || !loteActual.id) return [];
  refrescando = true;
  try{
    const { data, error } = await db.rpc('fn_prep_pendientes_detalle', { p_usuario:operador.id }); if(error) throw error;
    const l = (data||[]).find(x => x.lote_id===loteActual.id); if(!l) return [];
    const nuevo = armarImpreso(l); const agregadas=[];
    Object.keys(nuevo).forEach(rid => { if(!permitidas.has(rid)){ permitidas.add(rid); impreso[rid]=nuevo[rid]; sel[rid]=1; sel[rid]=tandasIniciales(rid); agregadas.push(nuevo[rid].nombre); } else impreso[rid]=nuevo[rid]; });
    resumenImp = textoImpreso(l);
    if(agregadas.length){ toast('Se imprimió algo más: '+agregadas.join(', ')+'. Ya está en tu lista para registrar.','ok'); if(!document.getElementById('ov')) render(); }
    return agregadas;
  }catch{ return []; }
  finally{ refrescando = false; }
}
document.addEventListener('visibilitychange', () => { if(!document.hidden) refrescarImpresas(); });
window.addEventListener('focus', () => refrescarImpresas());
setInterval(refrescarImpresas, 15000);
// Si esta misma persona dejó una tanda a medias (se cayó la tablet, se bloqueó la pantalla), vuelve a donde iba.
function aplicarBorrador(op){
  const b = leer(BORRADOR); if(!b) return;
  if(Date.now()-b.t > 18*3600*1000 || !b.uses || !b.uses.length){ quitar(BORRADOR); return; }
  if(b.usuario !== op.id || (b.loteActual?.id||null) !== (loteActual?.id||null)) return;
  (b.nuevos||[]).forEach(n => { if(!INS[n.code]){ INS[n.code]=n; DATA.insumos.push(n); } });
  (b.libres||[]).forEach(r => { if(!REC[r.id]){ REC[r.id]=r; DATA.recetas.push(r); } });
  const ok = id => REC[id] && (!restringido || permitidas.has(id));
  sel = {}; Object.keys(b.sel||{}).forEach(id => { if(ok(id)) sel[id]=b.sel[id]; });
  uses = (b.uses||[]).filter(u => INS[u.code] && ok(u.rid)); uid = b.uid || uses.length+1;
  step = Math.max(2, Math.min(3, b.step||2)); toast('Seguís con tu tanda donde ibas','ok');
}
// 30 s sin tocar nada en "qué preparás" cierran la sesión y vuelven a pedir el PIN.
function armarBloqueo(){
  clearTimeout(bloqT);
  if(!operador || cerrado || step!==1) return;
  bloqT = setTimeout(() => { operador=null; sel={}; uses=[]; loteActual=null; restringido=false; render(); pedirEntrada('La pantalla se bloqueó por inactividad. Entrá de nuevo con tu PIN.'); }, 30000);
}
['pointerdown','keydown','touchstart'].forEach(e => window.addEventListener(e, () => { if(bloqT) armarBloqueo(); }, true));
async function init(){
  catalogoListo = Promise.all([cargarCatalogo(), cargarAjustes()]);
  render();
  await catalogoListo;
  vaciarBuzon(); window.addEventListener('online', vaciarBuzon);
}
init();
