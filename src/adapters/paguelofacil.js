// Esqueleto del adaptador PagueloFacil (Panamá). NO implementado; requiere afiliación y credenciales (CCLW / token).
// Puntos previstos (confirmar con su documentación oficial):
//  - createCheckout/authorize: Link de pago o API de transacciones (sandbox y producción).
//  - charge: cobro recurrente con tarjeta tokenizada, si su plan lo permite.
//  - verifyWebhook: validar notificación / URL de retorno.
const notImpl = () => { throw new Error('Adaptador PagueloFacil pendiente de afiliación y credenciales'); };
module.exports = { name: 'paguelofacil', capabilities: { wallets: [], recurring: null, hostedCheckout: true },
  authorize: notImpl, charge: notImpl, verifyWebhook: notImpl };
