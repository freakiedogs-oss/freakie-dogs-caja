import { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../../supabase';
import { STORES, STORES_SHORT, today, yesterday, shiftDate, n } from '../../config';
import { useToast } from '../../hooks/useToast';

// Helper: horas restantes de las 72h desde aprobado_at
function horasRestantes72(aprobadoAt){
  if(!aprobadoAt) return -1;
  const ms=new Date(aprobadoAt).getTime()+72*3600*1000-Date.now();
  return ms>0?ms/3600000:-1;
}
function fmtTimer(horas){
  if(horas<=0) return null;
  const h=Math.floor(horas);
  const m=Math.floor((horas-h)*60);
  if(h>=24) return `${Math.floor(h/24)}d ${h%24}h`;
  return `${h}h ${m}m`;
}

const fmt$ = (v) => `$${parseFloat(v || 0).toFixed(2)}`;
const fmtPct = (v) => `${parseFloat(v || 0).toFixed(2)}%`;

// Helper: consolidar array de cierres en un solo objeto sumado
function consolidarCierres(arr){
  if(!arr||arr.length===0) return null;
  if(arr.length===1) return {...arr[0], _turnos: [arr[0].turno], _turnoCount: 1};
  const base={...arr[0]};
  const campos=['efectivo_quanto','tarjeta_quanto','ventas_transferencia','ventas_link_pago',
    'total_ventas_quanto','total_egresos','total_ingresos','efectivo_calculado',
    'efectivo_real_depositar','diferencia_deposito'];
  campos.forEach(k=>{ base[k]=arr.reduce((s,c)=>s+n(c[k]),0); });
  // Observaciones: concatenar las que existan
  const obs=arr.map(c=>c.observaciones).filter(Boolean);
  base.observaciones=obs.length?obs.join(' | '):null;
  // Comentario corrección: concatenar
  const corr=arr.map(c=>c.comentario_correccion).filter(Boolean);
  base.comentario_correccion=corr.length?corr.join(' | '):null;
  // Estado: el "peor" estado del grupo (corrección > enviado > borrador > aprobado)
  const prioridad={requiere_correccion:0,enviado:1,borrador:2,aprobado:3};
  const peor=arr.reduce((worst,c)=>(prioridad[c.estado]??99)<(prioridad[worst.estado]??99)?c:worst,arr[0]);
  base.estado=peor.estado;
  base.turno=arr.map(c=>c.turno).join(' + ');
  base.creado_por=[...new Set(arr.map(c=>c.creado_por))].join(', ');
  base._turnos=arr.map(c=>c.turno);
  base._turnoCount=arr.length;
  // Para aprobación masiva guardamos los IDs
  base._ids=arr.map(c=>c.id);
  return base;
}

function EstadoBadge({estado}){
  const map={
    aprobado:{cls:'tag-green',txt:'✓ Aprobado'},
    enviado:{cls:'tag-yellow',txt:'En revisión'},
    borrador:{cls:'tag-gray',txt:'Borrador'},
    requiere_correccion:{cls:'tag-orange',txt:'⚠ Corrección'}
  };
  const s=map[estado]||{cls:'tag-gray',txt:estado};
  return <span className={`tag ${s.cls}`}>{s.txt}</span>;
}

export default function AdminView({user,onEditCierre,onBack,onAcciones}){
  const {show,Toast}=useToast();
  const [fechaDesde,setFechaDesde]=useState(today());
  const [fechaHasta,setFechaHasta]=useState(today());
  const [egresosDetalle,setEgresosDetalle]=useState([]);
  const [ingresosDetalle,setIngresosDetalle]=useState([]);
  const [accionesPendientesCount,setAccionesPendientesCount]=useState(0);
  const [cierres,setCierres]=useState([]);
  const [depositos,setDepositos]=useState([]);
  const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState(null);       // cierre consolidado (o individual)
  const [selectedGroup,setSelectedGroup]=useState([]); // todos los cierres raw del grupo
  const [turnoActivo,setTurnoActivo]=useState('consolidado'); // 'consolidado' | turno real
  const [comentario,setComentario]=useState('');
  const [saving,setSaving]=useState(false);
  const [depDetalle,setDepDetalle]=useState(null);
  // Filtros
  const [filtroEstado,setFiltroEstado]=useState('todos');
  const [filtroSuc,setFiltroSuc]=useState('todas');

  // Almacén completo de egresos/ingresos (todos los turnos)
  const [allEgresos,setAllEgresos]=useState([]);
  const [allIngresos,setAllIngresos]=useState([]);

  const allStoreCodes=Object.keys(STORES).filter(sc=>sc!=='CM001');
  const esRangoSimple=fechaDesde===fechaHasta;

  const cargar=async()=>{
    setLoading(true);
    const [cRes,dRes,accRes]=await Promise.all([
      db.from('ventas_diarias').select('*').gte('fecha',fechaDesde).lte('fecha',fechaHasta).order('fecha',{ascending:false}).order('store_code'),
      db.from('depositos_bancarios').select('*').gte('fecha_deposito',fechaDesde).lte('fecha_deposito',fechaHasta),
      db.from('acciones_pendientes').select('id').eq('estado','pendiente')
    ]);
    setCierres(cRes.data||[]);
    setDepositos(dRes.data||[]);
    setAccionesPendientesCount((accRes.data||[]).length);
    setLoading(false);
  };

  // Helper: agrupar cierres por store_code+fecha
  const groupByStoreDate=useCallback((cierresArr)=>{
    const map={};
    for(const c of cierresArr){
      const key=`${c.store_code}|${c.fecha}`;
      if(!map[key]) map[key]=[];
      map[key].push(c);
    }
    return map;
  },[]);

  // Abrir detalle — carga egresos/ingresos de TODOS los turnos del día
  const abrirDetalle=async(consolidado, group)=>{
    setSelected(consolidado);
    setSelectedGroup(group);
    setTurnoActivo('consolidado');
    setComentario(consolidado.comentario_aprobacion||'');
    setDepDetalle(null);

    const ids=group.map(c=>c.id);
    const [egRes,inRes,depRes]=await Promise.all([
      db.from('egresos_cierre').select('*').in('cierre_id',ids),
      db.from('ingresos_cierre').select('*').in('cierre_id',ids),
      db.from('depositos_bancarios').select('*').eq('store_code',consolidado.store_code).contains('dias_cubiertos',[consolidado.fecha]).limit(1)
    ]);
    setAllEgresos(egRes.data||[]);
    setAllIngresos(inRes.data||[]);
    setDepDetalle((depRes.data||[])[0]||null);
  };

  // Filtrar egresos/ingresos por turno activo
  const egresosDetalleFiltrados=useMemo(()=>{
    if(turnoActivo==='consolidado') return allEgresos;
    const turnoIds=selectedGroup.filter(c=>c.turno===turnoActivo).map(c=>c.id);
    return allEgresos.filter(e=>turnoIds.includes(e.cierre_id));
  },[allEgresos,turnoActivo,selectedGroup]);

  const ingresosDetalleFiltrados=useMemo(()=>{
    if(turnoActivo==='consolidado') return allIngresos;
    const turnoIds=selectedGroup.filter(c=>c.turno===turnoActivo).map(c=>c.id);
    return allIngresos.filter(e=>turnoIds.includes(e.cierre_id));
  },[allIngresos,turnoActivo,selectedGroup]);

  // Datos numéricos del modal según turno activo
  const datosModal=useMemo(()=>{
    if(!selected) return null;
    if(turnoActivo==='consolidado') return selected;
    const turnoC=selectedGroup.find(c=>c.turno===turnoActivo);
    return turnoC||selected;
  },[selected,turnoActivo,selectedGroup]);

  const confirmarDeposito=async()=>{
    if(!depDetalle)return;
    setSaving(true);
    await db.from('depositos_bancarios').update({estado:'confirmado'}).eq('id',depDetalle.id);
    setSaving(false);
    setDepDetalle({...depDetalle,estado:'confirmado'});
    show('✓ Depósito confirmado');
  };

  useEffect(()=>{cargar();},[fechaDesde,fechaHasta]);

  // Helpers de filtro
  const matchEstado=(estado,dep)=>{
    if(filtroEstado==='todos') return true;
    if(filtroEstado==='completo') return estado==='aprobado'&&dep&&dep.estado==='confirmado';
    return filtroEstado===estado;
  };
  const matchSuc=(sc)=> filtroSuc==='todas'||filtroSuc===sc;

  // Status de una sucursal en una fecha — ahora consolida todos los turnos
  const getStatus=(sc,fecha)=>{
    const group=cierres.filter(x=>x.store_code===sc&&x.fecha===fecha);
    if(group.length===0) return {tipo:'faltante'};
    const c=consolidarCierres(group);
    const dep=depositos.find(d=>d.store_code===sc&&(d.fotos_urls||[]).length>0);
    if(c.estado==='aprobado'&&dep&&dep.estado==='confirmado') return {tipo:'completo',cierre:c,group,dep};
    if(c.estado==='aprobado') return {tipo:'aprobado',cierre:c,group,dep:dep||null};
    if(c.estado==='requiere_correccion') return {tipo:'correccion',cierre:c,group,dep:dep||null};
    if(c.estado==='enviado') return {tipo:'revision',cierre:c,group,dep:dep||null};
    return {tipo:'borrador',cierre:c,group,dep:dep||null};
  };

  // KPIs basados en filtros actuales
  const kpi=useMemo(()=>{
    const filtered=cierres.filter(c=>{
      const dep=depositos.find(d=>d.store_code===c.store_code&&(d.fotos_urls||[]).length>0);
      return matchEstado(c.estado,dep)&&matchSuc(c.store_code);
    });
    const base=filtered.filter(c=>c.diferencia_deposito!=null);
    const totalDif=base.reduce((s,c)=>s+n(c.diferencia_deposito),0);
    const totalAbsDif=base.reduce((s,c)=>s+Math.abs(n(c.diferencia_deposito)),0);
    const totalEfCalc=base.reduce((s,c)=>s+n(c.efectivo_calculado),0);
    const pct=totalEfCalc>0?(totalAbsDif/totalEfCalc)*100:0;
    return {totalDif,totalAbsDif,totalEfCalc,pct,count:base.length};
  },[cierres,depositos,filtroEstado,filtroSuc]);

  // Stats del rango completo (sin filtro sucursal/estado) para la barra superior
  const statsBase=useMemo(()=>{
    const out={faltante:0,revision:0,correccion:0,aprobado:0,completo:0};
    if(esRangoSimple){
      allStoreCodes.forEach(sc=>{
        const s=getStatus(sc,fechaDesde);
        if(out[s.tipo]!==undefined)out[s.tipo]++;
      });
    } else {
      // Agrupar por store+fecha, contar por grupo consolidado
      const grouped=groupByStoreDate(cierres);
      Object.values(grouped).forEach(group=>{
        const c=consolidarCierres(group);
        const dep=depositos.find(d=>d.store_code===c.store_code&&(d.fotos_urls||[]).length>0);
        if(c.estado==='aprobado'&&dep&&dep.estado==='confirmado')out.completo++;
        else if(c.estado==='aprobado')out.aprobado++;
        else if(c.estado==='requiere_correccion')out.correccion++;
        else if(c.estado==='enviado')out.revision++;
      });
    }
    return out;
  },[cierres,depositos,fechaDesde,esRangoSimple]);

  const STATUS_CFG={
    faltante:{label:'Sin enviar',color:'#555',bg:'#1a1a1a',border:'#2a2a2a',icon:'—'},
    borrador:{label:'Borrador',color:'#666',bg:'#1a1a1a',border:'#2a2a2a',icon:'✏'},
    revision:{label:'Por revisar',color:'#facc15',bg:'#71400022',border:'#713f12',icon:'👁'},
    correccion:{label:'Req. corrección',color:'#f97316',bg:'#431c0322',border:'#7c2d12',icon:'⚠'},
    aprobado:{label:'Aprobado',color:'#4ade80',bg:'#14532d22',border:'#14532d',icon:'✓'},
    completo:{label:'★ Completo',color:'#4ade80',bg:'#14532d44',border:'#16a34a',icon:'★'},
  };

  const tagDif=dif=>{
    const a=Math.abs(dif||0);
    if(a<1) return <span className="tag tag-green">✓ OK</span>;
    if(a<=5) return <span className="tag tag-yellow">{fmt$(a)}</span>;
    return <span className="tag tag-red">⚠ {fmt$(a)}</span>;
  };

  // Aprobar: ahora afecta todos los cierres del grupo
  const aprobar=async(estado)=>{
    if(!selected)return;
    setSaving(true);
    const ids=selectedGroup.map(c=>c.id);
    const updateData={estado,aprobado_por:`${user.nombre} ${user.apellido}`,aprobado_at:new Date().toISOString(),comentario_aprobacion:comentario.trim()||null};
    await Promise.all(ids.map(id=>
      db.from('ventas_diarias').update(updateData).eq('id',id)
    ));
    setSaving(false);
    show(estado==='aprobado'?'✓ Cierre aprobado':'⚠ Marcado para corrección');
    setSelected(null); setSelectedGroup([]); setComentario(''); cargar();
  };

  // Lista a mostrar — ahora SIEMPRE consolida por store_code+fecha
  const displayItems=useMemo(()=>{
    const getTipo=(c,dep)=>{
      if(c.estado==='aprobado'&&dep&&dep.estado==='confirmado') return 'completo';
      if(c.estado==='aprobado') return 'aprobado';
      if(c.estado==='requiere_correccion') return 'correccion';
      if(c.estado==='enviado') return 'revision';
      return 'borrador';
    };

    if(esRangoSimple){
      const stores=filtroSuc==='todas'?allStoreCodes:[filtroSuc];
      return stores.map(sc=>{
        const s=getStatus(sc,fechaDesde);
        if(filtroEstado!=='todos'){
          const tipoMatch=filtroEstado===s.tipo||(filtroEstado==='enviado'&&s.tipo==='revision');
          if(!tipoMatch) return null;
        }
        return {sc,s};
      }).filter(Boolean);
    } else {
      // Agrupar por store_code+fecha → una tarjeta por grupo
      const grouped=groupByStoreDate(cierres);
      const items=[];
      for(const [key,group] of Object.entries(grouped)){
        const c=consolidarCierres(group);
        if(!matchSuc(c.store_code)) continue;
        const dep=depositos.find(d=>d.store_code===c.store_code&&(d.fotos_urls||[]).length>0);
        if(!matchEstado(c.estado,dep)) continue;
        const tipo=getTipo(c,dep);
        items.push({sc:c.store_code,s:{tipo,cierre:c,group,dep:dep||null}});
      }
      // Ordenar por fecha desc, luego store_code
      items.sort((a,b)=>b.s.cierre.fecha.localeCompare(a.s.cierre.fecha)||a.sc.localeCompare(b.sc));
      return items;
    }
  },[esRangoSimple,cierres,depositos,filtroSuc,filtroEstado,fechaDesde]);

  // Cerrar modal
  const cerrarModal=()=>{
    setSelected(null);setSelectedGroup([]);setTurnoActivo('consolidado');
    setAllEgresos([]);setAllIngresos([]);
  };

  return(
    <div style={{minHeight:'100vh',padding:'0 16px 50px'}}>
      <Toast/>

      {/* Modal cierre detalle */}
      {selected&&datosModal&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&cerrarModal()}>
          <div className="modal">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
              <div>
                <div style={{fontWeight:800,fontSize:17}}>{STORES[selected.store_code]||selected.store_code}</div>
                <div style={{fontSize:13,color:'#666'}}>{selected.fecha} · {datosModal.turno} · {datosModal.creado_por}</div>
              </div>
              <EstadoBadge estado={datosModal.estado}/>
            </div>

            {/* Toggle de turnos — solo si hay >1 turno */}
            {selectedGroup.length>1&&(
              <div style={{display:'flex',gap:4,margin:'10px 0 6px',flexWrap:'wrap'}}>
                <button
                  onClick={()=>setTurnoActivo('consolidado')}
                  style={{
                    padding:'5px 14px',borderRadius:16,fontSize:12,fontWeight:600,cursor:'pointer',
                    background:turnoActivo==='consolidado'?'#e63946':'#1e1e1e',
                    color:turnoActivo==='consolidado'?'#fff':'#aaa',
                    border:turnoActivo==='consolidado'?'1px solid #e63946':'1px solid #333'
                  }}>
                  Consolidado
                </button>
                {selectedGroup.map(c=>(
                  <button key={c.turno}
                    onClick={()=>setTurnoActivo(c.turno)}
                    style={{
                      padding:'5px 14px',borderRadius:16,fontSize:12,fontWeight:600,cursor:'pointer',
                      background:turnoActivo===c.turno?'#e63946':'#1e1e1e',
                      color:turnoActivo===c.turno?'#fff':'#aaa',
                      border:turnoActivo===c.turno?'1px solid #e63946':'1px solid #333'
                    }}>
                    {c.turno.charAt(0).toUpperCase()+c.turno.slice(1)}
                  </button>
                ))}
              </div>
            )}

            <div style={{margin:'14px 0 4px'}}>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Efectivo QUANTO</span><span style={{fontWeight:600}}>{fmt$(datosModal.efectivo_quanto)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Tarjeta QUANTO</span><span style={{fontWeight:600}}>{fmt$(datosModal.tarjeta_quanto)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Transferencia</span><span style={{fontWeight:600}}>{fmt$(datosModal.ventas_transferencia)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Link de Pago</span><span style={{fontWeight:600}}>{fmt$(datosModal.ventas_link_pago)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Total ventas</span><span style={{fontWeight:700}}>{fmt$(datosModal.total_ventas_quanto)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Egresos</span><span style={{fontWeight:600,color:'#f87171'}}>-{fmt$(datosModal.total_egresos)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Ingresos</span><span style={{fontWeight:600,color:'#4ade80'}}>+{fmt$(datosModal.total_ingresos)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Efectivo calculado</span><span style={{fontWeight:700}}>{fmt$(datosModal.efectivo_calculado)}</span></div>
              <div className="row"><span style={{fontWeight:700}}>Efectivo real depósito</span><span style={{fontWeight:800,fontSize:17}}>{fmt$(datosModal.efectivo_real_depositar)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Diferencia</span>{tagDif(datosModal.diferencia_deposito)}</div>
              {datosModal.observaciones&&<div className="row"><span style={{color:'#888',fontSize:13}}>Obs:</span><span style={{fontSize:13}}>{datosModal.observaciones}</span></div>}
              {datosModal.comentario_correccion&&(
                <div style={{marginTop:8,padding:'8px 10px',background:'#0d1a2a',borderRadius:8,fontSize:13,color:'#60a5fa'}}>
                  📝 <strong>Respuesta del equipo:</strong> {datosModal.comentario_correccion}
                </div>
              )}
            </div>

            {/* Detalle egresos con fotos */}
            {egresosDetalleFiltrados.length>0&&(
              <div style={{marginTop:12}}>
                <div className="sec-title">Egresos del día{turnoActivo!=='consolidado'?` (${turnoActivo})`:''}</div>
                {egresosDetalleFiltrados.map(eg=>(
                  <div key={eg.id} style={{padding:'8px 12px',background:'#1a1a1a',borderRadius:8,marginBottom:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div>
                        <span style={{fontWeight:600,fontSize:13}}>{eg.motivo_nombre}</span>
                        {eg.persona_recibe&&<span style={{fontSize:12,color:'#888'}}> → {eg.persona_recibe}</span>}
                      </div>
                      <span style={{fontWeight:700,color:'#f87171',fontSize:13}}>{fmt$(eg.monto)}</span>
                    </div>
                    {eg.comentario&&<div style={{fontSize:11,color:'#888',marginTop:2}}>{eg.comentario}</div>}
                    {eg.foto_url&&(
                      <a href={eg.foto_url} target="_blank" rel="noopener" style={{display:'block',marginTop:6}}>
                        <img src={eg.foto_url} style={{width:'100%',maxHeight:200,objectFit:'cover',borderRadius:8,border:'1px solid #333'}} alt="Foto egreso"/>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Detalle ingresos */}
            {ingresosDetalleFiltrados.length>0&&(
              <div style={{marginTop:12}}>
                <div className="sec-title">Ingresos del día{turnoActivo!=='consolidado'?` (${turnoActivo})`:''}</div>
                {ingresosDetalleFiltrados.map(ing=>(
                  <div key={ing.id} style={{padding:'8px 12px',background:'#1a1a1a',borderRadius:8,marginBottom:8,display:'flex',justifyContent:'space-between'}}>
                    <div>
                      <span style={{fontWeight:600,fontSize:13}}>{ing.motivo_nombre}</span>
                      {ing.nombre_evento&&<span style={{fontSize:12,color:'#888'}}> · {ing.nombre_evento}</span>}
                    </div>
                    <span style={{fontWeight:700,color:'#4ade80',fontSize:13}}>{fmt$(ing.monto)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Sección depósito con foto */}
            {depDetalle&&(
              <div style={{marginTop:14}}>
                <div className="sec-title">🏦 Depósito Bancario</div>
                <div style={{background:'#1a1a1a',borderRadius:10,padding:12,border:'1px solid #2a2a2a'}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                    <span style={{color:'#888',fontSize:13}}>Monto depositado</span>
                    <span style={{fontWeight:800,fontSize:17}}>{fmt$(depDetalle.monto)}</span>
                  </div>
                  {depDetalle.monto_esperado!=null&&(
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                      <span style={{color:'#888',fontSize:13}}>Monto esperado</span>
                      <span style={{fontWeight:600}}>{fmt$(depDetalle.monto_esperado)}</span>
                    </div>
                  )}
                  {depDetalle.diferencia_deposito!=null&&(
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
                      <span style={{color:'#888',fontSize:13}}>Diferencia</span>
                      {tagDif(depDetalle.diferencia_deposito)}
                    </div>
                  )}
                  {(depDetalle.fotos_urls||[]).map((url,i)=>(
                    <a key={i} href={url} target="_blank" rel="noopener" style={{display:'block',marginBottom:8}}>
                      <img src={url} style={{width:'100%',maxHeight:280,objectFit:'contain',borderRadius:8,border:'1px solid #333',background:'#111'}} alt={`Foto depósito ${i+1}`}/>
                    </a>
                  ))}
                  {depDetalle.notas&&<div style={{fontSize:12,color:'#888',fontStyle:'italic',marginTop:4}}>📝 {depDetalle.notas}</div>}
                  {depDetalle.estado==='pendiente'?(
                    <button className="btn btn-red" onClick={confirmarDeposito} disabled={saving}
                      style={{width:'100%',marginTop:10,fontSize:14}}>
                      {saving?<span className="spin"/>:'✓ Confirmo: monto coincide con la foto'}
                    </button>
                  ):(
                    <div style={{textAlign:'center',padding:'8px 0',color:'#4ade80',fontWeight:700,fontSize:13,marginTop:6}}>
                      ✓ Depósito confirmado
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Timer 72h para aprobados */}
            {selected.estado==='aprobado'&&selected.aprobado_at&&(()=>{
              const hr=horasRestantes72(selected.aprobado_at);
              const timer=fmtTimer(hr);
              return timer?(
                <div style={{marginTop:12,padding:'8px 12px',background:'#1e3a5f33',borderRadius:8,display:'flex',justifyContent:'space-between',alignItems:'center',border:'1px solid #1e3a5f'}}>
                  <span style={{fontSize:12,color:'#60a5fa'}}>⏱ Editable por: <strong>{timer}</strong></span>
                  <button className="btn btn-ghost" onClick={()=>{cerrarModal();onEditCierre(selectedGroup[0]);}}
                    style={{fontSize:12,color:'#60a5fa',borderColor:'#1e3a5f',padding:'4px 12px'}}>
                    ✏️ Editar
                  </button>
                </div>
              ):(
                <div style={{marginTop:12,padding:'8px 12px',background:'#1a1a1a',borderRadius:8,fontSize:12,color:'#555',textAlign:'center'}}>
                  🔒 Período de edición (72h) expirado
                </div>
              );
            })()}

            {/* Edición completa → navega a CierreForm */}
            {selected.estado!=='aprobado'&&(
              <button className="btn btn-ghost" onClick={()=>{cerrarModal();onEditCierre(selectedGroup[0]);}}
                style={{marginTop:12,marginBottom:4,fontSize:13,color:'#60a5fa',borderColor:'#1e3a5f'}}>
                ✏️ Editar cierre completo (egresos, ingresos, ventas...)
              </button>
            )}

            <div style={{marginTop:12,marginBottom:8}}>
              <div style={{fontSize:13,color:'#aaa',marginBottom:5}}>Comentario de revisión</div>
              <textarea className="inp" rows={2} value={comentario} onChange={e=>setComentario(e.target.value)}
                placeholder="Opcional..." style={{resize:'none'}}
                readOnly={selected.estado==='aprobado'}/>
            </div>
            {selected.estado!=='aprobado'&&(
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-ghost" onClick={()=>aprobar('requiere_correccion')} disabled={saving}
                  style={{flex:1,fontSize:13,color:'#f97316',borderColor:'#7c2d12'}}>
                  ⚠ Corrección
                </button>
                <button className="btn btn-red" onClick={()=>aprobar('aprobado')} disabled={saving} style={{flex:2}}>
                  {saving?<span className="spin"/>:'✓ Aprobar'}
                </button>
              </div>
            )}
            {selected.estado==='aprobado'&&(
              <div style={{textAlign:'center',padding:'8px 0',color:'#4ade80',fontWeight:700}}>
                ✓ Aprobado por {selected.aprobado_por}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'20px 0 12px'}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'#e63946',fontSize:26,cursor:'pointer',padding:'0 4px'}}>‹</button>
        <div style={{fontWeight:800,fontSize:17}}>Dashboard de Cierres</div>
      </div>

      {/* Rango de fechas */}
      <div className="card">
        <div className="sec-title">Rango de Fechas</div>
        <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap',alignItems:'center'}}>
          {[
            {lbl:'Hoy',fn:()=>{setFechaDesde(today());setFechaHasta(today());}},
            {lbl:'Ayer',fn:()=>{setFechaDesde(yesterday());setFechaHasta(yesterday());}},
            {lbl:'7 días',fn:()=>{setFechaDesde(shiftDate(today(),-6));setFechaHasta(today());}},
            {lbl:'Este mes',fn:()=>{setFechaDesde(today().slice(0,7)+'-01');setFechaHasta(today());}},
          ].map(({lbl,fn})=>(
            <button key={lbl} onClick={fn} style={{padding:'4px 12px',borderRadius:16,fontSize:12,background:'#1e1e1e',border:'1px solid #333',color:'#aaa',cursor:'pointer'}}>{lbl}</button>
          ))}
          <div style={{marginLeft:'auto',display:'flex',gap:4}}>
            <button onClick={()=>{setFechaDesde(shiftDate(fechaDesde,-1));setFechaHasta(shiftDate(fechaHasta,-1));}}
              style={{background:'#1e1e1e',border:'1px solid #333',color:'#aaa',borderRadius:8,width:36,height:36,fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>◀</button>
            <button onClick={()=>{const nd=shiftDate(fechaDesde,1);const nh=shiftDate(fechaHasta,1);if(nh<=today()){setFechaDesde(nd);setFechaHasta(nh);}}}
              style={{background:'#1e1e1e',border:'1px solid #333',color:'#aaa',borderRadius:8,width:36,height:36,fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>▶</button>
          </div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <div style={{flex:1}}>
            <div style={{fontSize:12,color:'#555',marginBottom:4}}>Desde</div>
            <input type="date" className="inp" value={fechaDesde} onChange={e=>{setFechaDesde(e.target.value);if(e.target.value>fechaHasta)setFechaHasta(e.target.value);}} style={{fontSize:14,padding:'10px 12px'}}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:12,color:'#555',marginBottom:4}}>Hasta</div>
            <input type="date" className="inp" value={fechaHasta} onChange={e=>setFechaHasta(e.target.value)} style={{fontSize:14,padding:'10px 12px'}}/>
          </div>
        </div>
      </div>

      {/* Stats resumen */}
      <div style={{display:'flex',gap:6,marginBottom:14}}>
        {[
          {k:'faltante',l:'Sin enviar',c:'#555'},
          {k:'revision',l:'Revisión',c:'#facc15'},
          {k:'correccion',l:'Corrección',c:'#f97316'},
          {k:'aprobado',l:'Aprobado',c:'#4ade80'},
          {k:'completo',l:'Completo',c:'#4ade80'},
        ].map(({k,l,c})=>(
          <div key={k} className="stat-card">
            <div style={{fontSize:20,fontWeight:800,color:c}}>{statsBase[k]||0}</div>
            <div style={{fontSize:9,color:'#555',marginTop:2,lineHeight:1.2}}>{l}</div>
          </div>
        ))}
      </div>

      {/* KPI descuadre */}
      <div className="card" style={{background:'#111',border:'1px solid #333',marginBottom:14}}>
        <div className="sec-title">KPI — Descuadre de Efectivo</div>
        <div style={{fontSize:12,color:'#555',marginBottom:10}}>{kpi.count} cierre{kpi.count!==1?'s':''} con datos · filtros aplicados</div>
        <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:120}}>
            <div style={{fontSize:11,color:'#555',marginBottom:4}}>Descuadre nominal</div>
            <div style={{fontWeight:800,fontSize:20,color:Math.abs(kpi.totalDif)<1?'#4ade80':Math.abs(kpi.totalDif)<=20?'#facc15':'#f87171'}}>
              {kpi.totalDif>=0?'+':''}{fmt$(kpi.totalDif)}
            </div>
            <div style={{fontSize:11,color:'#555',marginTop:2}}>{kpi.totalDif>0?'sobrante':kpi.totalDif<0?'faltante':'cuadrado'}</div>
          </div>
          <div style={{flex:1,minWidth:120}}>
            <div style={{fontSize:11,color:'#555',marginBottom:4}}>Magnitud absoluta</div>
            <div style={{fontWeight:800,fontSize:20,color:kpi.totalAbsDif<1?'#4ade80':kpi.totalAbsDif<=20?'#facc15':'#f87171'}}>
              {fmt$(kpi.totalAbsDif)}
            </div>
            <div style={{fontSize:11,color:'#555',marginTop:2}}>abs(diferencias)</div>
          </div>
          <div style={{flex:1,minWidth:120}}>
            <div style={{fontSize:11,color:'#555',marginBottom:4}}>% del efectivo</div>
            <div style={{fontWeight:800,fontSize:20,color:kpi.pct<0.5?'#4ade80':kpi.pct<=2?'#facc15':'#f87171'}}>
              {fmtPct(kpi.pct)}
            </div>
            <div style={{fontSize:11,color:'#555',marginTop:2}}>sobre {fmt$(kpi.totalEfCalc)} calc.</div>
          </div>
        </div>
      </div>

      {/* Banner acciones pendientes */}
      {accionesPendientesCount>0&&(
        <div className="card" style={{background:'linear-gradient(135deg,#431c03,#1a1a1a)',border:'1px solid #f97316',marginBottom:14,cursor:'pointer'}}
          onClick={()=>onAcciones&&onAcciones()}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{fontSize:28}}>⚡</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,color:'#f97316',fontSize:15}}>{accionesPendientesCount} acción{accionesPendientesCount!==1?'es':''} pendiente{accionesPendientesCount!==1?'s':''}</div>
              <div style={{fontSize:12,color:'#888',marginTop:2}}>Incidentes que requieren seguimiento</div>
            </div>
            <div style={{color:'#f97316',fontSize:20}}>→</div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="card">
        <div style={{fontSize:11,color:'#555',marginBottom:6,fontWeight:700,letterSpacing:1}}>ESTADO</div>
        <div className="chips">
          {[{k:'todos',l:'Todos'},{k:'enviado',l:'Por revisar'},{k:'requiere_correccion',l:'Corrección'},{k:'aprobado',l:'Aprobado'},{k:'completo',l:'★ Completo'}].map(({k,l})=>(
            <div key={k} className={`chip${filtroEstado===k?' on':''}`} onClick={()=>setFiltroEstado(k)}>{l}</div>
          ))}
        </div>
        <div style={{fontSize:11,color:'#555',marginBottom:6,fontWeight:700,letterSpacing:1,marginTop:8}}>SUCURSAL</div>
        <div className="chips">
          <div className={`chip${filtroSuc==='todas'?' on':''}`} onClick={()=>setFiltroSuc('todas')}>Todas</div>
          {allStoreCodes.map(sc=>(
            <div key={sc} className={`chip${filtroSuc===sc?' on':''}`} onClick={()=>setFiltroSuc(sc)}>
              {STORES_SHORT[sc]||sc}
            </div>
          ))}
        </div>
      </div>

      {/* Lista */}
      {loading?(
        <div style={{textAlign:'center',padding:30}}><div className="spin" style={{width:32,height:32,margin:'0 auto'}}/></div>
      ):(
        displayItems.length===0?(
          <div style={{textAlign:'center',color:'#444',padding:30}}>Sin resultados para los filtros seleccionados</div>
        ):(
          displayItems.map(({sc,s},idx)=>{
            const cfg=STATUS_CFG[s.tipo];
            const c=s.cierre;
            const group=s.group||[c].filter(Boolean);
            return(
              <div key={`${sc}-${c?.fecha||idx}`}
                onClick={c?()=>abrirDetalle(c,group):undefined}
                style={{background:cfg.bg,border:`1.5px solid ${cfg.border}`,borderRadius:12,padding:'14px 16px',marginBottom:10,cursor:c?'pointer':'default',opacity:s.tipo==='faltante'?.5:1}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15}}>{STORES[sc]}</div>
                    {c&&(
                      <div style={{fontSize:12,color:'#888',marginTop:2}}>
                        {!esRangoSimple&&`${c.fecha} · `}
                        {c._turnoCount>1
                          ? <span style={{color:'#60a5fa'}}>{c._turnoCount} turnos</span>
                          : c.turno}
                        {' · '}{c.creado_por}
                      </div>
                    )}
                    {!c&&<div style={{fontSize:12,color:'#555',marginTop:2}}>Sin cierre registrado</div>}
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13,color:cfg.color}}>{cfg.icon} {cfg.label}</div>
                    {c&&<div style={{marginTop:4}}>{tagDif(c.diferencia_deposito)}</div>}
                  </div>
                </div>
                {c&&(
                  <div style={{display:'flex',gap:16,marginTop:10}}>
                    <div style={{fontSize:12}}><span style={{color:'#666'}}>Ventas: </span><span style={{fontWeight:600}}>{fmt$(c.total_ventas_quanto)}</span></div>
                    <div style={{fontSize:12}}><span style={{color:'#666'}}>Depósito: </span><span style={{fontWeight:600}}>{fmt$(c.efectivo_real_depositar)}</span></div>
                  </div>
                )}
                {s.dep&&(
                  s.dep.estado==='confirmado'
                    ? <div style={{marginTop:6,fontSize:12,color:'#4ade80'}}>🏦 Depósito {fmt$(s.dep.monto)} confirmado con foto</div>
                    : <div style={{marginTop:6,fontSize:12,color:'#facc15',background:'rgba(250,204,21,0.10)',borderRadius:6,padding:'3px 8px',display:'inline-block'}}>🏦 Depósito reportado, falta confirmación</div>
                )}
              </div>
            );
          })
        )
      )}
    </div>
  );
}
