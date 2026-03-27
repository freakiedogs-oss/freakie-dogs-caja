import { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../../supabase';
import { STORES, STORES_SHORT, today, yesterday, shiftDate, n, BUCKET_CIERRES } from '../../config';
import { useToast } from '../../hooks/useToast';

const fmt$ = (n) => `$${parseFloat(n || 0).toFixed(2)}`;

const uploadFoto = async (file, folder) => {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await db.storage.from(BUCKET_CIERRES).upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(error.message);
  const { data } = db.storage.from(BUCKET_CIERRES).getPublicUrl(path);
  return data.publicUrl;
};


export default function IncidentesDash({user,onBack,defaultTab}){
  const {show,Toast}=useToast();
  const [tab,setTab]=useState(defaultTab||'reportes'); // 'reportes' | 'acciones'
  const [fechaDesde,setFechaDesde]=useState(today());
  const [fechaHasta,setFechaHasta]=useState(today());
  const [reportes,setReportes]=useState([]);
  const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState(null);
  const [incDetalle,setIncDetalle]=useState([]);
  const [ausDetalle,setAusDetalle]=useState([]);
  const [filtroSuc,setFiltroSuc]=useState('todas');
  // Acciones pendientes
  const [acciones,setAcciones]=useState([]);
  const [accLoading,setAccLoading]=useState(false);
  const [accSelected,setAccSelected]=useState(null);
  const [accNotas,setAccNotas]=useState('');
  const [accFotos,setAccFotos]=useState([]);
  const accFRef=useRef();

  const allStoreCodes=Object.keys(STORES);

  const cargar=async()=>{
    setLoading(true);
    const {data}=await db.from('reportes_turno').select('*')
      .gte('fecha',fechaDesde).lte('fecha',fechaHasta)
      .order('fecha',{ascending:false}).order('store_code');
    setReportes(data||[]);
    setLoading(false);
  };
  useEffect(()=>{cargar();},[fechaDesde,fechaHasta]);

  const cargarAcciones=async()=>{
    setAccLoading(true);
    const q=db.from('acciones_pendientes').select('*').order('created_at',{ascending:false});
    if(filtroSuc!=='todas') q.eq('store_code',filtroSuc);
    const {data}=await q;
    setAcciones(data||[]);
    setAccLoading(false);
  };
  useEffect(()=>{if(tab==='acciones')cargarAcciones();},[tab,filtroSuc]);

  const resolverAccion=async(acc)=>{
    let evidUrls=[];
    if(accFotos.length>0) evidUrls=await Promise.all(accFotos.map(f=>uploadFoto(f,`acciones/${acc.store_code}`)));
    const {error}=await db.from('acciones_pendientes').update({
      estado:'resuelta',notas_resolucion:accNotas.trim()||null,evidencia_urls:evidUrls,
      resuelto_por:`${user.nombre} ${user.apellido}`,resuelto_at:new Date().toISOString()
    }).eq('id',acc.id);
    if(error){show('❌ '+error.message);return;}
    show('✓ Acción resuelta');
    setAccSelected(null);setAccNotas('');setAccFotos([]);
    cargarAcciones();
  };

  const verDetalle=async(rep)=>{
    setSelected(rep);
    const [{data:inc},{data:aus}]=await Promise.all([
      db.from('incidentes_reporte').select('*').eq('reporte_id',rep.id),
      db.from('ausencias_reporte').select('*').eq('reporte_id',rep.id),
    ]);
    setIncDetalle(inc||[]);
    setAusDetalle(aus||[]);
  };

  const filtrados=useMemo(()=>
    filtroSuc==='todas'?reportes:reportes.filter(r=>r.store_code===filtroSuc)
  ,[reportes,filtroSuc]);

  const kpi=useMemo(()=>{
    const total=filtrados.length;
    const sinNov=filtrados.filter(r=>r.estado_turno==='sin_novedad').length;
    const graves=filtrados.filter(r=>r.estado_turno==='grave').length;
    return {total,sinNov,graves,pctOk:total>0?Math.round(sinNov/total*100):0};
  },[filtrados]);

  const ESTADO_CFG={
    sin_novedad:    {label:'Sin novedad',         color:'#4ade80',bg:'#14532d33'},
    novedades_menores:{label:'Novedades menores', color:'#facc15',bg:'#713f1233'},
    moderado:       {label:'Incidentes moderados',color:'#f97316',bg:'#431c0333'},
    grave:          {label:'Incidentes graves',   color:'#f87171',bg:'#7f1d1d33'},
  };
  const SEV_COLOR={leve:'#4ade80',moderado:'#facc15',grave:'#f87171'};

  return(
    <div style={{minHeight:'100vh',padding:'0 16px 60px'}}>
      <Toast/>
      <div style={{padding:'20px 0 16px',display:'flex',alignItems:'center',gap:12}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'#888',fontSize:22,cursor:'pointer',padding:0}}>←</button>
        <div style={{fontWeight:800,fontSize:18}}>📋 Reportes de Turno</div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:0,marginBottom:14,borderRadius:10,overflow:'hidden',border:'1px solid #2a2a2a'}}>
        {[{k:'reportes',label:'📋 Reportes'},{k:'acciones',label:`⚡ Acciones${acciones.filter(a=>a.estado==='pendiente').length>0?' ('+acciones.filter(a=>a.estado==='pendiente').length+')':''}`}].map(t=>(
          <div key={t.k} onClick={()=>setTab(t.k)}
            style={{flex:1,textAlign:'center',padding:'10px 0',fontSize:13,fontWeight:700,cursor:'pointer',
              background:tab===t.k?'#e63946':'#1a1a1a',color:tab===t.k?'#fff':'#888',transition:'all .15s'}}>
            {t.label}
          </div>
        ))}
      </div>

      {tab==='reportes'&&<>
      {/* Filtros fecha */}
      <div className="card">
        <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap',alignItems:'center'}}>
          {[['Hoy',today(),today()],['Ayer',yesterday(),yesterday()],['7 días',shiftDate(today(),-6),today()],
            ['Este mes',today().slice(0,7)+'-01',today()]].map(([l,d,h])=>(
            <div key={l} onClick={()=>{setFechaDesde(d);setFechaHasta(h);}}
              className={`chip${fechaDesde===d&&fechaHasta===h?' on':''}`}>{l}</div>
          ))}
          <div style={{marginLeft:'auto',display:'flex',gap:4}}>
            <button onClick={()=>{setFechaDesde(shiftDate(fechaDesde,-1));setFechaHasta(shiftDate(fechaHasta,-1));}}
              style={{background:'#1e1e1e',border:'1px solid #333',color:'#aaa',borderRadius:8,width:36,height:36,fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>◀</button>
            <button onClick={()=>{const nd=shiftDate(fechaDesde,1);const nh=shiftDate(fechaHasta,1);if(nh<=today()){setFechaDesde(nd);setFechaHasta(nh);}}}
              style={{background:'#1e1e1e',border:'1px solid #333',color:'#aaa',borderRadius:8,width:36,height:36,fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>▶</button>
          </div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <div style={{flex:1}}><div style={{fontSize:11,color:'#555',marginBottom:4}}>Desde</div>
            <input type="date" className="inp" value={fechaDesde} onChange={e=>setFechaDesde(e.target.value)} style={{fontSize:13}}/></div>
          <div style={{flex:1}}><div style={{fontSize:11,color:'#555',marginBottom:4}}>Hasta</div>
            <input type="date" className="inp" value={fechaHasta} onChange={e=>setFechaHasta(e.target.value)} style={{fontSize:13}}/></div>
        </div>
      </div>

      {/* Filtro sucursales */}
      <div className="chips" style={{marginBottom:14}}>
        <div className={`chip${filtroSuc==='todas'?' on':''}`} onClick={()=>setFiltroSuc('todas')}>Todas</div>
        {allStoreCodes.map(sc=>(
          <div key={sc} className={`chip${filtroSuc===sc?' on':''}`} onClick={()=>setFiltroSuc(sc)}>{STORES_SHORT[sc]}</div>
        ))}
      </div>

      {/* KPIs */}
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        <div className="stat-card"><div style={{fontSize:22,fontWeight:800}}>{kpi.total}</div><div style={{fontSize:11,color:'#555',marginTop:2}}>Reportes</div></div>
        <div className="stat-card"><div style={{fontSize:22,fontWeight:800,color:'#4ade80'}}>{kpi.pctOk}%</div><div style={{fontSize:11,color:'#555',marginTop:2}}>Sin novedad</div></div>
        <div className="stat-card"><div style={{fontSize:22,fontWeight:800,color:'#f87171'}}>{kpi.graves}</div><div style={{fontSize:11,color:'#555',marginTop:2}}>Graves</div></div>
      </div>

      {loading&&<div style={{textAlign:'center',padding:30}}><div className="spin" style={{width:28,height:28,margin:'0 auto'}}/></div>}

      {!loading&&filtrados.length===0&&(
        <div style={{textAlign:'center',padding:30,color:'#555'}}>No hay reportes para este período</div>
      )}

      {filtrados.map(rep=>{
        const cfg=ESTADO_CFG[rep.estado_turno]||ESTADO_CFG.sin_novedad;
        return(
          <div key={rep.id} className="card" style={{border:`1px solid ${cfg.color}44`,marginBottom:10,cursor:'pointer'}}
            onClick={()=>verDetalle(rep)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div>
                <div style={{fontWeight:700,fontSize:14}}>{STORES[rep.store_code]||rep.store_code}</div>
                <div style={{fontSize:12,color:'#666',marginTop:2}}>{rep.fecha} · {rep.creado_por}</div>
              </div>
              <span style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:700,
                background:cfg.bg,color:cfg.color}}>{cfg.label}</span>
            </div>
            {rep.notas&&<div style={{marginTop:8,fontSize:12,color:'#888',fontStyle:'italic'}}>"{rep.notas}"</div>}
          </div>
        );
      })}

      {/* Modal detalle */}
      {selected&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setSelected(null)}>
          <div className="modal">
            <div style={{fontWeight:800,fontSize:17,marginBottom:4}}>{STORES[selected.store_code]}</div>
            <div style={{fontSize:12,color:'#666',marginBottom:16}}>{selected.fecha} · {selected.creado_por}</div>

            <div style={{padding:'10px 12px',borderRadius:10,marginBottom:14,
              background:ESTADO_CFG[selected.estado_turno]?.bg,
              border:`1px solid ${ESTADO_CFG[selected.estado_turno]?.color}44`}}>
              <span style={{fontWeight:700,color:ESTADO_CFG[selected.estado_turno]?.color}}>
                {ESTADO_CFG[selected.estado_turno]?.label}
              </span>
            </div>

            {incDetalle.length>0&&<>
              <div className="sec-title">⚠️ Incidentes</div>
              {incDetalle.map(inc=>(
                <div key={inc.id} style={{padding:'8px 12px',background:'#1a1a1a',borderRadius:8,marginBottom:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontWeight:600,fontSize:13}}>{inc.tipo_label}</span>
                    <span style={{fontSize:11,fontWeight:700,color:SEV_COLOR[inc.severidad]}}>{inc.severidad}</span>
                  </div>
                  {inc.detalle&&<div style={{fontSize:11,color:'#888',marginTop:3}}>{inc.detalle}</div>}
                </div>
              ))}
            </>}

            {ausDetalle.length>0&&<>
              <div className="sec-title" style={{marginTop:12}}>👥 Ausencias/Tardanzas</div>
              {ausDetalle.map(aus=>(
                <div key={aus.id} style={{padding:'8px 12px',background:'#1a1a1a',borderRadius:8,marginBottom:8,display:'flex',justifyContent:'space-between'}}>
                  <span style={{fontWeight:600,fontSize:13}}>{aus.empleado_nombre}</span>
                  <span style={{fontSize:11,fontWeight:700,color:aus.tipo==='sin_permiso'?'#f87171':aus.tipo==='tarde'?'#facc15':'#60a5fa'}}>
                    {aus.tipo==='sin_permiso'?'Sin permiso':aus.tipo==='con_permiso'?'Con permiso':'Tarde'}
                  </span>
                </div>
              ))}
            </>}

            {(ausDetalle.length===0&&incDetalle.length===0)&&(
              <div style={{textAlign:'center',padding:20,color:'#555'}}>✅ Turno sin novedades ni ausencias reportadas</div>
            )}

            {selected.notas&&(
              <div style={{marginTop:12,padding:'10px 12px',background:'#1a1a1a',borderRadius:8,fontSize:13,color:'#aaa',fontStyle:'italic'}}>
                📝 {selected.notas}
              </div>
            )}
            <button className="btn btn-ghost" onClick={()=>setSelected(null)} style={{marginTop:16}}>Cerrar</button>
          </div>
        </div>
      )}
      </>}

      {/* Tab Acciones Pendientes */}
      {tab==='acciones'&&<>
        {/* Filtro sucursales (reutilizado) */}
        <div className="chips" style={{marginBottom:14}}>
          <div className={`chip${filtroSuc==='todas'?' on':''}`} onClick={()=>setFiltroSuc('todas')}>Todas</div>
          {allStoreCodes.map(sc=>(
            <div key={sc} className={`chip${filtroSuc===sc?' on':''}`} onClick={()=>setFiltroSuc(sc)}>{STORES_SHORT[sc]}</div>
          ))}
        </div>

        {/* KPI acciones */}
        {(()=>{
          const pend=acciones.filter(a=>a.estado==='pendiente').length;
          const proc=acciones.filter(a=>a.estado==='en_proceso').length;
          const res=acciones.filter(a=>a.estado==='resuelta').length;
          return(
            <div style={{display:'flex',gap:8,marginBottom:16}}>
              <div className="stat-card"><div style={{fontSize:22,fontWeight:800,color:'#f97316'}}>{pend}</div><div style={{fontSize:11,color:'#555',marginTop:2}}>Pendientes</div></div>
              <div className="stat-card"><div style={{fontSize:22,fontWeight:800,color:'#60a5fa'}}>{proc}</div><div style={{fontSize:11,color:'#555',marginTop:2}}>En proceso</div></div>
              <div className="stat-card"><div style={{fontSize:22,fontWeight:800,color:'#4ade80'}}>{res}</div><div style={{fontSize:11,color:'#555',marginTop:2}}>Resueltas</div></div>
            </div>
          );
        })()}

        {accLoading&&<div style={{textAlign:'center',padding:30}}><div className="spin" style={{width:28,height:28,margin:'0 auto'}}/></div>}

        {!accLoading&&acciones.length===0&&(
          <div style={{textAlign:'center',padding:30,color:'#555'}}>No hay acciones registradas</div>
        )}

        {!accLoading&&acciones.map(acc=>{
          const colores={pendiente:{bg:'#431c03',c:'#f97316'},en_proceso:{bg:'#1e3a5f',c:'#60a5fa'},resuelta:{bg:'#14532d',c:'#4ade80'}};
          const col=colores[acc.estado]||colores.pendiente;
          return(
            <div key={acc.id} className="card" style={{border:`1px solid ${col.c}44`,marginBottom:10,cursor:'pointer'}}
              onClick={()=>{setAccSelected(acc);setAccNotas('');setAccFotos([]);}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13}}>{acc.descripcion}</div>
                  <div style={{fontSize:11,color:'#666',marginTop:3}}>{STORES[acc.store_code]||acc.store_code} · {acc.creado_por}</div>
                  <div style={{fontSize:11,color:'#555',marginTop:2}}>{new Date(acc.created_at).toLocaleDateString('es-SV')}</div>
                </div>
                <span style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:700,background:col.bg,color:col.c,flexShrink:0}}>
                  {acc.estado==='pendiente'?'Pendiente':acc.estado==='en_proceso'?'En proceso':'Resuelta'}
                </span>
              </div>
              {acc.estado==='resuelta'&&acc.notas_resolucion&&(
                <div style={{marginTop:6,fontSize:11,color:'#4ade80',fontStyle:'italic'}}>✓ {acc.notas_resolucion}</div>
              )}
            </div>
          );
        })}

        {/* Modal resolver acción */}
        {accSelected&&accSelected.estado!=='resuelta'&&(
          <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setAccSelected(null)}>
            <div className="modal">
              <div style={{fontWeight:800,fontSize:17,marginBottom:4}}>⚡ Resolver Acción</div>
              <div style={{fontSize:13,color:'#aaa',marginBottom:6}}>{accSelected.descripcion}</div>
              <div style={{fontSize:11,color:'#555',marginBottom:16}}>{STORES[accSelected.store_code]} · {accSelected.creado_por}</div>

              <div className="sec-title">Notas de resolución</div>
              <textarea className="inp" rows={3} value={accNotas} onChange={e=>setAccNotas(e.target.value)}
                placeholder="Describe cómo se resolvió…" style={{resize:'none',fontSize:13,marginBottom:12}}/>

              <div className="sec-title">Evidencia (fotos)</div>
              <input ref={accFRef} type="file" accept="image/*" multiple onChange={e=>setAccFotos(Array.from(e.target.files).slice(0,3))} style={{display:'none'}}/>
              <button className="btn btn-ghost btn-sm" onClick={()=>accFRef.current.click()} style={{marginBottom:12,fontSize:12}}>
                📷 {accFotos.length>0?`${accFotos.length} foto(s)`:'Agregar evidencia'}
              </button>

              <div style={{display:'flex',gap:8,marginTop:8}}>
                <button className="btn btn-ghost" onClick={()=>setAccSelected(null)} style={{flex:1}}>Cancelar</button>
                <button className="btn btn-red" onClick={()=>resolverAccion(accSelected)} style={{flex:1}}>✓ Marcar Resuelta</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal ver acción resuelta */}
        {accSelected&&accSelected.estado==='resuelta'&&(
          <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setAccSelected(null)}>
            <div className="modal">
              <div style={{fontWeight:800,fontSize:17,marginBottom:4,color:'#4ade80'}}>✓ Acción Resuelta</div>
              <div style={{fontSize:13,color:'#aaa',marginBottom:6}}>{accSelected.descripcion}</div>
              <div style={{fontSize:11,color:'#555',marginBottom:12}}>{STORES[accSelected.store_code]} · Resuelta por {accSelected.resuelto_por}</div>
              {accSelected.notas_resolucion&&(
                <div style={{padding:'10px 12px',background:'#14532d33',borderRadius:8,fontSize:13,color:'#4ade80',marginBottom:12}}>
                  {accSelected.notas_resolucion}
                </div>
              )}
              {(accSelected.evidencia_urls||[]).map((u,i)=>(
                <a key={i} href={u} target="_blank" style={{display:'block',fontSize:12,color:'#60a5fa',padding:'3px 0'}}>📷 Evidencia {i+1}</a>
              ))}
              <button className="btn btn-ghost" onClick={()=>setAccSelected(null)} style={{marginTop:16}}>Cerrar</button>
            </div>
          </div>
        )}
      </>}
    </div>
  );
}
