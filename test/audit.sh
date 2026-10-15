#!/bin/bash
# Auditoría: intenta obtener originales/datos sin pagar. Todo debe fallar (≠200 o sin contenido sensible).
cd "$(dirname "$0")/.."; B=${1:-$BASE_URL}; PASS=0; FAIL=0
P=$(node -e "const d=require('./data.json');const p=d.projects.find(x=>x.type==='digital');console.log(p.id)")
PAY=$(node -e "const d=require('./data.json');console.log(d.payments.find(x=>x.buyer).id)")
TX=$(node -e "const d=require('./data.json');console.log(d.payments.find(x=>x.buyer).transaction_id)")
USED=$(node -e "const d=require('./data.json');console.log(d.downloads.find(x=>x.count>=x.max).token)")
EXP=$(node -e "const d=require('./data.json');console.log(d.downloads.find(x=>new Date(x.expires_at)<new Date()).token)")
chk(){ local url="$1"; shift; local out code; code=$(curl -s -o /tmp/aud.out -w '%{http_code}' --path-as-is "$@" "$B$url");
  if [ "$code" = 200 ] && ( head -c5 /tmp/aud.out | grep -q '%PDF' || grep -qE 'ADMIN_PASSWORD|webhook_secret|"token"|"payments"' /tmp/aud.out ); then echo "✘ $code $url"; FAIL=$((FAIL+1)); 
  elif [ "$code" = 200 ] || [ "${code:0:1}" = 5 ] || [ "$code" = 000 ]; then echo "✘ $code (inesperado) $url"; FAIL=$((FAIL+1)); else echo "✔ $code $url"; PASS=$((PASS+1)); fi; }
for u in /files/$P.pdf /files/ /samples/partitura-ejemplo.pdf /samples/ /data.json /.env /outbox/ /src/server.js /package.json \
  /../data.json /%2e%2e/data.json /..%2f..%2fdata.json /public/../.env /style.css/../../data.json /preview/..%2f..%2fdata.json.png \
  /preview/..%2f$P.pdf /d/$P /d/$PAY /d/$TX /d/$P.pdf /d/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "/d/$USED" "/d/$EXP" \
  /api/projects /api/payments /api/subscriptions /admin; do chk "$u"; done
chk /admin -u admin:incorrecta; chk /api/projects -u admin:incorrecta
echo "Resultado: $PASS bloqueados, $FAIL fugas"
