// Interfaz que todo adaptador de procesador debe cumplir:
//  name: string
//  capabilities: { wallets: ['google_pay','apple_pay'], recurring: bool, hostedCheckout: bool }
//  authorize({card|wallet, amount, project}) -> {status:'approved'|'declined', transactionId, token, last4, brand, reason}
//  charge(token, amount, project) -> {status, transactionId, reason}   (cobro recurrente con token)
//  verifyWebhook(req) -> boolean
// Se elige con PROCESSOR=mock|cybersource|paguelofacil.
module.exports = {};
