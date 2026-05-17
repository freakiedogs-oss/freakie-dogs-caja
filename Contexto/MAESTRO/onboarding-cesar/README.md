# Onboarding Cesar — Carpeta de assets

Esta carpeta contiene los archivos auxiliares para el onboarding de Cesar como segundo desarrollador del ERP via Claude.

## Archivos

- `exportar_memoria.sh` — Script bash para empaquetar la memoria local de Claude de Jose a un ZIP que Cesar pueda importar.

## Cómo usar el export de memoria

### Para Jose (paso 1 — generar el ZIP)

En tu Mac, abrí Terminal y corré:

```bash
cd "/Users/joseisart/Documents/Freakies/Claude/Freakie Dogs ERP/Contexto/MAESTRO/onboarding-cesar"
bash exportar_memoria.sh
```

Esto genera `~/Downloads/jose_memory_export_YYYY-MM-DD.zip` con todos los archivos de memoria de tu Claude (~60 archivos, patrones aprendidos durante 6 meses).

Mandale ese ZIP a Cesar.

### Para Cesar (paso 2 — importar el ZIP)

Seguí la sección 4 del documento `ONBOARDING_CESAR.md` (en la carpeta padre `/Contexto/MAESTRO/`).

Resumen:
1. Descomprimí el ZIP en tu carpeta local de memoria de Claude
2. Reiniciá Cowork
3. Verificá con: `¿Qué sabés sobre v_gastos_consolidados?` (debería mencionar la regla de prioridad)

## Si el script falla

Si `exportar_memoria.sh` no encuentra la carpeta de memoria, es porque la ruta cambió. Para localizarla:

1. Abrí una sesión nueva de Cowork
2. Preguntale a Claude: `¿Cuál es la ruta exacta de tu directorio de memoria local?`
3. Editá el script y reemplazá la variable `MEMORY_DIR` con la ruta nueva
4. Corré de nuevo
