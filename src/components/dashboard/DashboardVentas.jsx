import { useState, useEffect } from 'react';
import { db } from '../../supabase';
import { STORES, today, n } from '../../config';
import { useToast } from '../../hooks/useToast';

const fmt$ = (n) => `$${parseFloat(n || 0).toFixed(2)}`;


export default function DashboardVentas({user,onBack}){
  const {show,Toast}=useToast();
  const [tab,setTab]=useState('hoy');
  const [loading,setLoading]=useState(true);
  const [perf,setPerf]=useState([]);
  const [tendencia,setTendencia]=useState([]);
  const [productos,setProductos]=useState([]);
  const [semanal,setSemanal]=useState([]);
  const [costos,setCostos]=useState([]);
  const [miSucursal,setMiSucursal]=useState(null); // {id, nombre} para gerente
  const isAdmin=user.rol==='admin';

  useEffect(()=>{
    const cargar=async()=>{
      try{
        const hace14=new Date(Date.now()-6*3600*1000-14*86400*1000).toISOString().split('T')[0];
        // Gerente: resolver su sucursal_id y nombre desde store_code
        let filtroId=null, filtroNombre=null;
        if(!isAdmin&&user.store_code){
          const {data:map}=await db.from('quanto_store_mapping')
            .select('sucursal_id, sucursales(nombre)')
            .eq('store_code',user.store_code).maybeSingle();
          filtroId=map?.sucursal_id||null;
          filtroNombre=map?.sucursales?.nombre||null;
          if(filtroId) setMiSucursal({id:filtroId,nombre:filtroNombre});
        }
        // Queries con filtro opcional
        let perfQ=db.from('vista_performance_vs_meta').select('*').order('ventas_reales',{ascending:false});
        let tendQ=db.from('vista_ventas_diarias').select('*').gte('fecha',hace14).order('fecha',{ascending:true});
        if(filtroId){perfQ=perfQ.eq('sucursal_id',filtroId);tendQ=tendQ.eq('sucursal_id',filtroId);}
        const[pRes,tRes,prRes,sRes,cRes]=await Promise.all([
          perfQ, tendQ,
          db.from('vista_top_productos').select('*').order('revenue_total',{ascending:false}).limit(20),
          isAdmin?db.from('vista_patron_semanal').select('*').order('dia_num',{ascending:true}):Promise.resolve({data:[]}),
          db.from('vista_labor_cost_ratio').select('*')
        ]);
        setPerf(pRes.data||[]);
        setTendencia(tRes.data||[]);
        setProductos(prRes.data||[]);
        setSemanal(sRes.data||[]);
        const todosCostos=cRes.data||[];
        setCostos(filtroNombre?todosCostos.filter(c=>c.sucursal===filtroNombre):todosCostos);
        setLoading(false);
      }catch(e){show('Error cargando datos');setLoading(false);}
    };
    cargar();
  },[]);

  const TABS=[{k:'hoy',label:'📊 Hoy'},{k:'tendencia',label:'📈 14 días'},{k:'productos',label:'🍔 Productos'},{k:'semanal',label:'📅 Semanal'},{k:'costos',label:'💰 Nómina'}];

  const estadoColor={EXCELENTE:'#4ade80',CUMPLIDO:'#86efac',CERCA:'#fbbf24',undefined:'#f87171','BAJO META':'#f87171'};
  const estadoBg={EXCELENTE:'#14532d',CUMPLIDO:'#1a3a1a',CERCA:'#451a03',undefined:'#3b0000','BAJO META':'#3b0000'};

  // Agrupar tendencia por fecha para el chart simple
  const tendenciaPorFecha=useMemo(()=>{
    const m={};
    tendencia.forEach(r=>{if(!m[r.fecha])m[r.fecha]=0;m[r.fecha]+=n(r.ventas_totales);});
    return Object.entries(m).map(([f,v])=>({fecha:f,total:v})).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  },[tendencia]);
  const maxTendencia=useMemo(()=>Math.max(...tendenciaPorFecha.map(x=>x.total),1),[tendenciaPorFecha]);

  // Patrón semanal: admin usa vista global, gerente lo computa desde sus tendencias
  const semanalData=useMemo(()=>{
    if(isAdmin) return semanal;
    if(!tendencia.length) return [];
    const DIAS=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const byDow={};
    tendencia.forEach(r=>{
      const dow=new Date(r.fecha+'T12:00:00').getDay();
      if(!byDow[dow]) byDow[dow]={dia_num:dow,dia_semana:DIAS[dow],vals:[]};
      byDow[dow].vals.push(n(r.ventas_totales));
    });
    return Object.values(byDow).map(d=>({
      dia_num:d.dia_num, dia_semana:d.dia_semana,
      semanas_con_datos:d.vals.length,
      venta_promedio:(d.vals.reduce((a,b)=>a+b,0)/d.vals.length).toFixed(2),
      venta_minima:Math.min(...d.vals).toFixed(2),
      venta_maxima:Math.max(...d.vals).toFixed(2),
      ticket_promedio:null
    })).sort((a,b)=>a.dia_num-b.dia_num);
  },[isAdmin,semanal,tendencia]);
  const maxSemanal=useMemo(()=>Math.max(...semanalData.map(x=>n(x.venta_promedio)),1),[semanalData]);

  return(
    <div style={{minHeight:'100vh',padding:'0 0 40px'}}>
      <Toast/>
      {/* Header */}
      <div style={{padding:'20px 16px 12px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid #1a1a1a'}}>
        <div>
          <button onClick={onBack} style={{background:'none',border:'none',color:'#4ade80',fontSize:13,cursor:'pointer',padding:0,marginBottom:4}}>← Volver</button>
          <div style={{fontWeight:800,fontSize:18}}>Analytics de Ventas</div>
          {!isAdmin&&miSucursal&&<div style={{fontSize:12,color:'#4ade80',marginTop:2}}>📍 {miSucursal.nombre}</div>}
          {!isAdmin&&!miSucursal&&!loading&&<div style={{fontSize:12,color:'#f87171',marginTop:2}}>⚠️ Sin sucursal mapeada</div>}
        </div>
        <div style={{fontSize:11,color:'#555',textAlign:'right'}}>{isAdmin?'Todas las sucursales':'Tu sucursal'}<br/>QUANTO</div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',overflowX:'auto',borderBottom:'1px solid #1a1a1a',padding:'0 8px'}}>
        {TABS.map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)}
            style={{background:'none',border:'none',color:tab===t.k?'#4ade80':'#555',padding:'10px 10px',fontSize:12,cursor:'pointer',whiteSpace:'nowrap',borderBottom:tab===t.k?'2px solid #4ade80':'2px solid transparent',fontWeight:tab===t.k?700:400}}>
            {t.label}
          </button>
        ))}
      </div>

      {loading&&<div style={{textAlign:'center',padding:40}}><div className="spin" style={{width:32,height:32,margin:'0 auto'}}/></div>}

      {/* TAB: HOY — Performance vs Meta */}
      {!loading&&tab==='hoy'&&(
        <div style={{padding:'16px'}}>
          <div style={{fontSize:12,color:'#555',marginBottom:12}}>Últimos días con datos · vs metas configuradas</div>
          {perf.length===0&&<div style={{textAlign:'center',color:'#555',padding:20}}>Sin datos. Verifica que existan metas en metas_ventas.</div>}
          {perf.map((r,i)=>(
            <div key={i} className="card" style={{marginBottom:10,borderColor:estadoColor[r.estado]||'#222',background:estadoBg[r.estado]||'#161616'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                <span style={{fontWeight:700,fontSize:14}}>{r.sucursal}</span>
                <span style={{fontSize:11,color:estadoColor[r.estado]||'#f87171',fontWeight:700,background:'rgba(0,0,0,0.3)',padding:'2px 7px',borderRadius:6}}>{r.estado||'SIN META'}</span>
              </div>
              <div style={{fontSize:11,color:'#888',marginBottom:6}}>{r.fecha}</div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Ventas reales</span><span style={{fontWeight:700}}>{fmt$(r.ventas_reales)}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Meta diaria</span><span style={{fontWeight:600}}>{r.meta_diaria?fmt$(r.meta_diaria):'—'}</span></div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Cumplimiento</span><span style={{fontWeight:700,color:estadoColor[r.estado]||'#f87171'}}>{r.pct_cumplimiento!=null?`${r.pct_cumplimiento}%`:'—'}</span></div>
              {/* Barra de progreso */}
              {r.meta_diaria&&<div style={{marginTop:8,background:'#222',borderRadius:4,height:6}}>
                <div style={{height:6,borderRadius:4,background:estadoColor[r.estado]||'#f87171',width:`${Math.min(100,n(r.pct_cumplimiento))}%`,transition:'width 0.5s'}}/>
              </div>}
            </div>
          ))}
        </div>
      )}

      {/* TAB: TENDENCIA 14 días */}
      {!loading&&tab==='tendencia'&&(
        <div style={{padding:'16px'}}>
          <div style={{fontSize:12,color:'#555',marginBottom:12}}>Ventas totales por día (todas las sucursales)</div>
          {tendenciaPorFecha.map((d,i)=>(
            <div key={i} style={{marginBottom:8}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                <span style={{fontSize:12,color:'#888'}}>{new Date(d.fecha+'T12:00:00').toLocaleDateString('es-SV',{weekday:'short',day:'numeric',month:'short'})}</span>
                <span style={{fontSize:13,fontWeight:700}}>{fmt$(d.total)}</span>
              </div>
              <div style={{background:'#222',borderRadius:3,height:8}}>
                <div style={{height:8,borderRadius:3,background:'#4ade80',width:`${(d.total/maxTendencia*100).toFixed(1)}%`,transition:'width 0.5s'}}/>
              </div>
            </div>
          ))}
          {tendenciaPorFecha.length===0&&<div style={{textAlign:'center',color:'#555',padding:20}}>Sin datos recientes</div>}
        </div>
      )}

      {/* TAB: TOP PRODUCTOS */}
      {!loading&&tab==='productos'&&(
        <div style={{padding:'16px'}}>
          <div style={{fontSize:12,color:'#555',marginBottom:12}}>Ranking por ingresos totales · todos los tiempos</div>
          {productos.map((p,i)=>(
            <div key={i} className="card" style={{marginBottom:8,padding:'10px 14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div style={{flex:1,marginRight:8}}>
                  <span style={{fontSize:12,color:'#4ade80',fontWeight:700,marginRight:6}}>#{i+1}</span>
                  <span style={{fontSize:13,fontWeight:600}}>{p.producto}</span>
                  {p.categoria&&<span style={{marginLeft:6,fontSize:10,color:'#555',background:'#1a1a1a',padding:'1px 5px',borderRadius:4}}>{p.categoria}</span>}
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{fontWeight:700,fontSize:13}}>{fmt$(p.revenue_total)}</div>
                  <div style={{fontSize:11,color:'#555'}}>{p.unidades_totales} uds · {fmt$(p.precio_promedio)} c/u</div>
                </div>
              </div>
            </div>
          ))}
          {productos.length===0&&<div style={{textAlign:'center',color:'#555',padding:20}}>Sin datos de productos (requiere DTEs cargados)</div>}
        </div>
      )}

      {/* TAB: PATRÓN SEMANAL */}
      {!loading&&tab==='semanal'&&(
        <div style={{padding:'16px'}}>
          <div style={{fontSize:12,color:'#555',marginBottom:12}}>Promedio de ventas por día de la semana · últimas 8 semanas</div>
          {semanalData.map((d,i)=>(
            <div key={i} style={{marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span style={{fontSize:13,fontWeight:600,textTransform:'capitalize'}}>{(d.dia_semana||'').trim()}</span>
                <div style={{textAlign:'right'}}>
                  <span style={{fontSize:13,fontWeight:700}}>{fmt$(d.venta_promedio)}</span>
                  <span style={{fontSize:11,color:'#555',marginLeft:8}}>ticket {fmt$(d.ticket_promedio)}</span>
                </div>
              </div>
              <div style={{background:'#222',borderRadius:3,height:10}}>
                <div style={{height:10,borderRadius:3,background:n(d.venta_promedio)===n(maxSemanal)?'#4ade80':'#2a6049',width:`${(n(d.venta_promedio)/maxSemanal*100).toFixed(1)}%`,transition:'width 0.5s'}}/>
              </div>
              <div style={{fontSize:10,color:'#444',marginTop:2}}>{d.semanas_con_datos} semanas de datos · mín {fmt$(d.venta_minima)} — máx {fmt$(d.venta_maxima)}</div>
            </div>
          ))}
          {semanalData.length===0&&<div style={{textAlign:'center',color:'#555',padding:20}}>Sin datos suficientes aún</div>}
        </div>
      )}

      {/* TAB: COSTO LABORAL */}
      {!loading&&tab==='costos'&&(
        <div style={{padding:'16px'}}>
          <div style={{fontSize:12,color:'#555',marginBottom:12}}>% nómina / ventas por sucursal · mes actual vs anterior</div>
          {costos.map((c,i)=>{
            const pct=n(c.labor_cost_pct);
            const color=pct===0?'#555':pct<25?'#4ade80':pct<35?'#fbbf24':'#f87171';
            return(
              <div key={i} className="card" style={{marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <span style={{fontWeight:700,fontSize:14}}>{c.sucursal}</span>
                  <span style={{fontSize:18,fontWeight:800,color}}>{c.labor_cost_pct!=null?`${c.labor_cost_pct}%`:'—'}</span>
                </div>
                <div style={{fontSize:11,color:'#555',marginBottom:6}}>{c.mes?new Date(c.mes).toLocaleDateString('es-SV',{month:'long',year:'numeric'}):'Sin ventas registradas'}</div>
                <div className="row"><span style={{color:'#888',fontSize:13}}>Nómina mensual</span><span style={{fontWeight:600}}>{fmt$(c.nomina_mensual)}</span></div>
                <div className="row"><span style={{color:'#888',fontSize:13}}>Ventas del mes</span><span style={{fontWeight:600}}>{c.ventas_mes?fmt$(c.ventas_mes):'—'}</span></div>
                <div className="row"><span style={{color:'#888',fontSize:13}}>Empleados activos</span><span style={{fontWeight:600}}>{c.num_empleados}</span></div>
              </div>
            );
          })}
          {costos.length===0&&<div style={{textAlign:'center',color:'#555',padding:20}}>Sin datos de nómina</div>}
          <div style={{marginTop:16,padding:'10px 14px',background:'#0a1a0a',borderRadius:10,border:'1px solid #1a3a1a',fontSize:12,color:'#555'}}>
            💡 Referencia: &lt;25% excelente · 25–35% normal · &gt;35% revisar costos
          </div>
        </div>
      )}
    </div>
  );
}
