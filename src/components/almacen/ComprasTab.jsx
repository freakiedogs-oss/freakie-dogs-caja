import { useState, useEffect } from 'react';
import { db } from '../../supabase';
import { fmtDate, n } from '../../config';
import { useToast } from '../../hooks/useToast';

// ── COMPRAS / ÓRDENES DE COMPRA ───────────────────────────────
export default function ComprasTab({user,show}){
  const [vista,setVista]=useState('lista'); // lista | nueva | detalle
  const [ordenes,setOrdenes]=useState([]);
  const [loading,setLoading]=useState(true);
  const [ocSeleccionada,setOcSeleccionada]=useState(null);

  const cargar=()=>{
    setLoading(true);
    db.from('ordenes_compra').select('*')
      .order('created_at',{ascending:false}).limit(30)
      .then(({data})=>{setOrdenes(data||[]);setLoading(false);});
  };
  useEffect(()=>{cargar();},[]);

  if(vista==='nueva') return <NuevaOC user={user} show={show} onBack={()=>{setVista('lista');cargar();}}/>;
  if(vista==='detalle'&&ocSeleccionada) return <DetalleOC oc={ocSeleccionada} user={user} show={show} onBack={()=>{setVista('lista');setOcSeleccionada(null);cargar();}}/>;

  const badgeColor=(e)=>({borrador:'#555',pendiente_aprobacion:'#f4a261',aprobada:'#4ade80',parcial_recibida:'#60a5fa',recibida:'#22c55e',cancelada:'#e63946'}[e]||'#555');

  return(
    <div style={{padding:'16px 16px 100px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
        <div className="sec-title" style={{marginBottom:0}}>Órdenes de Compra</div>
        <button className="btn btn-green btn-sm" onClick={()=>setVista('nueva')}>+ Nueva OC</button>
      </div>
      {loading&&<div className="spin" style={{width:28,height:28,margin:'20px auto'}}/>}
      {!loading&&ordenes.length===0&&(
        <div className="empty"><div className="empty-icon">📝</div><div className="empty-text">Sin órdenes aún</div>
        <div style={{fontSize:12,color:'#555',marginTop:8}}>Crea tu primera orden de compra</div></div>
      )}
      {ordenes.map(oc=>(
        <div key={oc.id} className="card" style={{padding:'12px 14px',cursor:'pointer'}} onClick={()=>{setOcSeleccionada(oc);setVista('detalle');}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:14}}>{oc.proveedor||'Sin proveedor'}</div>
              <div style={{fontSize:12,color:'#666',marginTop:2}}>OC-{String(oc.numero_oc||'').padStart(4,'0')} · {fmtDate(oc.fecha_emision)}</div>
              {oc.total_items>0&&<div style={{fontSize:11,color:'#888',marginTop:2}}>{oc.total_items} items · ${Number(oc.total_estimado||0).toFixed(2)}</div>}
            </div>
            <span style={{fontSize:11,fontWeight:600,padding:'3px 8px',borderRadius:6,color:'#fff',background:badgeColor(oc.estado)}}>
              {oc.estado==='pendiente_aprobacion'?'Pendiente':oc.estado.charAt(0).toUpperCase()+oc.estado.slice(1).replace('_',' ')}
            </span>
          </div>
          {oc.notas&&<div style={{fontSize:12,color:'#888',marginTop:4}}>{oc.notas}</div>}
        </div>
      ))}
    </div>
  );
}

// ── NUEVA ORDEN DE COMPRA ─────────────────────────────────────
function NuevaOC({user,show,onBack}){
  const [proveedorId,setProveedorId]=useState('');
  const [proveedorNombre,setProveedorNombre]=useState('');
  const [provSearch,setProvSearch]=useState('');
  const [provResults,setProvResults]=useState([]);
  const [items,setItems]=useState([]);
  const [notas,setNotas]=useState('');
  const [fechaEntrega,setFechaEntrega]=useState('');
  const [saving,setSaving]=useState(false);
  const [loadingSugerencias,setLoadingSugerencias]=useState(false);

  // Buscar proveedores
  useEffect(()=>{
    if(provSearch.length<2){setProvResults([]);return;}
    const t=setTimeout(()=>{
      db.from('proveedores').select('id,nombre').eq('activo',true)
        .ilike('nombre','%'+provSearch+'%').limit(8)
        .then(({data})=>setProvResults(data||[]));
    },300);
    return ()=>clearTimeout(t);
  },[provSearch]);

  // Al seleccionar proveedor, cargar sugerencias
  const seleccionarProveedor=async(prov)=>{
    setProveedorId(prov.id);
    setProveedorNombre(prov.nombre);
    setProvSearch('');
    setProvResults([]);
    setLoadingSugerencias(true);
    const {data}=await db.rpc('sugerir_compra_proveedor',{p_proveedor_id:prov.id});
    if(data&&data.length>0){
      setItems(data.map(d=>({
        prodId:d.producto_id, nombre:d.nombre, unidad:d.unidad||'',
        cantidad:d.cantidad_sugerida>0?String(d.cantidad_sugerida):'',
        precio:d.precio_unitario>0?String(d.precio_unitario):'',
        stockActual:d.stock_actual, stockMin:d.stock_minimo, sugerido:d.cantidad_sugerida,
        incluir:d.cantidad_sugerida>0 // pre-check solo los que necesitan reposición
      })));
    } else {
      setItems([]);
      show('Este proveedor no tiene productos asociados');
    }
    setLoadingSugerencias(false);
  };

  const toggleItem=(idx)=>{
    const u=[...items]; u[idx].incluir=!u[idx].incluir; setItems(u);
  };
  const setCantidad=(idx,v)=>{
    const u=[...items]; u[idx].cantidad=v; setItems(u);
  };

  const itemsIncluidos=items.filter(it=>it.incluir&&n(it.cantidad)>0);
  const totalEstimado=itemsIncluidos.reduce((s,it)=>s+n(it.cantidad)*n(it.precio),0);

  const guardar=async()=>{
    if(!proveedorId){show('Selecciona un proveedor');return;}
    if(itemsIncluidos.length===0){show('Agrega al menos un item');return;}
    setSaving(true);
    try{
      // 1. Crear OC
      const {data:oc,error:e1}=await db.from('ordenes_compra').insert({
        proveedor:proveedorNombre,
        proveedor_id:proveedorId,
        fecha_emision:new Date().toISOString().slice(0,10),
        fecha_entrega_esperada:fechaEntrega||null,
        estado:'pendiente_aprobacion',
        total_estimado:totalEstimado,
        total_items:itemsIncluidos.length,
        creada_por:user.id,
        notas:notas.trim()||null
      }).select().single();
      if(e1) throw e1;

      // 2. Insertar items
      const rows=itemsIncluidos.map(it=>({
        orden_id:oc.id,
        producto_id:it.prodId,
        descripcion:it.nombre,
        unidad:it.unidad,
        cantidad_solicitada:n(it.cantidad),
        precio_unitario_estimado:n(it.precio)||null,
        stock_actual_al_crear:n(it.stockActual),
        stock_minimo:n(it.stockMin),
        cantidad_sugerida:n(it.sugerido)
      }));
      const {error:e2}=await db.from('ordenes_compra_items').insert(rows);
      if(e2) throw e2;

      show('✅ OC-'+String(oc.numero_oc).padStart(4,'0')+' creada — pendiente de aprobación');
      onBack();
    }catch(e){show('❌ '+e.message);}
    setSaving(false);
  };

  return(
    <div style={{padding:'16px 16px 100px'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Volver</button>
        <div className="sec-title" style={{marginBottom:0}}>Nueva Orden de Compra</div>
      </div>

      {/* Proveedor */}
      <div className="field">
        <label>Proveedor *</label>
        {proveedorId?(
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{flex:1,padding:'10px 12px',background:'#1a1a1a',borderRadius:8,fontWeight:600}}>{proveedorNombre}</div>
            <button className="btn btn-ghost btn-sm" onClick={()=>{setProveedorId('');setProveedorNombre('');setItems([]);}}>Cambiar</button>
          </div>
        ):(
          <div style={{position:'relative'}}>
            <input type="text" value={provSearch} onChange={e=>setProvSearch(e.target.value)} placeholder="Buscar proveedor..." autoFocus/>
            {provResults.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#1a1a1a',border:'1px solid #333',borderRadius:8,zIndex:10,maxHeight:200,overflowY:'auto'}}>
                {provResults.map(p=>(
                  <div key={p.id} style={{padding:'10px 12px',borderBottom:'1px solid #222',cursor:'pointer'}} onClick={()=>seleccionarProveedor(p)}>
                    {p.nombre}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fecha entrega */}
      <div className="field">
        <label>Fecha entrega esperada</label>
        <input type="date" value={fechaEntrega} onChange={e=>setFechaEntrega(e.target.value)}/>
      </div>

      {/* Notas */}
      <div className="field">
        <label>Notas (opcional)</label>
        <input type="text" value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Observaciones"/>
      </div>

      {/* Loading sugerencias */}
      {loadingSugerencias&&<div style={{textAlign:'center',padding:20}}><div className="spin" style={{width:24,height:24,margin:'0 auto'}}/><div style={{fontSize:12,color:'#555',marginTop:8}}>Cargando productos del proveedor...</div></div>}

      {/* Items del proveedor */}
      {!loadingSugerencias&&items.length>0&&(
        <div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div className="sec-title" style={{marginBottom:0}}>PRODUCTOS ({itemsIncluidos.length} seleccionados)</div>
          </div>
          <div style={{fontSize:11,color:'#f4a261',marginBottom:8}}>
            Items con stock bajo mínimo están pre-seleccionados con cantidad sugerida
          </div>
          {items.map((it,i)=>(
            <div key={i} style={{padding:'10px 12px',background:it.incluir?'#1a2a1a':'#111',border:'1px solid '+(it.incluir?'#2a4a2a':'#1e1e1e'),borderRadius:10,marginBottom:6}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <input type="checkbox" checked={it.incluir} onChange={()=>toggleItem(i)} style={{width:18,height:18}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500}}>{it.nombre}</div>
                  <div style={{fontSize:11,color:'#666'}}>
                    {it.unidad} · Stock: {it.stockActual}{it.stockMin>0?' · Mín: '+it.stockMin:''}
                    {it.precio>0?' · $'+Number(it.precio).toFixed(2):''}
                  </div>
                </div>
              </div>
              {it.incluir&&(
                <div style={{display:'flex',gap:8,marginTop:8,marginLeft:26}}>
                  <div style={{flex:1}}>
                    <input type="number" value={it.cantidad} onChange={e=>setCantidad(i,e.target.value)}
                      placeholder="Cant." inputMode="decimal" style={{textAlign:'center',fontWeight:600}}/>
                  </div>
                  {it.sugerido>0&&n(it.cantidad)!==n(it.sugerido)&&(
                    <button className="btn btn-ghost btn-sm" style={{fontSize:11}} onClick={()=>setCantidad(i,String(it.sugerido))}>
                      Sugerido: {it.sugerido}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Total y botón guardar */}
          <div style={{marginTop:16,padding:'12px',background:'#1a1a1a',borderRadius:10,textAlign:'center'}}>
            <div style={{fontSize:12,color:'#888'}}>Total estimado</div>
            <div style={{fontSize:22,fontWeight:800,color:'#4ade80'}}>${totalEstimado.toFixed(2)}</div>
            <div style={{fontSize:11,color:'#555'}}>{itemsIncluidos.length} items</div>
          </div>
          <button className="btn btn-green" style={{width:'100%',padding:'14px',fontSize:15,fontWeight:700,marginTop:12}}
            onClick={guardar} disabled={saving||itemsIncluidos.length===0}>
            {saving?'Guardando...':'📝 Crear OC — Enviar a Aprobación'}
          </button>
        </div>
      )}

      {!loadingSugerencias&&proveedorId&&items.length===0&&(
        <div className="empty"><div className="empty-icon">📦</div><div className="empty-text">Sin productos para este proveedor</div></div>
      )}
    </div>
  );
}

// ── DETALLE ORDEN DE COMPRA ───────────────────────────────────
function DetalleOC({oc,user,show,onBack}){
  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [estado,setEstado]=useState(oc.estado);

  useEffect(()=>{
    db.from('ordenes_compra_items').select('*').eq('orden_id',oc.id)
      .order('created_at').then(({data})=>{setItems(data||[]);setLoading(false);});
  },[]);

  const aprobar=async()=>{
    if(!confirm('¿Aprobar esta orden de compra?')) return;
    setSaving(true);
    try{
      await db.from('ordenes_compra').update({
        estado:'aprobada',
        fecha_aprobacion:new Date().toISOString(),
        aprobada_por:user.id,
        updated_at:new Date().toISOString()
      }).eq('id',oc.id);
      setEstado('aprobada');
      show('✅ OC aprobada — disponible para recepción');
    }catch(e){show('❌ '+e.message);}
    setSaving(false);
  };

  const cancelar=async()=>{
    if(!confirm('¿Cancelar esta orden de compra?')) return;
    setSaving(true);
    try{
      await db.from('ordenes_compra').update({
        estado:'cancelada',
        updated_at:new Date().toISOString()
      }).eq('id',oc.id);
      setEstado('cancelada');
      show('❌ OC cancelada');
    }catch(e){show('❌ '+e.message);}
    setSaving(false);
  };

  const badgeColor=(e)=>({borrador:'#555',pendiente_aprobacion:'#f4a261',aprobada:'#4ade80',parcial_recibida:'#60a5fa',recibida:'#22c55e',cancelada:'#e63946'}[e]||'#555');

  return(
    <div style={{padding:'16px 16px 100px'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Volver</button>
        <div className="sec-title" style={{marginBottom:0}}>OC-{String(oc.numero_oc||'').padStart(4,'0')}</div>
        <span style={{fontSize:11,fontWeight:600,padding:'3px 8px',borderRadius:6,color:'#fff',background:badgeColor(estado)}}>
          {estado==='pendiente_aprobacion'?'Pendiente':estado.charAt(0).toUpperCase()+estado.slice(1).replace('_',' ')}
        </span>
      </div>

      {/* Info */}
      <div className="card" style={{padding:'12px 14px',marginBottom:12}}>
        <div style={{fontWeight:600,fontSize:15}}>{oc.proveedor}</div>
        <div style={{fontSize:12,color:'#666',marginTop:4}}>
          Creada: {fmtDate(oc.fecha_emision)}
          {oc.fecha_entrega_esperada&&' · Entrega: '+fmtDate(oc.fecha_entrega_esperada)}
        </div>
        {oc.fecha_aprobacion&&<div style={{fontSize:12,color:'#4ade80',marginTop:2}}>Aprobada: {fmtDate(oc.fecha_aprobacion)}</div>}
        {oc.notas&&<div style={{fontSize:12,color:'#888',marginTop:4}}>{oc.notas}</div>}
        <div style={{fontSize:14,fontWeight:700,color:'#4ade80',marginTop:8}}>${Number(oc.total_estimado||0).toFixed(2)} · {oc.total_items} items</div>
      </div>

      {/* Items */}
      <div className="sec-title">PRODUCTOS</div>
      {loading&&<div className="spin" style={{width:24,height:24,margin:'12px auto'}}/>}
      {items.map(it=>(
        <div key={it.id} style={{padding:'8px 0',borderBottom:'1px solid #1a1a1a',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:500}}>{it.descripcion}</div>
            <div style={{fontSize:11,color:'#555'}}>
              {it.unidad}{it.precio_unitario_estimado?' · $'+Number(it.precio_unitario_estimado).toFixed(2):''}
              {it.stock_actual_al_crear!=null?' · Stock era: '+it.stock_actual_al_crear:''}
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontWeight:600,fontSize:14}}>{it.cantidad_solicitada}</div>
            {it.cantidad_recibida>0&&<div style={{fontSize:11,color:'#4ade80'}}>Recibido: {it.cantidad_recibida}</div>}
          </div>
        </div>
      ))}

      {/* Acciones */}
      {estado==='pendiente_aprobacion'&&(user.rol==='admin'||user.rol==='bodeguero')&&(
        <div style={{display:'flex',gap:8,marginTop:16}}>
          <button className="btn btn-green" style={{flex:1,padding:'12px',fontSize:14}} onClick={aprobar} disabled={saving}>
            ✅ Aprobar OC
          </button>
          <button className="btn btn-danger" style={{flex:1,padding:'12px',fontSize:14}} onClick={cancelar} disabled={saving}>
            ❌ Cancelar
          </button>
        </div>
      )}
      {estado==='aprobada'&&(
        <div style={{marginTop:16,padding:'12px',background:'#1a2a1a',border:'1px solid #2a4a2a',borderRadius:10,textAlign:'center'}}>
          <div style={{fontSize:13,color:'#4ade80',fontWeight:600}}>✅ OC Aprobada — Lista para recepción</div>
          <div style={{fontSize:11,color:'#555',marginTop:4}}>Al crear una nueva recepción con este proveedor, los items se precargarán</div>
        </div>
      )}
      {estado==='recibida'&&oc.recepcion_id&&(
        <div style={{marginTop:16,padding:'12px',background:'#1a2a1a',border:'1px solid #2a4a2a',borderRadius:10,textAlign:'center'}}>
          <div style={{fontSize:13,color:'#22c55e',fontWeight:600}}>📦 Recepción completada</div>
        </div>
      )}
    </div>
  );
}
