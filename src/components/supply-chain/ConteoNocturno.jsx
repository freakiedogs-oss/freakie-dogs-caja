import { useState, useEffect } from 'react';
import { db } from '../../supabase';
import { today, n } from '../../config';
import { useToast } from '../../hooks/useToast';

const ROLES_MULTI_SUCURSAL = ['ejecutivo', 'admin'];

/* ── Stepper button style (48px touch target) ── */
const stepBtn={
  width:48,height:48,borderRadius:12,border:'1px solid #333',
  background:'#1a1a1a',color:'#fff',fontSize:22,fontWeight:700,
  display:'flex',alignItems:'center',justifyContent:'center',
  cursor:'pointer',userSelect:'none',flexShrink:0,
  WebkitTapHighlightColor:'transparent'
};
const stepBtnActive={...stepBtn,background:'#e63946',border:'1px solid #e63946'};

export default function ConteoNocturno({user,onBack}){
  const {show,Toast}=useToast();
  const [screen,setScreen]=useState(1); // 0=seleccionar sucursal, 1=conteo, 2=pedido
  const [sucursalId,setSucursalId]=useState(null);
  const [sucursalNombre,setSucursalNombre]=useState('');
  const [sucursales,setSucursales]=useState([]);
  const [productos,setProductos]=useState([]);
  const [loading,setLoading]=useState(true);
  const [guardando,setGuardando]=useState(false);
  const [generandoPedido,setGenerandoPedido]=useState(false);
  const [conteoHoy,setConteoHoy]=useState(null);
  const [pedidoItems,setPedidoItems]=useState([]);
  const [pedidoQtys,setPedidoQtys]=useState({});
  const [isEdit,setIsEdit]=useState(false);        // editando conteo existente
  const [editExpira,setEditExpira]=useState(null);  // Date cuando expira la ventana de edición
  const [ocultarCero,setOcultarCero]=useState(false); // toggle para ocultar pedido=0 en Screen 2
  const [gruposAbiertos,setGruposAbiertos]=useState({}); // {cat: bool} — todos cerrados al inicio
  const toggleGrupo=(cat)=>setGruposAbiertos(prev=>({...prev,[cat]:!prev[cat]}));
  const [tiempoRestante,setTiempoRestante]=useState('');
  const [conteoCerrado,setConteoCerrado]=useState(false); // true cuando hay conteo >6h

  const EDIT_WINDOW_MS = 6*60*60*1000; // 6 horas
  const needsSucursalPicker = ROLES_MULTI_SUCURSAL.includes(user.rol) || !user.store_code;

  // Timer para mostrar tiempo restante de edición
  useEffect(()=>{
    if(!editExpira) return;
    const tick=()=>{
      const ms=editExpira.getTime()-Date.now();
      if(ms<=0){setTiempoRestante('expirado');return;}
      const h=Math.floor(ms/3600000);
      const m=Math.floor((ms%3600000)/60000);
      setTiempoRestante(`${h}h ${m}m restantes`);
    };
    tick();
    const iv=setInterval(tick,60000);
    return ()=>clearInterval(iv);
  },[editExpira]);

  // Cargar inventario para una sucursal específica
  const cargarInventario = async (sucId) => {
    setSucursalId(sucId);
    setLoading(true);
    try {
      const hoy = today();

      // 1. Verificar si ya existe conteo hoy (múltiples filas, una por producto)
      const {data:conteoRows} = await db.from('inventario_conteo_nocturno')
        .select('producto_id, cantidad_real, cantidad_teorica, created_at')
        .eq('sucursal_id', sucId).eq('fecha', hoy);

      // 2. Cargar solo productos marcados para conteo nocturno
      const {data:invData} = await db.from('inventario')
        .select('id, producto_id, stock_actual, stock_minimo, stock_maximo, catalogo_productos(id, nombre, unidad_medida, categoria, incluir_conteo, conteo_categoria, conteo_orden)')
        .eq('sucursal_id', sucId)
        .eq('catalogo_productos.incluir_conteo', true);

      const prods = (invData||[])
        .filter(inv => inv.catalogo_productos?.incluir_conteo)
        .map(inv => ({
          inventario_id: inv.id,
          producto_id: inv.producto_id,
          nombre: inv.catalogo_productos?.nombre || 'Sin nombre',
          unidad: inv.catalogo_productos?.unidad_medida || 'unidad',
          categoria: inv.catalogo_productos?.conteo_categoria || inv.catalogo_productos?.categoria || 'Otros',
          conteo_orden: inv.catalogo_productos?.conteo_orden || 999,
          stock_teorico: inv.stock_actual,
          stock_minimo: inv.stock_minimo,
          stock_maximo: inv.stock_maximo,
          cantidad_real: null
        }))
        .sort((a,b) => a.conteo_orden - b.conteo_orden);

      if (conteoRows && conteoRows.length > 0) {
        // Conteo ya existe — verificar ventana de 6h
        const oldest = conteoRows.reduce((min,r)=> r.created_at<min?r.created_at:min, conteoRows[0].created_at);
        const createdAt = new Date(oldest);
        const expira = new Date(createdAt.getTime() + EDIT_WINDOW_MS);
        const dentroDeVentana = Date.now() < expira.getTime();

        // Mapa de cantidades guardadas
        const conteoMap = Object.fromEntries(conteoRows.map(r=>[r.producto_id, r.cantidad_real]));

        if (dentroDeVentana) {
          // Dentro de 6h → permitir edición, pre-llenar cantidades
          const prodsConDatos = prods.map(p=>({...p, cantidad_real: conteoMap[p.producto_id] ?? null}));
          setProductos(prodsConDatos);
          setIsEdit(true);
          setEditExpira(expira);
          setConteoHoy(conteoRows);
          setScreen(1);
          show('✏️ Editando conteo existente');
        } else {
          // >6h → conteo anterior cerrado, permitir nuevo conteo (turno PM)
          // Pre-llenar con datos del conteo anterior como referencia
          const prodsConDatos = prods.map(p=>({...p, cantidad_real: null}));
          setProductos(prodsConDatos);
          setConteoHoy(conteoRows);
          setConteoCerrado(true);
          setIsEdit(false);
          setEditExpira(null);
          setScreen(1);
          show('📋 Nuevo conteo — el anterior se guardó hace >6h');
        }
      } else {
        // Sin conteo → formulario nuevo
        setProductos(prods);
        setIsEdit(false);
        setEditExpira(null);
        setScreen(1);
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

  const stepCantidad=(prodId,delta)=>{
    setProductos(prev=>prev.map(p=>{
      if(p.producto_id!==prodId)return p;
      const cur=p.cantidad_real===null?p.stock_teorico:p.cantidad_real;
      return {...p,cantidad_real:Math.max(0,cur+delta)};
    }));
  };

  const setIgualTeorico=(prodId)=>{
    setProductos(prev=>prev.map(p=>p.producto_id===prodId?{...p,cantidad_real:p.stock_teorico}:p));
  };

  // Progreso del conteo
  const contados=productos.filter(p=>p.cantidad_real!==null).length;
  const totalProds=productos.length;
  const pctContado=totalProds>0?Math.round(contados/totalProds*100):0;

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
      show('⚠️ Faltan '+sinCantidad.length+' productos sin contar');
      return;
    }

    // Si es edición, verificar que aún estemos dentro de la ventana
    if(isEdit && editExpira && Date.now()>=editExpira.getTime()){
      show('🔒 La ventana de edición (6h) ha expirado');
      return;
    }

    setGuardando(true);
    try{
      const hoy=today();

      // 1. Siempre borrar registros previos de hoy (por si quedaron parciales)
      await db.from('inventario_conteo_nocturno')
        .delete().eq('sucursal_id',sucursalId).eq('fecha',hoy);

      // 2. Insertar conteo (sin "diferencia" — es columna generada en DB)
      const conteos=productos.map(p=>({
        sucursal_id: sucursalId,
        producto_id: p.producto_id,
        fecha: hoy,
        cantidad_real: p.cantidad_real,
        cantidad_teorica: p.stock_teorico,
        contado_por: user.id,
        notas: isEdit?'Editado':'Conteo inicial'
      }));

      const {error:conteoErr}=await db.from('inventario_conteo_nocturno')
        .insert(conteos);
      if(conteoErr)throw conteoErr;

      // 3. Actualizar stock_actual en inventario (en lotes de 20 para velocidad)
      const batchSize=20;
      for(let i=0;i<productos.length;i+=batchSize){
        const batch=productos.slice(i,i+batchSize);
        await Promise.all(batch.map(p=>
          db.from('inventario').update({stock_actual:p.cantidad_real})
            .eq('producto_id',p.producto_id).eq('sucursal_id',sucursalId)
        ));
      }

      setConteoHoy({});
      show(isEdit?'✅ Conteo actualizado':'✅ Conteo guardado');

      // 4. Preparar pedido sugerido — mostrar TODOS los productos
      // Los que están bajo mínimo tienen cantidad sugerida, el resto qty=0
      const todosParaPedido=productos.map(p=>{
        const bajominimo=p.stock_minimo>0 && p.cantidad_real<p.stock_minimo;
        return {
          producto_id: p.producto_id,
          nombre: p.nombre,
          unidad: p.unidad,
          categoria: p.categoria,
          cantidad_real: p.cantidad_real,
          stock_minimo: p.stock_minimo,
          stock_maximo: p.stock_maximo,
          cantidad_sugerida: bajominimo ? Math.max(0, p.stock_maximo-p.cantidad_real) : 0,
          bajominimo
        };
      });
      // Ordenar: bajo mínimo primero, luego el resto
      todosParaPedido.sort((a,b)=>(b.bajominimo?1:0)-(a.bajominimo?1:0));

      setPedidoItems(todosParaPedido);
      setPedidoQtys(Object.fromEntries(todosParaPedido.map(s=>[s.producto_id, s.cantidad_sugerida])));
      setScreen(2);
    }catch(e){
      show('❌ Error: '+e.message);
    }finally{
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

  // Orden fijo de grupos según hoja de control de inventario
  const ORDEN_GRUPOS=[
    'CARNES Y COMPLEMENTOS',
    'VEGETALES - VERDURAS',
    'QUESOS - LACTEOS',
    'PANES',
    'PAPAS - CONGELADOS',
    'SALSAS Y ADEREZOS',
    'EMPAQUES Y DESECHABLES',
    'BEBIDAS',
    'EXTRAS',
    'UTENSILIOS DE LIMPIEZA',
  ];

  // Agrupar productos por categoría
  const porCategoria={};
  productos.forEach(p=>{
    if(!porCategoria[p.categoria])porCategoria[p.categoria]=[];
    porCategoria[p.categoria].push(p);
  });
  // Ordenar grupos por lista fija; desconocidos al final
  const categorias=Object.keys(porCategoria).sort((a,b)=>{
    const ia=ORDEN_GRUPOS.indexOf(a);
    const ib=ORDEN_GRUPOS.indexOf(b);
    return (ia===-1?999:ia)-(ib===-1?999:ib);
  });

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
      <div style={{minHeight:'100vh',padding:'0 16px 100px'}}>
        <Toast/>
        {/* Header */}
        <div style={{padding:'20px 0 8px',display:'flex',alignItems:'center',gap:12}}>
          <button onClick={needsSucursalPicker?()=>setScreen(0):onBack} style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:18}}>📋 Conteo Nocturno</div>
            <div style={{color:'#555',fontSize:12}}>{sucursalNombre} · {new Date(Date.now()-6*3600*1000).toLocaleDateString('es-SV',{weekday:'short',month:'short',day:'numeric'})}</div>
          </div>
        </div>

        {/* ── Barra de progreso sticky ── */}
        <div style={{position:'sticky',top:0,zIndex:20,background:'#0d0d0d',padding:'10px 0 12px'}}>
          {/* Banner modo edición */}
          {isEdit&&(
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',marginBottom:8,borderRadius:8,background:'#facc1520',border:'1px solid #facc15'}}>
              <span style={{fontSize:12,color:'#facc15',fontWeight:600}}>✏️ Editando conteo</span>
              <span style={{fontSize:11,color:'#facc15'}}>{tiempoRestante}</span>
            </div>
          )}
          {conteoCerrado&&!isEdit&&(
            <div style={{padding:'8px 12px',marginBottom:8,borderRadius:8,background:'#4ade8020',border:'1px solid #4ade80'}}>
              <span style={{fontSize:12,color:'#4ade80',fontWeight:600}}>📋 Nuevo conteo — reemplaza el anterior (+6h)</span>
            </div>
          )}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <span style={{fontSize:13,color:'#aaa'}}>{contados} de {totalProds} contados</span>
            <span style={{fontSize:13,fontWeight:700,color:pctContado===100?'#4ade80':'#e63946'}}>{pctContado}%</span>
          </div>
          <div style={{height:6,background:'#222',borderRadius:3,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${pctContado}%`,background:pctContado===100?'#4ade80':'#e63946',borderRadius:3,transition:'width 0.3s ease'}}/>
          </div>
        </div>

        {categorias.map(cat=>{
          const catContados=porCategoria[cat].filter(p=>p.cantidad_real!==null).length;
          const catTotal=porCategoria[cat].length;
          const catCompleta=catContados===catTotal;
          const abierto=!!gruposAbiertos[cat];
          return(
          <div key={cat} style={{marginBottom:4}}>
            {/* Cabecera colapsable */}
            <button onClick={()=>toggleGrupo(cat)}
              style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'12px 14px',borderRadius:10,border:'1px solid #222',cursor:'pointer',
                background:catCompleta?'#0d2a1a':'#13131f',
                borderColor:catCompleta?'#4ade8040':'#222',
                marginBottom:abierto?6:0,transition:'all 0.15s'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:14,color:catCompleta?'#4ade80':'#888',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.5px'}}>
                  {cat}
                </span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:12,fontWeight:600,
                  color:catCompleta?'#4ade80':catContados>0?'#facc15':'#555',
                  background:catCompleta?'#4ade8020':catContados>0?'#facc1520':'#1a1a1a',
                  padding:'2px 8px',borderRadius:99,border:`1px solid ${catCompleta?'#4ade8040':catContados>0?'#facc1540':'#333'}`}}>
                  {catContados}/{catTotal}
                </span>
                <span style={{fontSize:16,color:'#555',lineHeight:1}}>{abierto?'▲':'▼'}</span>
              </div>
            </button>

            {/* Items — solo si abierto */}
            {abierto && porCategoria[cat].map(p=>{
              const contado=p.cantidad_real!==null;
              const diff=getDiferencia(p);
              return(
              <div key={p.producto_id} className="card" style={{borderLeft:contado?'3px solid #4ade80':'3px solid #333',transition:'border 0.2s'}}>
                {/* Nombre + stock teórico */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <div style={{fontWeight:600,fontSize:14}}>{p.nombre}</div>
                  <div style={{fontSize:12,color:'#888',flexShrink:0,marginLeft:8}}>teórico: <b style={{color:'#ccc'}}>{p.stock_teorico}</b> {p.unidad}</div>
                </div>

                {/* ── Stepper: [-] input [+] ── */}
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <button style={stepBtn} onClick={()=>stepCantidad(p.producto_id,-1)}>−</button>
                  <input type="number" inputMode="numeric" min="0" step="1" value={p.cantidad_real??''}
                    onChange={e=>updateCantidadReal(p.producto_id, e.target.value)}
                    style={{flex:1,padding:'12px 8px',background:'#0a0a0a',border:'1px solid #333',borderRadius:10,color:'#fff',fontSize:18,textAlign:'center',fontWeight:700}}
                    placeholder="—"/>
                  <button style={stepBtn} onClick={()=>stepCantidad(p.producto_id,1)}>+</button>
                </div>

                {/* ── Botón "= Teórico" + diferencia ── */}
                <div style={{display:'flex',gap:8,marginTop:8,alignItems:'center'}}>
                  {!contado&&(
                    <button onClick={()=>setIgualTeorico(p.producto_id)}
                      style={{padding:'8px 14px',borderRadius:8,border:'1px solid #333',background:'#1a1a1a',color:'#aaa',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}}>
                      = Teórico ({p.stock_teorico})
                    </button>
                  )}
                  {contado&&(
                    <div style={{flex:1,textAlign:'center',padding:'6px 10px',borderRadius:8,background:getDifColor(p)+'20',border:'1px solid '+getDifColor(p),color:getDifColor(p),fontWeight:600,fontSize:13}}>
                      {diff>0?'+':''}{diff} <span style={{fontSize:10,fontWeight:400}}>diferencia</span>
                    </div>
                  )}
                </div>
              </div>
            );})
            }
          </div>
        );})}

        {/* ── Botón Guardar sticky ── */}
        <div style={{position:'fixed',bottom:0,left:0,right:0,padding:'12px 16px',background:'linear-gradient(transparent, #0d0d0d 30%)',zIndex:20}}>
          <button className="btn btn-red" onClick={guardarConteo} disabled={guardando||contados<totalProds}
            style={{fontSize:17,padding:18,width:'100%',opacity:contados<totalProds?0.5:1}}>
            {guardando?<span className="spin"/>:contados<totalProds?`Faltan ${totalProds-contados} productos`:isEdit?'✏️ Actualizar Conteo':'✓ Guardar Conteo'}
          </button>
        </div>
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
          <div style={{color:'#555',fontSize:12}}>{pedidoItems.length} productos · <span style={{color:'#e63946'}}>{pedidoItems.filter(p=>p.bajominimo).length} bajo mínimo</span></div>
        </div>
      </div>

      {pedidoItems.length===0?(
        <div className="card" style={{textAlign:'center',padding:40}}>
          <div style={{fontSize:18,marginBottom:8}}>✓ Stock OK</div>
          <div style={{color:'#666',fontSize:13}}>No se requieren pedidos en este momento</div>
        </div>
      ):(
        <>
          {/* Toggle ocultar productos con pedido 0 */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:'#1a1a1a',borderRadius:10,marginBottom:12,border:'1px solid #333'}}>
            <span style={{fontSize:13,color:'#aaa'}}>Ocultar productos con pedido 0</span>
            <button onClick={()=>setOcultarCero(!ocultarCero)}
              style={{width:48,height:28,borderRadius:14,border:'none',cursor:'pointer',position:'relative',
                background:ocultarCero?'#4ade80':'#333',transition:'background 0.2s'}}>
              <div style={{width:22,height:22,borderRadius:11,background:'#fff',position:'absolute',top:3,
                left:ocultarCero?23:3,transition:'left 0.2s'}}/>
            </button>
          </div>
          {pedidoItems.filter(p=>!ocultarCero||n(pedidoQtys[p.producto_id]||0)>0).map(p=>{
            const qty=n(pedidoQtys[p.producto_id]||0);
            return(
            <div key={p.producto_id} className="card" style={p.bajominimo?{borderLeft:'3px solid #e63946'}:{}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontWeight:600,fontSize:14}}>{p.nombre}</div>
                {p.bajominimo&&qty>0&&<span style={{fontSize:10,color:'#e63946',fontWeight:600}}>BAJO MÍNIMO</span>}
                {qty===0&&<span style={{fontSize:11,color:'#555'}}>sin pedido</span>}
              </div>
              <div style={{display:'flex',gap:6,fontSize:12,color:'#888',marginBottom:10,flexWrap:'wrap'}}>
                <span>Real: <b style={{color:'#ccc'}}>{p.cantidad_real}</b></span>
                <span>·</span>
                <span>Mín: <b style={{color:'#facc15'}}>{p.stock_minimo}</b></span>
                <span>·</span>
                <span>Máx: <b style={{color:'#4ade80'}}>{p.stock_maximo}</b></span>
              </div>
              {/* ── Stepper pedido ── */}
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <button style={stepBtn} onClick={()=>setPedidoQtys(prev=>({...prev,[p.producto_id]:Math.max(0,qty-1)}))}>−</button>
                <input type="number" inputMode="numeric" min="0" step="1"
                  value={pedidoQtys[p.producto_id]??0}
                  onChange={e=>setPedidoQtys(prev=>({...prev,[p.producto_id]:e.target.value}))}
                  style={{flex:1,padding:'12px 8px',background:'#0a0a0a',border:'1px solid #333',borderRadius:10,color:'#fff',fontSize:18,textAlign:'center',fontWeight:700}}/>
                <button style={stepBtn} onClick={()=>setPedidoQtys(prev=>({...prev,[p.producto_id]:qty+1}))}>+</button>
              </div>
            </div>
          );}
          )}
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
