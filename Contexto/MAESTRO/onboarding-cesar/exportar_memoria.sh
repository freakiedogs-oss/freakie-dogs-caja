#!/bin/bash
# exportar_memoria.sh
# Empaqueta la carpeta de memoria local de Claude (Jose) a un ZIP para que Cesar lo importe.
# Uso: bash exportar_memoria.sh
# Output: jose_memory_export_YYYY-MM-DD.zip en ~/Downloads/

set -e

MEMORY_DIR="$HOME/Library/Application Support/Claude/local-agent-mode-sessions/2306bb9c-1aea-45de-8c65-10b042ca4507/62a37d0f-152c-46cf-b601-20096d4c0b36/spaces/c38c3e8f-22b1-48ce-8530-d86d46ae4dfa/memory"

OUTPUT_DIR="$HOME/Downloads"
OUTPUT_FILE="$OUTPUT_DIR/jose_memory_export_$(date +%Y-%m-%d).zip"

if [ ! -d "$MEMORY_DIR" ]; then
  echo "ERROR: No encuentro la carpeta de memoria en:"
  echo "  $MEMORY_DIR"
  echo ""
  echo "Es posible que la ruta haya cambiado. Para localizarla, en una sesión de Cowork preguntale a Claude:"
  echo "  ¿Cuál es la ruta exacta de tu directorio de memoria local?"
  exit 1
fi

echo "Empaquetando memoria desde:"
echo "  $MEMORY_DIR"
echo ""

cd "$MEMORY_DIR"
zip -r "$OUTPUT_FILE" . -x "*.DS_Store"

echo ""
echo "✅ Listo:"
echo "  $OUTPUT_FILE"
echo ""
echo "Mandale este ZIP a Cesar (WhatsApp/Drive/lo-que-sea)."
echo "Cesar lo importa siguiendo la sección 4 de ONBOARDING_CESAR.md"
