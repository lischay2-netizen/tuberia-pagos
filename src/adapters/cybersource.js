// Esqueleto del adaptador real (Cybersource vía Banco General). NO implementado.
// Puntos de integración previstos:
//  - createCheckout: Secure Acceptance Hosted Checkout / Unified Checkout (firma HMAC-SHA256 de campos)
//  - handleReturn: validar firma de la respuesta, guardar payment_token (TMS), nunca el PAN
//  - charge: POST /pts/v2/payments con paymentInformation.paymentInstrument.id (token TMS)
//  - verifyWebhook: validar firma de notificaciones (Webhooks / Merchant POST URL)
const notImpl = () => { throw new Error('Adaptador Cybersource pendiente de credenciales de Banco General'); };
module.exports = { name: 'cybersource', capabilities: { wallets: [], recurring: true, hostedCheckout: true }, createCheckout: notImpl, authorize: notImpl, charge: notImpl, verifyWebhook: notImpl };
