#!/usr/bin/env bash
# Prueba de punta a punta del receptor de PedidosYa (edge fn `peya-plugin`).
#
# Firma un JWT igual que lo hace el middleware de Delivery Hero (HS512 con el
# pluginSecret + claim `service: middleware`) y ejercita los cuatro caminos que
# importan: health check, rechazo sin token válido, dispatch de una orden e
# idempotencia del reintento.
#
#   ./scripts/test-peya-plugin.sh                      # contra api.freakiedogs.com
#   BASE=https://btbox....supabase.co/functions/v1/peya-plugin ./scripts/test-peya-plugin.sh
#
# El secreto se pide por consola a propósito: pasarlo como argumento lo dejaría
# escrito en el historial de zsh.
set -uo pipefail

BASE="${BASE:-https://api.freakiedogs.com/functions/v1/peya-plugin}"
VENDOR="${VENDOR:-AR-PRUEBAS-INTEGRACION-0001}"
TOKEN_ORDEN="${TOKEN_ORDEN:-TEST-$(date +%s)}"

if [ -z "${PEYA_PLUGIN_SECRET:-}" ]; then
  printf 'pluginSecret de PedidosYa: '
  read -rs PEYA_PLUGIN_SECRET
  echo
fi

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

firmar_jwt() {
  local h p s
  h=$(printf '%s' '{"typ":"JWT","alg":"HS512"}' | b64url)
  p=$(printf '%s' "$1" | b64url)
  s=$(printf '%s' "$h.$p" \
      | openssl dgst -sha512 -hmac "$PEYA_PLUGIN_SECRET" -binary | b64url)
  printf '%s.%s.%s' "$h" "$p" "$s"
}

JWT_OK=$(firmar_jwt '{"service":"middleware"}')
# Un token con claim equivocado debe rechazarse aunque la firma sea correcta.
JWT_MAL=$(firmar_jwt '{"service":"otra-cosa"}')

fallos=0
verificar() { # descripción, esperado, obtenido
  if [ "$2" = "$3" ]; then
    printf '  ok   %-46s %s\n' "$1" "$3"
  else
    printf '  FALLA %-45s esperado %s, obtuvo %s\n' "$1" "$2" "$3"
    fallos=$((fallos + 1))
  fi
}

echo "Probando $BASE"
echo

# 1. Health check: público, sin autenticación. Es lo que PeYa usó para validar el SSL.
code=$(curl -s -o /tmp/peya_health.json -w '%{http_code}' "$BASE")
verificar "health check responde 200" 200 "$code"
grep -q '"status":"ok"' /tmp/peya_health.json \
  && echo '  ok   health check dice status ok' \
  || { echo '  FALLA health check sin {"status":"ok"}'; fallos=$((fallos + 1)); }

# 2. Sin credenciales no se pasa. Si esto diera 200, el webhook estaría abierto.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/order/$VENDOR" \
  -H 'Content-Type: application/json' -d '{"token":"SIN-AUTH"}')
verificar "dispatch sin Authorization da 401" 401 "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/order/$VENDOR" \
  -H "Authorization: Bearer $JWT_MAL" \
  -H 'Content-Type: application/json' -d '{"token":"CLAIM-MALO"}')
verificar "claim service incorrecto da 401" 401 "$code"

# 3. Dispatch real. Debe devolver remoteOrderId: sin él no llegan los updates de estado.
cuerpo=$(cat <<JSON
{
  "token": "$TOKEN_ORDEN",
  "code": "$TOKEN_ORDEN",
  "expeditionType": "delivery",
  "delivery": { "riderPickupTime": "2030-01-01T12:00:00Z" },
  "callbackUrls": {
    "orderAcceptedUrl": "https://example.invalid/accept",
    "orderRejectedUrl": "https://example.invalid/reject"
  },
  "products": [ { "name": "Freakie Clásica", "quantity": "1", "paidPrice": "5.99" } ]
}
JSON
)

code=$(curl -s -o /tmp/peya_disp.json -w '%{http_code}' -X POST "$BASE/order/$VENDOR" \
  -H "Authorization: Bearer $JWT_OK" -H 'Content-Type: application/json' -d "$cuerpo")
verificar "dispatch con JWT válido da 200" 200 "$code"

rid=$(python3 -c 'import json,sys;print(json.load(open("/tmp/peya_disp.json")).get("remoteResponse",{}).get("remoteOrderId",""))' 2>/dev/null)
verificar "devuelve el remoteOrderId esperado" "FD-$TOKEN_ORDEN" "$rid"

# 4. Idempotencia: DH reintenta hasta 10 veces. El reintento no puede duplicar el
#    pedido ni cambiar el remoteOrderId.
curl -s -o /tmp/peya_disp2.json -X POST "$BASE/order/$VENDOR" \
  -H "Authorization: Bearer $JWT_OK" -H 'Content-Type: application/json' -d "$cuerpo" >/dev/null
rid2=$(python3 -c 'import json;print(json.load(open("/tmp/peya_disp2.json")).get("remoteResponse",{}).get("remoteOrderId",""))' 2>/dev/null)
verificar "el reintento devuelve el mismo id" "$rid" "$rid2"

# 5. Cambio de estado sobre la orden recién creada.
code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
  "$BASE/remoteId/$VENDOR/remoteOrder/$rid/posOrderStatus" \
  -H "Authorization: Bearer $JWT_OK" -H 'Content-Type: application/json' \
  -d '{"status":"ORDER_CANCELLED","message":"prueba automatizada"}')
verificar "cancelación da 200" 200 "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
  "$BASE/remoteId/$VENDOR/remoteOrder/FD-NO-EXISTE/posOrderStatus" \
  -H "Authorization: Bearer $JWT_OK" -H 'Content-Type: application/json' \
  -d '{"status":"ORDER_CANCELLED","message":"x"}')
verificar "estado de orden inexistente da 404" 404 "$code"

# 6. Pedido de menú: 202 sincrónico, el menú se manda después por la API.
code=$(curl -s -o /dev/null -w '%{http_code}' \
  "$BASE/menuimport/$VENDOR?vendorCode=X&menuImportId=Y" \
  -H "Authorization: Bearer $JWT_OK")
verificar "menuimport da 202" 202 "$code"

echo
if [ "$fallos" -eq 0 ]; then
  echo "Todo en orden. Orden de prueba: $TOKEN_ORDEN (quedó cancelada)."
else
  echo "$fallos verificación(es) fallaron."
fi
exit "$fallos"
