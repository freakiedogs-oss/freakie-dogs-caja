import { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../../supabase';
import { STORES, today, fmtDate, n } from '../../config';
import { useToast } from '../../hooks/useToast';
import { Badge } from '../ui/Badge';

// ── DESPACHO A SUCURSALES (Flujo C) ──────────────────────────
export default function DespachoTab({user,show}){
  const [view,setView]=useState('lista');
  const [pedidos,setPedidos]=useState([]);
  const [despachos,setDespachos]=useState([]);
  const [loading,setLoading]=useState(true);
  const [sel,setSel]=useState(null);
  const [tab,setTab]=useState('pendientes'); // pendientes | proceso | historial

  const cargar=async()=>{
    setLoading(true);
    try{
      const [{data:ped},{data:des}]=await Promise.all([
        // Pedidos 'enviado' (pendientes) o 'preparando' (ya tienen despacho preparándose)
        db.from('pedidos_sucursal').select('*,sucursales(nombre)').in('estado',['enviado','preparando']).order('created_at',{ascending:false}),
        // Embed por nombre de FK: despachos_sucursal apunta dos veces a sucursales
        // (sucursal_id = destino, origen_sucursal_id = origen de transferencia), y
        // `sucursales(nombre)` a secas es ambiguo -> PostgREST tumba la consulta.
        db.from('despachos_sucursal').select('*,sucursales!despachos_sucursal_sucursal_id_fkey(nombre)').in('estado',['preparando','despachado','en_ruta','recibido']).order('created_at',{ascending:false}).limit(50),
      ]);
      setPedidos(ped||[]);
      setDespachos(des||[]);
    }catch(e){show('❌ '+e.message);}
    setLoading(false);
  };

  useEffect(()=>{cargar();},[]);

  if(view==='preparar'&&sel) return <PrepararDespacho pedido={sel} user={user} show={show} onBack={()=>{setSel(null);setView('lista');cargar();}}/>;

  const despachosEnProceso=despachos.filter(d=>['preparando','despachado'].includes(d.estado));
  const despachosHistorial=despachos.filter(d=>['en_ruta','recibido'].includes(d.estado));

  return(
    <div style={{padding:'16px 16px 100px'}}>
      <div style={{display:'flex',gap:6,marginBottom:16,overflowX:'auto',flexWrap:'nowrap'}}>
        <button className={`btn btn-sm ${tab==='pendientes'?'btn-red':'btn-ghost'}`} onClick={()=>setTab('pendientes')}>📋 Pendientes</button>
        <button className={`btn btn-sm ${tab==='proceso'?'btn-red':'btn-ghost'}`} onClick={()=>setTab('proceso')}>⚙️ En proceso</button>
        <button className={`btn btn-sm ${tab==='historial'?'btn-red':'btn-ghost'}`} onClick={()=>setTab('historial')}>✅ Historial</button>
      </div>
      {loading&&<div className="spin" style={{width:28,height:28,margin:'20px auto'}}/>}

      {!loading&&tab==='pendientes'&&<>
        {pedidos.filter(p=>p.estado==='enviado').length===0&&pedidos.filter(p=>p.estado==='preparando').length===0&&
          <div className="empty"><div className="empty-icon">📋</div><div className="empty-text">No hay pedidos pendientes</div></div>}
        {pedidos.filter(p=>p.estado==='enviado').map(p=>(
          <div key={p.id} className="card">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
              <div>
                <div style={{fontWeight:700,fontSize:15}}>{p.sucursales?.nombre||p.sucursal_id}</div>
                <div style={{color:'#666',fontSize:12,marginTop:2}}>Pedido: {fmtDate(p.fecha_pedido)}{p.created_at&&` · ${new Date(p.created_at).toLocaleTimeString('es-SV',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'America/El_Salvador'})}`}</div>
                {p.fecha_entrega_estimada&&<div style={{color:'#fbbf24',fontSize:12}}>Entrega: {fmtDate(p.fecha_entrega_estimada)}</div>}
              </div>
              <Badge estado={p.estado}/>
            </div>
            {p.notas&&<div style={{fontSize:13,color:'#888',marginBottom:8}}>📝 {p.notas}</div>}
            <button className="btn btn-orange btn-sm" onClick={()=>{setSel(p);setView('preparar');}}>
              📦 Preparar Despacho
            </button>
          </div>
        ))}
        {/* Pedidos preparando: ya tienen despacho preparándose, no se pueden volver a preparar */}
        {pedidos.filter(p=>p.estado==='preparando').map(p=>(
          <div key={p.id} className="card" style={{borderLeft:'3px solid #facc15'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
              <div>
                <div style={{fontWeight:700,fontSize:15}}>{p.sucursales?.nombre||p.sucursal_id}</div>
                <div style={{color:'#666',fontSize:12,marginTop:2}}>Pedido: {fmtDate(p.fecha_pedido)}{p.created_at&&` · ${new Date(p.created_at).toLocaleTimeString('es-SV',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'America/El_Salvador'})}`}</div>
              </div>
              <span style={{fontSize:11,padding:'4px 10px',borderRadius:6,background:'#facc1520',color:'#facc15',fontWeight:600}}>⚙️ Preparando</span>
            </div>
            {p.notas&&<div style={{fontSize:13,color:'#888',marginBottom:8}}>📝 {p.notas}</div>}
            <div style={{fontSize:12,color:'#facc15'}}>Ya tiene despacho en preparación — ver pestaña "En proceso"</div>
          </div>
        ))}
      </>}

      {!loading&&tab==='proceso'&&<>
        {despachosEnProceso.length===0&&<div className="empty"><div className="empty-icon">⚙️</div><div className="empty-text">No hay despachos en proceso</div></div>}
        {despachosEnProceso.map(d=>(
          <DespachoEnProcesoCard key={d.id} despacho={d} user={user} show={show} onUpdate={cargar}/>
        ))}
      </>}

      {!loading&&tab==='historial'&&<>
        {despachosHistorial.length===0&&<div className="empty"><div className="empty-icon">✅</div><div className="empty-text">Sin historial aún</div></div>}
        {despachosHistorial.map(d=>(
          <div key={d.id} className="card">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div>
                <div style={{fontWeight:700}}>{d.sucursales?.nombre}</div>
                <div style={{color:'#666',fontSize:12}}>{fmtDate(d.fecha_despacho)}</div>
                {d.motorista_nombre&&<div style={{fontSize:12,color:'#60a5fa',marginTop:2}}>🚚 {d.motorista_nombre}</div>}
              </div>
              <Badge estado={d.estado}/>
            </div>
            {d.hora_salida&&<div style={{fontSize:11,color:'#888',marginTop:4}}>Salida: {new Date(d.hora_salida).toLocaleString('es-SV')}</div>}
            {d.hora_recepcion&&<div style={{fontSize:11,color:'#4ade80',marginTop:2}}>Recibido: {new Date(d.hora_recepcion).toLocaleString('es-SV')}</div>}
            {d.notas_despacho&&<div style={{fontSize:12,color:'#888',marginTop:4}}>📝 {d.notas_despacho}</div>}
          </div>
        ))}
      </>}
    </div>
  );
}

// ── DESPACHO EN PROCESO CARD ──────────────────────────────────
function DespachoEnProcesoCard({despacho,user,show,onUpdate}){
  const [expand,setExpand]=useState(false);
  const [items,setItems]=useState([]);
  const [loadingItems,setLoadingItems]=useState(false);
  const [saving,setSaving]=useState(false);

  const cargarItems=async()=>{
    setLoadingItems(true);
    try{
      const {data}=await db.from('despacho_items').select('id,despacho_id,producto_id,descripcion,cantidad_solicitada,cantidad_despachada,unidad,unidad_medida').eq('despacho_id',despacho.id);
      setItems(data||[]);
      return data||[];
    }catch(e){show('❌ '+e.message);}
    finally{setLoadingItems(false);}
    return [];
  };

  const marcarDespachado=async()=>{
    setSaving(true);
    try{
      // 1. Marcar despacho como despachado + hora_salida
      await db.from('despachos_sucursal').update({estado:'despachado',hora_salida:new Date().toISOString()}).eq('id',despacho.id);
      // 2. Ahora sí marcar el pedido como 'despachado' (motorista ya salió)
      if(despacho.pedido_id){
        await db.from('pedidos_sucursal').update({estado:'despachado'}).eq('id',despacho.pedido_id);
      }
      show('✅ Despachado — motorista en camino');
      onUpdate();
      setExpand(false);
    }catch(e){show('❌ '+e.message);}
    setSaving(false);
  };

  const handleToggle=()=>{
    if(!expand) cargarItems();
    setExpand(!expand);
  };

  const reimprimir=async()=>{
    const {data}=await db.rpc('hoja_despacho',{p_despacho_id:despacho.id});
    const its=(data?.items)||[];
    const groups={};
    its.forEach(it=>{const cat=it.grupo||'Sin grupo';if(!groups[cat])groups[cat]=[];groups[cat].push(it);});
    const ORDEN=['Carnes y Complementos','Panes y Harinas','Quesos y Lácteos','Vegetales y Verduras','Salsas y Aderezos','Papas y Congelados','Bebidas','Empaques y Desechables','Utensilios de Limpieza','Extras'];
    const grouped=Object.entries(groups).sort((a,b)=>{
      const ia=ORDEN.findIndex(o=>o.toLowerCase()===a[0].toLowerCase());
      const ib=ORDEN.findIndex(o=>o.toLowerCase()===b[0].toLowerCase());
      return (ia===-1?999:ia)-(ib===-1?999:ib);
    }).map(([cat,arr])=>[cat,arr.map(it=>({
      nombre:it.nombre,presentacion:it.presentacion,unidad:it.unidad,
      solicitado:it.enviado,costo_unitario:it.costo_unitario
    }))]);
    imprimirHojaDespacho({
      sucursal:despacho.sucursales?.nombre||data?.sucursal||'',
      fecha:fmtDate(despacho.fecha_despacho),
      motorista:despacho.motorista_nombre||'',
      grouped
    });
  };

  return(
    <div className="card" style={{cursor:'pointer'}} onClick={handleToggle}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div>
          <div style={{fontWeight:700}}>{despacho.sucursales?.nombre}</div>
          <div style={{color:'#666',fontSize:12,marginTop:2}}>{fmtDate(despacho.fecha_despacho)}</div>
          {despacho.motorista_nombre&&<div style={{fontSize:12,color:'#60a5fa',marginTop:2}}>🚚 {despacho.motorista_nombre}</div>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <Badge estado={despacho.estado}/>
          <span style={{color:'#555',fontSize:14}}>{expand?'▲':'▼'}</span>
        </div>
      </div>

      {expand&&(
        <div style={{marginTop:12,borderTop:'1px solid #2a2a2a',paddingTop:12}} onClick={e=>e.stopPropagation()}>
          <div className="sec-title">ÍTEMS EN DESPACHO</div>
          {loadingItems&&<div className="spin" style={{width:20,height:20,margin:'8px auto'}}/>}
          {!loadingItems&&items.length===0&&<div style={{color:'#555',fontSize:13,paddingBottom:8}}>Sin ítems</div>}
          {!loadingItems&&items.map(it=>(
            <div key={it.id} style={{padding:'8px 0',borderBottom:'1px solid #1a1a1a',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:500}}>{it.descripcion||'Producto'}</div>
                <div style={{fontSize:11,color:'#555'}}>{it.cantidad_despachada} {it.unidad_medida||'unidad'}</div>
              </div>
            </div>
          ))}
          <div style={{display:'flex',gap:8,marginTop:12}}>
            {despacho.estado==='preparando'&&(
              <button className="btn btn-green" style={{flex:1}} onClick={marcarDespachado} disabled={saving}>
                {saving?'Marcando...':'🚚 Marcar Despachado'}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={reimprimir}>🖨️ Reimprimir</button>
          </div>
          {despacho.hora_salida&&<div style={{fontSize:11,color:'#4ade80',marginTop:8}}>Salida: {new Date(despacho.hora_salida).toLocaleString('es-SV')}</div>}
        </div>
      )}
    </div>
  );
}

// ── IMPRIMIR HOJA DE REQUISICIÓN ──────────────────────────────
// grouped: [ [categoria, [{nombre, presentacion, unidad, solicitado, costo_unitario}]] ]
function imprimirHojaDespacho({sucursal,fecha,motorista,grouped}){
  const fmt=(v)=>{ const nn=Number(v||0); return Number.isInteger(nn)?String(nn):nn.toFixed(2); };
  const fmtM=(v)=>v==null?'—':'$'+Number(v).toFixed(2);
  const td='padding:3px 5px;border-bottom:1px solid #ddd;font-size:10px';
  let grandTotal=0;
  const rows=grouped.map(([cat,its])=>{
    let sub=0;
    const r=its.map(it=>{
      const ct=(it.costo_unitario!=null&&it.solicitado>0)?it.costo_unitario*it.solicitado:null;
      if(ct!=null)sub+=ct;
      return `<tr>
        <td style="${td}">${it.nombre||'Producto'}</td>
        <td style="${td};text-align:center;font-size:9px;color:#555">${it.presentacion||it.unidad||'—'}</td>
        <td style="${td};text-align:center;font-weight:700">${it.solicitado>0?fmt(it.solicitado):''}</td>
        <td style="${td};text-align:center;width:60px"></td>
        <td style="${td};text-align:right">${fmtM(it.costo_unitario)}</td>
        <td style="${td};text-align:right;font-weight:700">${ct!=null?fmtM(ct):'—'}</td>
      </tr>`;
    }).join('');
    grandTotal+=sub;
    return `<tr><td colspan="6" style="background:#eee;font-weight:700;padding:3px 6px;font-size:10.5px">${cat}</td></tr>`+r+
      `<tr><td colspan="4" style="border-bottom:1px solid #ccc"></td><td style="border-bottom:1px solid #ccc;text-align:right;font-size:9px;color:#666;padding:2px 5px">Subtotal</td><td style="border-bottom:1px solid #ccc;text-align:right;font-weight:700;padding:2px 5px;font-size:10px">${fmtM(sub)}</td></tr>`;
  }).join('');
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Requisición ${sucursal}</title>
    <style>@media print{@page{margin:8mm;size:letter portrait}body{font-family:Arial,sans-serif;font-size:10.5px;color:#000}}
    body{font-family:Arial,sans-serif;font-size:10.5px}table{width:100%;border-collapse:collapse;margin-top:10px;table-layout:fixed}
    th{background:#333;color:#fff;padding:4px 5px;text-align:left;font-size:9px}
    td{word-wrap:break-word;overflow-wrap:break-word}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
    .logo{font-size:18px;font-weight:900}.firma{margin-top:26px;display:flex;justify-content:space-between;gap:22px}
    .firma-box{flex:1;text-align:center;border-top:1px solid #000;padding-top:6px;font-size:10px}</style></head>
    <body>
    <div class="header"><div><div class="logo">🍔 FREAKIE DOGS</div><div style="font-size:12px;color:#666">Hoja de Requisición</div></div>
    <div style="text-align:right"><div><strong>Destino:</strong> ${sucursal}</div>
    <div><strong>Fecha:</strong> ${fecha}</div>
    ${motorista?`<div><strong>Motorista:</strong> ${motorista}</div>`:''}</div></div>
    <table><thead><tr><th style="width:28%">Producto</th><th style="text-align:center;width:16%">Presentación</th><th style="text-align:center;width:10%">Solicitado</th><th style="text-align:center;width:10%">Recibido</th><th style="text-align:right;width:13%">Costo Unit.</th><th style="text-align:right;width:13%">Costo Total</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4"></td><td style="text-align:right;font-weight:900;padding:6px 5px;border-top:2px solid #333;font-size:11px">TOTAL</td><td style="text-align:right;font-weight:900;padding:6px 5px;border-top:2px solid #333;font-size:11px">${fmtM(grandTotal)}</td></tr></tfoot>
    </table>
    <div class="firma"><div class="firma-box">Solicitante</div><div class="firma-box">Despachador</div><div class="firma-box">Recibido por</div></div>
    <div style="text-align:center;margin-top:20px;font-size:10px;color:#999">Freakie Dogs ERP — ${new Date().toLocaleString('es-SV')}</div>
    </body></html>`;
  const w=window.open('','_blank','width=800,height=600');
  if(w){w.document.write(html);w.document.close();setTimeout(()=>w.print(),400);}
}

// ── PREPARAR DESPACHO ─────────────────────────────────────────
function PrepararDespacho({pedido,user,show,onBack}){
  const [pitems,setPitems]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [cmId,setCmId]=useState(null);
  const [motorista,setMotorista]=useState('');
  const [motoristas,setMotoristas]=useState([]);
  const bottomRef=useRef(null);

  useEffect(()=>{
    // Get CM001 sucursal ID
    db.from('sucursales').select('id').eq('store_code','CM001').maybeSingle()
      .then(({data})=>{
        if(data) setCmId(data.id);
      });
    // Load motoristas
    db.from('usuarios_erp').select('id,nombre').in('rol',['despachador','motorista']).order('nombre')
      .then(({data})=>setMotoristas(data||[]));
    // Load pedido items + conteo nocturno actual de la sucursal (para la hoja)
    db.from('pedido_items').select('*,catalogo_productos(nombre,unidad_medida,categoria,conteo_categoria,presentacion_pedido,precio_referencia)').eq('pedido_id',pedido.id)
      .then(async({data})=>{
        const its=(data||[]).map(it=>({...it,qty_despacho:String(it.cantidad_solicitada||0),conteo:0,costo_erp:null}));
        const ids=its.map(it=>it.producto_id).filter(Boolean);
        if(ids.length){
          const [{data:cmap},{data:costData}]=await Promise.all([
            db.rpc('conteo_actual_sucursal',{p_sucursal_id:pedido.sucursal_id,p_producto_ids:ids}),
            db.from('compras_dte_items').select('producto_id,precio_unitario').in('producto_id',ids).order('created_at',{ascending:false}),
          ]);
          if(cmap) its.forEach(it=>{ it.conteo=Number(cmap[it.producto_id]||0); });
          const costoMap={};
          (costData||[]).forEach(c=>{ if(!costoMap[c.producto_id]) costoMap[c.producto_id]=Number(c.precio_unitario); });
          its.forEach(it=>{ it.costo_erp=costoMap[it.producto_id]??(it.catalogo_productos?.precio_referencia?Number(it.catalogo_productos.precio_referencia):null); });
        }
        setPitems(its);
        setLoading(false);
      });
  },[pedido.id]);

  const despachar=async()=>{
    if(!cmId){show('❌ No se encontró Casa Matriz');return;}
    if(!motorista.trim()){show('⚠️ Ingresa el nombre del motorista');return;}
    setSaving(true);
    try{
      // 0. Protección anti-duplicado: verificar que no exista despacho activo para este pedido
      const {data:existente}=await db.from('despachos_sucursal')
        .select('id').eq('pedido_id',pedido.id)
        .in('estado',['preparando','despachado','en_ruta'])
        .limit(1);
      if(existente&&existente.length>0){
        show('⚠️ Este pedido ya tiene un despacho en proceso');
        setSaving(false);
        return;
      }

      // 1. Marcar pedido como 'preparando' (NO 'despachado' todavía — eso es cuando el motorista sale)
      await db.from('pedidos_sucursal').update({estado:'preparando'}).eq('id',pedido.id);

      // 2. Crear despacho_sucursal (con motorista_id para que el driver vea su ruta)
      const motoObj=motoristas.find(m=>m.nombre===motorista.trim());
      const {data:des,error:desErr}=await db.from('despachos_sucursal').insert({
        sucursal_id:pedido.sucursal_id,
        pedido_id:pedido.id,
        fecha_despacho:today(),
        estado:'preparando',
        preparado_por:user.id,
        motorista_id:motoObj?.id||null,
        motorista_nombre:motorista.trim(),
      }).select().single();
      if(desErr) throw desErr;

      // 3. Crear despacho_items (with pricing)
      const rows=[];
      for(const it of pitems){
        const qty=n(it.qty_despacho);
        if(qty<=0) continue;

        let costo=it.catalogo_productos?.precio_referencia||0;

        rows.push({
          despacho_id:des.id,
          producto_id:it.producto_id||null,
          descripcion:it.catalogo_productos?.nombre||'Producto',
          cantidad_despachada:qty,
          unidad_medida:it.catalogo_productos?.unidad_medida||it.unidad||'unidad',
          costo_unitario:costo,
        });
      }

      if(rows.length>0){
        const {error:itmErr}=await db.from('despacho_items').insert(rows);
        if(itmErr) throw itmErr;

        // 4. Descontar de Casa Matriz POR KARDEX.
        // Antes esto hacía read-then-write directo sobre inventario.stock_actual, en lotes de 10:
        //   · no dejaba rastro en kardex_movimientos → el Historial del Kardex nunca mostraba
        //     los despachos, y el kardex dejó de cuadrar con el inventario (+138,193 unidades
        //     de diferencia en CM al momento de este cambio);
        //   · el leer-y-escribir no era atómico: dos despachos simultáneos del mismo producto
        //     se pisaban y uno de los dos descuentos se perdía.
        // kardex_mover_lote hace ambas cosas del lado del servidor y en una sola llamada.
        const validItems=pitems.filter(it=>it.producto_id&&n(it.qty_despacho)>0);
        if(validItems.length>0){
          const {error:kErr}=await db.rpc('kardex_mover_lote',{
            p_items:validItems.map(it=>({producto_id:it.producto_id,cantidad:-n(it.qty_despacho)})),
            p_tipo:'traslado',
            p_referencia_tipo:'despacho',
            p_referencia_id:des.id,
            p_notas:'Salida de Casa Matriz por despacho a sucursal',
            p_usuario_id:user?.id||null,
            p_sucursal_id:cmId,
            // el stock de CM todavía no es confiable; el negativo delata el faltante en vez de
            // frenar el despacho, igual que hace registrar_produccion
            p_permitir_negativo:true,
          });
          if(kErr) throw kErr;
        }
      }

      // 5. Batch update pedido_items.cantidad_despachada
      const itemsToUpdate=pitems.filter(it=>n(it.qty_despacho)>0);
      await Promise.all(itemsToUpdate.map(it=>
        db.from('pedido_items').update({cantidad_despachada:n(it.qty_despacho)}).eq('id',it.id)
      ));

      show('✅ Despacho creado — preparando');
      onBack();
    }catch(e){ show('❌ '+e.message); }
    setSaving(false);
  };

  // Group items by category
  const grouped=useMemo(()=>{
    const groups={};
    pitems.forEach(it=>{
      const cat=it.catalogo_productos?.conteo_categoria||it.catalogo_productos?.categoria||'Otros';
      if(!groups[cat]) groups[cat]=[];
      groups[cat].push(it);
    });
    return Object.entries(groups);
  },[pitems]);

  return(
    <div style={{minHeight:'100vh'}}>
      <div className="header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:15}}>Preparar Despacho</div>
          <div style={{fontSize:12,color:'#666'}}>{pedido.sucursales?.nombre}</div>
        </div>
      </div>
      <div style={{padding:'16px 16px 100px'}}>
        <div style={{marginBottom:12,padding:'10px',background:'#1e3a5f',borderRadius:8,borderLeft:'3px solid #60a5fa'}}>
          <div style={{fontSize:12,color:'#60a5fa',fontWeight:600}}>Pedido: {fmtDate(pedido.fecha_pedido)}{pedido.created_at&&` · ${new Date(pedido.created_at).toLocaleTimeString('es-SV',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'America/El_Salvador'})}`}</div>
          {pedido.fecha_entrega_estimada&&<div style={{fontSize:11,color:'#888',marginTop:2}}>Entrega estimada: {fmtDate(pedido.fecha_entrega_estimada)}</div>}
        </div>

        {loading&&<div className="spin" style={{width:28,height:28,margin:'20px auto'}}/>}
        {!loading&&pitems.length===0&&<div className="empty"><div className="empty-icon">📋</div><div className="empty-text">Este pedido no tiene ítems</div></div>}

        {!loading&&pitems.length>0&&(
          <div style={{display:'flex',gap:8,marginBottom:12}}>
            <button className="btn btn-ghost btn-sm" style={{flex:1}} onClick={()=>{
              setPitems(p=>p.map(x=>({...x,qty_despacho:String(x.cantidad_solicitada||0)})));
              requestAnimationFrame(()=>bottomRef.current?.scrollIntoView({behavior:'smooth',block:'end'}));
            }}>✅ Todo Solicitado</button>
            <button className="btn btn-ghost btn-sm" style={{flex:1}} onClick={()=>{
              setPitems(p=>p.map(x=>({...x,qty_despacho:'0'})));
            }}>🔄 Limpiar</button>
          </div>
        )}

        {!loading&&grouped.map(([categoria,items])=>(
          <div key={categoria} style={{marginBottom:16}}>
            <div className="sec-title">{categoria}</div>
            {items.map((it,i)=>(
              <div key={it.id} className="item-row">
                <div style={{fontWeight:600,fontSize:14,marginBottom:8}}>
                  {it.catalogo_productos?.nombre||`Ítem ${i+1}`}
                </div>
                <div style={{fontSize:12,color:'#666',marginBottom:10}}>
                  Solicitado: <strong style={{color:'#f0f0f0'}}>{it.cantidad_solicitada} {it.catalogo_productos?.unidad_medida||''}</strong>
                  <span style={{marginLeft:10,color:'#888'}}>· Conteo suc.: <strong style={{color:'#fbbf24'}}>{n(it.conteo||0)}</strong></span>
                  <span style={{marginLeft:10,color:'#888'}}>· Resultante: <strong style={{color:'#4ade80'}}>{n(it.conteo||0)+n(it.qty_despacho||0)}</strong></span>
                </div>
                <div>
                  <label>Cantidad a despachar</label>
                  <div className="num-input">
                    <button className="num-btn" onClick={()=>{
                      const idx=pitems.findIndex(x=>x.id===it.id);
                      const v=Math.max(0,n(pitems[idx].qty_despacho)-1);
                      setPitems(p=>p.map((x,j)=>j===idx?{...x,qty_despacho:String(v)}:x));
                    }}>−</button>
                    <input type="number" className="num-field" value={it.qty_despacho}
                      onChange={e=>{
                        const idx=pitems.findIndex(x=>x.id===it.id);
                        setPitems(p=>p.map((x,j)=>j===idx?{...x,qty_despacho:e.target.value}:x));
                      }} min="0" step="0.01"/>
                    <button className="num-btn" onClick={()=>{
                      const idx=pitems.findIndex(x=>x.id===it.id);
                      const v=n(pitems[idx].qty_despacho)+1;
                      setPitems(p=>p.map((x,j)=>j===idx?{...x,qty_despacho:String(v)}:x));
                    }}>+</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}

        {!loading&&pitems.length>0&&<>
          <div className="field" style={{marginTop:16}}>
            <label>🚚 Motorista asignado</label>
            <select value={motorista} onChange={e=>setMotorista(e.target.value)} style={{width:'100%',padding:'12px',background:'#1a1a1a',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:14}}>
              <option value="">— Seleccionar motorista —</option>
              {motoristas.map(m=><option key={m.id} value={m.nombre}>{m.nombre}</option>)}
            </select>
          </div>
          <div ref={bottomRef} style={{display:'flex',gap:8}}>
            <button className="btn btn-orange" style={{flex:1}} onClick={despachar} disabled={saving||!motorista.trim()}>
              {saving?'Creando despacho...':'📦 Crear Despacho'}
            </button>
            <button className="btn btn-ghost" style={{flex:'0 0 auto',padding:'14px 18px'}} onClick={()=>{
              const ORDEN=['Carnes y Complementos','Panes y Harinas','Quesos y Lácteos','Vegetales y Verduras','Salsas y Aderezos','Papas y Congelados','Bebidas','Empaques y Desechables','Utensilios de Limpieza','Extras'];
              const gs={};
              pitems.forEach(it=>{
                const cat=it.catalogo_productos?.conteo_categoria||it.catalogo_productos?.categoria||'Otros';
                if(!gs[cat])gs[cat]=[];
                gs[cat].push({nombre:it.catalogo_productos?.nombre||'Producto',presentacion:it.catalogo_productos?.presentacion_pedido||'',unidad:it.catalogo_productos?.unidad_medida||it.unidad||'',solicitado:n(it.cantidad_solicitada||0),costo_unitario:it.costo_erp});
              });
              const g=Object.entries(gs).sort((a,b)=>{const ia=ORDEN.findIndex(o=>o.toLowerCase()===a[0].toLowerCase());const ib=ORDEN.findIndex(o=>o.toLowerCase()===b[0].toLowerCase());return(ia===-1?999:ia)-(ib===-1?999:ib);});
              imprimirHojaDespacho({
                sucursal:pedido.sucursales?.nombre||pedido.sucursal_id,
                fecha:new Date().toLocaleDateString('es-SV',{day:'2-digit',month:'short',year:'numeric'}),
                motorista,
                grouped:g
              });
            }}>🖨️</button>
          </div>
        </>}
      </div>
    </div>
  );
}
