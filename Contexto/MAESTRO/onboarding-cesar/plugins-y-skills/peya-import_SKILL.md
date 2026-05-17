---
name: peya-import
description: Importa ventas PeYa (PedidosYa) desde ZIPs de archivos JSON DTE al sistema ERP Freakie Dogs. Úsalo siempre que el usuario suba un ZIP de JSONs de PeYa, mencione "ventas PeYa", "importar PeYa", "DTE PeYa", "archivos JSON de deliveries", o cualquier variación. El skill deduplica automáticamente usando codigo_generacion, detecta las sucursales del nombre del archivo, e importa solo los registros nuevos con canal_venta = 'peya'. Siempre verificar la suma total directamente en BD al final para evitar el bug de paginación de 1000 filas.
---

# PeYa DTE Import

Importa automáticamente ventas PeYa desde ZIPs de JSONs al Supabase del ERP.

## Contexto del negocio

Las ventas PeYa (PedidosYa) NO aparecen en los reportes de transacciones regulares de Quanto porque fluyen a Cuentas por Cobrar (CxC), no a transacciones directas. Por eso hay que importarlas manualmente desde los archivos JSON DTE que provee el sistema.

- **Tabla destino**: `quanto_dte_ventas` (proyecto Supabase: `btboxlwfqcbrdfrlnwln`)
- **Identificador único**: `codigo_generacion` (UUID por DTE — nunca se repite, incluso si `numero_control` se resetea cada año fiscal)
- **Canal**: `canal_venta = 'peya'`
- **Sucursales activas PeYa**: M001, S001, S003, S004

## Patrón del nombre de archivo

```
DTE-01-{STORE_CODE}P{correlativo}-{año}-{correlativo_largo}-{UUID}.json
Ejemplo: DTE-01-S003P001-2026-0000001-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX.json
```

Extraer store_code: `fname.split('-')[2].split('P')[0]` → `S003`

## Paso a paso

### 1. Extraer ZIP

```python
import zipfile, os, json, pickle
from pathlib import Path

zip_path = "/path/al/archivo.zip"
out_dir = "/sessions/.../outputs/json_peya/"

with zipfile.ZipFile(zip_path) as z:
    z.extractall(out_dir)

json_files = list(Path(out_dir).rglob("*.json"))
print(f"Total archivos: {len(json_files)}")
```

### 2. Parsear JSONs

```python
rows = []
errores = []

for fp in json_files:
    try:
        with open(fp) as f:
            doc = json.load(f)
        
        # Navegar estructura DTE
        dte = doc.get('dteJson', doc)
        ident = dte.get('identificacion', dte.get('Identificacion', {}))
        resumen = dte.get('resumen', dte.get('Resumen', {}))
        
        fname = fp.name
        store_code = fname.split('-')[2].split('P')[0]
        
        rows.append({
            'codigo_generacion': ident.get('codigoGeneracion'),
            'numero_control': ident.get('numeroControl'),
            'fecha_emision': ident.get('fecEmi'),
            'total_pagar': float(resumen.get('totalPagar', 0)),
            'store_code': store_code,
            'canal_venta': 'peya',
            # Campos opcionales adicionales:
            'tipo_dte': ident.get('tipoDte'),
            'total_gravadas': float(resumen.get('totalGravada', resumen.get('gravada', 0))),
            'iva': float(resumen.get('totalIva', 0)),
        })
    except Exception as e:
        errores.append((str(fp), str(e)))

print(f"Parseados: {len(rows)} | Errores: {len(errores)}")
```

### 3. Verificar duplicados (con paginación correcta)

⚠️ CRÍTICO: Supabase retorna máximo 1000 filas. Siempre usar `.range()` para conteos completos.

```python
from supabase import create_client

SUPABASE_URL = "https://btboxlwfqcbrdfrlnwln.supabase.co"
SUPABASE_KEY = "<anon_key>"  # del .env o de get_publishable_keys()

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# Obtener TODOS los codigo_generacion de peya en BD (paginado)
todos_en_bd = set()
offset = 0
while True:
    res = (sb.table('quanto_dte_ventas')
           .select('codigo_generacion')
           .eq('canal_venta', 'peya')
           .range(offset, offset + 999)
           .execute())
    todos_en_bd.update(
        r['codigo_generacion'].upper() 
        for r in res.data 
        if r.get('codigo_generacion')
    )
    if len(res.data) < 1000:
        break
    offset += 1000

print(f"Registros PeYa en BD: {len(todos_en_bd)}")

# Separar nuevos vs duplicados
nuevos = [r for r in rows if r['codigo_generacion'] and r['codigo_generacion'].upper() not in todos_en_bd]
duplicados = [r for r in rows if r['codigo_generacion'] and r['codigo_generacion'].upper() in todos_en_bd]

print(f"Nuevos a importar: {len(nuevos)}")
print(f"Duplicados (ya en BD): {len(duplicados)}")
```

### 4. Insertar en lotes de 100

```python
BATCH_SIZE = 100
insertados = 0
errores_insert = []

for i in range(0, len(nuevos), BATCH_SIZE):
    batch = nuevos[i:i+BATCH_SIZE]
    try:
        res = sb.table('quanto_dte_ventas').insert(batch).execute()
        insertados += len(batch)
        print(f"Lote {i//BATCH_SIZE + 1}: {len(batch)} insertados")
    except Exception as e:
        errores_insert.append((i, str(e)))
        print(f"ERROR en lote {i//BATCH_SIZE + 1}: {e}")

print(f"\nTotal insertados: {insertados}")
```

### 5. Verificar total en BD (SQL directo — evita límite 1000 filas)

⚠️ NO sumar desde Python sobre el resultado del cliente — usar execute_sql para el SUM real.

```sql
SELECT 
    store_code,
    COUNT(*) as registros,
    SUM(total_pagar) as total_ventas,
    MIN(fecha_emision) as desde,
    MAX(fecha_emision) as hasta
FROM quanto_dte_ventas
WHERE canal_venta = 'peya'
GROUP BY store_code
ORDER BY store_code;
```

También verificar el gran total:
```sql
SELECT COUNT(*) as total_registros, SUM(total_pagar) as total_global
FROM quanto_dte_ventas
WHERE canal_venta = 'peya';
```

## Reporte final esperado

Siempre entregar un resumen con:
- Total archivos en ZIP
- Nuevos importados (con desglose por sucursal)
- Duplicados encontrados (omitidos)
- Errores de parseo/inserción
- **Monto total verificado en BD por SQL** (breakdown por sucursal y grand total)

Ejemplo:
```
📦 ZIP procesado: 8,267 archivos
✅ Nuevos importados: 8,267 (M001: 2,103 | S001: 1,845 | S003: 2,891 | S004: 1,428)
♻️  Duplicados omitidos: 0
❌ Errores: 0

💰 Totales verificados en BD (SQL directo):
   M001: 2,103 registros — $XX,XXX.XX
   S001: 1,845 registros — $XX,XXX.XX
   S003: 2,891 registros — $XX,XXX.XX
   S004: 1,428 registros — $XX,XXX.XX
   TOTAL: 9,267 registros — $XXX,XXX.XX
```

## Problemas conocidos y soluciones

| Problema | Causa | Solución |
|---|---|---|
| Error RLS / 401 | Política INSERT faltante para anon | `CREATE POLICY "allow_insert_anon" ON quanto_dte_ventas FOR INSERT TO anon, authenticated WITH CHECK (true)` |
| Unique constraint en `numero_control` | NC se resetea cada año fiscal | Constraint correcto: `UNIQUE (store_code, numero_control, fecha_emision)` — ya aplicado |
| Monto total incorrecto | Supabase devuelve max 1000 filas | SIEMPRE verificar con `execute_sql` SUM directo, nunca sumar desde Python sobre `.select()` |
| `dteJson` key no encontrada | Algunos JSONs tienen estructura plana | Usar `doc.get('dteJson', doc)` para manejar ambos formatos |

## Anon key

Obtener siempre fresh del MCP:
```
mcp__0aba5879-f401-47a1-8888-425c5698ff98__get_publishable_keys(project_id="btboxlwfqcbrdfrlnwln")
```
