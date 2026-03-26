import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';
import { STORES, today, n } from '../../config';
import { useToast } from '../../hooks/useToast';

const fmt$ = (n) => `$${parseFloat(n || 0).toFixed(2)}`;


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
  const [selected,setSelected]=useState(null);
  const [comentario,setComentario]=useState('');
  const [saving,setSaving]=useState(false);
  // Filtros
  const [filtroEstados,setFiltroEstados]=useState(new Set(['todos']));
  const [filtroSucursales,setFiltroSucursales]=useState(new Set(['todas']));

  const allStoreCodes=Object.keys(STORES);
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

  // Cargar egresos/ingresos al seleccionar un cierre
  const abrirDetalle=async(cierre)=>{
    setSelected(cierre);setComentario(cierre.comentario_aprobacion||'');
    const [egRes,inRes]=await Promise.all([
      db.from('egresos_cierre').select('*').eq('cierre_id',cierre.id),
      db.from('ingresos_cierre').select('*').eq('cierre_id',cierre.id)
    ]);
    setEgresosDetalle(egRes.data||[]);
    setIngresosDetalle(inRes.data||[]);
  };

  useEffect(()=>{cargar();},[fechaDesde,fechaHasta]);

  // Filtros chips toggle
  const toggleEstado=e=>{
    if(e==='todos'){setFiltroEstados(new Set(['todos']));return;}
    setFiltroEstados(prev=>{
      const next=new Set(prev);next.delete('todos');
      next.has(e)?next.delete(e):next.add(e);
      if(next.size===0)next.add('todos');
      return next;
    });
  };
  const toggleSucursal=sc=>{
    if(sc==='todas'){setFiltroSucursales(new Set(['todas']));return;}
    setFiltroSucursales(prev=>{
      const next=new Set(prev);next.delete('todas');
      next.has(sc)?next.delete(sc):next.add(sc);
      if(next.size===0)next.add('todas');
      return next;
    });
  };

  // Status de una sucursal en una fecha específica
  const getStatus=(sc,fecha)=>{
    const c=cierres.find(x=>x.store_code===sc&&x.fecha===fecha);
    if(!c) return {tipo:'faltante'};
    const dep=depositos.find(d=>d.store_code===sc&&(d.fotos_urls||[]).length>0);
    if(c.estado==='aprobado'&&dep) return {tipo:'completo',cierre:c,dep};
    if(c.estado==='aprobado') return {tipo:'aprobado',cierre:c};
    if(c.estado==='requiere_correccion') return {tipo:'correccion',cierre:c};
    if(c.estado==='enviado') return {tipo:'revision',cierre:c};
    return {tipo:'borrador',cierre:c};
  };

  // Filtrar cierres para el listado
  const filteredCierres=useMemo(()=>{
    return cierres.filter(c=>{
      const estadoOk=filtroEstados.has('todos')||filtroEstados.has(c.estado)||(filtroEstados.has('completo')&&c.estado==='aprobado'&&depositos.find(d=>d.store_code===c.store_code&&(d.fotos_urls||[]).length>0));
      const sucOk=filtroSucursales.has('todas')||filtroSucursales.has(c.store_code);
      return estadoOk&&sucOk;
    });
  },[cierres,depositos,filtroEstados,filtroSucursales]);

  // KPIs basados en filtros actuales
  const kpi=useMemo(()=>{
    const base=filteredCierres.filter(c=>c.diferencia_deposito!=null);
    const totalDif=base.reduce((s,c)=>s+n(c.diferencia_deposito),0);
    const totalAbsDif=base.reduce((s,c)=>s+Math.abs(n(c.diferencia_deposito)),0);
    const totalEfCalc=base.reduce((s,c)=>s+n(c.efectivo_calculado),0);
    const pct=totalEfCalc>0?(totalAbsDif/totalEfCalc)*100:0;
    return {totalDif,totalAbsDif,totalEfCalc,pct,count:base.length};
  },[filteredCierres]);

  // Stats del rango completo (sin filtro sucursal/estado) para la barra superior
  const statsBase=useMemo(()=>{
    const out={faltante:0,revision:0,correccion:0,aprobado:0,completo:0};
    if(esRangoSimple){
      allStoreCodes.forEach(sc=>{
        const s=getStatus(sc,fechaDesde);
        if(out[s.tipo]!==undefined)out[s.tipo]++;
      });
    } else {
      cierres.forEach(c=>{
        const dep=depositos.find(d=>d.store_code===c.store_code&&(d.fotos_urls||[]).length>0);
        if(c.estado==='aprobado'&&dep)out.completo++;
        else if(c.estado==='aprobado')out.aprobado++;
        else if(c.estado==='requiere_correccion')out.correccion++;
        else if(c.estado==='enviado')out.revision++;
      });
      if(esRangoSimple) out.faltante=Math.max(0,allStoreCodes.length-cierres.length);
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

  const aprobar=async(estado)=>{
    if(!selected)return;
    setSaving(true);
    await db.from('ventas_diarias').update({estado,aprobado_por:`${user.nombre} ${user.apellido}`,aprobado_at:new Date().toISOString(),comentario_aprobacion:comentario.trim()||null}).eq('id',selected.id);
    setSaving(false);
    show(estado==='aprobado'?'✓ Cierre aprobado':'⚠ Marcado para corrección');
    setSelected(null); setComentario(''); cargar();
  };

  // Lista a mostrar: si rango simple, mostrar todas las sucursales (incluye faltantes)
  const displayItems=useMemo(()=>{
    if(esRangoSimple){
      // Mostrar todas las sucursales del filtro
      const stores=filtroSucursales.has('todas')?allStoreCodes:[...filtroSucursales];
      return stores.map(sc=>{
        const s=getStatus(sc,fechaDesde);
        // Aplicar filtro de estado
        if(!filtroEstados.has('todos')){
          const tipoMatch=filtroEstados.has(s.tipo)||(filtroEstados.has('enviado')&&s.tipo==='revision');
          if(!tipoMatch) return null;
        }
        return {sc,s};
      }).filter(Boolean);
    } else {
      // Mostrar lista de cierres filtrados
      return filteredCierres.map(c=>{
        const dep=depositos.find(d=>d.store_code===c.store_code&&(d.fotos_urls||[]).length>0);
        let tipo=c.estado==='aprobado'&&dep?'completo':c.estado==='aprobado'?'aprobado':c.estado==='requiere_correccion'?'correccion':c.estado==='enviado'?'revision':'borrador';
        return {sc:c.store_code,s:{tipo,cierre:c,dep}};
      });
    }
  },[esRangoSimple,cierres,depositos,filtroSucursales,filtroEstados,fechaDesde]);

  return(
    <div style={{minHeight:'100vh',padding:'0 16px 50px'}}>
      <Toast/>

      {/* Modal cierre detalle */}
      {selected&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setSelected(null)}>
          <div className="modal">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
              <div>
                <div style={{fontWeight:800,fontSize:17}}>{STORES[selected.store_code]||selected.store_code}</div>
                <div style={{fontSize:13,color:'#666'}}>{selected.fecha} · {selected.turno} · {selected.creado_por}</div>
              </div>
              <EstadoBadge estado={selected.estado}/>
            </div>
            <div style={{margin:'14px 0 4px'}}>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Efectivo QUANTO</span><span style={{fontWeight:600}}>{fmt$(selected.efectivo_quanto)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Tarjeta QUANTO</span><span style={{fontWeight:600}}>{fmt$(selected.tarjeta_quanto)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Transferencia</span><span style={{fontWeight:600}}>{fmt$(selected.ventas_transferencia)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Link de Pago</span><span style={{fontWeight:600}}>{fmt$(selected.ventas_link_pago)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Total ventas</span><span style={{fontWeight:700}}>{fmt$(selected.total_ventas_quanto)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Egresos</span><span style={{fontWeight:600,color:'#f87171'}}>-{fmt$(selected.total_egresos)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Ingresos</span><span style={{fontWeight:600,color:'#4ade80'}}>+{fmt$(selected.total_ingresos)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Efectivo calculado</span><span style={{fontWeight:700}}>{fmt$(selected.efectivo_calculado)}</span></div>
              <div className="row"><span style={{fontWeight:700}}>Efectivo real depósito</span><span style={{fontWeight:800,fontSize:17}}>{fmt$(selected.efectivo_real_depositar)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Diferencia</span>{tagDif(selected.diferencia_deposito)}</div>
              {selected.observaciones&&<div className="row"><span style={{color:'#888',fontSize:13}}>Obs:</span><span style={{fontSize:13}}>{selected.observaciones}</span></div>}
              {selected.comentario_correccion&&(
                <div style={{marginTop:8,padding:'8px 10px',background:'#0d1a2a',borderRadius:8,fontSize:13,color:'#60a5fa'}}>
                  📝 <strong>Respuesta del equipo:</strong> {selected.comentario_correccion}
                </div>
              )}
            </div>

            {/* Detalle egresos con fotos */}
            {egresosDetalle.length>0&&(
              <div style={{marginTop:12}}>
                <div className="sec-title">Egresos del día</div>
                {egresosDetalle.map(eg=>(
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
            {ingresosDetalle.length>0&&(
              <div style={{marginTop:12}}>
                <div className="sec-title">Ingresos del día</div>
                {ingresosDetalle.map(ing=>(
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

            {/* Edición completa → navega a CierreForm */}
            {selected.estado!=='aprobado'&&(
              <button className="btn btn-ghost" onClick={()=>{setSelected(null);onEditCierre(selected);}}
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
        {/* Accesos rápidos */}
        <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
          {[
            {lbl:'Hoy',fn:()=>{setFechaDesde(today());setFechaHasta(today());}},
            {lbl:'7 días',fn:()=>{const d=new Date(Date.now()-6*3600*1000);d.setUTCDate(d.getUTCDate()-6);setFechaDesde(d.toISOString().split('T')[0]);setFechaHasta(today());}},
            {lbl:'Este mes',fn:()=>{const d=new Date(Date.now()-6*3600*1000);setFechaDesde(`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-01`);setFechaHasta(today());}},
          ].map(({lbl,fn})=>(
            <button key={lbl} onClick={fn} style={{padding:'4px 12px',borderRadius:16,fontSize:12,background:'#1e1e1e',border:'1px solid #333',color:'#aaa',cursor:'pointer'}}>{lbl}</button>
          ))}
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
            <div key={k} className={`chip${filtroEstados.has(k)?' on':''}`} onClick={()=>toggleEstado(k)}>{l}</div>
          ))}
        </div>
        <div style={{fontSize:11,color:'#555',marginBottom:6,fontWeight:700,letterSpacing:1,marginTop:8}}>SUCURSAL</div>
        <div className="chips">
          <div className={`chip${filtroSucursales.has('todas')?' on':''}`} onClick={()=>toggleSucursal('todas')}>Todas</div>
          {allStoreCodes.map(sc=>(
            <div key={sc} className={`chip${filtroSucursales.has(sc)?' on':''}`} onClick={()=>toggleSucursal(sc)}>
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
            return(
              <div key={`${sc}-${c?.fecha||idx}`}
                onClick={c?()=>abrirDetalle(c):undefined}
                style={{background:cfg.bg,border:`1.5px solid ${cfg.border}`,borderRadius:12,padding:'14px 16px',marginBottom:10,cursor:c?'pointer':'default',opacity:s.tipo==='faltante'?.5:1}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15}}>{STORES[sc]}</div>
                    {c&&<div style={{fontSize:12,color:'#888',marginTop:2}}>{!esRangoSimple&&`${c.fecha} · `}{c.turno} · {c.creado_por}</div>}
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
                {s.tipo==='completo'&&s.dep&&(
                  <div style={{marginTop:6,fontSize:12,color:'#4ade80'}}>🏦 Depósito {fmt$(s.dep.monto)} confirmado con foto</div>
                )}
              </div>
            );
          })
        )
      )}
    </div>
  );
}
