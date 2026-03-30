import { useState, useEffect } from 'react';
import { db } from '../../supabase';
import { today, n } from '../../config';
import { useToast } from '../../hooks/useToast';

const fmt$ = (n) => `$${parseFloat(n || 0).toFixed(2)}`;


const ROLES_MULTI_SUCURSAL = ['ejecutivo', 'admin'];

export default function ConteoNocturno({user,onBack}){
  const {show,Toast}=useToast();
  const [screen,setScreen]=useState(1); // 0=seleccionar sucursal, 1=conteo, 2=pedido
  const [sucursalId,setSucursalId]=useState(null);
  const [sucursalNombre,setSucursalNombre]=useState('');
  const [sucursales,setSucursales]=useState([]);
  const [productos,setProductos]=useState([]); // {id, nombre, unidad, stock_actual, categoria, cantidad_real}
  const [loading,setLoading]=useState(true);
  const [guardando,setGuardando]=useState(false);
  const [generandoPedido,setGenerandoPedido]=useState(false);
  const [conteoHoy,setConteoHoy]=useState(null);
  const [pedidoItems,setPedidoItems]=useState([]); // {producto_id, nombre, cantidad_real, stock_minimo, stock_maximo, cantidad_sugerida}
  const [pedidoQtys,setPedidoQtys]=useState({}); // {producto_id: cantidad}

  const needsSucursalPicker = ROLES_MULTI_SUCURSAL.includes(user.rol) || !user.store_code;

  // Cargar inventario para una sucursal específica
  const cargarInventario = async (sucId) => {
    setSucursalId(sucId);
    setLoading(true);
    try {
      const hoy = today();
      const {data:existente} = await db.from('inventario_conteo_nocturno')
        .select('*').eq('sucursal_id', sucId).eq('fecha', hoy).maybeSingle();
      if (existente) {
        setConteoHoy(existente);
        setScreen(2);
        show('⏭ Conteo ya realizado, mostrando pedido sugerido');
      } else {
        setScreen(1);
      }

      const {data:invData} = await db.from('inventario')
        .select('id, producto_id, stock_actual, stock_minimo, stock_maximo, catalogo_productos(id, nombre, unidad_medida, categoria)')
        .eq('sucursal_id', sucId).order('catalogo_productos(categoria)', {ascending: true});

      if (invData && invData.length > 0) {
        const prods = invData.map(inv => ({
          inventario_id: inv.id,
          producto_id: inv.producto_id,
          nombre: inv.catalogo_productos?.nombre || 'Sin nombre',
          unidad: inv.catalogo_productos?.unidad_medida || 'unidad',
          categoria: inv.catalogo_productos?.categoria || 'Otros',
          stock_teorico: inv.stock_actual,
          stock_minimo: inv.stock_minimo,
          stock_maximo: inv.stock_maximo,
          cantidad_real: null
        }));
        setProductos(prods);
      }
      setLoading(false);
    } catch(e) {
      show('❌ Error cargando datos: ' + e.message);
      setLoading(false);
    }
  };

  // Obtener sucursal_id y cargar inventario
  useEffect(()=>{
    const init=async()=>{
      try{
        if (needsSucursalPicker) {
          // Ejecutivo/admin: mostrar selector de sucursales (excluir Casa Matriz)
          const {data:allSucs} = await db.from('sucursales')
            .select('id, nombre, store_code')
            .neq('store_code', 'CM001')
            .order('nombre');
          setSucursales(allSucs || []);
          setScreen(0); // pantalla de selección
          setLoading(false);
          return;
        }

        // Usuario con store_code: ir directo
        const {data:suc}=await db.from('sucursales')
          .select('id, nombre').eq('store_code',user.store_code).maybeSingle();
        if(!suc){show('❌ No se encontró sucursal');setLoading(false);return;}
        setSucursalNombre(suc.nombre);
        await cargarInventario(suc.id);
      }catch(e){
        show('❌ Error cargando datos: '+e.message);
        setLoading(false);
      }
    };
    init();
  },[]);

  const updateCantidadReal=(prodId,val)=>{
    setProductos(prev=>prev.map(p=>p.producto_id===prodId?{...p,cantidad_real:val===''?null:n(val)}:p));
  };

  const getDiferencia=(prod)=>{
    if(prod.cantidad_real===null)return null;
    return prod.cantidad_real-prod.stock_teorico;
  };

  const getDifColor=(prod)=>{
    const diff=getDiferencia(prod);
    if(diff===null)return '#555';
    if(diff>=0)return '#4ade80'; // verde
    if(diff<-prod.stock_teorico*0.1)return '#f87171'; // rojo (>10% bajo)
    return '#facc15'; // amarillo
  };

  const guardarConteo=async()=>{
    // Validar que todos tengan cantidad_real
    const sinCantidad=productos.filter(p=>p.cantidad_real===null);
    if(sinCantidad.length>0){
      show('⚠️ Faltan cantidades para: '+sinCantidad.map(p=>p.nombre).join(', '));
      return;
    }

    setGuardando(true);
    try{
      const hoy=today();
      // Insertar conteo para cada producto
      const conteos=productos.map(p=>({
        sucursal_id: sucursalId,
        producto_id: p.producto_id,
        fecha: hoy,
        cantidad_real: p.cantidad_real,
        cantidad_teorica: p.stock_teorico,
        diferencia: p.cantidad_real-p.stock_teorico,
        contado_por: user.id,
        notas: null
      }));

      const {data:conteoData,error:conteoErr}=await db.from('inventario_conteo_nocturno')
        .insert(conteos).select();

      if(conteoErr)throw conteoErr;

      // Actualizar stock_actual en inventario con la cantidad real
      for(const p of productos){
        await db.from('inventario').update({stock_actual:p.cantidad_real})
          .eq('producto_id',p.producto_id).eq('sucursal_id',sucursalId);
      }

      setConteoHoy({});
      setGuardando(false);
      show('✓ Conteo guardado');

      // Preparar pedido sugerido
      const sugerencias=productos
        .filter(p=>p.cantidad_real<p.stock_minimo)
        .map(p=>({
          producto_id: p.producto_id,
          nombre: p.nombre,
          unidad: p.unidad,
          cantidad_real: p.cantidad_real,
          stock_minimo: p.stock_minimo,
          stock_maximo: p.stock_maximo,
          cantidad_sugerida: p.stock_maximo-p.cantidad_real
        }));

      setPedidoItems(sugerencias);
      if(sugerencias.length===0){
        show('✓ No se requieren pedidos (stock OK)');
        setTimeout(()=>onBack(), 2000);
      }else{
        setPedidoQtys(Object.fromEntries(sugerencias.map(s=>[s.producto_id, s.cantidad_sugerida])));
        setScreen(2);
      }
    }catch(e){
      show('❌ Error guardando: '+e.message);
      setGuardando(false);
    }
  };

  const enviarPedido=async()=>{
    // Filtrar items con cantidad > 0
    const items=pedidoItems.filter(p=>n(pedidoQtys[p.producto_id])>0);
    if(items.length===0){
      show('⚠️ No hay productos con cantidad > 0');
      return;
    }

    setGenerandoPedido(true);
    try{
      // Crear pedido_sucursal
      const {data:pedido,error:pedErr}=await db.from('pedidos_sucursal')
        .insert({
          fecha_pedido: today(),
          sucursal_id: sucursalId,
          estado: 'enviado',
          solicitado_por: user.id,
          notas: 'Auto-generado por Conteo Nocturno'
        }).select().single();

      if(pedErr)throw pedErr;

      // Insertar pedido_items
      const pedidoItems=items.map(p=>({
        pedido_id: pedido.id,
        producto_id: p.producto_id,
        cantidad_solicitada: n(pedidoQtys[p.producto_id]),
        cantidad_despachada: 0,
        unidad: p.unidad
      }));

      const {error:itemErr}=await db.from('pedido_items').insert(pedidoItems);
      if(itemErr)throw itemErr;

      setGenerandoPedido(false);
      show('✓ Pedido enviado al almacén');
      setTimeout(()=>onBack(), 2000);
    }catch(e){
      show('❌ Error creando pedido: '+e.message);
      setGenerandoPedido(false);
    }
  };

  const omitirPedido=()=>{
    onBack();
  };

  // Agrupar productos por categoría
  const porCategoria={};
  productos.forEach(p=>{
    if(!porCategoria[p.categoria])porCategoria[p.categoria]=[];
    porCategoria[p.categoria].push(p);
  });
  const categorias=Object.keys(porCategoria).sort();

  if(loading){
    return(
      <div style={{minHeight:'100vh',padding:'0 16px 60px',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <Toast/>
        <div className="spin" style={{width:40,height:40}}/>
      </div>
    );
  }

  // ── SCREEN 0: SELECTOR DE SUCURSAL (ejecutivo/admin) ──
  if(screen===0){
    return(
      <div style={{minHeight:'100vh',padding:'0 16px 60px'}}>
        <Toast/>
        <div style={{padding:'20px 0 16px',display:'flex',alignItems:'center',gap:12}}>
          <button onClick={onBack} style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
          <div>
            <div style={{fontWeight:800,fontSize:18}}>📋 Conteo Nocturno</div>
            <div style={{color:'#555',fontSize:12}}>Seleccionar sucursal</div>
          </div>
        </div>
        {sucursales.map(s=>(
          <button key={s.id} className="card" onClick={()=>{setSucursalNombre(s.nombre);cargarInventario(s.id);}}
            style={{width:'100%',textAlign:'left',cursor:'pointer',border:'1px solid #333',background:'#111',marginBottom:8}}>
            <div style={{fontWeight:600,fontSize:15,color:'#fff'}}>{s.nombre}</div>
            <div style={{color:'#888',fontSize:12}}>{s.store_code}</div>
          </button>
        ))}
      </div>
    );
  }

  // ── SCREEN 1: CONTEO ──
  if(screen===1){
    return(
      <div style={{minHeight:'100vh',padding:'0 16px 60px'}}>
        <Toast/>
        <div style={{padding:'20px 0 16px',display:'flex',alignItems:'center',gap:12}}>
          <button onClick={needsSucursalPicker?()=>setScreen(0):onBack} style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
          <div>
            <div style={{fontWeight:800,fontSize:18}}>📋 Conteo Nocturno</div>
            <div style={{color:'#555',fontSize:12}}>{sucursalNombre} · {new Date(Date.now()-6*3600*1000).toLocaleDateString('es-SV',{weekday:'short',month:'short',day:'numeric'})}</div>
          </div>
        </div>

        {categorias.map(cat=>(
          <div key={cat}>
            <div style={{fontWeight:700,fontSize:13,color:'#888',padding:'14px 0 8px',textTransform:'uppercase',letterSpacing:'0.5px'}}>
              {cat}
            </div>
            {porCategoria[cat].map(p=>(
              <div key={p.producto_id} className="card">
                <div style={{fontWeight:600,fontSize:14,marginBottom:8}}>{p.nombre}</div>
                <div className="row"><span style={{fontSize:12,color:'#888'}}>Stock teórico</span><span>{p.stock_teorico} {p.unidad}</span></div>
                <div style={{display:'flex',gap:8,marginTop:10}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,color:'#666',marginBottom:4}}>Cantidad Real</div>
                    <input type="number" min="0" step="1" value={p.cantidad_real??''}
                      onChange={e=>updateCantidadReal(p.producto_id, e.target.value)}
                      style={{width:'100%',padding:'10px',background:'#0a0a0a',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:14}}
                      placeholder="0"/>
                  </div>
                  {p.cantidad_real!==null&&(
                    <div style={{flex:1,textAlign:'center',padding:'10px',borderRadius:8,background:getDifColor(p)+'20',border:'1px solid '+getDifColor(p),color:getDifColor(p),fontWeight:600,fontSize:13}}>
                      {getDiferencia(p)>0?'+':''}{getDiferencia(p)}<br/><span style={{fontSize:10}}>diferencia</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}

        <button className="btn btn-red" onClick={guardarConteo} disabled={guardando} style={{fontSize:17,padding:18,marginTop:20}}>
          {guardando?<span className="spin"/>:'✓ Guardar Conteo'}
        </button>
      </div>
    );
  }

  // ── SCREEN 2: PEDIDO SUGERIDO ──
  return(
    <div style={{minHeight:'100vh',padding:'0 16px 60px'}}>
      <Toast/>
      <div style={{padding:'20px 0 16px',display:'flex',alignItems:'center',gap:12}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
        <div>
          <div style={{fontWeight:800,fontSize:18}}>📦 Pedido Sugerido</div>
          <div style={{color:'#555',fontSize:12}}>{pedidoItems.length} productos</div>
        </div>
      </div>

      {pedidoItems.length===0?(
        <div className="card" style={{textAlign:'center',padding:40}}>
          <div style={{fontSize:18,marginBottom:8}}>✓ Stock OK</div>
          <div style={{color:'#666',fontSize:13}}>No se requieren pedidos en este momento</div>
        </div>
      ):(
        <>
          {pedidoItems.map(p=>(
            <div key={p.producto_id} className="card">
              <div style={{fontWeight:600,fontSize:14,marginBottom:8}}>{p.nombre}</div>
              <div className="row"><span style={{fontSize:12,color:'#888'}}>Contado (real)</span><span>{p.cantidad_real} {p.unidad}</span></div>
              <div className="row"><span style={{fontSize:12,color:'#888'}}>Stock mínimo</span><span>{p.stock_minimo} {p.unidad}</span></div>
              <div className="row"><span style={{fontSize:12,color:'#888'}}>Stock máximo</span><span>{p.stock_maximo} {p.unidad}</span></div>
              <div style={{display:'flex',gap:8,marginTop:10}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,color:'#666',marginBottom:4}}>Cantidad a ordenar</div>
                  <input type="number" min="0" step="1"
                    value={pedidoQtys[p.producto_id]??0}
                    onChange={e=>setPedidoQtys(prev=>({...prev,[p.producto_id]:e.target.value}))}
                    style={{width:'100%',padding:'10px',background:'#0a0a0a',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:14}}/>
                </div>
                <div style={{flex:1,display:'flex',alignItems:'flex-end'}}>
                  <button className="btn btn-danger btn-sm" onClick={()=>setPedidoQtys(prev=>({...prev,[p.producto_id]:0}))}
                    style={{width:'100%',padding:'10px'}}>
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <div style={{display:'flex',gap:10,marginTop:20}}>
        <button className="btn btn-ghost" onClick={omitirPedido} style={{flex:1}}>
          Omitir Pedido
        </button>
        <button className="btn btn-red" onClick={enviarPedido} disabled={generandoPedido||pedidoItems.length===0} style={{flex:1,padding:14}}>
          {generandoPedido?<span className="spin"/>:'📤 Enviar'}
        </button>
      </div>
    </div>
  );
}
