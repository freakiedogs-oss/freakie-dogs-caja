import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';
import { today, n } from '../../config';
import { useToast } from '../../hooks/useToast';

/* ── Stepper 48px touch target ── */
const stepBtn={
  width:48,height:48,borderRadius:12,border:'1px solid #333',
  background:'#1a1a1a',color:'#fff',fontSize:22,fontWeight:700,
  display:'flex',alignItems:'center',justifyContent:'center',
  cursor:'pointer',userSelect:'none',flexShrink:0,
  WebkitTapHighlightColor:'transparent'
};

const SUCURSAL_CM001 = 'CM001';

/* ─────────────────────────────────────────────────────────── */
export default function InventarioFisico({user, onBack}){
  const {show,Toast}=useToast();

  // Pantallas: 'list' | 'count' | 'review'
  const [screen,setScreen]=useState('list');
  const [loading,setLoading]=useState(true);
  const [guardando,setGuardando]=useState(false);

  // Datos
  const [historial,setHistorial]=useState([]);      // inventarios previos
  const [invFisicoId,setInvFisicoId]=useState(null); // ID del inventario activo
  const [productos,setProductos]=useState([]);        // productos a contar
  const [catFilter,setCatFilter]=useState('');         // filtro categoría
  const [searchTxt,setSearchTxt]=useState('');         // búsqueda texto
  const [sucursalId,setSucursalId]=useState(null);     // UUID de CM001

  /* ── Cargar historial ── */
  useEffect(()=>{
    (async()=>{
      try{
        // Obtener UUID de CM001
        const {data:suc}=await db.from('sucursales')
          .select('id').eq('store_code',SUCURSAL_CM001).maybeSingle();
        if(!suc){show('❌ No se encontró Casa Matriz');setLoading(false);return;}
        setSucursalId(suc.id);

        // Historial de inventarios
        const {data:hist}=await db.from('inventario_fisico')
          .select('id, fecha, estado, total_productos, productos_contados, productos_con_diferencia, created_at, completado_at, usuarios_erp(nombre)')
          .eq('sucursal_id',suc.id)
          .order('created_at',{ascending:false})
          .limit(20);
        setHistorial(hist||[]);

        // ¿Hay uno en progreso?
        const enProgreso=(hist||[]).find(h=>h.estado==='en_progreso');
        if(enProgreso){
          // Ir directo a continuar ese
          await cargarInventario(enProgreso.id, suc.id);
        }

        setLoading(false);
      }catch(e){
        show('❌ '+e.message);setLoading(false);
      }
    })();
  },[]);

  /* ── Cargar o crear inventario ── */
  const cargarInventario = async (id, sucId) => {
    setLoading(true);
    try{
      setInvFisicoId(id);

      // Cargar todos los productos inventariables
      const {data:catProds}=await db.from('catalogo_productos')
        .select('id, nombre, unidad_medida, categoria')
        .eq('incluir_inventario_fisico',true)
        .order('categoria').order('nombre');

      // Cargar stock actual de CM001
      const {data:invData}=await db.from('inventario')
        .select('producto_id, stock_actual')
        .eq('sucursal_id', sucId || sucursalId);
      const stockMap=Object.fromEntries((invData||[]).map(i=>[i.producto_id, i.stock_actual]));

      // Cargar detalle ya guardado (si hay)
      const {data:detalle}=await db.from('inventario_fisico_detalle')
        .select('producto_id, cantidad_contada, notas')
        .eq('inventario_fisico_id', id);
      const detalleMap=Object.fromEntries((detalle||[]).map(d=>[d.producto_id,d]));

      const prods=(catProds||[]).map(p=>({
        producto_id: p.id,
        nombre: p.nombre,
        unidad: p.unidad_medida||'unidad',
        categoria: p.categoria||'Otros',
        stock_sistema: stockMap[p.id]||0,
        cantidad_contada: detalleMap[p.id]?.cantidad_contada ?? null,
        notas_item: detalleMap[p.id]?.notas||'',
        dirty: false // cambió desde último guardado?
      }));

      setProductos(prods);
      setScreen('count');
      setLoading(false);
    }catch(e){
      show('❌ '+e.message);setLoading(false);
    }
  };

  const iniciarNuevo = async () => {
    setLoading(true);
    try{
      // Contar productos inventariables
      const {count}=await db.from('catalogo_productos')
        .select('id',{count:'exact',head:true})
        .eq('incluir_inventario_fisico',true);

      const {data:nuevo,error}=await db.from('inventario_fisico')
        .insert({
          sucursal_id: sucursalId,
          fecha: today(),
          estado:'en_progreso',
          total_productos: count||0,
          productos_contados:0,
          contado_por: user.id,
          notas:'Inventario físico semanal'
        }).select().single();
      if(error)throw error;

      show('📋 Nuevo inventario iniciado');
      setHistorial(prev=>[nuevo,...prev]);
      await cargarInventario(nuevo.id, sucursalId);
    }catch(e){
      show('❌ '+e.message);setLoading(false);
    }
  };

  /* ── Actualizar cantidad ── */
  const setCantidad=(prodId,val)=>{
    setProductos(prev=>prev.map(p=>
      p.producto_id===prodId?{...p, cantidad_contada:val===''?null:n(val), dirty:true}:p
    ));
  };
  const stepCantidad=(prodId,delta)=>{
    setProductos(prev=>prev.map(p=>{
      if(p.producto_id!==prodId)return p;
      const cur=p.cantidad_contada===null?p.stock_sistema:p.cantidad_contada;
      return {...p, cantidad_contada:Math.max(0,cur+delta), dirty:true};
    }));
  };
  const setIgual=(prodId)=>{
    setProductos(prev=>prev.map(p=>
      p.producto_id===prodId?{...p, cantidad_contada:p.stock_sistema, dirty:true}:p
    ));
  };

  /* ── Guardar progreso parcial ── */
  const guardarProgreso = async () => {
    const dirty=productos.filter(p=>p.dirty && p.cantidad_contada!==null);
    if(dirty.length===0){show('ℹ️ No hay cambios por guardar');return;}

    setGuardando(true);
    try{
      // Upsert detalle en batches de 30
      const batchSize=30;
      for(let i=0;i<dirty.length;i+=batchSize){
        const batch=dirty.slice(i,i+batchSize).map(p=>({
          inventario_fisico_id: invFisicoId,
          producto_id: p.producto_id,
          cantidad_contada: p.cantidad_contada,
          cantidad_sistema: p.stock_sistema,
          contado_at: new Date().toISOString()
        }));
        const {error}=await db.from('inventario_fisico_detalle')
          .upsert(batch, {onConflict:'inventario_fisico_id,producto_id'});
        if(error)throw error;
      }

      // Actualizar contadores en header
      const contados=productos.filter(p=>p.cantidad_contada!==null).length;
      const conDiff=productos.filter(p=>p.cantidad_contada!==null && p.cantidad_contada!==p.stock_sistema).length;
      await db.from('inventario_fisico').update({
        productos_contados: contados,
        productos_con_diferencia: conDiff
      }).eq('id',invFisicoId);

      // Limpiar dirty flags
      setProductos(prev=>prev.map(p=>({...p,dirty:false})));
      show(`✅ ${dirty.length} productos guardados (${contados}/${productos.length} total)`);
    }catch(e){
      show('❌ Error guardando: '+e.message);
    }finally{
      setGuardando(false);
    }
  };

  /* ── Finalizar inventario ── */
  const finalizarInventario = async () => {
    const sinContar=productos.filter(p=>p.cantidad_contada===null);
    if(sinContar.length>0){
      show(`⚠️ Faltan ${sinContar.length} productos sin contar`);
      return;
    }

    setGuardando(true);
    try{
      // Guardar todo primero
      const todos=productos.map(p=>({
        inventario_fisico_id: invFisicoId,
        producto_id: p.producto_id,
        cantidad_contada: p.cantidad_contada,
        cantidad_sistema: p.stock_sistema,
        contado_at: new Date().toISOString()
      }));
      const batchSize=30;
      for(let i=0;i<todos.length;i+=batchSize){
        const batch=todos.slice(i,i+batchSize);
        const {error}=await db.from('inventario_fisico_detalle')
          .upsert(batch, {onConflict:'inventario_fisico_id,producto_id'});
        if(error)throw error;
      }

      // Actualizar stock_actual en inventario de CM001
      for(let i=0;i<productos.length;i+=batchSize){
        const batch=productos.slice(i,i+batchSize);
        await Promise.all(batch.map(p=>
          db.from('inventario').upsert({
            sucursal_id: sucursalId,
            producto_id: p.producto_id,
            stock_actual: p.cantidad_contada
          },{onConflict:'producto_id,sucursal_id'})
        ));
      }

      // Marcar como completado
      const conDiff=productos.filter(p=>p.cantidad_contada!==p.stock_sistema).length;
      await db.from('inventario_fisico').update({
        estado:'completado',
        productos_contados: productos.length,
        productos_con_diferencia: conDiff,
        completado_at: new Date().toISOString()
      }).eq('id',invFisicoId);

      show('✅ Inventario completado — stock actualizado');
      setScreen('review');
    }catch(e){
      show('❌ '+e.message);
    }finally{
      setGuardando(false);
    }
  };

  /* ── Métricas ── */
  const contados=productos.filter(p=>p.cantidad_contada!==null).length;
  const totalProds=productos.length;
  const pctContado=totalProds>0?Math.round(contados/totalProds*100):0;
  const dirtyCount=productos.filter(p=>p.dirty).length;
  const conDiferencia=productos.filter(p=>p.cantidad_contada!==null && p.cantidad_contada!==p.stock_sistema);

  /* ── Categorías disponibles ── */
  const categorias=useMemo(()=>{
    const cats=[...new Set(productos.map(p=>p.categoria))].sort();
    return cats;
  },[productos]);

  /* ── Productos filtrados ── */
  const prodsFiltrados=useMemo(()=>{
    let list=productos;
    if(catFilter) list=list.filter(p=>p.categoria===catFilter);
    if(searchTxt){
      const q=searchTxt.toLowerCase();
      list=list.filter(p=>p.nombre.toLowerCase().includes(q));
    }
    return list;
  },[productos,catFilter,searchTxt]);

  /* ── Agrupados por categoría ── */
  const porCategoria=useMemo(()=>{
    const map={};
    prodsFiltrados.forEach(p=>{
      if(!map[p.categoria])map[p.categoria]=[];
      map[p.categoria].push(p);
    });
    return map;
  },[prodsFiltrados]);
  const catKeys=Object.keys(porCategoria).sort();

  // ── LOADING ──
  if(loading){
    return(
      <div style={{minHeight:'100vh',padding:'0 16px',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <Toast/><div className="spin" style={{width:40,height:40}}/>
      </div>
    );
  }

  // ── SCREEN: REVIEW (post-finalización) ──
  if(screen==='review'){
    return(
      <div style={{minHeight:'100vh',padding:'0 16px 60px'}}>
        <Toast/>
        <div style={{padding:'20px 0 16px',display:'flex',alignItems:'center',gap:12}}>
          <button onClick={onBack} style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
          <div>
            <div style={{fontWeight:800,fontSize:18}}>✅ Inventario Completado</div>
            <div style={{color:'#4ade80',fontSize:12}}>Casa Matriz · {new Date().toLocaleDateString('es-SV')}</div>
          </div>
        </div>

        <div className="card" style={{textAlign:'center',padding:24}}>
          <div style={{fontSize:40,marginBottom:8}}>📦</div>
          <div style={{fontSize:22,fontWeight:800,color:'#4ade80'}}>{totalProds} productos contados</div>
          <div style={{color:'#888',fontSize:14,marginTop:4}}>{conDiferencia.length} con diferencias</div>
        </div>

        {conDiferencia.length>0&&(
          <>
            <div style={{fontWeight:700,fontSize:14,color:'#e63946',margin:'16px 0 8px'}}>
              ⚠️ Productos con diferencia ({conDiferencia.length})
            </div>
            {conDiferencia.sort((a,b)=>Math.abs(b.cantidad_contada-b.stock_sistema)-Math.abs(a.cantidad_contada-a.stock_sistema)).slice(0,30).map(p=>{
              const diff=p.cantidad_contada-p.stock_sistema;
              return(
                <div key={p.producto_id} className="card" style={{borderLeft:`3px solid ${diff<0?'#e63946':'#facc15'}`}}>
                  <div style={{fontWeight:600,fontSize:13}}>{p.nombre}</div>
                  <div style={{display:'flex',gap:12,fontSize:12,color:'#888',marginTop:4}}>
                    <span>Sistema: <b style={{color:'#ccc'}}>{p.stock_sistema}</b></span>
                    <span>Contado: <b style={{color:'#fff'}}>{p.cantidad_contada}</b></span>
                    <span style={{color:diff<0?'#e63946':'#facc15',fontWeight:700}}>{diff>0?'+':''}{diff}</span>
                  </div>
                </div>
              );
            })}
          </>
        )}

        <button className="btn btn-red" onClick={onBack} style={{width:'100%',marginTop:20,padding:16}}>
          ← Volver al menú
        </button>
      </div>
    );
  }

  // ── SCREEN: LIST (historial) ──
  if(screen==='list'){
    return(
      <div style={{minHeight:'100vh',padding:'0 16px 60px'}}>
        <Toast/>
        <div style={{padding:'20px 0 16px',display:'flex',alignItems:'center',gap:12}}>
          <button onClick={onBack} style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
          <div>
            <div style={{fontWeight:800,fontSize:18}}>📦 Inventario Físico</div>
            <div style={{color:'#555',fontSize:12}}>Casa Matriz · Semanal</div>
          </div>
        </div>

        <button className="btn btn-red" onClick={iniciarNuevo}
          style={{width:'100%',padding:16,fontSize:16,marginBottom:20}}>
          + Iniciar Nuevo Inventario
        </button>

        {historial.length>0&&(
          <div style={{fontWeight:700,fontSize:14,color:'#888',marginBottom:8}}>Historial</div>
        )}
        {historial.map(h=>{
          const pct=h.total_productos>0?Math.round(h.productos_contados/h.total_productos*100):0;
          const esProgreso=h.estado==='en_progreso';
          return(
            <div key={h.id} className="card" style={{cursor:esProgreso?'pointer':'default',
              borderLeft:`3px solid ${esProgreso?'#facc15':h.estado==='completado'?'#4ade80':'#555'}`}}
              onClick={esProgreso?()=>cargarInventario(h.id, sucursalId):undefined}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontWeight:600,fontSize:14}}>
                    {new Date(h.fecha+'T12:00:00').toLocaleDateString('es-SV',{weekday:'short',day:'numeric',month:'short'})}
                  </div>
                  <div style={{fontSize:12,color:'#888',marginTop:2}}>
                    {h.usuarios_erp?.nombre||'—'} · {h.productos_contados}/{h.total_productos} productos
                    {h.productos_con_diferencia>0&&<span style={{color:'#e63946'}}> · {h.productos_con_diferencia} dif</span>}
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  {esProgreso?(
                    <div style={{fontSize:12,color:'#facc15',fontWeight:600}}>
                      {pct}% ▸ Continuar
                    </div>
                  ):(
                    <div style={{fontSize:12,color:'#4ade80',fontWeight:600}}>✓ Completado</div>
                  )}
                </div>
              </div>
              {esProgreso&&(
                <div style={{height:4,background:'#222',borderRadius:2,marginTop:8,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${pct}%`,background:'#facc15',borderRadius:2}}/>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── SCREEN: COUNT (conteo activo) ──
  return(
    <div style={{minHeight:'100vh',padding:'0 16px 120px'}}>
      <Toast/>
      {/* Header */}
      <div style={{padding:'20px 0 8px',display:'flex',alignItems:'center',gap:12}}>
        <button onClick={()=>{if(dirtyCount>0){guardarProgreso();}setScreen('list');}}
          style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
        <div style={{flex:1}}>
          <div style={{fontWeight:800,fontSize:18}}>📦 Inventario Físico</div>
          <div style={{color:'#555',fontSize:12}}>Casa Matriz · {today()}</div>
        </div>
      </div>

      {/* ── Barra progreso sticky ── */}
      <div style={{position:'sticky',top:0,zIndex:20,background:'#0d0d0d',padding:'10px 0 8px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
          <span style={{fontSize:13,color:'#aaa'}}>{contados} de {totalProds}</span>
          <span style={{fontSize:13,fontWeight:700,color:pctContado===100?'#4ade80':'#e63946'}}>{pctContado}%</span>
        </div>
        <div style={{height:6,background:'#222',borderRadius:3,overflow:'hidden'}}>
          <div style={{height:'100%',width:`${pctContado}%`,background:pctContado===100?'#4ade80':'#e63946',borderRadius:3,transition:'width 0.3s ease'}}/>
        </div>

        {/* Filtros */}
        <div style={{display:'flex',gap:8,marginTop:10}}>
          <input type="text" placeholder="🔍 Buscar producto..."
            value={searchTxt} onChange={e=>setSearchTxt(e.target.value)}
            style={{flex:1,padding:'10px 12px',background:'#111',border:'1px solid #333',borderRadius:10,color:'#fff',fontSize:13}}/>
          <select value={catFilter} onChange={e=>setCatFilter(e.target.value)}
            style={{padding:'10px 8px',background:'#111',border:'1px solid #333',borderRadius:10,color:'#fff',fontSize:12,maxWidth:140}}>
            <option value="">Todas ({totalProds})</option>
            {categorias.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Dirty indicator */}
        {dirtyCount>0&&(
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8,padding:'6px 10px',background:'#facc1520',borderRadius:8,border:'1px solid #facc1540'}}>
            <span style={{fontSize:11,color:'#facc15'}}>{dirtyCount} cambios sin guardar</span>
            <button onClick={guardarProgreso} disabled={guardando}
              style={{fontSize:11,color:'#facc15',fontWeight:700,background:'none',border:'none',cursor:'pointer',padding:'4px 8px'}}>
              {guardando?'Guardando...':'💾 Guardar'}
            </button>
          </div>
        )}
      </div>

      {/* ── Productos por categoría ── */}
      {catKeys.map(cat=>{
        const items=porCategoria[cat];
        const catContados=items.filter(p=>p.cantidad_contada!==null).length;
        return(
          <div key={cat}>
            <div style={{fontWeight:700,fontSize:12,color:'#888',padding:'14px 0 8px',textTransform:'uppercase',letterSpacing:'0.5px',display:'flex',justifyContent:'space-between'}}>
              <span>{cat}</span>
              <span style={{color:catContados===items.length?'#4ade80':'#555',fontWeight:400,fontSize:11}}>{catContados}/{items.length}</span>
            </div>
            {items.map(p=>{
              const contado=p.cantidad_contada!==null;
              const diff=contado?p.cantidad_contada-p.stock_sistema:null;
              const diffColor=diff===null?'#555':diff===0?'#4ade80':diff<0?'#e63946':'#facc15';
              return(
                <div key={p.producto_id} className="card" style={{borderLeft:`3px solid ${contado?diffColor:'#333'}`,transition:'border 0.2s'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                    <div style={{fontWeight:600,fontSize:13,flex:1}}>{p.nombre}</div>
                    <div style={{fontSize:11,color:'#888',flexShrink:0,marginLeft:8}}>
                      sistema: <b style={{color:'#ccc'}}>{p.stock_sistema}</b> {p.unidad}
                    </div>
                  </div>

                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <button style={stepBtn} onClick={()=>stepCantidad(p.producto_id,-1)}>−</button>
                    <input type="number" inputMode="numeric" min="0" step="1"
                      value={p.cantidad_contada??''} onChange={e=>setCantidad(p.producto_id,e.target.value)}
                      style={{flex:1,padding:'12px 8px',background:'#0a0a0a',border:'1px solid #333',borderRadius:10,color:'#fff',fontSize:18,textAlign:'center',fontWeight:700}}
                      placeholder="—"/>
                    <button style={stepBtn} onClick={()=>stepCantidad(p.producto_id,1)}>+</button>
                  </div>

                  <div style={{display:'flex',gap:8,marginTop:8,alignItems:'center'}}>
                    {!contado&&(
                      <button onClick={()=>setIgual(p.producto_id)}
                        style={{padding:'8px 14px',borderRadius:8,border:'1px solid #333',background:'#1a1a1a',color:'#aaa',fontSize:12,cursor:'pointer'}}>
                        = Sistema ({p.stock_sistema})
                      </button>
                    )}
                    {contado&&(
                      <div style={{flex:1,textAlign:'center',padding:'6px 10px',borderRadius:8,
                        background:diffColor+'20',border:'1px solid '+diffColor,color:diffColor,fontWeight:600,fontSize:13}}>
                        {diff>0?'+':''}{diff} <span style={{fontSize:10,fontWeight:400}}>{diff===0?'OK':'diferencia'}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* ── Botones sticky ── */}
      <div style={{position:'fixed',bottom:0,left:0,right:0,padding:'12px 16px',background:'linear-gradient(transparent, #0d0d0d 30%)',zIndex:20}}>
        <div style={{display:'flex',gap:10}}>
          <button className="btn btn-ghost" onClick={guardarProgreso} disabled={guardando||dirtyCount===0}
            style={{flex:1,padding:14,opacity:dirtyCount===0?0.5:1}}>
            {guardando?<span className="spin"/>:`💾 Guardar (${dirtyCount})`}
          </button>
          <button className="btn btn-red" onClick={finalizarInventario}
            disabled={guardando||contados<totalProds}
            style={{flex:1,padding:14,opacity:contados<totalProds?0.5:1}}>
            {contados<totalProds?`Faltan ${totalProds-contados}`:'✓ Finalizar'}
          </button>
        </div>
      </div>
    </div>
  );
}
