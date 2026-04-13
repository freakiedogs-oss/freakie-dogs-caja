import { useState, useEffect } from 'react';
import { db } from '../../supabase';
import { STORES, today, n } from '../../config';
import { useToast } from '../../hooks/useToast';

const fmt$ = (n) => `$${parseFloat(n || 0).toFixed(2)}`;


export default function DashboardEjecutivo({user,onBack}){
  const [kpis,setKpis]=useState(null);
  const [tendencia,setTendencia]=useState([]);
  const [sucursales,setSucursales]=useState([]);
  const [comprasMes,setComprasMes]=useState(0);
  const [prestamos,setPrestamos]=useState([]);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState('resumen');

  const COLORES={'M001':'#4ade80','S001':'#60a5fa','S002':'#f472b6','S003':'#facc15','S004':'#fb923c'};
  const mesActual=new Date().toLocaleDateString('es-SV',{month:'long',year:'numeric'});

  useEffect(()=>{
    const load=async()=>{
      try{
        // 1. Ventas mes actual y hoy por sucursal (MATVIEW unificada: quanto > cierre)
        const inicioMes=new Date(); inicioMes.setDate(1);
        const mesStr=inicioMes.toISOString().split('T')[0];
        const {data:vtMes}=await db.from('v_ventas_unificadas')
          .select('store_code,total_ventas_quanto,fecha')
          .gte('fecha',mesStr);

        // 2. Ventas tendencia últimos 14 días (MATVIEW unificada)
        const d14=new Date(); d14.setDate(d14.getDate()-14);
        const d14Str=d14.toISOString().split('T')[0];
        const {data:vtTend}=await db.from('v_ventas_unificadas')
          .select('fecha,total_ventas_quanto')
          .gte('fecha',d14Str)
          .order('fecha',{ascending:true});

        // 3. Compras del mes
        const mesStr=`${inicioMes.getFullYear()}-${String(inicioMes.getMonth()+1).padStart(2,'0')}-01`;
        const {data:comp}=await db.from('compras').select('total').gte('fecha_emision',mesStr);

        // 4. Préstamos
        const {data:prest}=await db.from('prestamos').select('institucion,monto,fecha').eq('activo',true).order('monto',{ascending:false});

        // Procesar ventas por sucursal este mes
        const porSuc={};
        const hoyStr=new Date().toLocaleDateString('en-CA',{timeZone:'America/El_Salvador'});
        let totalMes=0, totalHoy=0;
        (vtMes||[]).forEach(r=>{
          const sc=r.store_code;
          if(!porSuc[sc]) porSuc[sc]={mes:0,hoy:0};
          const v=Number(r.total_ventas_quanto||0);
          porSuc[sc].mes+=v;
          if(r.fecha===hoyStr) porSuc[sc].hoy+=v;
          totalMes+=v;
          if(r.fecha===hoyStr) totalHoy+=v;
        });

        // Procesar tendencia por día (total cadena) — MATVIEW ya agrupa por fecha
        const tendMap={};
        (vtTend||[]).forEach(r=>{
          tendMap[r.fecha]=(tendMap[r.fecha]||0)+Number(r.total_ventas_quanto||0);
        });
        const tendArr=Object.entries(tendMap).sort((a,b)=>a[0].localeCompare(b[0])).slice(-14);

        // Ventas mes anterior (referencia)
        const totalCompras=(comp||[]).reduce((s,r)=>s+Number(r.total||0),0);

        // Ordenar sucursales por ventas mes
        const sucArr=Object.entries(porSuc)
          .map(([sc,v])=>({sc,nombre:STORES[sc]||sc,mes:v.mes,hoy:v.hoy,pct:totalMes>0?((v.mes/totalMes)*100).toFixed(1):0}))
          .sort((a,b)=>b.mes-a.mes);

        setKpis({totalMes,totalHoy,totalCompras});
        setTendencia(tendArr);
        setSucursales(sucArr);
        setComprasMes(totalCompras);
        setPrestamos(prest||[]);
      }catch(e){console.error(e);}
      setLoading(false);
    };
    load();
  },[]);

  const fmt$=v=>v==null?'—':'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});
  const totalPrest=prestamos.reduce((s,r)=>s+Number(r.monto||0),0);

  // Mini barchart SVG
  const MiniBar=({data})=>{
    if(!data.length) return null;
    const max=Math.max(...data.map(d=>d[1]));
    const W=300,H=60,bw=Math.floor(W/data.length)-2;
    return(
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:'visible'}}>
        {data.map(([dia,val],i)=>{
          const h=max>0?Math.max(2,(val/max)*(H-16)):2;
          const x=i*(bw+2);
          const y=H-h-12;
          const isLast=i===data.length-1;
          return(
            <g key={i}>
              <rect x={x} y={y} width={bw} height={h} rx={2}
                fill={isLast?'#4ade80':'#2a5a2a'} opacity={isLast?1:0.75}/>
              {i%3===0&&<text x={x+bw/2} y={H-1} textAnchor="middle" fontSize={8} fill="#444">
                {dia.slice(5)}
              </text>}
              {isLast&&<text x={x+bw/2} y={y-3} textAnchor="middle" fontSize={8} fill="#4ade80">
                {fmt$(val)}
              </text>}
            </g>
          );
        })}
      </svg>
    );
  };

  return(
    <div style={{minHeight:'100vh',background:'#0d0d0d'}}>
      {/* Header */}
      <div style={{padding:'20px 16px 12px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid #1a1a1a',background:'#111'}}>
        <div>
          <button onClick={onBack} style={{background:'none',border:'none',color:'#4ade80',fontSize:13,cursor:'pointer',padding:0,marginBottom:4}}>← Volver</button>
          <div style={{fontWeight:800,fontSize:18}}>🏆 Dashboard Ejecutivo</div>
          <div style={{fontSize:11,color:'#555',marginTop:2}}>
            {new Date().toLocaleDateString('es-SV',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}
          </div>
        </div>
        <div style={{fontSize:10,color:'#333',textAlign:'right'}}>Solo<br/>Ejecutivos</div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',borderBottom:'1px solid #1a1a1a',overflowX:'auto'}}>
        {[['resumen','📊 Resumen'],['sucursales','🏪 Sucursales'],['financiero','💰 Financiero']].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)}
            style={{background:'none',border:'none',color:tab===k?'#4ade80':'#555',padding:'10px 14px',fontSize:12,
              cursor:'pointer',whiteSpace:'nowrap',borderBottom:tab===k?'2px solid #4ade80':'2px solid transparent',fontWeight:tab===k?700:400}}>
            {l}
          </button>
        ))}
      </div>

      {loading&&<div style={{textAlign:'center',padding:60}}><div className="spin" style={{width:36,height:36,margin:'0 auto'}}/></div>}

      {!loading&&tab==='resumen'&&(
        <div style={{padding:16}}>
          {/* KPI Cards */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
            <div className="card" style={{textAlign:'center',borderColor:'#14532d',background:'#0a1a0a'}}>
              <div style={{fontSize:10,color:'#555',marginBottom:4}}>VENTAS MES</div>
              <div style={{fontSize:22,fontWeight:800,color:'#4ade80'}}>{fmt$(kpis?.totalMes)}</div>
              <div style={{fontSize:10,color:'#555',marginTop:2,textTransform:'capitalize'}}>{mesActual}</div>
            </div>
            <div className="card" style={{textAlign:'center',borderColor:'#1e3a5f',background:'#0a0f1a'}}>
              <div style={{fontSize:10,color:'#555',marginBottom:4}}>COMPRAS MES</div>
              <div style={{fontSize:22,fontWeight:800,color:'#60a5fa'}}>{fmt$(kpis?.totalCompras)}</div>
              <div style={{fontSize:10,color:'#555',marginTop:2}}>DTEs recibidos</div>
            </div>
            <div className="card" style={{textAlign:'center',borderColor:'#3d1a00',background:'#150a00',gridColumn:'1/-1'}}>
              <div style={{fontSize:10,color:'#555',marginBottom:4}}>DEUDA TOTAL</div>
              <div style={{fontSize:22,fontWeight:800,color:'#fb923c'}}>{fmt$(totalPrest)}</div>
              <div style={{fontSize:10,color:'#555',marginTop:2}}>{prestamos.length} prestamos activos</div>
            </div>
          </div>

          {/* Tendencia 14 días */}
          <div className="card" style={{marginBottom:16}}>
            <div style={{fontSize:12,color:'#4ade80',fontWeight:700,marginBottom:10}}>📈 Tendencia 14 días (cadena total)</div>
            <MiniBar data={tendencia}/>
            {tendencia.length>1&&(()=>{
              const vals=tendencia.map(d=>d[1]);
              const ult=vals[vals.length-1];
              const ant=vals[vals.length-2];
              const diff=ult-ant;
              const pct=ant>0?((diff/ant)*100).toFixed(1):0;
              return(
                <div style={{marginTop:8,fontSize:12,color:diff>=0?'#4ade80':'#f87171',textAlign:'right'}}>
                  {diff>=0?'▲':'▼'} {Math.abs(pct)}% vs día anterior
                </div>
              );
            })()}
          </div>

          {/* Top sucursales mini */}
          <div className="card">
            <div style={{fontSize:12,color:'#888',fontWeight:700,marginBottom:10}}>🏪 ESTE MES POR SUCURSAL</div>
            {sucursales.map((s,i)=>(
              <div key={s.sc} style={{marginBottom:8}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}>
                  <span style={{fontSize:12,color:COLORES[s.sc]||'#fff',fontWeight:600}}>{s.nombre||s.sc}</span>
                  <span style={{fontSize:12,fontWeight:700}}>{fmt$(s.mes)}</span>
                </div>
                <div style={{background:'#1a1a1a',borderRadius:4,height:5}}>
                  <div style={{height:5,borderRadius:4,background:COLORES[s.sc]||'#4ade80',width:`${s.pct}%`,transition:'width 0.5s'}}/>
                </div>
                <div style={{textAlign:'right',fontSize:10,color:'#555',marginTop:1}}>{s.pct}% del total</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading&&tab==='sucursales'&&(
        <div style={{padding:16}}>
          {sucursales.map((s,i)=>(
            <div key={s.sc} className="card" style={{marginBottom:12,borderLeft:`3px solid ${COLORES[s.sc]||'#444'}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:COLORES[s.sc]||'#fff'}}>{s.nombre||s.sc}</div>
                  <div style={{fontSize:10,color:'#555'}}>Código: {s.sc}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:10,color:'#555'}}>Rango #{i+1}</div>
                  <div style={{fontSize:13,fontWeight:700,color:'#4ade80'}}>{s.pct}%</div>
                </div>
              </div>
              <div className="row"><span style={{color:'#888',fontSize:13}}>Ventas este mes</span><span style={{fontWeight:700,color:'#4ade80'}}>{fmt$(s.mes)}</span></div>
            </div>
          ))}
          <div style={{marginTop:8,padding:'10px 14px',background:'#0a1a0a',borderRadius:10,border:'1px solid #1a3a1a',fontSize:13}}>
            <div className="row" style={{marginBottom:0}}>
              <span style={{color:'#888'}}>Total cadena (mes)</span>
              <span style={{fontWeight:800,color:'#4ade80',fontSize:16}}>{fmt$(kpis?.totalMes)}</span>
            </div>
          </div>
        </div>
      )}

      {!loading&&tab==='financiero'&&(
        <div style={{padding:16}}>
          {/* Compras vs Ventas */}
          <div className="card" style={{marginBottom:12,borderColor:'#1e3a5f',background:'#0a0f1a'}}>
            <div style={{fontSize:12,color:'#60a5fa',fontWeight:700,marginBottom:8}}>📦 Compras (DTEs) este mes</div>
            <div style={{fontSize:28,fontWeight:800,color:'#60a5fa'}}>{fmt$(kpis?.totalCompras)}</div>
            {kpis?.totalMes>0&&(
              <div style={{marginTop:6,fontSize:12,color:'#555'}}>
                Ratio compras/ventas: <span style={{color:kpis.totalCompras/kpis.totalMes<0.35?'#4ade80':'#f87171',fontWeight:700}}>
                  {((kpis.totalCompras/kpis.totalMes)*100).toFixed(1)}%
                </span>
                <span style={{color:'#444',marginLeft:6}}>(ref: &lt;35%)</span>
              </div>
            )}
          </div>

          {/* Préstamos */}
          <div className="card" style={{marginBottom:12,borderColor:'#3d1a00',background:'#150a00'}}>
            <div style={{fontSize:12,color:'#fb923c',fontWeight:700,marginBottom:8}}>💳 Préstamos Activos</div>
            <div style={{fontSize:28,fontWeight:800,color:'#fb923c',marginBottom:12}}>{fmt$(totalPrest)}</div>
            {prestamos.map((p,i)=>(
              <div key={i} style={{borderTop:'1px solid #2a1500',paddingTop:8,marginTop:8}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:12,color:'#ccc'}}>{p.institucion}</span>
                  <span style={{fontSize:13,fontWeight:700,color:'#fb923c'}}>{fmt$(p.monto)}</span>
                </div>
                {p.fecha&&<div style={{fontSize:10,color:'#555',marginTop:2}}>{new Date(p.fecha).toLocaleDateString('es-SV',{year:'numeric',month:'short',day:'numeric'})}</div>}
              </div>
            ))}
          </div>

          {/* Info */}
          <div style={{padding:'10px 14px',background:'#111',borderRadius:10,border:'1px solid #222',fontSize:12,color:'#555'}}>
            💡 Datos en tiempo real desde Supabase. Ventas desde QUANTO. Compras desde DTEs Gmail.
          </div>
        </div>
      )}
    </div>
  );
}
