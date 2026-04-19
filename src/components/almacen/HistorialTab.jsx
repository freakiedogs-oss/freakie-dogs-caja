import { useState, useEffect, useRef } from 'react';
import { db } from '../../supabase';
import { STORES, today, fmtDate, n } from '../../config';
import { BUCKET_CIERRES as BUCKET } from '../../config';
import { useToast } from '../../hooks/useToast';
import { Badge } from '../ui/Badge';
import { NuevoProveedorModal, NuevoProductoModal } from './shared';

export default function HistorialTab({user,show}){
  const [recs,setRecs]=useState([]);
  const [loading,setLoading]=useState(true);
  const [expandedId,setExpandedId]=useState(null);
  const [items,setItems]=useState([]);
  const [loadingItems,setLoadingItems]=useState(false);
  const [saving,setSaving]=useState(false);
  const [cmId,setCmId]=useState(null);
  const [editRec,setEditRec]=useState(null);
  // Cruces pendientes
  const [pendientes,setPendientes]=useState([]);
  const [showPendientes,setShowPendientes]=useState(false);
  const [loadingPend,setLoadingPend]=useState(false);
  const [pendCount,setPendCount]=useState(0);
  const [pendItems,setPendItems]=useState({}); // {recepcion_id:[items]}
  const [expPendId,setExpPendId]=useState(null); // DTE id expandido
  // Recepciones huérfanas (sin DTE en compras)
  const [huerfanas,setHuerfanas]=useState([]);
  const [showHuerfanas,setShowHuerfanas]=useState(false);

  const cargar=async()=>{
    const {data:allRecs}=await db.from('recepciones').select('*')
      .order('created_at',{ascending:false}).limit(30);
    setRecs(allRecs||[]);setLoading(false);
    // Cargar count de pendientes
    db.from('compras_dte').select('id',{count:'exact',head:true})
      .eq('revision_manual',true).eq('cruzado',false)
      .then(({count})=>setPendientes(prev=>count>0?prev:[]));
    // Detectar huérfanas: recepciones con dte_codigo que NO existe en compras_dte
    if(allRecs&&allRecs.length>0){
      const conDte=(allRecs||[]).filter(r=>r.dte_codigo);
      if(conDte.length>0){
        const codigos=[...new Set(conDte.map(r=>r.dte_codigo))];
        const {data:dtes}=await db.from('compras_dte').select('dte_codigo').in('dte_codigo',codigos);
        const existentes=new Set((dtes||[]).map(d=>d.dte_codigo));
        const sinDte=conDte.filter(r=>!existentes.has(r.dte_codigo));
        setHuerfanas(sinDte);
      }
    }
  };
  const cargarPendientes=async()=>{
    setLoadingPend(true);
    const {data}=await db.from('compras_dte').select('*,recepcion_candidata:recepciones!compras_dte_recepcion_candidata_id_fkey(*)')
      .eq('revision_manual',true).eq('cruzado',false)
      .order('fecha_emision',{ascending:false});
    setPendientes(data||[]);
    // Batch cargar items de TODAS las recepciones candidatas
    const recIds=[...new Set((data||[]).map(d=>d.recepcion_candidata_id).filter(Boolean))];
    if(recIds.length>0){
      const {data:itms}=await db.from('recepcion_items').select('*').in('recepcion_id',recIds);
      const byRec={};
      (itms||[]).forEach(it=>{(byRec[it.recepcion_id]=byRec[it.recepcion_id]||[]).push(it);});
      setPendItems(byRec);
    }
    setLoadingPend(false);
  };
  // Extraer items del JSON DTE (cuerpoDocumento del DTE SV)
  const dteItems=(dte)=>{
    const cuerpo=dte?.json_original?.cuerpoDocumento;
    if(!Array.isArray(cuerpo)) return [];
    return cuerpo.map(it=>({
      desc:it.descripcion||'(sin descripción)',
      cant:Number(it.cantidad)||0,
      precio:Number(it.precioUni)||0,
      subtotal:Number(it.ventaGravada)||0
    }));
  };
  const aprobarCruce=async(dte)=>{
    setSaving(true);
    try{
      await db.from('compras_dte').update({
        cruzado:true,
        recepcion_id:dte.recepcion_candidata_id,
        revision_manual:false,
        notas_revision:'Aprobado manualmente',
        updated_at:new Date().toISOString()
      }).eq('id',dte.id);
      show('✅ Cruce aprobado');
      cargarPendientes();
    }catch(e){show('❌ '+e.message);}
    setSaving(false);
  };
  const rechazarCruce=async(dte)=>{
    setSaving(true);
    try{
      await db.from('compras_dte').update({
        revision_manual:false,
        recepcion_candidata_id:null,
        notas_revision:'Rechazado — no son el mismo DTE',
        updated_at:new Date().toISOString()
      }).eq('id',dte.id);
      show('❌ Cruce rechazado');
      cargarPendientes();
    }catch(e){show('❌ '+e.message);}
    setSaving(false);
  };

  useEffect(()=>{
    cargar();
    db.from('sucursales').select('id').eq('store_code','CM001').maybeSingle().then(({data})=>{if(data)setCmId(data.id);});
  },[]);

  const horasDesde=(d)=>(Date.now()-new Date(d).getTime())/3600000;
  const esEditable=(r)=>horasDesde(r.created_at)<72;

  const toggleExpand=async(recId)=>{
    if(expandedId===recId){setExpandedId(null);return;}
    setExpandedId(recId);
    setLoadingItems(true);
    const {data}=await db.from('recepcion_items').select('*').eq('recepcion_id',recId);
    setItems((data||[]).map(it=>({...it,qty_edit:String(it.cantidad_recibida)})));
    setLoadingItems(false);
  };

  const eliminarRecepcion=async(rec)=>{
    if(!confirm('¿Eliminar esta recepción por completo? Se revertirá el inventario.')){return;}
    setSaving(true);
    try{
      // 1. Obtener items para revertir inventario
      const {data:recItems}=await db.from('recepcion_items').select('*').eq('recepcion_id',rec.id);
      // 2. Revertir inventario
      for(const it of (recItems||[])){
        if(!it.producto_id||!cmId) continue;
        const {data:inv}=await db.from('inventario').select('id,stock_actual')
          .eq('producto_id',it.producto_id).eq('sucursal_id',cmId).maybeSingle();
        if(inv){
          await db.from('inventario').update({
            stock_actual:Math.max(0,parseFloat(inv.stock_actual)-parseFloat(it.cantidad_recibida)),
            ultima_actualizacion:new Date().toISOString()
          }).eq('id',inv.id);
        }
      }
      // 3. Borrar items
      await db.from('recepcion_items').delete().eq('recepcion_id',rec.id);
      // 4. Borrar recepción
      await db.from('recepciones').delete().eq('id',rec.id);
      show('🗑️ Recepción eliminada e inventario revertido');
      setExpandedId(null);
      cargar();
    }catch(e){show('❌ '+e.message);}
    setSaving(false);
  };

  useEffect(()=>{
    db.from('compras_dte').select('id',{count:'exact',head:true})
      .eq('revision_manual',true).eq('cruzado',false)
      .then(({count})=>setPendCount(count||0));
  },[pendientes]);

  // Si estamos editando, mostrar EditarRecepcion (DESPUÉS de todos los hooks)
  if(editRec) return <EditarRecepcion rec={editRec} cmId={cmId} show={show} onBack={()=>{setEditRec(null);setExpandedId(null);cargar();}}/>;

  return(
    <div style={{padding:'16px 16px 100px'}}>
      {/* Banner de cruces pendientes */}
      {pendCount>0&&(
        <div style={{background:'linear-gradient(135deg,#2a1800,#3d2200)',border:'1px solid #f4a261',borderRadius:12,padding:'12px 14px',marginBottom:14,cursor:'pointer'}}
          onClick={()=>{setShowPendientes(!showPendientes);if(!showPendientes&&pendientes.length===0)cargarPendientes();}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:'#f4a261'}}>⚠️ {pendCount} cruce{pendCount>1?'s':''} pendiente{pendCount>1?'s':''}</div>
              <div style={{fontSize:11,color:'#b8860b',marginTop:2}}>DTE de correo con match parcial — requiere tu revisión</div>
            </div>
            <span style={{color:'#f4a261',fontSize:16}}>{showPendientes?'▲':'▼'}</span>
          </div>
        </div>
      )}
      {/* Banner recepciones sin DTE contabilizado */}
      {huerfanas.length>0&&(
        <div style={{background:'linear-gradient(135deg,#2a0000,#3d0000)',border:'1px solid #e63946',borderRadius:12,padding:'12px 14px',marginBottom:14,cursor:'pointer'}}
          onClick={()=>setShowHuerfanas(!showHuerfanas)}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:'#e63946'}}>🔴 {huerfanas.length} recepción{huerfanas.length>1?'es':''} sin DTE contabilizado</div>
              <div style={{fontSize:11,color:'#b44',marginTop:2}}>Tienen foto y código DTE pero no llegó el DTE por email</div>
            </div>
            <span style={{color:'#e63946',fontSize:16}}>{showHuerfanas?'▲':'▼'}</span>
          </div>
        </div>
      )}
      {showHuerfanas&&huerfanas.map(r=>(
        <div key={r.id} className="card" style={{padding:'12px 14px',borderLeft:'3px solid #e63946',marginBottom:8}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:'#fff'}}>{r.proveedor||'Sin nombre'}</div>
              <div style={{fontSize:11,color:'#666'}}>{fmtDate(r.fecha)} · DTE ****{r.dte_codigo}</div>
            </div>
            {r.foto_dte_url&&<img src={r.foto_dte_url} style={{width:50,height:38,objectFit:'cover',borderRadius:6}} alt="DTE"/>}
          </div>
          <div style={{fontSize:11,color:'#888',marginTop:6}}>💡 Este proveedor no envía DTE por email. Verificar con contador si necesita registro manual.</div>
        </div>
      ))}

      {/* Lista de cruces pendientes */}
      {showPendientes&&(
        <div style={{marginBottom:16}}>
          {loadingPend&&<div className="spin" style={{width:24,height:24,margin:'12px auto'}}/>}
          {!loadingPend&&pendientes.map(dte=>{
            const cand=dte.recepcion_candidata;
            const dItems=dteItems(dte);
            const rItems=cand?(pendItems[cand.id]||[]):[];
            const totDteCant=dItems.reduce((s,x)=>s+x.cant,0);
            const totRecCant=rItems.reduce((s,x)=>s+(Number(x.cantidad_recibida)||0),0);
            const totRecMonto=rItems.reduce((s,x)=>s+((Number(x.cantidad_recibida)||0)*(Number(x.precio_unitario)||0)),0);
            const expanded=expPendId===dte.id;
            return(
              <div key={dte.id} className="card" style={{padding:'12px 14px',borderLeft:'3px solid #f4a261',marginBottom:8}}>
                {/* Resumen header */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,color:'#888',marginBottom:2}}>📧 DTE del correo</div>
                    <div style={{fontSize:13,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{dte.proveedor_nombre||'Proveedor'}</div>
                    <div style={{fontSize:11,color:'#666'}}>{fmtDate(dte.fecha_emision)} · ****{dte.dte_codigo}</div>
                    <div style={{fontSize:13,color:'#4ade80',fontWeight:600,marginTop:2}}>${Number(dte.monto_total||0).toFixed(2)} · {dItems.length} ítem{dItems.length!==1?'s':''} · {totDteCant.toFixed(0)} u</div>
                  </div>
                  {cand&&(
                    <div style={{flex:1,minWidth:0,background:'#1a1a1a',borderRadius:8,padding:'8px 10px'}}>
                      <div style={{fontSize:11,color:'#888',marginBottom:2}}>📦 Recepción candidata</div>
                      <div style={{fontSize:13,fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{cand.proveedor||'—'}</div>
                      <div style={{fontSize:11,color:'#666'}}>{fmtDate(cand.fecha)}{cand.dte_codigo?' · ****'+cand.dte_codigo:' · sin código'}</div>
                      <div style={{fontSize:13,color:'#4ade80',fontWeight:600,marginTop:2}}>${totRecMonto.toFixed(2)} · {rItems.length} ítem{rItems.length!==1?'s':''} · {totRecCant.toFixed(0)} u</div>
                    </div>
                  )}
                </div>

                {/* Diff rápido */}
                {cand&&(
                  <div style={{display:'flex',gap:8,marginTop:8,fontSize:11}}>
                    <div style={{flex:1,padding:'4px 8px',borderRadius:6,background:Math.abs(Number(dte.monto_total||0)-totRecMonto)<0.5?'#0a3d0a':'#3d2200',color:Math.abs(Number(dte.monto_total||0)-totRecMonto)<0.5?'#4ade80':'#f4a261'}}>
                      Δ Monto: ${(Number(dte.monto_total||0)-totRecMonto).toFixed(2)}
                    </div>
                    <div style={{flex:1,padding:'4px 8px',borderRadius:6,background:totDteCant===totRecCant?'#0a3d0a':'#3d2200',color:totDteCant===totRecCant?'#4ade80':'#f4a261'}}>
                      Δ Cantidad: {(totDteCant-totRecCant).toFixed(0)} u
                    </div>
                  </div>
                )}

                {/* Toggle ver ítems */}
                <button className="btn" style={{width:'100%',fontSize:12,padding:'6px',marginTop:8,background:'transparent',border:'1px solid #333',color:'#888'}}
                  onClick={()=>setExpPendId(expanded?null:dte.id)}>
                  {expanded?'▲ Ocultar ítems':`▼ Comparar ítems (DTE: ${dItems.length} · Rec: ${rItems.length})`}
                </button>

                {/* Comparación de ítems side-by-side */}
                {expanded&&(
                  <div style={{marginTop:10,borderTop:'1px solid #2a2a2a',paddingTop:10}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                      {/* Columna DTE */}
                      <div>
                        <div style={{fontSize:11,color:'#f4a261',fontWeight:700,marginBottom:6,textAlign:'center',background:'#2a1800',padding:'4px',borderRadius:4}}>📧 DTE ({dItems.length})</div>
                        {dItems.length===0&&<div style={{fontSize:11,color:'#555',textAlign:'center'}}>Sin ítems</div>}
                        {dItems.map((it,i)=>(
                          <div key={i} style={{padding:'6px 0',borderBottom:'1px solid #1a1a1a',fontSize:11}}>
                            <div style={{color:'#fff',marginBottom:2,wordBreak:'break-word'}}>{it.desc.length>60?it.desc.slice(0,60)+'…':it.desc}</div>
                            <div style={{display:'flex',justifyContent:'space-between',color:'#888'}}>
                              <span>{it.cant.toFixed(2)} × ${it.precio.toFixed(2)}</span>
                              <span style={{color:'#4ade80',fontWeight:600}}>${it.subtotal.toFixed(2)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Columna Recepción */}
                      <div>
                        <div style={{fontSize:11,color:'#4ade80',fontWeight:700,marginBottom:6,textAlign:'center',background:'#0a2a0a',padding:'4px',borderRadius:4}}>📦 Recepción ({rItems.length})</div>
                        {rItems.length===0&&<div style={{fontSize:11,color:'#555',textAlign:'center'}}>Sin ítems</div>}
                        {rItems.map((it,i)=>{
                          const cant=Number(it.cantidad_recibida)||0;
                          const precio=Number(it.precio_unitario)||0;
                          return(
                            <div key={it.id||i} style={{padding:'6px 0',borderBottom:'1px solid #1a1a1a',fontSize:11}}>
                              <div style={{color:'#fff',marginBottom:2,wordBreak:'break-word'}}>{(it.descripcion||'(sin desc)').length>60?(it.descripcion||'').slice(0,60)+'…':(it.descripcion||'(sin desc)')}</div>
                              <div style={{display:'flex',justifyContent:'space-between',color:'#888'}}>
                                <span>{cant.toFixed(2)}{it.unidad?' '+it.unidad:''} × ${precio.toFixed(2)}</span>
                                <span style={{color:'#4ade80',fontWeight:600}}>${(cant*precio).toFixed(2)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <div style={{display:'flex',gap:8,marginTop:10}}>
                  <button className="btn btn-green" style={{flex:1,fontSize:13,padding:'10px'}} onClick={()=>aprobarCruce(dte)} disabled={saving}>
                    ✅ Sí, es el mismo
                  </button>
                  <button className="btn" style={{flex:1,fontSize:13,padding:'10px',background:'#333',border:'1px solid #555'}} onClick={()=>rechazarCruce(dte)} disabled={saving}>
                    ❌ No coincide
                  </button>
                </div>
              </div>
            );
          })}
          {!loadingPend&&pendientes.length===0&&<div style={{textAlign:'center',color:'#555',fontSize:13,padding:8}}>No hay cruces pendientes</div>}
        </div>
      )}

      <div className="sec-title">Últimas recepciones</div>
      {loading&&<div className="spin" style={{width:28,height:28,margin:'20px auto'}}/>}
      {!loading&&recs.length===0&&<div className="empty"><div className="empty-icon">📋</div><div className="empty-text">Sin historial aún</div></div>}
      {recs.map(r=>{
        const editable=esEditable(r);
        const horas=Math.round(72-horasDesde(r.created_at));
        return(
        <div key={r.id} className="card" style={{padding:'12px 14px',cursor:'pointer'}} onClick={()=>toggleExpand(r.id)}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:14}}>{r.proveedor||'Sin nombre'}</div>
              <div style={{fontSize:12,color:'#666',marginTop:2}}>{fmtDate(r.fecha)}</div>
              {editable&&<div style={{fontSize:11,color:'#4ade80',marginTop:2}}>✏️ Editable — {horas}h restantes</div>}
              {!editable&&<div style={{fontSize:11,color:'#555',marginTop:2}}>🔒 Bloqueada</div>}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <Badge estado={r.estado}/>
              <span style={{color:'#555',fontSize:16}}>{expandedId===r.id?'▲':'▼'}</span>
            </div>
          </div>
          {r.foto_dte_url&&<div style={{marginTop:8}}><img src={r.foto_dte_url} style={{width:60,height:45,objectFit:'cover',borderRadius:6}} alt="DTE"/></div>}
          {r.notas&&<div style={{fontSize:12,color:'#888',marginTop:4}}>{r.notas}</div>}

          {expandedId===r.id&&(
            <div style={{marginTop:12,borderTop:'1px solid #2a2a2a',paddingTop:12}} onClick={e=>e.stopPropagation()}>
              {r.dte_codigo&&<div style={{fontSize:12,color:'#f4a261',marginBottom:8}}>🔖 DTE: ****{r.dte_codigo}</div>}
              {loadingItems&&<div className="spin" style={{width:20,height:20,margin:'8px auto'}}/>}
              {!loadingItems&&items.map((it,idx)=>(
                <div key={it.id} style={{padding:'8px 0',borderBottom:'1px solid #1a1a1a',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:500}}>{it.descripcion||'Producto'}</div>
                    <div style={{fontSize:11,color:'#555'}}>{it.unidad}{it.precio_unitario?' · $'+Number(it.precio_unitario).toFixed(2):''}</div>
                  </div>
                  <div style={{fontWeight:600,fontSize:14}}>{it.cantidad_recibida}</div>
                </div>
              ))}
              {editable&&!loadingItems&&(
                <div style={{display:'flex',gap:8,marginTop:10}}>
                  <button className="btn btn-green" style={{flex:1,fontSize:13,padding:'10px'}} onClick={()=>setEditRec(r)} disabled={saving}>
                    ✏️ Editar completa
                  </button>
                  <button className="btn btn-danger" style={{flex:1,fontSize:13,padding:'10px'}} onClick={()=>eliminarRecepcion(r)} disabled={saving}>
                    {saving?'Eliminando...':'🗑️ Eliminar'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      );})}
    </div>
  );
}

// ── EDITAR RECEPCIÓN COMPLETA ─────────────────────────────────
function EditarRecepcion({rec,cmId,show,onBack}){
  const [proveedorId,setProveedorId]=useState(null);
  const [proveedorNombre,setProveedorNombre]=useState(rec.proveedor||'');
  const [proveedorSearch,setProveedorSearch]=useState(rec.proveedor||'');
  const [proveedores,setProveedores]=useState([]);
  const [showProvSearch,setShowProvSearch]=useState(false);
  const [showNewProvModal,setShowNewProvModal]=useState(false);
  const [productos,setProductos]=useState([]);
  const [showNewProdModal,setShowNewProdModal]=useState(false);
  const [notas,setNotas]=useState(rec.notas||'');
  const [dteCodigo,setDteCodigo]=useState(rec.dte_codigo||'');
  const [items,setItems]=useState([]);
  const [origItems,setOrigItems]=useState([]);
  const [foto,setFoto]=useState(null);
  const [fotoUrl,setFotoUrl]=useState(rec.foto_dte_url||'');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const fRef=useRef();

  // Cargar proveedores
  useEffect(()=>{
    db.from('proveedores').select('id,nombre').eq('activo',true).then(({data})=>{
      setProveedores(data||[]);
      const match=(data||[]).find(p=>p.nombre===rec.proveedor);
      if(match) setProveedorId(match.id);
    });
  },[]);

  // Cargar productos del proveedor
  useEffect(()=>{
    if(!proveedorId){setProductos([]);return;}
    db.from('proveedor_productos')
      .select('producto_id,precio_unitario,unidad_compra,catalogo_productos(id,codigo,nombre,categoria,unidad_medida,precio_referencia)')
      .eq('proveedor_id',proveedorId).eq('activo',true)
      .then(({data})=>{
        const prods=(data||[]).map(pp=>({...pp.catalogo_productos,precio_proveedor:pp.precio_unitario,unidad_compra:pp.unidad_compra})).filter(Boolean);
        setProductos(prods);
      });
  },[proveedorId]);

  // Cargar items existentes
  useEffect(()=>{
    db.from('recepcion_items').select('*').eq('recepcion_id',rec.id).then(({data})=>{
      const mapped=(data||[]).map(it=>({
        dbId:it.id, prodId:it.producto_id, prodNombre:it.descripcion||'', desc:it.descripcion||'',
        qty:String(it.cantidad_recibida), precio:it.precio_unitario?String(it.precio_unitario):'', unidad:it.unidad||'unidad', origQty:it.cantidad_recibida
      }));
      setItems(mapped);
      setOrigItems(data||[]);
      setLoading(false);
    });
  },[rec.id]);

  const filteredProveedores=proveedorSearch.trim()
    ?proveedores.filter(p=>p.nombre.toLowerCase().includes(proveedorSearch.toLowerCase()))
    :proveedores;

  const selectProveedor=(p)=>{
    setProveedorId(p.id);setProveedorNombre(p.nombre);setProveedorSearch(p.nombre);setShowProvSearch(false);
  };
  const handleNewProveedor=(p)=>{selectProveedor(p);setProveedores(prev=>[...prev,p]);setShowNewProvModal(false);};
  const handleNewProducto=async(p)=>{
    if(proveedorId&&p.id){
      await db.from('proveedor_productos').upsert({proveedor_id:proveedorId,producto_id:p.id,precio_unitario:p.precio_referencia||null,unidad_compra:p.unidad_medida||'Unidad',es_proveedor_principal:true,activo:true},{onConflict:'proveedor_id,producto_id'});
    }
    setProductos(prev=>[...prev,{...p,precio_proveedor:p.precio_referencia}]);setShowNewProdModal(false);
  };

  const addItem=()=>setItems(prev=>[...prev,{dbId:null,prodId:null,prodNombre:'',desc:'',qty:'',precio:'',unidad:'unidad',origQty:0}]);
  const updItem=(i,f,v)=>setItems(prev=>prev.map((it,idx)=>idx===i?{...it,[f]:v}:it));
  const delItem=(i)=>setItems(prev=>prev.filter((_,idx)=>idx!==i));

  const handleFoto=async(e)=>{
    const f=e.target.files[0]; if(!f) return;
    setFoto(f);
    const reader=new FileReader(); reader.onload=ev=>setFotoUrl(ev.target.result); reader.readAsDataURL(f);
  };

  const guardar=async()=>{
    if(!proveedorNombre.trim()){show('⚠️ Selecciona un proveedor');return;}
    const validItems=items.filter(i=>(i.prodId||i.desc.trim()||i.prodNombre.trim())&&n(i.qty)>0);
    if(validItems.length===0){show('⚠️ Agrega al menos un ítem con cantidad');return;}
    setSaving(true);
    try{
      // 1. Foto
      let fotoDbUrl=rec.foto_dte_url;
      if(foto){
        const ext=(foto.name.split('.').pop()||'jpg').toLowerCase();
        const path=`recepciones/dte_${Date.now()}.${ext}`;
        const {error:upErr}=await db.storage.from(BUCKET).upload(path,foto,{cacheControl:'3600',upsert:false});
        if(!upErr){const {data:pu}=db.storage.from(BUCKET).getPublicUrl(path);fotoDbUrl=pu?.publicUrl;}
      }
      // 2. Revertir inventario de items originales
      for(const oi of origItems){
        if(!oi.producto_id||!cmId) continue;
        const {data:inv}=await db.from('inventario').select('id,stock_actual')
          .eq('producto_id',oi.producto_id).eq('sucursal_id',cmId).maybeSingle();
        if(inv){
          await db.from('inventario').update({stock_actual:Math.max(0,n(inv.stock_actual)-n(oi.cantidad_recibida)),ultima_actualizacion:new Date().toISOString()}).eq('id',inv.id);
        }
      }
      // 3. Borrar items viejos
      await db.from('recepcion_items').delete().eq('recepcion_id',rec.id);
      // 4. Actualizar recepción
      await db.from('recepciones').update({
        proveedor:proveedorNombre.trim(),
        notas:notas.trim()||null,
        dte_codigo:dteCodigo.trim()||null,
        foto_dte_url:fotoDbUrl,
        updated_at:new Date().toISOString()
      }).eq('id',rec.id);
      // 5. Insertar nuevos items
      const rows=validItems.map(it=>({
        recepcion_id:rec.id,
        producto_id:it.prodId||null,
        descripcion:it.prodId?(productos.find(p=>p.id===it.prodId)?.nombre||it.prodNombre):it.desc.trim()||it.prodNombre.trim(),
        cantidad_esperada:n(it.qty),
        cantidad_recibida:n(it.qty),
        unidad:it.unidad,
        precio_unitario:n(it.precio)||null,
      }));
      await db.from('recepcion_items').insert(rows);
      // 6. Sumar inventario nuevo
      for(const it of validItems){
        if(!it.prodId||!cmId) continue;
        const qty=n(it.qty);
        const {data:existing}=await db.from('inventario').select('id,stock_actual')
          .eq('producto_id',it.prodId).eq('sucursal_id',cmId).maybeSingle();
        if(existing){
          await db.from('inventario').update({stock_actual:n(existing.stock_actual)+qty,ultima_actualizacion:new Date().toISOString()}).eq('id',existing.id);
        }else{
          await db.from('inventario').insert({producto_id:it.prodId,sucursal_id:cmId,stock_actual:qty,stock_minimo:0,stock_maximo:999,ultima_actualizacion:new Date().toISOString()});
        }
      }
      // Actualizar precio en proveedor_productos con el último precio ingresado
      for(const it of validItems){
        if(!it.prodId||!proveedorId||!n(it.precio)) continue;
        await db.from('proveedor_productos').update({precio_unitario:n(it.precio)})
          .eq('proveedor_id',proveedorId).eq('producto_id',it.prodId);
      }
      show('✅ Recepción actualizada');
      onBack();
    }catch(e){show('❌ '+e.message);}
    setSaving(false);
  };

  if(loading) return <div style={{padding:40,textAlign:'center'}}><div className="spin" style={{width:28,height:28,margin:'0 auto'}}/></div>;

  return(
    <div style={{minHeight:'100vh'}}>
      <div className="header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div style={{fontWeight:700,fontSize:16}}>Editar Recepción</div>
      </div>
      <div style={{padding:'16px 16px 100px'}}>
        {/* Proveedor */}
        <div className="field">
          <label>Proveedor *</label>
          <div className="autocomplete-container">
            <input type="text" value={proveedorSearch} onChange={e=>{setProveedorSearch(e.target.value);setProveedorNombre(e.target.value);setShowProvSearch(true);}}
              onFocus={()=>setShowProvSearch(true)} placeholder="Buscar proveedor..."/>
            {showProvSearch&&(
              <div className={`autocomplete-dropdown active`}>
                {filteredProveedores.length>0?filteredProveedores.slice(0,8).map(p=>(
                  <div key={p.id} className="autocomplete-item" onClick={()=>selectProveedor(p)}>{p.nombre}</div>
                )):<div style={{padding:'10px 12px',color:'#666'}}>Sin resultados</div>}
                <div className="autocomplete-item" style={{background:'#1b4332',color:'#4ade80',borderTop:'1px solid #222'}} onClick={()=>setShowNewProvModal(true)}>+ Agregar nuevo proveedor</div>
              </div>
            )}
          </div>
        </div>
        {/* Notas */}
        <div className="field">
          <label>Notas (opcional)</label>
          <input type="text" value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Observaciones generales"/>
        </div>
        {/* DTE código */}
        <div className="field">
          <label>Últimos 4 dígitos del DTE</label>
          <input type="text" value={dteCodigo} onChange={e=>setDteCodigo(e.target.value.replace(/\D/g,'').slice(0,4))}
            placeholder="Ej: 2345" maxLength={4} inputMode="numeric"
            style={{width:120,fontSize:20,fontWeight:700,textAlign:'center',letterSpacing:8}}/>
          <div style={{fontSize:11,color:'#555',marginTop:4}}>Del número de control del DTE</div>
        </div>
        {/* Foto */}
        <div className="field">
          <label>Foto del DTE</label>
          <div className={`photo-btn ${fotoUrl?'has-photo':''}`} onClick={()=>fRef.current.click()}>
            {fotoUrl
              ?<><img src={fotoUrl} style={{width:120,height:90,objectFit:'cover',borderRadius:8}} alt="DTE"/><span style={{marginTop:4}}>Tap para cambiar</span></>
              :<><span style={{fontSize:28}}>📷</span><span>Tomar foto del DTE</span></>}
          </div>
          <input type="file" ref={fRef} accept="image/*" capture="environment" onChange={handleFoto} style={{display:'none'}}/>
        </div>
        {/* Items */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div className="sec-title" style={{marginBottom:0}}>PRODUCTOS</div>
          <button className="btn btn-ghost btn-sm" onClick={addItem}>+ Agregar</button>
        </div>
        {items.map((it,i)=>(
          <div key={i} className="item-row">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <span style={{fontSize:13,color:'#666'}}>Producto {i+1}</span>
              {items.length>1&&<button onClick={()=>delItem(i)} style={{background:'none',border:'none',color:'#e63946',fontSize:18,cursor:'pointer'}}>×</button>}
            </div>
            <div className="field" style={{marginBottom:8}}>
              <label style={{fontSize:12}}>Producto</label>
              <input type="text" value={it.prodNombre} onChange={e=>{updItem(i,'prodNombre',e.target.value);updItem(i,'desc',e.target.value);}}
                onFocus={()=>{if(proveedorId)updItem(i,'searchOpen',true);}}
                placeholder={proveedorId?'Buscar producto...':'Escribir descripción'}/>
              {it.searchOpen&&proveedorId&&(
                <div style={{background:'#1e1e1e',border:'1px solid #333',borderTop:'none',maxHeight:180,overflowY:'auto',borderRadius:'0 0 8px 8px',marginTop:-4}}>
                  {productos.filter(p=>p.nombre.toLowerCase().includes((it.prodNombre||'').toLowerCase())).slice(0,8).map(p=>(
                    <div key={p.id} style={{padding:'8px 12px',borderBottom:'1px solid #222',cursor:'pointer',fontSize:13,color:'#f0f0f0',display:'flex',justifyContent:'space-between'}}
                      onClick={()=>{updItem(i,'prodId',p.id);updItem(i,'prodNombre',p.nombre);updItem(i,'desc',p.nombre);updItem(i,'unidad',p.unidad_compra||p.unidad_medida||'unidad');updItem(i,'precio',p.precio_proveedor||p.precio_referencia||'');updItem(i,'searchOpen',false);}}>
                      <span>{p.nombre}</span>
                      {p.precio_proveedor&&<span style={{color:'#4ade80',fontSize:11}}>${Number(p.precio_proveedor).toFixed(2)}</span>}
                    </div>
                  ))}
                  <div className="autocomplete-item" style={{background:'#1b4332',color:'#4ade80',borderTop:'1px solid #222'}} onClick={()=>setShowNewProdModal(true)}>+ Nuevo Producto</div>
                </div>
              )}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <div><label>Cantidad</label><input type="number" value={it.qty} onChange={e=>updItem(i,'qty',e.target.value)} placeholder="0" min="0" step="0.01"/></div>
              <div><label>Unidad</label>
                <select value={it.unidad} onChange={e=>updItem(i,'unidad',e.target.value)}>
                  <option value="unidad">Unidad</option><option value="kg">Kilogramo</option><option value="lb">Libra</option>
                  <option value="litro">Litro</option><option value="caja">Caja</option><option value="bolsa">Bolsa</option>
                  <option value="rollo">Rollo</option><option value="paquete">Paquete</option><option value="galón">Galón</option>
                </select>
              </div>
            </div>
            <div className="field" style={{marginTop:8,marginBottom:0}}>
              <label>Precio unitario</label>
              <input type="number" value={it.precio} onChange={e=>updItem(i,'precio',e.target.value)} placeholder="0.00" min="0" step="0.01"/>
            </div>
          </div>
        ))}
        <button className="btn btn-green" style={{marginTop:8}} onClick={guardar} disabled={saving}>
          {saving?'Guardando...':'💾 Guardar cambios'}
        </button>
      </div>
      {showNewProvModal&&<NuevoProveedorModal onSave={handleNewProveedor} onClose={()=>setShowNewProvModal(false)}/>}
      {showNewProdModal&&<NuevoProductoModal onSave={handleNewProducto} onClose={()=>setShowNewProdModal(false)}/>}
    </div>
  );
}
