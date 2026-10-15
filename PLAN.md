# Tubería de pagos reutilizable — Plan

> Supuesto de trabajo: Banco General (Enlace/Botón de Pago BG, sobre Cybersource) confirma que hay cobros recurrentes, montos variables, varios comercios/subcuentas y acceso a la API. **Nada de esto está confirmado todavía**; el correo a BG está enviado y pendiente de respuesta.

## 1. Objetivo
Un único servicio que le dé a cada proyecto (juego, app, web) su propio **link** y **botón** de pago (donación, suscripción o pago único). La persona pone su tarjeta en una página segura y el dinero llega a la **cuenta/comercio que elijas por proyecto**.

## 2. Arquitectura
```
[App/Web del proyecto] --botón/link--> [Checkout /p/:slug] --redirige--> [Página segura Cybersource (BG)]
                                              ^                                   |
                                              |<------ respuesta firmada + token --+
[Panel admin] --> [API + BD] <-- webhooks Cybersource
                     |--> [Programador de cobros recurrentes] --REST con token--> Cybersource
                     |--> [Webhooks a cada proyecto] + avisos por correo/WhatsApp
                     |--> [Tablero: recaudado por proyecto y cuenta]
```
1. **Panel de proyectos**: alta de proyecto, tipo de cobro, monto fijo/libre, merchant ID de BG destino, URL webhook. El nombre del proyecto es el concepto que ve quien paga.
2. **Link y botón universales**: `pagos.tudominio.com/p/<slug>` + `<script src=".../button.js" data-project="slug">`. En apps móviles se abre el link en navegador/WebView.
3. **Checkout alojado**: nuestra página única y neutra muestra concepto + monto y envía a la página de pago de Cybersource. **Nunca tocamos el número de tarjeta.**
4. **Cobros recurrentes**: un proceso diario cobra suscripciones vencidas con el token; si falla, reintenta (3 intentos, cada 3 días) y luego cancela y avisa.
5. **Avisos y registro**: webhooks de Cybersource → actualizamos BD → notificamos al proyecto (p. ej. desbloquear premium) → correo/WhatsApp al cliente.
6. **Tablero**: totales por proyecto, cuenta, estado, suscriptores activos, fallos.

## 2b. Diseño del checkout: UNO SOLO, neutro e igual para todos
- Misma página para cualquier proyecto o empresa: **sin logo, colores ni marca del comercio**. Solo se ve el **concepto/producto** y el **monto**.
- Monto grande arriba, debajo "cada mes", "donación" o "pago único".
- Campos mínimos: número de tarjeta, vencimiento, código de atrás y correo para el recibo (el monto solo aparece si es libre).
- Un único botón principal: "Pagar $X" o "Donar $X". Sin menús ni enlaces que distraigan.
- Español sencillo ("Código de atrás" en vez de "CVV").
- Confirmación clara: ✓ "¡Pago listo!", monto, concepto, a dónde llega el recibo, comprobante y "Ya puedes cerrar esta página". Si falla: "El pago no se hizo. No se cobró nada" + botón "Intentar de nuevo".
- En producción, si la tarjeta se captura en la página de Cybersource, se configurará su apariencia (o Unified Checkout/Microform incrustado) para mantener este mismo diseño neutro, según lo que permita BG.

## 3. Modelo de datos
- **projects**: id, slug, name, type (donation|subscription|one_time), amount (null = libre), free_amount, currency (USD), merchant_id, webhook_url, webhook_secret, created_at (sin campos de marca: el checkout es neutro).
- **customers**: id, email, name, phone, created_at.
- **payment_methods**: id, customer_id, processor, token (TMS customer/instrument id), brand, last4, exp_month, exp_year.
- **subscriptions**: id, project_id, customer_id, payment_method_id, amount, interval (month), status (active|past_due|canceled), next_charge_at, retries, canceled_at.
- **payments**: id, project_id, subscription_id?, customer_id, merchant_id, amount, status (approved|declined|refunded), processor_tx_id, reference, recurring, created_at.
- **events**: log de webhooks recibidos/enviados (idempotencia por id de evento).

## 4. Endpoints
| Método | Ruta | Uso |
|---|---|---|
| GET/POST | /api/projects, PATCH /api/projects/:id | CRUD proyectos (admin, autenticado) |
| GET | /p/:slug | Checkout público |
| POST | /p/:slug/checkout | Crea referencia y firma los campos para Cybersource |
| GET/POST | /p/:slug/return | Respuesta firmada de Cybersource (éxito/rechazo) |
| POST | /webhooks/cybersource | Notificaciones del procesador |
| GET | /api/payments, /api/subscriptions | Tablero |
| POST | /api/subscriptions/:id/cancel | Cancelar (cliente vía link mágico o admin) |
| GET | /button.js | Botón embebible |

## 5. Puntos de integración con Cybersource (a validar con BG)
- **Secure Acceptance Hosted Checkout / Unified Checkout**: formulario firmado con HMAC-SHA256 (profile_id, access_key, secret key), `transaction_type=sale,create_payment_token` para cobrar y tokenizar a la vez. Incluye 3‑D Secure.
- **Token Management Service (TMS)**: guardamos solo el id del token (customer / payment instrument).
- **REST Payments API** (`POST /pts/v2/payments`) con el token para los cobros mensuales (MIT/credencial almacenada) y reembolsos.
- **Webhooks / Merchant POST URL**: confirmación servidor‑a‑servidor; validar firma y usar idempotencia.
- **Varias cuentas**: un merchant ID (o perfil) por cuenta destino; el adaptador elige credenciales según `project.merchant_id`. Depende de lo que BG permita.
- El documento de referencia es el manual del Enlace de Pago BG; BG debe entregarnos credenciales y entorno de pruebas.

## 6. Seguridad y PCI
- Tarjeta solo en la página alojada de Cybersource → alcance PCI mínimo (SAQ A, a confirmar con BG).
- Secretos en variables de entorno/gestor de secretos; nunca en el repo.
- Validar la firma de toda respuesta y webhook; no confiar en el monto que manda el navegador (se recalcula en servidor).
- HTTPS obligatorio, panel con login + 2FA, límites de intentos, webhooks a proyectos firmados con HMAC.
- Registros sin datos sensibles; respaldos de la BD.
- Términos, política de reembolso y cancelación visibles en suscripciones.

## 7. Preguntas abiertas para Banco General
1. ¿Cobros recurrentes con token (TMS) y cobros iniciados por el comercio vía API?
2. ¿Secure Acceptance/Unified Checkout, o solo el Enlace de Pago manual?
3. ¿Varios merchant IDs / subcomercios con un solo registro, cada uno a cuenta distinta?
4. ¿Webhooks disponibles? ¿Entorno sandbox y credenciales de prueba?
5. Comisiones, plazo de depósito, contracargos, monedas, límites, tarjetas extranjeras.
6. Requisitos de afiliación (persona natural vs. sociedad, aviso de operación).

## 8. Hoja de ruta
- **Fase 0 (hecho)**: prototipo local con procesador simulado, panel, checkout único neutro, confirmación, botón, scheduler. (El envío real del recibo por correo aún no está implementado.)
- **Fase 1**: respuesta de BG + afiliación + credenciales sandbox.
- **Fase 2**: adaptador Cybersource real (checkout alojado + token + webhooks) en sandbox; base de datos real (SQLite/Postgres); login del panel.
- **Fase 3**: suscripciones reales con reintentos, correos/WhatsApp, portal para cancelar.
- **Fase 4**: despliegue con HTTPS en dominio propio, primer proyecto real (el juego), monitoreo.
- **Fase 5**: tablero avanzado, reembolsos, exportes contables, SDK para apps móviles.

### Plan B si BG no permite algo
PayPal (suscripciones/donaciones, funciona en Panamá), procesadores locales (PagueloFacil, Tilopay) o LLC en EE. UU. + Stripe. La interfaz de adaptadores permite cambiar de procesador sin rehacer el resto.


## 9. Estado del prototipo (15 oct 2026)
Funciona en **simulación** (sin dinero real):
- Checkout único y neutro; autocompletado del navegador (`cc-number`, `cc-exp`, `cc-csc`, `email`).
- Botones Google Pay / Apple Pay **simulados**, visibles solo si el procesador declara `capabilities.wallets`.
- Recibos HTML en español mediante un mailer enchufable (`src/mailer.js`). Por defecto, `MAILER=outbox` escribe archivos `.eml`/`.html` en `outbox/` y **no envía** nada.
- Tablero: totales, por proyecto y por cuenta destino, pagos, suscripciones con estado y botón Cancelar.
- Link de autoservicio firmado (HMAC) en el recibo para que el cliente cancele: `/s/:id/cancelar?t=...`.
- Cobro recurrente: si falla, reintenta a los 3 días; al 3.er fallo cancela y avisa por correo.
- Webhooks a cada proyecto firmados con `x-tuberia-signature: sha256=HMAC(secreto, "timestamp.body")` + `x-tuberia-timestamp`.
- Adaptadores: `mock` (activo), `cybersource` y `paguelofacil` (esqueletos sin implementar).
- Prueba automática: `test/e2e.js` (con `test/receiver.js`).

## 10. Checklist para conectar Banco General
**Trámites (tú):**
- [ ] Aviso de operación (Panamá Emprende) vigente.
- [ ] RUC (persona natural o sociedad) y DV.
- [ ] Cuenta en Banco General a nombre del mismo titular/RUC.
- [ ] Solicitud de afiliación a Comercio Electrónico BG (Enlace/Botón de Pago) y respuesta a las preguntas abiertas (sección 7).
- [ ] Sitio público con HTTPS, términos, política de reembolsos/cancelación y datos de contacto (normalmente lo exigen al afiliar).

**Ambiente de pruebas:**
- [ ] Recibir de BG el acceso al ambiente de pruebas de Cybersource. El usuario de prueba que se mencionó es `ebc2test`; hay que confirmarlo con BG, porque no está verificado en documentación pública.
- [ ] Crear en el Business Center: perfil de Secure Acceptance/Unified Checkout (profile_id, access_key, secret_key), llave REST (key id + shared secret) y, si aplica, una configuración de TMS y de webhooks.
- [ ] Hacer transacciones de prueba (aprobada, rechazada, 3DS, recurrente con token, reembolso).
- [ ] Enviar evidencias y pedir la **validación/certificación a comercioelectronico@bgeneral.com** para pasar a producción.
- [ ] Recibir credenciales de producción (una por merchant ID / cuenta destino).

**Código a cambiar:**
1. `src/adapters/cybersource.js`: implementar `authorize` como redirección a la página alojada (o Unified Checkout) con firma HMAC; agregar la ruta `/p/:slug/return` que valida la firma y guarda el `payment_token`; implementar `charge(token)` con `POST /pts/v2/payments` (credencial almacenada / MIT); implementar `verifyWebhook`. Declarar `capabilities.wallets` solo si BG habilita Google Pay/Apple Pay.
2. Checkout: con `hostedCheckout: true`, nuestro formulario ya no captura la tarjeta. Solo muestra concepto + monto + correo y redirige.
3. Variables de entorno: `PROCESSOR=cybersource`, `CYBS_ENV=test|prod`, credenciales por merchant ID, `APP_SECRET`, `BASE_URL` con HTTPS.
4. `src/mailer.js`: agregar un mailer real (SMTP / Resend / SES) y usar `MAILER=smtp`.
5. Base de datos: cambiar `data.json` por SQLite/Postgres; agregar login al panel.
6. Plan B: misma interfaz en `src/adapters/paguelofacil.js`.

## 11. Productos digitales (partituras)
Tipo `digital`: PDF guardado en `files/` (fuera de `public/`) y entregado solo por `/d/:token` (aleatorio, 7 días, 5 descargas). La marca de agua se pone en cada descarga con pdf-lib. Catálogo `/tienda/:seller` con el mismo diseño neutro. Pendiente para producción: guardar los archivos en almacenamiento privado (S3/R2), aplicar un límite por IP, y que el link de Instagram use un dominio corto propio con HTTPS.
