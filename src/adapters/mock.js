// ADAPTADOR SIMULADO (simulación). No mueve dinero real.
// Tarjetas: termina en 0002 = rechazada; termina en 0341 = se aprueba hoy pero los cobros recurrentes fallan; otra = aprobada.
const crypto = require('crypto');
const id = p => p + crypto.randomBytes(5).toString('hex');
module.exports = {
  name: 'mock',
  capabilities: { wallets: ['google_pay', 'apple_pay'], recurring: true, hostedCheckout: false },
  async authorize({ card, wallet }) {
    if (wallet) return { status: 'approved', transactionId: id('SIM-'), token: id('tok_sim_'), last4: '4242', brand: wallet === 'apple_pay' ? 'Apple Pay' : 'Google Pay' };
    const d = String(card || '').replace(/\D/g, '');
    if (d.length < 13) return { status: 'declined', reason: 'Número de tarjeta inválido' };
    if (d.endsWith('0002')) return { status: 'declined', reason: 'Tarjeta rechazada (simulación)' };
    return { status: 'approved', transactionId: id('SIM-'), token: (d.endsWith('0341') ? 'tok_fail_' : 'tok_sim_') + crypto.randomBytes(6).toString('hex'), last4: d.slice(-4), brand: 'Tarjeta' };
  },
  async charge(token) {
    if (String(token).startsWith('tok_fail_')) return { status: 'declined', reason: 'Fondos insuficientes (simulación)' };
    return { status: 'approved', transactionId: id('SIM-') };
  },
  verifyWebhook() { return true; }
};
