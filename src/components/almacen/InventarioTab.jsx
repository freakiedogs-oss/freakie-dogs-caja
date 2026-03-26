import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';

export default function InventarioTab({user,show}){
  const [inv,setInv]=useState([]);
  const [loading,setLoading]=useState(true);
  const [busqueda,setBusqueda]=useState('');
  const [cmId,setCmId]=useState(null);

  useEffect(()=>{
    db.from('sucursales').select('id').eq('store_code','CM001').maybeSingle().then(({data})=>{
      if(!data) return;
      setCmId(data.id);
      db.from('inventario').select('*,catalogo_productos(nombre,categoria,unidad_medida)')
        .eq('sucursal_id',data.id).order('stock_actual',{ascending:true})
        .then(({data:inv})=>{ setInv(inv||[]); setLoading(false); });
    });
  },[]);

  const filtrado=useMemo(()=>{
    if(!busqueda.trim()) return inv;
    const q=busqueda.toLowerCase();
    return inv.filter(i=>i.catalogo_productos?.nombre?.toLowerCase().includes(q)||i.catalogo_productos?.categoria?.toLowerCase().includes(q));
  },[inv,busqueda]);

  const alertas=inv.filter(i=>i.alerta_activa||i.stock_actual<=i.stock_minimo);

  return(
    <div style={{padding:'16px 16px 100px'}}>
      {alertas.length>0&&(
        <div className="card" style={{borderColor:'#7c2d12',marginBottom:16}}>
          <div style={{fontWeight:700,color:'#fb923c',marginBottom:6}}>⚠️ {alertas.length} producto(s) bajo mínimo</div>
          {alertas.map(a=>(
            <div key={a.id} style={{fontSize:13,color:'#f0f0f0',padding:'4px 0',borderBottom:'1px solid #2a2a2a'}}>
              {a.catalogo_productos?.nombre||a.id}: <strong>{a.stock_actual}</strong> / mín {a.stock_minimo}
            </div>
          ))}
        </div>
      )}
      <div className="field">
        <input type="text" value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="🔍 Buscar producto..."/>
      </div>
      {loading&&<div className="spin" style={{width:28,height:28,margin:'20px auto'}}/>}
      {!loading&&filtrado.length===0&&(
        <div className="empty">
          <div className="empty-icon">📦</div>
          <div className="empty-text">{busqueda?'Sin resultados':'Inventario vacío — carga mercadería primero'}</div>
        </div>
      )}
      {filtrado.map(it=>(
        <div key={it.id} className="card" style={{padding:'12px 14px',borderColor:it.stock_actual<=it.stock_minimo?'#7c2d12':'#2a2a2a'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:14}}>{it.catalogo_productos?.nombre||it.id}</div>
              <div style={{fontSize:12,color:'#666',marginTop:2}}>{it.catalogo_productos?.categoria||'Sin categoría'}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontWeight:700,fontSize:18,color:it.stock_actual<=it.stock_minimo?'#fb923c':'#4ade80'}}>
                {it.stock_actual}
              </div>
              <div style={{fontSize:11,color:'#555'}}>{it.catalogo_productos?.unidad_medida||'unid'}</div>
            </div>
          </div>
          <div style={{display:'flex',gap:16,marginTop:8,fontSize:12,color:'#555'}}>
            <span>Mín: {it.stock_minimo}</span>
            <span>Máx: {it.stock_maximo}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
