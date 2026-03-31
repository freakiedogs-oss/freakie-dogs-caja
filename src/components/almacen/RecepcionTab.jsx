import { useState, useEffect, useRef } from 'react';
import { db } from '../../supabase';
import { STORES, today, fmtDate, n } from '../../config';
import { BUCKET_CIERRES as BUCKET } from '../../config';
import { useToast } from '../../hooks/useToast';
import { Badge } from '../ui/Badge';
import { NuevoProveedorModal, NuevoProductoModal } from './shared';

// ── RECEPCIÓN PROVEEDOR (Flujo A) ────────────────────────────
export default function RecepcionTab({user,show}){
  const [view,setView]=useState('lista'); // lista | detalle | nueva
  const [receps,setReceps]=useState([]);
  const [loading,setLoading]=useState(true);
  const [sel,setSel]=useState(null);
  const [sucursales,setSucursales]=useState([]);

  const cargar=async()=>{
    setLoading(true);
    const {data}=await db.from('recepciones')
      .select('*')
      .in('estado',['pendiente','en_proceso'])
      .eq('tipo_recepcion','bodega')
      .order('created_at',{ascending:false});
    setReceps(data||[]);
    const {data:suc}=await db.from('sucursales').select('id,nombre,store_code').eq('activa',true);
    setSucursales(suc||[]);
    setLoading(false);
  };

  useEffect(()=>{cargar();},[]);

  if(view==='detalle'&&sel) return <RecepcionDetalle rec={sel} user={user} show={show} onBack={()=>{setSel(null);setView('lista');cargar();}} />;
  if(view==='nueva') return <NuevaRecepcion user={user} sucursales={sucursales} show={show} onBack={()=>{setView('lista');cargar();}}/>;

  return(
    <div style={{padding:'16px 16px 100px'}}>
      <button className="btn btn-red" style={{marginBottom:16}} onClick={()=>setView('nueva')}>
        + Nueva Recepción de Proveedor
      </button>

      <div className="sec-title">Pendientes de Confirmar</div>
      {loading&&<div style={{textAlign:'center',padding:20}}><div className="spin" style={{width:28,height:28,margin:'0 auto'}}/></div>}
      {!loading&&receps.length===0&&(
        <div className="empty"><div className="empty-icon">📦</div><div className="empty-text">No hay recepciones pendientes</div></div>
      )}
      {receps.map(r=>(
        <div key={r.id} className="card" style={{cursor:'pointer'}} onClick={()=>{setSel(r);setView('detalle');}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
            <div>
              <div style={{fontWeight:700,fontSize:15}}>{r.proveedor||'Proveedor sin nombre'}</div>
              <div style={{color:'#666',fontSize:12,marginTop:2}}>{fmtDate(r.fecha)}</div>
            </div>
            <Badge estado={r.estado}/>
          </div>
          {r.notas&&<div style={{fontSize:13,color:'#888',marginTop:4}}>{r.notas}</div>}
          <div style={{marginTop:10,fontSize:13,color:'#e63946',fontWeight:600}}>Tap para confirmar →</div>
        </div>
      ))}
    </div>
  );
}

// ── NUEVA RECEPCIÓN ───────────────────────────────────────────
function NuevaRecepcion({user,sucursales,show,onBack}){
  const [proveedorId,setProveedorId]=useState(null);
  const [proveedorNombre,setProveedorNombre]=useState('');
  const [proveedorSearch,setProveedorSearch]=useState('');
  const [proveedores,setProveedores]=useState([]);
  const [showProvSearch,setShowProvSearch]=useState(false);
  const [showNewProvModal,setShowNewProvModal]=useState(false);
  const [productos,setProductos]=useState([]);
  const [showNewProdModal,setShowNewProdModal]=useState(false);
  const [notas,setNotas]=useState('');
  const [dteCodigo,setDteCodigo]=useState('');
  const [items,setItems]=useState([{prodId:null,prodNombre:'',desc:'',qty:'',precio:'',unidad:'unidad'}]);
  const [foto,setFoto]=useState(null);
  const [fotoUrl,setFotoUrl]=useState('');
  const [loading,setLoading]=useState(false);
  const [ocVinculada,setOcVinculada]=useState(null); // OC aprobada precargada
  const fRef=useRef();
  const cmId=sucursales.find(s=>s.store_code==='CM001')?.id;

  // Cargar proveedores activos
  useEffect(()=>{
    db.from('proveedores').select('id,nombre').eq('activo',true).then(({data})=>setProveedores(data||[]));
  },[]);

  // Cargar productos del proveedor seleccionado
  useEffect(()=>{
    if(!proveedorId){setProductos([]);return;}
    db.from('proveedor_productos')
      .select('producto_id,precio_unitario,unidad_compra,catalogo_productos(id,codigo,nombre,categoria,unidad_medida,precio_referencia)')
      .eq('proveedor_id',proveedorId)
      .eq('activo',true)
      .then(({data})=>{
        const prods=(data||[]).map(pp=>({
          ...pp.catalogo_productos,
          precio_proveedor:pp.precio_unitario,
          unidad_compra:pp.unidad_compra
        })).filter(Boolean);
        setProductos(prods);
      });
  },[proveedorId]);

  const filteredProveedores=proveedorSearch.trim()
    ?proveedores.filter(p=>p.nombre.toLowerCase().includes(proveedorSearch.toLowerCase()))
    :proveedores;

  const selectProveedor=async(p)=>{
    setProveedorId(p.id);
    setProveedorNombre(p.nombre);
    setProveedorSearch(p.nombre);
    setShowProvSearch(false);
    // Buscar OC aprobada para este proveedor
    const {data:ocs}=await db.from('ordenes_compra').select('*')
      .eq('proveedor_id',p.id).eq('estado','aprobada')
      .order('fecha_aprobacion',{ascending:false}).limit(1);
    if(ocs&&ocs.length>0){
      const oc=ocs[0];
      // Cargar items de la OC
      const {data:ocItems}=await db.from('ordenes_compra_items').select('*').eq('orden_id',oc.id);
      if(ocItems&&ocItems.length>0){
        setOcVinculada(oc);
        setItems(ocItems.map(it=>({
          prodId:it.producto_id, prodNombre:it.descripcion, desc:it.descripcion,
          qty:String(it.cantidad_solicitada), precio:it.precio_unitario_estimado?String(it.precio_unitario_estimado):'',
          unidad:it.unidad||'unidad'
        })));
        show('📋 OC-'+String(oc.numero_oc).padStart(4,'0')+' precargada');
        return;
      }
    }
    setOcVinculada(null);
    setItems([{prodId:null,prodNombre:'',desc:'',qty:'',precio:'',unidad:'unidad'}]);
  };

  const handleNewProveedor=(p)=>{
    selectProveedor(p);
    setProveedores(prev=>[...prev,p]);
    setShowNewProvModal(false);
  };

  const handleNewProducto=async(p)=>{
    // Vincular producto al proveedor actual en proveedor_productos
    if(proveedorId&&p.id){
      await db.from('proveedor_productos').upsert({
        proveedor_id:proveedorId,
        producto_id:p.id,
        precio_unitario:p.precio_referencia||null,
        unidad_compra:p.unidad_medida||'Unidad',
        es_proveedor_principal:true,
        activo:true
      },{onConflict:'proveedor_id,producto_id'});
    }
    setProductos(prev=>[...prev,{...p,precio_proveedor:p.precio_referencia}]);
    setShowNewProdModal(false);
  };

  const addItem=()=>setItems(prev=>[...prev,{prodId:null,prodNombre:'',desc:'',qty:'',precio:'',unidad:'unidad'}]);
  const updItem=(i,f,v)=>setItems(prev=>prev.map((it,idx)=>idx===i?{...it,[f]:v}:it));
  const delItem=(i)=>setItems(prev=>prev.filter((_,idx)=>idx!==i));

  const handleFoto=async(e)=>{
    const f=e.target.files[0]; if(!f) return;
    setFoto(f);
    const reader=new FileReader();
    reader.onload=ev=>setFotoUrl(ev.target.result);
    reader.readAsDataURL(f);
  };

  const getPriceAlert=(itemPrice,prodId)=>{
    if(!proveedorId||!itemPrice) return null;
    const prod=productos.find(p=>p.id===prodId);
    if(!prod) return null;
    const refPrice=n(prod.precio_referencia);
    const diff=(n(itemPrice)-refPrice)/refPrice*100;
    if(Math.abs(diff)>5){
      return `⚠️ Último precio: $${refPrice.toFixed(2)} — Diferencia: ${diff>0?'+':''}${diff.toFixed(1)}%`;
    }
    return null;
  };

  const guardar=async()=>{
    if(!proveedorId||!proveedorNombre.trim()){show('⚠️ Selecciona un proveedor');return;}
    const validItems=items.filter(i=>(i.prodId||i.desc.trim())&&n(i.qty)>0);
    if(validItems.length===0){show('⚠️ Agrega al menos un ítem con cantidad');return;}
    if(!cmId){show('⚠️ Casa Matriz no encontrada en BD');return;}
    setLoading(true);
    try{
      let fotoDbUrl=null;
      if(foto){
        const ext=(foto.name.split('.').pop()||'jpg').toLowerCase();
        const path=`recepciones/dte_${Date.now()}.${ext}`;
        const {error:upErr}=await db.storage.from(BUCKET).upload(path,foto,{cacheControl:'3600',upsert:false});
        if(!upErr){
          const {data:pu}=db.storage.from(BUCKET).getPublicUrl(path);
          fotoDbUrl=pu?.publicUrl;
        }
      }
      const {data:rec,error:recErr}=await db.from('recepciones').insert({
        fecha:today(),
        tipo_recepcion:'bodega_proveedor',
        sucursal_destino_id:cmId,
        proveedor:proveedorNombre.trim(),
        recibido_por:user.id,
        estado:'verificada',
        foto_dte_url:fotoDbUrl,
        notas:notas.trim()||null,
        dte_codigo:dteCodigo.trim()||null,
      }).select().single();
      if(recErr) throw recErr;

      const rows=validItems.map(it=>({
        recepcion_id:rec.id,
        producto_id:it.prodId||null,
        descripcion:it.prodId?productos.find(p=>p.id===it.prodId)?.nombre||it.desc:it.desc.trim(),
        cantidad_esperada:n(it.qty),
        cantidad_recibida:n(it.qty),
        unidad:it.unidad,
        precio_unitario:n(it.precio)||null,
      }));
      const {error:itmErr}=await db.from('recepcion_items').insert(rows);
      if(itmErr) throw itmErr;

      // Auto-actualizar inventario para cada producto con ID
      for(const it of validItems){
        if(!it.prodId) continue;
        const qty=n(it.qty);
        // Intentar obtener registro existente
        const {data:existing}=await db.from('inventario')
          .select('id,stock_actual')
          .eq('producto_id',it.prodId).eq('sucursal_id',cmId).maybeSingle();
        if(existing){
          await db.from('inventario').update({
            stock_actual:n(existing.stock_actual)+qty,
            ultima_actualizacion:new Date().toISOString()
          }).eq('id',existing.id);
        }else{
          await db.from('inventario').insert({
            producto_id:it.prodId,
            sucursal_id:cmId,
            stock_actual:qty,
            stock_minimo:0,
            stock_maximo:999,
            ultima_actualizacion:new Date().toISOString()
          });
        }
      }
      // Actualizar precio en proveedor_productos con el último precio ingresado
      for(const it of validItems){
        if(!it.prodId||!proveedorId||!n(it.precio)) continue;
        await db.from('proveedor_productos').update({precio_unitario:n(it.precio)})
          .eq('proveedor_id',proveedorId).eq('producto_id',it.prodId);
      }
      // Si hay OC vinculada, marcarla como recibida y vincular recepción
      if(ocVinculada){
        await db.from('ordenes_compra').update({
          estado:'recibida',
          recepcion_id:rec.id,
          fecha_recepcion:new Date().toISOString(),
          updated_at:new Date().toISOString()
        }).eq('id',ocVinculada.id);
        // Actualizar cantidades recibidas en items de la OC
        for(const it of validItems){
          if(!it.prodId) continue;
          await db.from('ordenes_compra_items').update({
            cantidad_recibida:n(it.qty),
            precio_unitario_real:n(it.precio)||null
          }).eq('orden_id',ocVinculada.id).eq('producto_id',it.prodId);
        }
      }
      show('✅ Recepción verificada e inventario actualizado'+(ocVinculada?' · OC cerrada':''));
      onBack();
    }catch(e){
      show('❌ Error: '+e.message);
    }
    setLoading(false);
  };

  return(
    <div style={{minHeight:'100vh'}}>
      <div className="header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div style={{fontWeight:700,fontSize:16}}>Nueva Recepción</div>
      </div>
      <div style={{padding:'16px 16px 100px'}}>
        {/* Proveedor con autocomplete */}
        <div className="field">
          <label>Proveedor *</label>
          <div className="autocomplete-container" style={{position:'relative'}}>
            <input type="text" value={proveedorSearch} onChange={e=>{setProveedorSearch(e.target.value);setShowProvSearch(true);}}
              onFocus={()=>setShowProvSearch(true)} onBlur={()=>setTimeout(()=>setShowProvSearch(false),200)} placeholder="Buscar proveedor..."/>
            {showProvSearch&&(
              <div className={`autocomplete-dropdown ${showProvSearch?'active':''}`}>
                {filteredProveedores.length>0?filteredProveedores.map(p=>(
                  <div key={p.id} className="autocomplete-item" onClick={()=>selectProveedor(p)}>
                    {p.nombre}
                  </div>
                )):<div style={{padding:'10px 12px',color:'#666'}}>Sin resultados</div>}
                <div className="autocomplete-item" style={{background:'#1b4332',color:'#4ade80',borderTop:'1px solid #222'}} onClick={()=>setShowNewProvModal(true)}>
                  + Agregar nuevo proveedor
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Banner OC vinculada */}
        {ocVinculada&&(
          <div style={{background:'linear-gradient(135deg,#1b4332,#2d6a4f)',border:'1px solid #40916c',borderRadius:12,padding:'12px 16px',marginBottom:16,display:'flex',alignItems:'center',gap:12}}>
            <span style={{fontSize:24}}>📋</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,color:'#95d5b2',fontSize:14}}>OC-{String(ocVinculada.numero_oc).padStart(4,'0')} precargada</div>
              <div style={{fontSize:12,color:'#b7e4c7',marginTop:2}}>{items.length} items cargados desde orden aprobada</div>
            </div>
            <button onClick={()=>{setOcVinculada(null);setItems([{prodId:null,prodNombre:'',desc:'',qty:'',precio:'',unidad:'unidad'}]);show('OC desvinculada');}}
              style={{background:'none',border:'1px solid #52b788',color:'#52b788',borderRadius:8,padding:'4px 10px',fontSize:12,cursor:'pointer'}}>✕ Desvincular</button>
          </div>
        )}

        <div className="field">
          <label>Notas (opcional)</label>
          <input type="text" value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Observaciones generales"/>
        </div>

        <div className="field">
          <label>Últimos 4 dígitos del DTE</label>
          <input type="text" value={dteCodigo} onChange={e=>setDteCodigo(e.target.value.replace(/\D/g,'').slice(0,4))}
            placeholder="Ej: 2345" maxLength={4} inputMode="numeric"
            style={{width:120,fontSize:20,fontWeight:700,textAlign:'center',letterSpacing:8}}/>
          <div style={{fontSize:11,color:'#555',marginTop:4}}>Del número de control del DTE</div>
        </div>

        {/* Foto DTE */}
        <div className="field">
          <label>Foto del DTE físico</label>
          <div className={`photo-btn ${foto?'has-photo':''}`} onClick={()=>fRef.current.click()}>
            {foto
              ? <><img src={fotoUrl} style={{width:120,height:90,objectFit:'cover',borderRadius:8}} alt="DTE"/><span style={{marginTop:4}}>✅ DTE adjunto — tap para cambiar</span></>
              : <><span style={{fontSize:28}}>📷</span><span>Tomar foto del DTE</span></>
            }
          </div>
          <input type="file" ref={fRef} accept="image/*" capture="environment" onChange={handleFoto} style={{display:'none'}}/>
        </div>

        {/* Items */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div className="sec-title" style={{marginBottom:0}}>PRODUCTOS RECIBIDOS</div>
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
              <input type="text" value={it.prodNombre} onChange={e=>updItem(i,'prodNombre',e.target.value)}
                onFocus={()=>{if(proveedorId)updItem(i,'searchOpen',true);}}
                placeholder={proveedorId?'Buscar producto...':'⬆️ Selecciona proveedor primero'}
                disabled={!proveedorId}
                style={!proveedorId?{opacity:0.5,cursor:'not-allowed'}:{}}/>
              {it.searchOpen&&proveedorId&&(
                <div style={{background:'#1e1e1e',border:'1px solid #333',borderTop:'none',maxHeight:180,overflowY:'auto',borderRadius:'0 0 8px 8px',marginTop:-4}}>
                  {productos.filter(p=>p.nombre.toLowerCase().includes((it.prodNombre||'').toLowerCase())).slice(0,8).map(p=>(
                    <div key={p.id} style={{padding:'8px 12px',borderBottom:'1px solid #222',cursor:'pointer',fontSize:13,color:'#f0f0f0',display:'flex',justifyContent:'space-between'}}
                      onClick={()=>{updItem(i,'prodId',p.id);updItem(i,'prodNombre',p.nombre);updItem(i,'unidad',p.unidad_compra||p.unidad_medida||'unidad');updItem(i,'precio',p.precio_proveedor||p.precio_referencia||'');updItem(i,'searchOpen',false);}}>
                      <span>{p.nombre}</span>
                      {p.precio_proveedor&&<span style={{color:'#4ade80',fontSize:11}}>${Number(p.precio_proveedor).toFixed(2)}</span>}
                    </div>
                  ))}
                  {productos.filter(p=>p.nombre.toLowerCase().includes((it.prodNombre||'').toLowerCase())).length===0&&(
                    <div style={{padding:'10px 12px',color:'#666',fontSize:13}}>No hay productos de este proveedor</div>
                  )}
                  <div className="autocomplete-item" style={{background:'#1b4332',color:'#4ade80',borderTop:'1px solid #222'}} onClick={()=>setShowNewProdModal(true)}>
                    + Nuevo Producto
                  </div>
                </div>
              )}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <div>
                <label>Cantidad</label>
                <input type="number" value={it.qty} onChange={e=>updItem(i,'qty',e.target.value)} placeholder="0" min="0" step="0.01"/>
              </div>
              <div>
                <label>Unidad</label>
                <select value={it.unidad} onChange={e=>updItem(i,'unidad',e.target.value)}>
                  <option value="unidad">Unidad</option>
                  <option value="kg">Kilogramo</option>
                  <option value="lb">Libra</option>
                  <option value="litro">Litro</option>
                  <option value="caja">Caja</option>
                  <option value="bolsa">Bolsa</option>
                  <option value="rollo">Rollo</option>
                  <option value="paquete">Paquete</option>
                  <option value="galón">Galón</option>
                </select>
              </div>
            </div>
            <div className="field" style={{marginTop:8,marginBottom:0}}>
              <label>Precio unitario</label>
              <input type="number" value={it.precio} onChange={e=>updItem(i,'precio',e.target.value)} placeholder="0.00" min="0" step="0.01"/>
              {getPriceAlert(it.precio,it.prodId)&&<div className="price-alert">{getPriceAlert(it.precio,it.prodId)}</div>}
            </div>
          </div>
        ))}

        <button className="btn btn-green" style={{marginTop:8}} onClick={guardar} disabled={loading}>
          {loading?'Guardando...':'✅ Confirmar Recepción'}
        </button>
      </div>

      {showNewProvModal&&<NuevoProveedorModal onSave={handleNewProveedor} onClose={()=>setShowNewProvModal(false)}/>}
      {showNewProdModal&&<NuevoProductoModal onSave={handleNewProducto} onClose={()=>setShowNewProdModal(false)}/>}
    </div>
  );
}

// ── DETALLE RECEPCIÓN (editar/confirmar) ──────────────────────
function RecepcionDetalle({rec,user,show,onBack}){
  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [foto,setFoto]=useState(null);
  const [fotoUrl,setFotoUrl]=useState(rec.foto_dte_url||'');
  const fRef=useRef();

  useEffect(()=>{
    db.from('recepcion_items').select('*').eq('recepcion_id',rec.id)
      .then(({data})=>{ setItems((data||[]).map(it=>({...it,qty_input:String(it.cantidad_recibida)}))); setLoading(false); });
  },[rec.id]);

  const handleFoto=async(e)=>{
    const f=e.target.files[0]; if(!f) return;
    setFoto(f);
    const reader=new FileReader(); reader.onload=ev=>setFotoUrl(ev.target.result); reader.readAsDataURL(f);
  };

  const confirmar=async()=>{
    setSaving(true);
    try{
      let fotoDbUrl=rec.foto_dte_url;
      if(foto){
        const ext=(foto.name.split('.').pop()||'jpg').toLowerCase();
        const path=`recepciones/dte_${Date.now()}.${ext}`;
        const {error:upErr}=await db.storage.from(BUCKET).upload(path,foto,{cacheControl:'3600',upsert:false});
        if(!upErr){const {data:pu}=db.storage.from(BUCKET).getPublicUrl(path); fotoDbUrl=pu?.publicUrl;}
      }
      // Actualizar items
      for(const it of items){
        await db.from('recepcion_items').update({cantidad_recibida:n(it.qty_input)}).eq('id',it.id);
      }
      // Actualizar recepción
      const hasDiff=items.some(it=>Math.abs(n(it.qty_input)-n(it.cantidad_esperada))>0.01);
      await db.from('recepciones').update({
        estado:hasDiff?'con_diferencias':'completada',
        foto_dte_url:fotoDbUrl,
        updated_at:new Date().toISOString(),
      }).eq('id',rec.id);

      // Actualizar inventario (upsert stock Casa Matriz)
      const cmId=rec.sucursal_destino_id;
      for(const it of items){
        if(it.producto_id){
          await db.from('inventario').upsert({
            sucursal_id:cmId, producto_id:it.producto_id,
            stock_actual:n(it.qty_input), ultima_actualizacion:new Date().toISOString()
          },{onConflict:'sucursal_id,producto_id',ignoreDuplicates:false});
        }
      }
      show(hasDiff?'⚠️ Recepción confirmada con diferencias':'✅ Recepción completada');
      onBack();
    }catch(e){ show('❌ '+e.message); }
    setSaving(false);
  };

  return(
    <div style={{minHeight:'100vh'}}>
      <div className="header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:15}}>{rec.proveedor||'Proveedor'}</div>
          <div style={{fontSize:12,color:'#666'}}>{fmtDate(rec.fecha)}</div>
        </div>
        <Badge estado={rec.estado}/>
      </div>
      <div style={{padding:'16px 16px 100px'}}>
        {/* Foto DTE */}
        <div className="field">
          <label>Foto del DTE</label>
          <div className={`photo-btn ${fotoUrl?'has-photo':''}`} onClick={()=>fRef.current.click()}>
            {fotoUrl
              ? <><img src={fotoUrl} style={{width:120,height:90,objectFit:'cover',borderRadius:8}} alt="DTE"/><span style={{marginTop:4}}>✅ Tap para reemplazar</span></>
              : <><span style={{fontSize:28}}>📷</span><span>Sin foto — tap para agregar</span></>
            }
          </div>
          <input type="file" ref={fRef} accept="image/*" capture="environment" onChange={handleFoto} style={{display:'none'}}/>
        </div>

        <div className="sec-title">CONFIRMAR CANTIDADES RECIBIDAS</div>
        {loading&&<div className="spin" style={{width:28,height:28,margin:'20px auto'}}/>}
        {items.map((it,i)=>(
          <div key={it.id} className="item-row">
            <div style={{fontWeight:600,fontSize:14,marginBottom:8}}>{it.descripcion||`Ítem ${i+1}`}</div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#666',marginBottom:10}}>
              <span>Esperado: <strong style={{color:'#f0f0f0'}}>{it.cantidad_esperada} {it.unidad||''}</strong></span>
            </div>
            <div>
              <label>Cantidad recibida</label>
              <div className="num-input">
                <button className="num-btn" onClick={()=>{const v=Math.max(0,n(it.qty_input)-1);setItems(p=>p.map((x,j)=>j===i?{...x,qty_input:String(v)}:x));}}>−</button>
                <input type="number" className="num-field" value={it.qty_input}
                  onChange={e=>setItems(p=>p.map((x,j)=>j===i?{...x,qty_input:e.target.value}:x))} min="0" step="0.01"/>
                <button className="num-btn" onClick={()=>{const v=n(it.qty_input)+1;setItems(p=>p.map((x,j)=>j===i?{...x,qty_input:String(v)}:x));}}>+</button>
              </div>
              {Math.abs(n(it.qty_input)-n(it.cantidad_esperada))>0.01&&(
                <div style={{fontSize:12,color:'#fb923c',marginTop:4}}>
                  ⚠️ Diferencia: {(n(it.qty_input)-n(it.cantidad_esperada)).toFixed(2)} {it.unidad}
                </div>
              )}
            </div>
          </div>
        ))}

        {!loading&&<button className="btn btn-green" style={{marginTop:12}} onClick={confirmar} disabled={saving}>
          {saving?'Confirmando...':'✅ Confirmar Recepción'}
        </button>}
      </div>
    </div>
  );
}
