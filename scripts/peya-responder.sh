#!/usr/bin/env bash
# Contesta a PedidosYa sobre un pedido ya recibido: aceptar, rechazar, marcar
# preparado o retirado. Es el disparador manual de la edge fn `peya-responder`,
# útil mientras el POS todavía no tiene el botón.
#
#   ./scripts/peya-responder.sh FD-TEST-1757... aceptar
#   ./scripts/peya-responder.sh FD-TEST-1757... rechazar ITEM_UNAVAILABLE "Se acabó el pan"
#   ./scripts/peya-responder.sh FD-TEST-1757... preparado
#   ./scripts/peya-responder.sh FD-TEST-1757... retirado
#
# El secreto se pide por consola: pasarlo como argumento lo dejaría en el historial.
#
# OJO CON EL RELOJ: cada pedido trae expiryDate. Si no se acepta ni rechaza antes,
# DH lo cancela solo con NO_RESPONSE y eso cuenta contra la tienda.
set -uo pipefail

BASE="${BASE:-https://api.freakiedogs.com/functions/v1/peya-responder}"

RID="${1:-}"
ACCION="${2:-}"
MOTIVO="${3:-}"
MENSAJE="${4:-}"

if [ -z "$RID" ] || [ -z "$ACCION" ]; then
  awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "$0"
  exit 1
fi

case "$ACCION" in
  aceptar|rechazar|preparado|retirado) ;;
  *) echo "acción inválida: $ACCION (aceptar|rechazar|preparado|retirado)"; exit 1 ;;
esac

# Los 24 motivos válidos los define DH; éstos son los que usa la operación a diario.
if [ "$ACCION" = "rechazar" ] && [ -z "$MOTIVO" ]; then
  echo "rechazar necesita motivo. Los habituales:"
  echo "  ITEM_UNAVAILABLE  TOO_BUSY  CLOSED  TEST_ORDER  TECHNICAL_PROBLEM"
  echo "  ADDRESS_OUT_OF_DELIVERY_AREA  CUSTOMER_CALLED_TO_CANCEL"
  exit 1
fi

if [ -z "${PEYA_ACCION_SECRET:-}" ]; then
  printf 'PEYA_ACCION_SECRET: '
  read -rs PEYA_ACCION_SECRET
  echo
fi

cuerpo=$(RID="$RID" ACCION="$ACCION" MOTIVO="$MOTIVO" MENSAJE="$MENSAJE" python3 - <<'PY'
import json, os
c = {"remoteOrderId": os.environ["RID"], "accion": os.environ["ACCION"]}
if os.environ["ACCION"] == "rechazar":
    c["motivo"] = os.environ["MOTIVO"]
    if os.environ["MENSAJE"]:
        c["mensaje"] = os.environ["MENSAJE"]
print(json.dumps(c))
PY
)

resp=$(curl -s -w '\n%{http_code}' -X POST "$BASE" \
  -H "x-freakie-secreto: $PEYA_ACCION_SECRET" \
  -H 'Content-Type: application/json' \
  -d "$cuerpo")

code=$(printf '%s' "$resp" | tail -n1)
json=$(printf '%s' "$resp" | sed '$d')

echo "HTTP $code"
printf '%s\n' "$json" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$json"

[ "$code" = "200" ] && exit 0 || exit 1
