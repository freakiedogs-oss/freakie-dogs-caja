import { useState, useEffect } from 'react';
import { db } from '../../supabase';
import InfoTip from '../ui/InfoTip'
import { today, n } from '../../config';
import { useToast } from '../../hooks/useToast';

const ROLES_MULTI_SUCURSAL = ['ejecutivo', 'admin', 'superadmin'];

// Escotilla para revisar las pantallas de conteo con la caja abierta, saltándose los
// gates de cierre Z y de despachos pendientes. VA VACÍA salvo mientras se revisa algo:
// sin gates se puede contar sobre un día sin cerrar y el teórico queda comparado
// contra ventas a medio turno, así que el conteo sale mal y nadie se entera.
// Historial: M001 estuvo acá del 30-ago al 1-sep para revisar merma/bebidas/cortesías
// (Jose), y se devolvió al confirmar que las pantallas quedaron listas.
const SIN_GATES_TEMPORAL = [];

// Quién puede autorizar un faltante de conteo (lo que se le descuenta a la
// sucursal): gerencia hacia arriba. La cajera que cuenta no puede firmarse sola.
const ROLES_AUTORIZA_FALTANTE = ['gerente', 'jefe_casa_matriz', 'admin', 'ejecutivo', 'superadmin'];

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
  const [cajaPendiente,setCajaPendiente]=useState(false); // true si falta cierre Z
  const [despachosPendientes,setDespachosPendientes]=useState(null); // despachos sin recepción

  // ── Modo de conteo (pedido de Jose 30-ago): al entrar se elige entre el conteo
  // normal y el de BEBIDAS. El de bebidas NO toca kardex ni inventario_conteo_nocturno
  // (si escribiera ahí, el conteo normal de la noche entraría en "edición" con solo
  // bebidas): cuenta lo físico y genera el pedido BEES sugerido en PDF descargable,
  // porque el pedido real se digita en la app de BEES (la ingesta por correo ya
  // registra la compra cuando BEES confirma el pedido).
  const [modo,setModo]=useState(null);           // 'normal' | 'bebidas'
  const [storeCodeSel,setStoreCodeSel]=useState(user.store_code||null);
  const [descargandoPdf,setDescargandoPdf]=useState(false);

  // ── Reporte de MERMA, obligatorio antes de contar (pedido Jose 30-ago) ──
  // Primero se declara la merma del día (puede ser "no hubo") y hasta entonces se
  // habilitan los conteos. Si no se pide antes, la merma se "esconde" dentro de la
  // diferencia del conteo y el tab de Fugas la lee como faltante sin explicación.
  const [mermaLista,setMermaLista]=useState(false);      // ya declarada en esta sesión
  const [mermaItems,setMermaItems]=useState([]);         // [{producto_id,nombre,unidad,cantidad}]
  const [mermaMotivo,setMermaMotivo]=useState('');
  const [mermaBusca,setMermaBusca]=useState('');
  const [mermaCatalogo,setMermaCatalogo]=useState([]);   // productos de la sucursal
  const [guardandoMerma,setGuardandoMerma]=useState(false);
  const [mermaHoy,setMermaHoy]=useState(null);           // merma ya registrada hoy (informativa)

  // ── Faltante del conteo: pasa con PIN de gerente + nota (pedido Jose 30-ago) ──
  // El faltante no se bloquea (el conteo debe poder cerrarse), pero no pasa mudo:
  // queda firmado, valorizado y acumulado por sucursal en Fugas para descontarlo.
  const [faltanteGate,setFaltanteGate]=useState(null);   // {faltantes:[], valor, pin, nota, auth, validando, err}

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
  const cargarInventario = async (sucId, storeCode) => {
    setSucursalId(sucId);
    setCajaPendiente(false);
    setDespachosPendientes(null);
    setLoading(true);
    try {
      const hoy = today();

      // 0a. Gate: no se puede contar sin cierre Z del día
      const sc = storeCode || user.store_code;
      const sinGates = SIN_GATES_TEMPORAL.includes(sc);   // normalmente false, ver arriba
      if (sc && !sinGates) {
        const cierreFiltro = sc === 'S003'
          ? { store_code: sc, fecha: hoy, tipo_cierre: 'Z', caja: 'general' }
          : { store_code: sc, fecha: hoy, tipo_cierre: 'Z' };
        let q = db.from('pos_turnos').select('id').match(cierreFiltro);
        if (sc !== 'S003') q = q.is('caja', null);
        const { data: cierre } = await q.limit(1);
        if (!cierre || cierre.length === 0) {
          setCajaPendiente(true);
          setLoading(false);
          return;
        }
      }

      // 0b. Gate: no se puede hacer pedido si hay despachos sin recepción humana
      const { data: despPend } = sinGates ? { data: [] } : await db.from('despachos_sucursal')
        .select('id, fecha_despacho, estado')
        .eq('sucursal_id', sucId)
        // Solo bloquean los despachos que la sucursal YA PUEDE recibir. Con
        // `neq('recibido')` también bloqueaban los que seguían en preparación en
        // casa matriz: no aparecían en Confirmar Entrega (que lista despachado/
        // en_ruta) y dejaban el conteo trabado sin salida posible.
        .in('estado', ['despachado', 'en_ruta'])
        .order('fecha_despacho', { ascending: false })
        .limit(5);
      if (despPend && despPend.length > 0) {
        setDespachosPendientes(despPend);
        setLoading(false);
        return;
      }

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

        // Mapas de cantidades guardadas
        const conteoMap = Object.fromEntries(conteoRows.map(r=>[r.producto_id, r.cantidad_real]));
        const teoricoMap = Object.fromEntries(conteoRows.map(r=>[r.producto_id, r.cantidad_teorica]));

        if (dentroDeVentana) {
          // Dentro de ventana → edición con el teórico ORIGINAL (pre-conteo, post-cierre Z)
          const prodsConDatos = prods.map(p=>({
            ...p,
            stock_teorico: teoricoMap[p.producto_id] ?? p.stock_teorico,
            cantidad_real: conteoMap[p.producto_id] ?? null,
          }));
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

  // Carga el catálogo de la sucursal para el buscador de merma y avisa si ya se
  // registró merma hoy (para no pedirla dos veces si vuelven a entrar).
  const abrirMerma=async(sucId)=>{
    setSucursalId(sucId);
    setLoading(true);
    try{
      const {data:invData}=await db.from('inventario')
        .select('producto_id, catalogo_productos(id, nombre, unidad_medida, activo)')
        .eq('sucursal_id', sucId);
      const cat=(invData||[])
        .filter(r=>r.catalogo_productos && r.catalogo_productos.activo!==false)
        .map(r=>({producto_id:r.producto_id, nombre:r.catalogo_productos.nombre,
                  unidad:r.catalogo_productos.unidad_medida||'unidad'}))
        .sort((a,b)=>a.nombre.localeCompare(b.nombre));
      setMermaCatalogo(cat);
      try{
        const desde=today()+'T00:00:00-06:00';
        const {data:km}=await db.from('kardex_movimientos')
          .select('cantidad, notas')
          .eq('sucursal_id', sucId).eq('tipo','merma').gte('created_at', desde);
        setMermaHoy(km && km.length ? km.length : null);
      }catch{ setMermaHoy(null); }
      setScreen('merma');
      setLoading(false);
    }catch(e){ show('❌ Error cargando productos: '+e.message); setLoading(false); }
  };

  const guardarMerma=async()=>{
    const items=mermaItems.filter(m=>n(m.cantidad)>0);
    if(items.length===0){ show('⚠️ Agregá al menos un producto con cantidad, o marcá "No hubo merma"'); return; }
    if(mermaMotivo.trim().length<5){ show('⚠️ Escribí el motivo (mínimo 5 caracteres)'); return; }
    setGuardandoMerma(true);
    try{
      const {data:resp,error}=await db.rpc('registrar_merma',{
        p_items: items.map(m=>({producto_id:m.producto_id, cantidad:n(m.cantidad)})),
        p_sucursal_id: sucursalId,
        p_motivo: mermaMotivo.trim(),
        p_usuario_id: user.id,
        p_notas: null,
      });
      if(error) throw error;
      show(`✅ Merma registrada: ${resp?.productos||items.length} producto(s)`
           + (resp?.valor ? ` · $${Number(resp.valor).toFixed(2)}` : ''));
      setMermaLista(true);
      setMermaItems([]); setMermaMotivo('');
      setScreen('elegir');
    }catch(e){ show('❌ No se pudo registrar la merma: '+e.message); }
    finally{ setGuardandoMerma(false); }
  };

  // Conteo de BEBIDAS: solo productos de bebida/cerveza/soda de la sucursal.
  // Sin gates de cierre/despachos (no ajusta stock ni pide a CM) y SIN filtrar por
  // incluir_conteo: la Coca de food court vive como "Insumo Soda" fuera del conteo
  // normal y es justo lo que más se pide a BEES.
  const cargarBebidas=async(sucId)=>{
    setSucursalId(sucId);
    setLoading(true);
    try{
      const {data:invData}=await db.from('inventario')
        .select('id, producto_id, stock_actual, stock_minimo, stock_maximo, catalogo_productos(id, nombre, unidad_medida, categoria, conteo_categoria, conteo_orden, activo)')
        .eq('sucursal_id', sucId);
      const esBebida=(c)=>/bebida|cerveza|soda/i.test(c||'');
      const prods=(invData||[])
        .filter(inv=>inv.catalogo_productos?.activo!==false
          && (esBebida(inv.catalogo_productos?.conteo_categoria)||esBebida(inv.catalogo_productos?.categoria)))
        .map(inv=>({
          inventario_id: inv.id,
          producto_id: inv.producto_id,
          nombre: inv.catalogo_productos?.nombre||'Sin nombre',
          unidad: inv.catalogo_productos?.unidad_medida||'unidad',
          categoria: inv.catalogo_productos?.conteo_categoria||inv.catalogo_productos?.categoria||'Bebidas',
          conteo_orden: inv.catalogo_productos?.conteo_orden||999,
          stock_teorico: inv.stock_actual,
          stock_minimo: inv.stock_minimo,
          stock_maximo: inv.stock_maximo,
          cantidad_real: null,
        }))
        .sort((a,b)=>(a.conteo_orden-b.conteo_orden)||a.nombre.localeCompare(b.nombre));
      if(prods.length===0){show('⚠️ Esta sucursal no tiene bebidas registradas en inventario');setLoading(false);return;}
      setProductos(prods);
      setIsEdit(false);setEditExpira(null);setConteoCerrado(false);
      setScreen(1);
      setLoading(false);
    }catch(e){show('❌ Error cargando bebidas: '+e.message);setLoading(false);}
  };

  // Bebidas: no escribe NADA en BD — arma el pedido sugerido y pasa a la pantalla del PDF
  const prepararPedidoBebidas=()=>{
    const sinCantidad=productos.filter(p=>p.cantidad_real===null);
    if(sinCantidad.length>0){show('⚠️ Faltan '+sinCantidad.length+' bebidas sin contar');return;}
    const items=productos.map(p=>{
      const bajominimo=p.stock_minimo>0&&p.cantidad_real<p.stock_minimo;
      return {
        producto_id:p.producto_id, nombre:p.nombre, unidad:p.unidad, categoria:p.categoria,
        cantidad_real:Math.max(0,n(p.cantidad_real)),
        stock_minimo:p.stock_minimo, stock_maximo:p.stock_maximo,
        cantidad_sugerida:bajominimo?Math.max(0,p.stock_maximo-p.cantidad_real):0,
        bajominimo,
      };
    });
    items.sort((a,b)=>(b.bajominimo?1:0)-(a.bajominimo?1:0));
    setPedidoItems(items);
    setPedidoQtys(Object.fromEntries(items.map(s=>[s.producto_id, s.cantidad_sugerida])));
    setScreen(2);
  };

  const descargarPdfBebidas=async()=>{
    const items=pedidoItems.filter(p=>n(pedidoQtys[p.producto_id])>0);
    if(items.length===0){show('⚠️ No hay bebidas con cantidad > 0');return;}
    setDescargandoPdf(true);
    try{
      // jsPDF se carga bajo demanda (import dinámico): no pesa en el bundle del POS
      const {jsPDF}=await import('jspdf');
      const {default:autoTable}=await import('jspdf-autotable');
      const doc=new jsPDF();
      const fecha=today();
      doc.setFontSize(15);doc.setFont(undefined,'bold');doc.setTextColor(20);
      doc.text('Pedido BEES sugerido',14,18);
      doc.setFontSize(10);doc.setFont(undefined,'normal');doc.setTextColor(90);
      doc.text(`${sucursalNombre} (${storeCodeSel||''}) · ${fecha} · generado del conteo de bebidas`,14,25);
      autoTable(doc,{
        startY:31,
        head:[['Producto','Unidad','Contado','Mín','Máx','PEDIR']],
        body:items.map(p=>[p.nombre,p.unidad,String(p.cantidad_real),String(n(p.stock_minimo)),String(n(p.stock_maximo)),String(n(pedidoQtys[p.producto_id]))]),
        styles:{fontSize:9},
        headStyles:{fillColor:[230,35,41]},
        columnStyles:{2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{fontStyle:'bold',halign:'right'}},
      });
      const noPedidas=pedidoItems.filter(p=>n(pedidoQtys[p.producto_id])===0);
      const y=(doc.lastAutoTable?.finalY||31)+8;
      doc.setFontSize(8);doc.setTextColor(120);
      doc.text(`Digitá este pedido en la app de BEES tal cual.${noPedidas.length>0?' '+noPedidas.length+' bebida(s) quedaron sin pedir (stock suficiente).':''}`,14,y);
      doc.save(`Pedido_BEES_${storeCodeSel||'suc'}_${fecha}.pdf`);
      show('⬇️ PDF descargado — digitalo en la app de BEES');
    }catch(e){show('❌ No se pudo generar el PDF: '+e.message);}
    finally{setDescargandoPdf(false);}
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
        setSucursalId(suc.id);
        setStoreCodeSel(user.store_code);
        await abrirMerma(suc.id);
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
    setProductos(prev=>prev.map(p=>p.producto_id===prodId?{...p,cantidad_real:Math.max(0,n(p.stock_teorico))}:p));
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

  // Faltantes = contado por debajo del teórico. Es lo que la sucursal tiene que
  // explicar (y lo que se le descuenta), así que se calcula sobre lo mismo que ve
  // en pantalla.
  const calcFaltantes=()=>productos
    .filter(p=>p.cantidad_real!==null && n(p.cantidad_real) < n(p.stock_teorico))
    .map(p=>({producto_id:p.producto_id, nombre:p.nombre, unidad:p.unidad,
              cantidad:Math.round((n(p.stock_teorico)-n(p.cantidad_real))*10000)/10000}));

  const guardarConteo=async(gate=null)=>{
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

    // Gate de faltante: NO bloquea el conteo (tiene que poder cerrarse), pero
    // exige firma de gerente + nota antes de guardar. Si ya viene autorizado
    // (gate), se sigue de largo.
    if(!gate){
      const faltantes=calcFaltantes();
      if(faltantes.length>0){
        setFaltanteGate({faltantes, pin:'', nota:'', auth:null, validando:false, err:''});
        return;
      }
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
        cantidad_real: Math.max(0,n(p.cantidad_real)),
        cantidad_teorica: p.stock_teorico,
        contado_por: user.id,
        notas: isEdit?'Editado':'Conteo inicial'
      }));

      const {error:conteoErr}=await db.from('inventario_conteo_nocturno')
        .insert(conteos);
      if(conteoErr)throw conteoErr;

      // 3. Ajustar el stock POR KARDEX, no a mano.
      // Antes esto hacía `update inventario set stock_actual = cantidad_real`:
      // el stock quedaba bien, pero la diferencia contra el teórico se perdía
      // sin dejar rastro — y esa diferencia es justamente la merma.
      // El delta lo calcula el servidor con la fila lockeada: mientras el
      // empleado cuenta, el POS sigue descontando ventas, así que restar contra
      // el `stock_teorico` que se leyó al abrir la pantalla se comería el turno.
      const {data:ajuste,error:ajErr}=await db.rpc('kardex_ajustar_absoluto',{
        p_items: productos.map(p=>({producto_id:p.producto_id, cantidad:n(p.cantidad_real)})),
        p_tipo: 'conteo_fisico',
        p_referencia_tipo: 'conteo_nocturno',
        p_referencia_id: null,
        p_notas: (isEdit?'Conteo nocturno (editado) ':'Conteo nocturno ')+hoy,
        p_usuario_id: user?.id||null,
        p_sucursal_id: sucursalId,
      });
      if(ajErr) throw ajErr;

      // 3b. Faltantes justificados: quedan valorizados y acumulados por sucursal
      // (tab de Fugas) para descontarlos del pago de esa sucursal. Va DESPUÉS del
      // ajuste: si el kardex falla, no se registra un descuento de algo que no pasó.
      if(gate?.faltantes?.length){
        try{
          const {data:rf,error:rfErr}=await db.rpc('registrar_faltantes_conteo',{
            p_items: gate.faltantes.map(f=>({producto_id:f.producto_id, cantidad:f.cantidad})),
            p_sucursal_id: sucursalId,
            p_nota: gate.nota,
            p_autorizado_por: gate.auth?.id || null,
            p_contado_por: user.id,
            p_modo: modo||'normal',
          });
          if(rfErr) throw rfErr;
          if(rf?.valor>0) show(`📌 Faltante registrado: $${Number(rf.valor).toFixed(2)} — queda en Fugas de ${sucursalNombre}`);
        }catch(e){
          // El conteo YA se guardó: no se revierte, pero hay que decirlo fuerte
          show('⚠️ El conteo se guardó pero el faltante NO se registró en Fugas: '+e.message);
        }
      }

      setConteoHoy({});
      // Se le dice al empleado lo que el conteo encontró, en vez de un "guardado"
      // mudo: si hay faltante, es lo que hay que revisar antes de irse.
      const falt=n(ajuste?.faltante), sobr=n(ajuste?.sobrante);
      if(falt>0||sobr>0){
        show((isEdit?'✅ Conteo actualizado':'✅ Conteo guardado')
          +' — '+(falt>0?`faltan ${falt}`:'')+(falt>0&&sobr>0?', ':'')
          +(sobr>0?`sobran ${sobr}`:'')+` (${n(ajuste?.ajustados)} productos con diferencia)`);
      }else{
        show((isEdit?'✅ Conteo actualizado':'✅ Conteo guardado')+' — todo cuadra');
      }

      // 4. Preparar pedido sugerido — mostrar TODOS los productos
      // Los que están bajo mínimo tienen cantidad sugerida, el resto qty=0
      const todosParaPedido=productos.map(p=>{
        const bajominimo=p.stock_minimo>0 && p.cantidad_real<p.stock_minimo;
        return {
          producto_id: p.producto_id,
          nombre: p.nombre,
          unidad: p.unidad,
          categoria: p.categoria,
          cantidad_real: Math.max(0,n(p.cantidad_real)),
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
      // Una sola orden VIVA por sucursal: la RPC sobrescribe atómicamente la orden
      // 'enviado' existente (o crea una nueva si no hay), con candado por sucursal
      // que mata doble-envíos y carreras. Ya no borramos/insertamos a mano.
      const payload=items.map(p=>({
        producto_id: p.producto_id,
        cantidad: n(pedidoQtys[p.producto_id]),
        unidad: p.unidad
      }));
      const {data:resp,error:rpcErr}=await db.rpc('guardar_pedido_vivo',{
        p_sucursal_id: sucursalId,
        p_usuario_id: user.id,
        p_items: payload,
        p_modo: 'conteo'
      });
      if(rpcErr)throw rpcErr;
      if(!resp?.ok)throw new Error(resp?.error||'no se pudo guardar el pedido');

      // #11: Casa Matriz sin stock → avisar lo que queda en pedido (lo devuelve la RPC)
      const faltan=resp.sin_stock||[];
      setGenerandoPedido(false);
      if(faltan.length>0){
        const lista=faltan.slice(0,8).map(f=>`• ${f.nombre} (CM: ${Number(f.cm||0)})`).join('\n');
        window.alert(`✓ Pedido enviado.\n\n⚠️ Casa Matriz NO tiene stock de ${faltan.length} producto(s) — quedan en pedido:\n${lista}${faltan.length>8?`\n…y ${faltan.length-8} más`:''}`);
      } else {
        show('✓ Pedido enviado al almacén');
      }
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
    'Carnes y Complementos',
    'Panes y Harinas',
    'Quesos y Lácteos',
    'Vegetales y Verduras',
    'Salsas y Aderezos',
    'Papas y Congelados',
    'Bebidas',
    'Empaques y Desechables',
    'Utensilios de Limpieza',
    'Extras',
  ];
  const ordenIdx=(cat)=>{ const i=ORDEN_GRUPOS.findIndex(g=>g.toLowerCase()===cat.toLowerCase()); return i===-1?999:i; };

  // Agrupar productos por categoría
  const porCategoria={};
  productos.forEach(p=>{
    if(!porCategoria[p.categoria])porCategoria[p.categoria]=[];
    porCategoria[p.categoria].push(p);
  });
  // Ordenar grupos por lista fija; desconocidos al final
  const categorias=Object.keys(porCategoria).sort((a,b)=>{
    const ia=ordenIdx(a);
    const ib=ordenIdx(b);
    return ia-ib;
  });

  if(loading){
    return(
      <div style={{minHeight:'100vh',padding:'0 16px 60px',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <Toast/>
        <div className="spin" style={{width:40,height:40}}/>
      </div>
    );
  }

  // ── GATE: caja no cerrada (antes del picker para que el admin lo vea) ──
  if(cajaPendiente){
    return(
      <div style={{minHeight:'100vh',padding:'0 16px 60px'}}>
        <Toast/>
        <div style={{padding:'20px 0 16px',display:'flex',alignItems:'center',gap:12}}>
          <button onClick={needsSucursalPicker?()=>{setCajaPendiente(false);setScreen(0);}:onBack}
            style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
          <div>
            <div style={{fontWeight:800,fontSize:18}}>📋 Conteo Nocturno</div>
            <div style={{color:'#555',fontSize:12}}>{sucursalNombre}</div>
          </div>
        </div>
        <div className="card" style={{textAlign:'center',padding:24,border:'1px solid #e63946'}}>
          <div style={{fontSize:40,marginBottom:12}}>🔒</div>
          <div style={{fontWeight:700,fontSize:16,color:'#e63946',marginBottom:8}}>Caja sin cerrar</div>
          <div style={{color:'#aaa',fontSize:14,lineHeight:1.5}}>
            Primero hacé el <b>corte Z</b> (cierre del día) antes de iniciar el conteo nocturno.
          </div>
        </div>
      </div>
    );
  }

  // ── GATE: despachos pendientes de recepción ──
  if(despachosPendientes && despachosPendientes.length>0){
    return(
      <div style={{minHeight:'100vh',padding:'0 16px 60px'}}>
        <Toast/>
        <div style={{padding:'20px 0 16px',display:'flex',alignItems:'center',gap:12}}>
          <button onClick={needsSucursalPicker?()=>{setDespachosPendientes(null);setScreen(0);}:onBack}
            style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
          <div>
            <div style={{fontWeight:800,fontSize:18}}>📋 Conteo Nocturno</div>
            <div style={{color:'#555',fontSize:12}}>{sucursalNombre}</div>
          </div>
        </div>
        <div className="card" style={{textAlign:'center',padding:24,border:'1px solid #e63946'}}>
          <div style={{fontSize:40,marginBottom:12}}>📦</div>
          <div style={{fontWeight:700,fontSize:16,color:'#e63946',marginBottom:8}}>Despachos sin recibir</div>
          <div style={{color:'#aaa',fontSize:14,lineHeight:1.5,marginBottom:16}}>
            Tenés <b>{despachosPendientes.length} despacho{despachosPendientes.length>1?'s':''}</b> pendiente{despachosPendientes.length>1?'s':''} de recepción.
            Confirmá la recepción antes de hacer conteo y pedido.
          </div>
          <div style={{color:'#e6a817',fontSize:13,lineHeight:1.5,marginBottom:16,background:'#1a1a1a',borderRadius:8,padding:'8px 12px'}}>
            Se recibe en <b>Supply Chain → Confirmar Entrega</b>. Si ahí no aparece, avisá a Casa Matriz:
            puede que el despacho todavía no salga de bodega.
          </div>
          {despachosPendientes.map(d=>(
            <div key={d.id} style={{background:'#1a1a1a',borderRadius:8,padding:'8px 12px',marginBottom:6,fontSize:13,color:'#ccc',textAlign:'left'}}>
              📦 Despacho del <b>{d.fecha_despacho}</b> — <span style={{color:'#e6a817'}}>{d.estado}</span>
            </div>
          ))}
        </div>
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
          <button key={s.id} className="card" onClick={()=>{setSucursalNombre(s.nombre);setStoreCodeSel(s.store_code);abrirMerma(s.id);}}
            style={{width:'100%',textAlign:'left',cursor:'pointer',border:'1px solid #333',background:'#111',marginBottom:8}}>
            <div style={{fontWeight:600,fontSize:15,color:'#fff'}}>{s.nombre}</div>
            <div style={{color:'#888',fontSize:12}}>{s.store_code}</div>
          </button>
        ))}
      </div>
    );
  }

  // ── PANTALLA MERMA: obligatoria antes de cualquier conteo ──
  if(screen==='merma'){
    const filtrados=mermaBusca.trim().length<2 ? [] : mermaCatalogo
      .filter(p=>p.nombre.toLowerCase().includes(mermaBusca.trim().toLowerCase())
                 && !mermaItems.some(m=>m.producto_id===p.producto_id))
      .slice(0,8);
    const totalUnidades=mermaItems.reduce((s,m)=>s+n(m.cantidad),0);
    return(
      <div style={{minHeight:'100vh',padding:'0 16px 120px'}}>
        <Toast/>
        <div style={{padding:'20px 0 16px',display:'flex',alignItems:'center',gap:12}}>
          <button onClick={needsSucursalPicker?()=>setScreen(0):onBack}
            style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
          <div>
            <div style={{fontWeight:800,fontSize:18}}>🗑️ Reporte de merma</div>
            <div style={{color:'#555',fontSize:12}}>{sucursalNombre} · paso 1 de 2</div>
          </div>
        </div>

        <div style={{padding:'10px 12px',marginBottom:12,borderRadius:8,background:'#e6394620',border:'1px solid #e63946'}}>
          <div style={{fontSize:12,color:'#e63946',fontWeight:700,marginBottom:4}}>Primero la merma, después el conteo</div>
          <div style={{fontSize:11,color:'#d98a8f',lineHeight:1.5}}>
            Reportá lo que se botó, se quemó o se dañó hoy. Si no hubo nada, tocá "No hubo merma".
            Lo que no se reporte acá aparece como faltante sin explicación en el tab de Fugas.
          </div>
        </div>

        {mermaHoy>0&&(
          <div style={{padding:'8px 12px',marginBottom:12,borderRadius:8,background:'#facc1520',border:'1px solid #facc15',fontSize:11,color:'#d4a017'}}>
            Ojo: hoy ya se registraron <b>{mermaHoy}</b> movimiento(s) de merma en esta sucursal. Si ya la reportaste, seguí sin agregar nada.
          </div>
        )}

        {/* Buscador */}
        <input value={mermaBusca} onChange={e=>setMermaBusca(e.target.value)}
          placeholder="Buscar producto… (ej: pan, carne, coca)"
          style={{width:'100%',padding:'13px 14px',background:'#0a0a0a',border:'1px solid #333',
                  borderRadius:10,color:'#fff',fontSize:15,marginBottom:8}}/>
        {filtrados.map(p=>(
          <button key={p.producto_id} className="card"
            onClick={()=>{setMermaItems(prev=>[...prev,{...p,cantidad:1}]);setMermaBusca('');}}
            style={{width:'100%',textAlign:'left',cursor:'pointer',border:'1px solid #333',background:'#111',marginBottom:6,padding:12}}>
            <div style={{fontSize:14,color:'#fff'}}>{p.nombre}</div>
            <div style={{fontSize:11,color:'#888'}}>{p.unidad}</div>
          </button>
        ))}
        {mermaBusca.trim().length>=2&&filtrados.length===0&&(
          <div style={{color:'#666',fontSize:12,padding:'6px 2px',marginBottom:8}}>Sin resultados</div>
        )}

        {/* Items agregados */}
        {mermaItems.map((m,i)=>(
          <div key={m.producto_id} className="card" style={{borderLeft:'3px solid #e63946'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div>
                <div style={{fontWeight:600,fontSize:14}}>{m.nombre}</div>
                <div style={{fontSize:11,color:'#888'}}>unidades de {m.unidad}</div>
              </div>
              <button onClick={()=>setMermaItems(prev=>prev.filter((_,j)=>j!==i))}
                style={{background:'none',border:'none',color:'#e63946',fontSize:18,cursor:'pointer'}}>✕</button>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <button style={stepBtn} onClick={()=>setMermaItems(prev=>prev.map((x,j)=>j===i?{...x,cantidad:Math.max(0,n(x.cantidad)-1)}:x))}>−</button>
              <input type="number" inputMode="decimal" min="0" step="any" value={m.cantidad}
                onChange={e=>setMermaItems(prev=>prev.map((x,j)=>j===i?{...x,cantidad:e.target.value}:x))}
                style={{flex:1,padding:'12px 8px',background:'#0a0a0a',border:'1px solid #333',borderRadius:10,color:'#fff',fontSize:18,textAlign:'center',fontWeight:700}}/>
              <button style={stepBtn} onClick={()=>setMermaItems(prev=>prev.map((x,j)=>j===i?{...x,cantidad:n(x.cantidad)+1}:x))}>+</button>
            </div>
          </div>
        ))}

        {mermaItems.length>0&&(
          <div style={{marginTop:10}}>
            <div style={{fontSize:12,color:'#aaa',marginBottom:6}}>¿Qué pasó? (obligatorio)</div>
            <textarea rows={2} value={mermaMotivo} onChange={e=>setMermaMotivo(e.target.value)}
              placeholder="Ej: se quemaron 3 hamburguesas, se cayó una bolsa de papas…"
              style={{width:'100%',padding:12,background:'#0a0a0a',border:'1px solid #333',borderRadius:10,color:'#fff',fontSize:14,resize:'vertical'}}/>
          </div>
        )}

        <div style={{position:'fixed',bottom:0,left:0,right:0,padding:'12px 16px 20px',background:'linear-gradient(transparent, #0d0d0d 30%)',zIndex:20}}>
          {mermaItems.length>0?(
            // Con merma reportada la nota es OBLIGATORIA: sin el porqué, el dato no
            // sirve para nada después (queda "faltó" sin causa).
            <button className="btn btn-red" onClick={guardarMerma}
              disabled={guardandoMerma||mermaMotivo.trim().length<5}
              style={{fontSize:17,padding:18,width:'100%',marginBottom:8,
                      opacity:mermaMotivo.trim().length<5?0.5:1}}>
              {guardandoMerma?<span className="spin"/>
                : mermaMotivo.trim().length<5 ? '✍️ Escribí el motivo de la merma'
                : `🗑️ Reportar merma (${totalUnidades} u) y continuar`}
            </button>
          ):(
            <button className="btn btn-red" onClick={()=>{setMermaLista(true);setScreen('elegir');}}
              style={{fontSize:17,padding:18,width:'100%',marginBottom:8,background:'#16a34a'}}>
              ✓ No hubo merma — continuar
            </button>
          )}
          {mermaItems.length>0&&(
            <button onClick={()=>{setMermaItems([]);setMermaMotivo('');}}
              style={{background:'none',border:'none',color:'#555',fontSize:12,cursor:'pointer',width:'100%',padding:6}}>
              Limpiar lista
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── PANTALLA ELEGIR MODO: conteo normal vs bebidas ──
  if(screen==='elegir'){
    return(
      <div style={{minHeight:'100vh',padding:'0 16px 60px'}}>
        <Toast/>
        <div style={{padding:'20px 0 16px',display:'flex',alignItems:'center',gap:12}}>
          <button onClick={()=>setScreen('merma')}
            style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
          <div>
            <div style={{fontWeight:800,fontSize:18}}>📋 Conteo Nocturno</div>
            <div style={{color:'#555',fontSize:12}}>{sucursalNombre} · ¿qué vas a contar?</div>
          </div>
        </div>
        <div style={{padding:'8px 12px',marginBottom:12,borderRadius:8,background:'#4ade8020',border:'1px solid #4ade80',fontSize:11,color:'#4ade80'}}>
          ✓ Merma reportada. Ya podés contar. <span style={{color:'#3bbd6b'}}>(¿Faltó algo? Volvé con la flecha.)</span>
        </div>
        <button className="card" onClick={()=>{setModo('normal');cargarInventario(sucursalId,storeCodeSel);}}
          style={{width:'100%',textAlign:'left',cursor:'pointer',border:'1px solid #333',background:'#111',marginBottom:10,padding:18}}>
          <div style={{fontSize:26,marginBottom:6}}>📋</div>
          <div style={{fontWeight:700,fontSize:16,color:'#fff'}}>Conteo normal</div>
          <div style={{color:'#888',fontSize:12,marginTop:4}}>Inventario completo de la noche. Ajusta el stock y genera el pedido a Casa Matriz.</div>
        </button>
        <button className="card" onClick={()=>{setModo('bebidas');cargarBebidas(sucursalId);}}
          style={{width:'100%',textAlign:'left',cursor:'pointer',border:'1px solid #60a5fa50',background:'#0a1520',padding:18}}>
          <div style={{fontSize:26,marginBottom:6}}>🥤</div>
          <div style={{fontWeight:700,fontSize:16,color:'#60a5fa'}}>Conteo de bebidas</div>
          <div style={{color:'#888',fontSize:12,marginTop:4}}>Contás solo sodas, tés y cervezas y te genera el <b>pedido BEES sugerido en PDF</b> para digitarlo en la app de BEES. No toca el inventario del sistema.</div>
        </button>
      </div>
    );
  }

  // ── MODAL: faltante en el conteo (PIN de gerente + nota) ──
  // Se renderiza como overlay sobre la pantalla de conteo, no como pantalla aparte:
  // la cajera tiene que seguir viendo lo que contó mientras el gerente autoriza.
  const modalFaltante = faltanteGate && (()=>{
    const g=faltanteGate;
    const validar=async()=>{
      if(g.pin.length<4) return;
      setFaltanteGate(x=>({...x,validando:true,err:''}));
      try{
        const {data,error}=await db.rpc('erp_login',{p_pin:g.pin});
        if(error) throw error;
        if(!data){ setFaltanteGate(x=>({...x,validando:false,pin:'',err:'PIN incorrecto'})); return; }
        if(!ROLES_AUTORIZA_FALTANTE.includes(data.rol)){
          setFaltanteGate(x=>({...x,validando:false,pin:'',err:`${data.nombre}: ese rol no puede autorizar un faltante`}));
          return;
        }
        setFaltanteGate(x=>({...x,validando:false,auth:data,err:''}));
      }catch(e){ setFaltanteGate(x=>({...x,validando:false,pin:'',err:e.message||'No se pudo validar'})); }
    };
    return(
      <div onClick={()=>setFaltanteGate(null)}
        style={{position:'fixed',inset:0,zIndex:60,background:'rgba(0,0,0,0.72)',display:'flex',
                alignItems:'center',justifyContent:'center',padding:16}}>
        <div onClick={e=>e.stopPropagation()}
          style={{width:'100%',maxWidth:420,maxHeight:'88vh',overflowY:'auto',background:'#141419',
                  border:'1px solid #e6394660',borderRadius:14,padding:18}}>
          <div style={{fontWeight:800,fontSize:17,color:'#e63946',marginBottom:4}}>⚠️ Hay faltante</div>
          <div style={{fontSize:12,color:'#aaa',lineHeight:1.5,marginBottom:12}}>
            {g.faltantes.length} producto{g.faltantes.length>1?'s':''} por debajo del sistema. Se puede cerrar el
            conteo, pero necesita <b>autorización de gerente</b> y una nota: queda acumulado en las
            <b> Fugas de {sucursalNombre}</b> para descontarlo.
          </div>

          <div style={{maxHeight:150,overflowY:'auto',background:'#0d0d10',borderRadius:10,padding:10,marginBottom:12}}>
            {g.faltantes.map(f=>(
              <div key={f.producto_id} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'3px 0',color:'#ccc'}}>
                <span style={{flex:1,paddingRight:8}}>{f.nombre}</span>
                <b style={{color:'#e63946'}}>−{f.cantidad} {f.unidad}</b>
              </div>
            ))}
          </div>

          {!g.auth?(
            <>
              <div style={{fontSize:12,color:'#aaa',marginBottom:6}}>PIN del gerente</div>
              <input type="password" inputMode="numeric" autoFocus value={g.pin}
                onChange={e=>setFaltanteGate(x=>({...x,pin:e.target.value.replace(/\D/g,'').slice(0,6),err:''}))}
                onKeyDown={e=>e.key==='Enter'&&validar()}
                style={{width:'100%',padding:'13px 14px',background:'#0a0a0a',border:'1px solid #333',
                        borderRadius:10,color:'#fff',fontSize:20,textAlign:'center',letterSpacing:6}}/>
              {g.err&&<div style={{color:'#f87171',fontSize:12,marginTop:8}}>{g.err}</div>}
              <button className="btn btn-red" onClick={validar} disabled={g.pin.length<4||g.validando}
                style={{width:'100%',padding:14,marginTop:12,opacity:g.pin.length<4?0.5:1}}>
                {g.validando?<span className="spin"/>:'Validar PIN'}
              </button>
            </>
          ):(
            <>
              <div style={{fontSize:12,color:'#4ade80',marginBottom:8}}>✓ Autoriza {g.auth.nombre} ({g.auth.rol})</div>
              <div style={{fontSize:12,color:'#aaa',marginBottom:6}}>¿Por qué falta? (obligatorio)</div>
              <textarea rows={3} autoFocus value={g.nota}
                onChange={e=>setFaltanteGate(x=>({...x,nota:e.target.value}))}
                placeholder="Ej: se usó para pruebas de receta, se dañó el congelador, error en el despacho de ayer…"
                style={{width:'100%',padding:12,background:'#0a0a0a',border:'1px solid #333',borderRadius:10,
                        color:'#fff',fontSize:14,resize:'vertical'}}/>
              <div style={{fontSize:11,color:'#666',margin:'6px 0 12px'}}>Mínimo 10 caracteres. Esta nota la ve Casa Matriz en Fugas.</div>
              <button className="btn btn-red" disabled={g.nota.trim().length<10||guardando}
                onClick={()=>{ const gate={...g,nota:g.nota.trim()}; setFaltanteGate(null); guardarConteo(gate); }}
                style={{width:'100%',padding:14,opacity:g.nota.trim().length<10?0.5:1}}>
                {g.nota.trim().length<10?'Escribí la explicación':'Autorizar y guardar conteo'}
              </button>
            </>
          )}
          <button onClick={()=>setFaltanteGate(null)}
            style={{background:'none',border:'none',color:'#666',fontSize:12,cursor:'pointer',width:'100%',padding:10}}>
            Cancelar — volver a contar
          </button>
        </div>
      </div>
    );
  })();

  // ── SCREEN 1: CONTEO ──
  if(screen===1){
    return(
      <div style={{minHeight:'100vh',padding:'0 16px 100px'}}>
        <Toast/>
        {modalFaltante}
        {/* Header */}
        <div style={{padding:'20px 0 8px',display:'flex',alignItems:'center',gap:12}}>
          <button onClick={()=>setScreen('elegir')} style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:18}}>{modo==='bebidas'?'🥤 Conteo de Bebidas':'📋 Conteo Nocturno'}</div>
            <div style={{color:'#555',fontSize:12}}>{sucursalNombre} · {new Date(Date.now()-6*3600*1000).toLocaleDateString('es-SV',{weekday:'short',month:'short',day:'numeric'})}</div>
          </div>
        </div>

        {/* ── Barra de progreso sticky ── */}
        <div style={{position:'sticky',top:0,zIndex:20,background:'#0d0d0d',padding:'10px 0 12px'}}>
          {/* Banner según estado */}
          {isEdit&&(
            <div style={{padding:'8px 12px',marginBottom:8,borderRadius:8,background:'#facc1520',border:'1px solid #facc15'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,color:'#facc15',fontWeight:600}}>✏️ Editando conteo</span>
                <span style={{fontSize:11,color:'#facc15'}}>{tiempoRestante}</span>
              </div>
              <div style={{fontSize:11,color:'#d4a017',marginTop:4}}>Estás editando el conteo que ya se guardó hoy. Si un producto aparece en rojo, la cantidad no cuadra con el sistema. Podés corregir.</div>
            </div>
          )}
          {conteoCerrado&&!isEdit&&(
            <div style={{padding:'8px 12px',marginBottom:8,borderRadius:8,background:'#4ade8020',border:'1px solid #4ade80'}}>
              <span style={{fontSize:12,color:'#4ade80',fontWeight:600}}>📋 Nuevo conteo — reemplaza el anterior (+6h)</span>
              <div style={{fontSize:11,color:'#3bbd6b',marginTop:4}}>Conteo nuevo del turno. Contá físicamente cada producto. Si un producto aparece en rojo, la cantidad no cuadra con el sistema.</div>
            </div>
          )}
          {!isEdit&&!conteoCerrado&&modo!=='bebidas'&&(
            <div style={{padding:'8px 12px',marginBottom:8,borderRadius:8,background:'#60a5fa20',border:'1px solid #60a5fa'}}>
              <div style={{fontSize:11,color:'#60a5fa'}}>Primer conteo del día. Contá físicamente cada producto. Si un producto aparece en rojo, la cantidad no cuadra con el sistema.</div>
            </div>
          )}
          {modo==='bebidas'&&(
            <div style={{padding:'8px 12px',marginBottom:8,borderRadius:8,background:'#60a5fa20',border:'1px solid #60a5fa'}}>
              <div style={{fontSize:11,color:'#60a5fa'}}>Contá físicamente cada bebida (en su unidad: fardo, caja…). Al final se genera el <b>pedido BEES sugerido en PDF</b>. Este conteo NO ajusta el inventario del sistema.</div>
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
              // En bebidas no se pinta rojo contra el teórico: ese teórico puede estar
              // roto por mapeos (ej. Insumo Soda en negativo) y el conteo no lo ajusta.
              const noCuadra=modo!=='bebidas'&&contado&&diff!==null&&diff!==0;
              return(
              <div key={p.producto_id} className="card" style={{borderLeft:`3px solid ${noCuadra?'#e63946':contado?'#4ade80':'#333'}`,transition:'border 0.2s'}}>
                <div style={{fontWeight:600,fontSize:14,marginBottom:10,color:noCuadra?'#e63946':'#fff'}}>{p.nombre}</div>

                {/* ── Stepper: [-] input [+] ── */}
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <button style={stepBtn} onClick={()=>stepCantidad(p.producto_id,-1)}>−</button>
                  {/* inputMode="decimal" y step="any": con "numeric" y step="1" el
                      teclado del celular sale sin punto y el navegador rechaza
                      cualquier fraccion, asi que una caja empezada no se podia
                      contar. El parseo de abajo ya usa parseFloat. */}
                  <input type="number" inputMode="decimal" min="0" step="any" value={p.cantidad_real??''}
                    onChange={e=>updateCantidadReal(p.producto_id, e.target.value)}
                    style={{flex:1,padding:'12px 8px',background:noCuadra?'#1a0a0a':'#0a0a0a',border:`1px solid ${noCuadra?'#e63946':'#333'}`,borderRadius:10,color:noCuadra?'#e63946':'#fff',fontSize:18,textAlign:'center',fontWeight:700}}
                    placeholder="—"/>
                  <button style={stepBtn} onClick={()=>stepCantidad(p.producto_id,1)}>+</button>
                </div>
              </div>
            );})
            }
          </div>
        );})}

        {/* ── Botón Guardar sticky ── */}
        <div style={{position:'fixed',bottom:0,left:0,right:0,padding:'12px 16px',background:'linear-gradient(transparent, #0d0d0d 30%)',zIndex:20}}>
          <button className="btn btn-red" onClick={()=>modo==='bebidas'?prepararPedidoBebidas():guardarConteo()} disabled={guardando||contados<totalProds}
            style={{fontSize:17,padding:18,width:'100%',opacity:contados<totalProds?0.5:1}}>
            {guardando?<span className="spin"/>:contados<totalProds?`Faltan ${totalProds-contados} productos`:modo==='bebidas'?'🛒 Generar pedido BEES':isEdit?'✏️ Actualizar Conteo':'✓ Guardar Conteo'}
          </button>
        </div>
      </div>
    );
  }

  // ── SCREEN 2: PEDIDO SUGERIDO ──
  return(
    <div style={{minHeight:'100vh',padding:'0 16px 120px'}}>
      <Toast/>
      <div style={{padding:'20px 0 16px',display:'flex',alignItems:'center',gap:12}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
        <div>
          <div style={{fontWeight:800,fontSize:18}}>{modo==='bebidas'?'🛒 Pedido BEES sugerido':isEdit?'📦 Pedido Actual':'📦 Pedido Sugerido'} <InfoTip text={modo==='bebidas'?"Pedido de bebidas calculado del conteo: para cada bebida bajo mínimo se sugiere rellenar al máximo. Descargá el PDF y digitá el pedido en la app de BEES.":isEdit?"Pedido generado a partir del conteo editado. Las cantidades reflejan lo contado.":"Pedido recomendado a partir del conteo nocturno: cuánto pedir de cada producto según su consumo y su stock mínimo."} /></div>
          <div style={{color:'#555',fontSize:12}}>{pedidoItems.length} productos · <span style={{color:'#e63946'}}>{pedidoItems.filter(p=>p.bajominimo).length} bajo mínimo</span></div>
        </div>
      </div>

      <div style={{padding:'8px 12px',marginBottom:12,borderRadius:8,background:isEdit?'#facc1520':'#60a5fa20',border:`1px solid ${isEdit?'#facc15':'#60a5fa'}`}}>
        <div style={{fontSize:11,color:isEdit?'#d4a017':'#60a5fa'}}>
          {modo==='bebidas'
            ?'Ajustá las cantidades si hace falta y descargá el PDF: ese es el pedido que se digita en la app de BEES. Cuando BEES confirme, el pedido entra solo al ERP por la ingesta de correo.'
            :isEdit
            ?'Pedido basado en el conteo que editaste. "Real" es lo que contaste. Los productos bajo mínimo ya tienen cantidad sugerida (máximo − real). Podés ajustar antes de enviar.'
            :'Pedido sugerido a partir de tu conteo. "Real" es lo que contaste físicamente. Los productos bajo mínimo ya tienen cantidad sugerida. Ajustá y enviá.'}
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
          {(()=>{
            // Agrupar pedidoItems por categoría con el mismo orden fijo
            const itemsFiltrados=pedidoItems.filter(p=>!ocultarCero||n(pedidoQtys[p.producto_id]||0)>0);
            const porCatPedido={};
            itemsFiltrados.forEach(p=>{
              const cat=p.categoria||'Otros';
              if(!porCatPedido[cat])porCatPedido[cat]=[];
              porCatPedido[cat].push(p);
            });
            const catsPedido=Object.keys(porCatPedido).sort((a,b)=>ordenIdx(a)-ordenIdx(b));
            return catsPedido.map(cat=>{
              const items=porCatPedido[cat];
              const tieneUrgentes=items.some(p=>p.bajominimo&&n(pedidoQtys[p.producto_id]||0)>0);
              const abiertoPed=!!gruposAbiertos['ped_'+cat];
              const totalPedido=items.reduce((s,p)=>s+n(pedidoQtys[p.producto_id]||0),0);
              return(
                <div key={cat} style={{marginBottom:4}}>
                  <button onClick={()=>toggleGrupo('ped_'+cat)}
                    style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',
                      padding:'12px 14px',borderRadius:10,border:'1px solid #222',cursor:'pointer',
                      background:tieneUrgentes?'#2a0d0d':abiertoPed?'#13131f':'#13131f',
                      borderColor:tieneUrgentes?'#e6394640':'#222',
                      marginBottom:abiertoPed?6:0,transition:'all 0.15s'}}>
                    <span style={{fontSize:14,color:tieneUrgentes?'#e63946':'#888',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.5px'}}>
                      {cat}
                    </span>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      {tieneUrgentes&&(
                        <span style={{fontSize:10,color:'#e63946',fontWeight:700,background:'#e6394620',padding:'2px 6px',borderRadius:99,border:'1px solid #e6394640'}}>
                          BAJO MÍN
                        </span>
                      )}
                      {totalPedido>0&&(
                        <span style={{fontSize:12,fontWeight:600,color:'#60a5fa',background:'#60a5fa20',padding:'2px 8px',borderRadius:99,border:'1px solid #60a5fa40'}}>
                          {totalPedido} uds
                        </span>
                      )}
                      <span style={{fontSize:16,color:'#555',lineHeight:1}}>{abiertoPed?'▲':'▼'}</span>
                    </div>
                  </button>
                  {abiertoPed && items.map(p=>{
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
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <button style={stepBtn} onClick={()=>setPedidoQtys(prev=>({...prev,[p.producto_id]:Math.max(0,qty-1)}))}>−</button>
                        <input type="number" inputMode="numeric" min="0" step="1"
                          value={pedidoQtys[p.producto_id]??0}
                          onChange={e=>setPedidoQtys(prev=>({...prev,[p.producto_id]:e.target.value}))}
                          style={{flex:1,padding:'12px 8px',background:'#0a0a0a',border:'1px solid #333',borderRadius:10,color:'#fff',fontSize:18,textAlign:'center',fontWeight:700}}/>
                        <button style={stepBtn} onClick={()=>setPedidoQtys(prev=>({...prev,[p.producto_id]:qty+1}))}>+</button>
                      </div>
                    </div>
                  );})}
                </div>
              );
            });
          })()}
        </>
      )}

      <div style={{position:'fixed',bottom:0,left:0,right:0,padding:'12px 16px 20px',background:'linear-gradient(transparent, #0d0d0d 30%)',zIndex:20}}>
        {(()=>{const itemsConQty=pedidoItems.filter(p=>n(pedidoQtys[p.producto_id])>0).length; return modo==='bebidas'?(
          <button className="btn btn-red" onClick={descargarPdfBebidas} disabled={descargandoPdf||itemsConQty===0}
            style={{fontSize:17,padding:18,width:'100%',opacity:itemsConQty===0?0.5:1,marginBottom:8}}>
            {descargandoPdf?<span className="spin"/>:itemsConQty>0?`⬇️ Descargar PDF del pedido (${itemsConQty} bebidas)`:'⬇️ Descargar PDF del pedido'}
          </button>
        ):(
          <button className="btn btn-red" onClick={enviarPedido} disabled={generandoPedido||itemsConQty===0}
            style={{fontSize:17,padding:18,width:'100%',opacity:itemsConQty===0?0.5:1,marginBottom:8}}>
            {generandoPedido?<span className="spin"/>:itemsConQty>0?`📤 Enviar Pedido (${itemsConQty} productos)`:'📤 Enviar Pedido'}
          </button>
        );})()}
        <button onClick={omitirPedido}
          style={{background:'none',border:'none',color:'#555',fontSize:12,cursor:'pointer',width:'100%',padding:6}}>
          {modo==='bebidas'?'Listo — salir sin descargar':'Omitir pedido esta noche'}
        </button>
      </div>
    </div>
  );
}
