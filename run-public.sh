#!/bin/bash
# Arranca el servidor con las variables de .env (en segundo plano)
cd "$(dirname "$0")"; set -a; . ./.env; set +a
pkill -f "node src/server.js"; sleep .5
nohup node src/server.js > server.log 2>&1 &
