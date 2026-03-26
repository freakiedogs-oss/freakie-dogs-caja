import { useState } from 'react';
import { db } from '../../supabase';

// ── NUEVO PROVEEDOR MODAL ────────────────────────────────────────
export function NuevoProveedorModal({onSave,onClose}){
  const [nombre,setNombre]=useState('');
  const [telefono,setTelefono]=useState('');
  const [correo,setCorreo]=useState('');
  const [contacto,setContacto]=useState('');
  const [nit,setNit]=useState('');
  const [direccion,setDireccion]=useState('');
  const [loading,setLoading]=useState(false);

  const guardar=async()=>{
    if(!nombre.trim()){alert('Ingresa el nombre del proveedor');return;}
    setLoading(true);
    try{
      const {data,error}=await db.from('proveedores').insert({
        nombre:nombre.trim(),
        telefono:telefono.trim()||null,
        correo:correo.trim()||null,
        contacto:contacto.trim()||null,
        nit:nit.trim()||null,
        direccion:direccion.trim()||null,
        activo:true,
      }).select().single();
      if(error) throw error;
      onSave(data);
    }catch(e){
      alert('Error: '+e.message);
    }
    setLoading(false);
  };

  return(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div style={{fontWeight:700,fontSize:16,marginBottom:16}}>+ Agregar Proveedor</div>
        <div className="field">
          <label>Nombre *</label>
          <input type="text" value={nombre} onChange={e=>setNombre(e.target.value)} placeholder="Nombre del proveedor"/>
        </div>
        <div className="field">
          <label>Teléfono</label>
          <input type="text" value={telefono} onChange={e=>setTelefono(e.target.value)} placeholder="Ej: 2501-5555"/>
        </div>
        <div className="field">
          <label>Correo</label>
          <input type="text" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="Ej: info@proveedor.com"/>
        </div>
        <div className="field">
          <label>Contacto</label>
          <input type="text" value={contacto} onChange={e=>setContacto(e.target.value)} placeholder="Nombre del contacto"/>
        </div>
        <div className="field">
          <label>NIT</label>
          <input type="text" value={nit} onChange={e=>setNit(e.target.value)} placeholder="NIT"/>
        </div>
        <div className="field">
          <label>Dirección</label>
          <input type="text" value={direccion} onChange={e=>setDireccion(e.target.value)} placeholder="Dirección física"/>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="btn btn-green" onClick={guardar} disabled={loading}>
            {loading?'Guardando...':'✅ Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── NUEVO PRODUCTO MODAL ──────────────────────────────────────
export function NuevoProductoModal({onSave,onClose}){
  const [nombre,setNombre]=useState('');
  const [categoria,setCategoria]=useState('');
  const [subcategoria,setSubcategoria]=useState('');
  const [unidad_medida,setUnidad_medida]=useState('unidad');
  const [precio_referencia,setPrecio_referencia]=useState('');
  const [loading,setLoading]=useState(false);

  const guardar=async()=>{
    if(!nombre.trim()){alert('Ingresa el nombre del producto');return;}
    setLoading(true);
    try{
      const {data,error}=await db.from('catalogo_productos').insert({
        nombre:nombre.trim(),
        categoria:categoria.trim()||null,
        subcategoria:subcategoria.trim()||null,
        unidad_medida:unidad_medida.trim()||'unidad',
        precio_referencia:precio_referencia?parseFloat(precio_referencia):null,
        activo:true,
      }).select().single();
      if(error) throw error;
      onSave(data);
    }catch(e){
      alert('Error: '+e.message);
    }
    setLoading(false);
  };

  return(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div style={{fontWeight:700,fontSize:16,marginBottom:16}}>+ Nuevo Producto</div>
        <div className="field">
          <label>Nombre *</label>
          <input type="text" value={nombre} onChange={e=>setNombre(e.target.value)} placeholder="Nombre del producto"/>
        </div>
        <div className="field">
          <label>Categoría</label>
          <input type="text" value={categoria} onChange={e=>setCategoria(e.target.value)} placeholder="Ej: Insumo, Bebidas"/>
        </div>
        <div className="field">
          <label>Subcategoría</label>
          <input type="text" value={subcategoria} onChange={e=>setSubcategoria(e.target.value)} placeholder="Subcategoría (opcional)"/>
        </div>
        <div className="field">
          <label>Unidad de Medida</label>
          <select value={unidad_medida} onChange={e=>setUnidad_medida(e.target.value)}>
            <option value="unidad">Unidad</option>
            <option value="kg">Kilogramo</option>
            <option value="lb">Libra</option>
            <option value="litro">Litro</option>
            <option value="caja">Caja</option>
            <option value="bolsa">Bolsa</option>
            <option value="rollo">Rollo</option>
            <option value="paquete">Paquete</option>
            <option value="galón">Galón</option>
          </select>
        </div>
        <div className="field">
          <label>Precio de Referencia</label>
          <input type="number" value={precio_referencia} onChange={e=>setPrecio_referencia(e.target.value)} placeholder="0.00" min="0" step="0.01"/>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="btn btn-green" onClick={guardar} disabled={loading}>
            {loading?'Guardando...':'✅ Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
