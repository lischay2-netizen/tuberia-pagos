// Esqueleto del adaptador REAL del Botón de Pago Yappy (nueva integración por API). NO implementado.
// Documentación: https://www.yappy.com.pa/comercial/desarrolladores/boton-de-pago-yappy-nueva-integracion/
//  1) POST payments/validate/merchant  { merchantId, urlDomain }  → token
//  2) POST /payments/payment-wc (Authorization: token) { merchantId, orderId, domain, paymentDate(epoch), aliasYappy (teléfono),
//     ipnUrl, discount, taxes, subtotal, total } → datos para el web component
//  3) Frontend: web component oficial https://bt-cdn.yappy.cloud/v1/cdn/web-component-btn-yappy.js (evento eventClick)
//  4) IPN: endpoint GET propio que Yappy llama al completar/cancelar; validar el hash con la clave secreta.
// Credenciales: ID de comercio + clave secreta desde Yappy Comercial (variables YAPPY_MERCHANT_ID, YAPPY_SECRET_KEY, YAPPY_DOMAIN).
const notImpl = () => { throw new Error('Adaptador Yappy real pendiente de afiliación a Yappy Comercial'); };
module.exports = { name: 'yappy', createOrder: notImpl, getOrder: notImpl, resolve: notImpl };
