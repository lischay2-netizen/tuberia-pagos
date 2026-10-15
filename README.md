# Tubería de pagos — prototipo local (SIMULACIÓN)

Requisitos: Node.js 18+.

```bash
cd tuberia-pagos
npm install
npm start            # http://localhost:3000
```

- Panel: http://localhost:3000/admin — crea proyectos (nombre, tipo, monto o monto libre, cuenta destino).
- Checkout público: http://localhost:3000/p/<slug>
- Botón para pegar en cualquier web: `<script src="http://localhost:3000/button.js" data-project="<slug>" data-label="Donar"></script>`
- API: `GET/POST /api/projects`, `GET /api/payments`, `POST /api/billing/run` (`{"now":"2026-12-01"}` para simular un mes después), `POST /webhooks/processor`.

Tarjetas de prueba (simulación): cualquier número de 13+ dígitos se aprueba; terminado en **0002** se rechaza.

Procesador: `PROCESSOR=mock` (por defecto). `src/adapters/cybersource.js` es el esqueleto para el adaptador real de Banco General/Cybersource; aún no está implementado. Datos en `data.json` (borrarlo reinicia todo).

El checkout es un único diseño neutro para todos los proyectos: solo muestra el concepto (nombre del proyecto) y el monto. El correo de recibo todavía no se envía (pendiente).

## Novedades
- Recibos: se escriben en `outbox/` (.eml y .html); no se envían correos reales. `MAILER=outbox`.
- Tarjeta terminada en **0341**: se aprueba al inicio, pero los cobros mensuales fallan (sirve para probar reintentos).
- Google/Apple Pay simulados (dependen de `capabilities.wallets` del procesador).
- Cancelar: desde el panel o con el link del recibo `/s/:id/cancelar?t=...`.
- Procesadores: `PROCESSOR=mock|cybersource|paguelofacil` (los dos últimos aún no están implementados).

## Prueba automática
```bash
rm -rf data.json outbox/* test/webhooks-recibidos.jsonl
npm start &  node test/receiver.js &  sleep 1
node test/e2e.js
```

## Productos digitales (partituras PDF)
- En el panel elige tipo "Producto digital (PDF)" y llena precio, PDF, autor (sale en la marca de agua) y tienda.
- Link corto para Instagram: `/p/<slug>`. Catálogo: `/tienda/<tienda>`.
- Después del pago: botón "Descargar PDF" en la confirmación y en el recibo. Link `/d/<token>` que vence a los 7 días (`LINK_DAYS`) y permite 5 descargas (`MAX_DOWNLOADS`). Cada página lleva: comprador, correo, fecha, pedido y "Arreglo © autor. Licencia de uso personal. Prohibida su redistribución.", más una marca diagonal.
- PDF de ejemplo: `node test/make-sample-pdf.js` → `samples/partitura-ejemplo.pdf`. Prueba: `node test/digital.js` (con el servidor corriendo).

## Seguridad y publicación
- `.env` (permiso 600): `ADMIN_PASSWORD` (usuario `admin`) y `BASE_URL`. Arranque con `./run-public.sh`.
- Protegido con contraseña: `/admin` y `/api/*`. Tras 10 intentos fallidos desde la misma IP, bloqueo de 15 minutos.
- Límites por IP: `/d/` 20 cada 10 min; `/p/` 60 por min; `/s/` 20 cada 10 min.
- Solo se sirve `public/`. `files/`, `samples/`, `outbox/`, `data.json` y `.env` nunca se publican.
- Tokens de descarga de 192 bits, comparados en tiempo constante (hash SHA-256 + timingSafeEqual).
- Vista previa pública: solo un PNG de 45 dpi de la página 1, marcado "VISTA PREVIA".
- Auditoría: `test/audit.sh http://localhost:3000`.

## Persistencia y correo real (opcionales, por variables de entorno)
- `DATABASE_URL=postgres://...` → guarda proyectos, pagos, suscripciones, descargas y los PDF/vistas previas en Postgres (tablas `records` y `files`). Sin ella se usa `data.json`.
- `MAILER=brevo` + `BREVO_API_KEY` + `MAIL_FROM` (+ `MAIL_FROM_NAME`) → envía recibos reales por la API HTTP de Brevo. `MAILER=resend` + `RESEND_API_KEY` también funciona, pero exige un dominio propio. Si el envío falla, se guarda una copia en `outbox/`.
- En Render free no sirve SMTP: bloquea los puertos 25, 465 y 587. Por eso el correo va por API HTTP.
- Pruebas: `test/mock-mail-api.js` imita la API de Brevo en el puerto 4100 (`BREVO_API_URL=http://localhost:4100/v3/smtp/email`).
