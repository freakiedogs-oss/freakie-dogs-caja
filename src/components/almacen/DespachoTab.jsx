import { useState, useEffect, useMemo } from 'react';
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
        db.from('pedidos_sucursal').select('*,sucursales(nombre)').eq('estado','enviado').order('created_at',{ascending:false}),
        db.from('despachos_sucursal').select('*,sucursales(nombre)').in('estado',['preparando','despachado','en_ruta','recibido']).order('created_at',{ascending:false}).limit(50),
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
        {pedidos.length===0&&<div className="empty"><div className="empty-icon">📋</div><div className="empty-text">No hay pedidos pendientes</div></div>}
        {pedidos.map(p=>(
          <div key={p.id} className="card">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
              <div>
                <div style={{fontWeight:700,fontSize:15}}>{p.sucursales?.nombre||p.sucursal_id}</div>
                <div style={{color:'#666',fontSize:12,marginTop:2}}>Pedido: {fmtDate(p.fecha_pedido)}</div>
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
      const {data}=await db.from('despacho_items').select('*').eq('despacho_id',despacho.id);
      setItems(data||[]);
    }catch(e){show('❌ '+e.message);}
    setLoadingItems(false);
  };

  const marcarDespachado=async()=>{
    setSaving(true);
    try{
      await db.from('despachos_sucursal').update({estado:'despachado',hora_salida:new Date().toISOString()}).eq('id',despacho.id);
      show('✅ Despacho marcado como despachado');
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
    if(items.length===0) await cargarItems();
    const its=items.length>0?items:[];
    const groups={};
    its.forEach(it=>{const cat='General';if(!groups[cat])groups[cat]=[];groups[cat].push(it);});
    const grouped=Object.entries(groups).map(([cat,arr])=>[cat,arr.map(it=>({qty_despacho:it.cantidad_despachada,catalogo_productos:{nombre:it.descripcion,unidad_medida:it.unidad_medida}}))]);
    imprimirHojaDespacho({
      sucursal:despacho.sucursales?.nombre||'',
      fecha:fmtDate(despacho.fecha_despacho),
      motorista:despacho.motorista_nombre||'—',
      items:its,
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

// ── IMPRIMIR HOJA DE DESPACHO ─────────────────────────────────
function imprimirHojaDespacho({sucursal,fecha,motorista,items,grouped}){
  const rows=grouped.map(([cat,its])=>
    `<tr><td colspan="4" style="background:#eee;font-weight:700;padding:6px 8px;font-size:13px">${cat}</td></tr>`+
    its.filter(it=>parseFloat(it.qty_despacho)>0).map(it=>
      `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd">${it.catalogo_productos?.nombre||'Producto'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:center">${it.qty_despacho} ${it.catalogo_productos?.unidad_medida||''}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:center;width:80px"></td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;width:120px"></td>
      </tr>`
    ).join('')
  ).join('');
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Despacho ${sucursal}</title>
    <style>@media print{@page{margin:12mm}body{font-family:Arial,sans-serif;font-size:14px;color:#000}}
    body{font-family:Arial,sans-serif;font-size:14px}table{width:100%;border-collapse:collapse;margin-top:12px}
    th{background:#333;color:#fff;padding:8px;text-align:left;font-size:13px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}
    .logo{font-size:22px;font-weight:900}.firma{margin-top:40px;display:flex;justify-content:space-between;gap:40px}
    .firma-box{flex:1;text-align:center;border-top:1px solid #000;padding-top:8px;font-size:12px}</style></head>
    <body>
    <div class="header"><div><div class="logo">🍔 FREAKIE DOGS</div><div style="font-size:12px;color:#666">Hoja de Despacho</div></div>
    <div style="text-align:right"><div><strong>Destino:</strong> ${sucursal}</div>
    <div><strong>Fecha:</strong> ${fecha}</div>
    <div><strong>Motorista:</strong> ${motorista||'—'}</div></div></div>
    <table><thead><tr><th>Producto</th><th style="text-align:center">Cant. Despachada</th><th style="text-align:center">Recibido</th><th>Observaciones</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div style="margin-top:20px;padding:10px;border:1px dashed #999;border-radius:6px;font-size:12px;color:#666">
    <strong>Notas generales:</strong>_______________________________________________</div>
    <div class="firma"><div class="firma-box">Preparado por (Bodega)</div><div class="firma-box">Motorista</div><div class="firma-box">Recibido por (Sucursal)</div></div>
    <div style="text-align:center;margin-top:20px;font-size:10px;color:#999">Documento generado por Freakie Dogs ERP — ${new Date().toLocaleString('es-SV')}</div>
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

  useEffect(()=>{
    // Get CM001 sucursal ID
    db.from('sucursales').select('id').eq('store_code','CM001').maybeSingle()
      .then(({data})=>{
        if(data) setCmId(data.id);
      });
    // Load pedido items
    db.from('pedido_items').select('*,catalogo_productos(nombre,unidad_medida,categoria,precio_referencia)').eq('pedido_id',pedido.id)
      .then(({data})=>{
        setPitems((data||[]).map(it=>({...it,qty_despacho:String(it.cantidad_solicitada||0)})));
        setLoading(false);
      });
  },[pedido.id]);

  const despachar=async()=>{
    if(!cmId){show('❌ No se encontró Casa Matriz');return;}
    if(!motorista.trim()){show('⚠️ Ingresa el nombre del motorista');return;}
    setSaving(true);
    try{
      // 1. Crear despacho_sucursal
      const {data:des,error:desErr}=await db.from('despachos_sucursal').insert({
        sucursal_id:pedido.sucursal_id,
        pedido_id:pedido.id,
        fecha_despacho:today(),
        estado:'preparando',
        preparado_por:user.id,
        motorista_nombre:motorista.trim(),
      }).select().single();
      if(desErr) throw desErr;

      // 2. Crear despacho_items (with pricing)
      const rows=[];
      for(const it of pitems){
        const qty=n(it.qty_despacho);
        if(qty<=0) continue;

        // Get costo_unitario from inventario or use precio_referencia
        let costo=it.catalogo_productos?.precio_referencia||0;
        if(it.producto_id&&cmId){
          const {data:inv}=await db.from('inventario').select('stock_actual').eq('producto_id',it.producto_id).eq('sucursal_id',cmId).maybeSingle();
          // For now, use catalogo price; real cost tracking could be more sophisticated
        }

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

        // 3. Decrement inventario.stock_actual for CM001
        for(const it of pitems){
          if(!it.producto_id||n(it.qty_despacho)<=0) continue;
          // Fetch current stock and decrement (Supabase JS v2 does not support db.raw())
          const {data:current}=await db.from('inventario').select('stock_actual').eq('producto_id',it.producto_id).eq('sucursal_id',cmId).maybeSingle();
          const newStock=n(current?.stock_actual||0)-n(it.qty_despacho);
          await db.from('inventario').update({
            stock_actual:newStock
          }).eq('producto_id',it.producto_id).eq('sucursal_id',cmId);
        }
      }

      // 4. Update pedido_items.cantidad_despachada and pedido estado
      for(const it of pitems){
        if(n(it.qty_despacho)>0){
          await db.from('pedido_items').update({cantidad_despachada:n(it.qty_despacho)}).eq('id',it.id);
        }
      }
      await db.from('pedidos_sucursal').update({estado:'despachado'}).eq('id',pedido.id);

      show('✅ Despacho creado — en proceso');
      onBack();
    }catch(e){ show('❌ '+e.message); }
    setSaving(false);
  };

  // Group items by category
  const grouped=useMemo(()=>{
    const groups={};
    pitems.forEach(it=>{
      const cat=it.catalogo_productos?.categoria||'Otros';
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
          <div style={{fontSize:12,color:'#60a5fa',fontWeight:600}}>Pedido: {fmtDate(pedido.fecha_pedido)}</div>
          {pedido.fecha_entrega_estimada&&<div style={{fontSize:11,color:'#888',marginTop:2}}>Entrega estimada: {fmtDate(pedido.fecha_entrega_estimada)}</div>}
        </div>

        {loading&&<div className="spin" style={{width:28,height:28,margin:'20px auto'}}/>}
        {!loading&&pitems.length===0&&<div className="empty"><div className="empty-icon">📋</div><div className="empty-text">Este pedido no tiene ítems</div></div>}

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
            <input type="text" value={motorista} onChange={e=>setMotorista(e.target.value)} placeholder="Nombre del motorista"/>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-orange" style={{flex:1}} onClick={despachar} disabled={saving||!motorista.trim()}>
              {saving?'Creando despacho...':'📦 Crear Despacho'}
            </button>
            <button className="btn btn-ghost" style={{flex:'0 0 auto',padding:'14px 18px'}} onClick={()=>{
              imprimirHojaDespacho({
                sucursal:pedido.sucursales?.nombre||pedido.sucursal_id,
                fecha:new Date().toLocaleDateString('es-SV',{day:'2-digit',month:'short',year:'numeric'}),
                motorista,
                items:pitems,
                grouped
              });
            }}>🖨️</button>
          </div>
        </>}
      </div>
    </div>
  );
}
