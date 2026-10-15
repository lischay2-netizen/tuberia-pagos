// YAPPY SIMULADO (simulación). Flujo: el cliente pone su número Yappy → se crea la orden "pendiente" →
// el cliente "aprueba" en su app (aquí, un botón de simulación) → pago aprobado. No mueve dinero real.
// Número terminado en 0000 = la orden se rechaza.
const crypto = require('crypto');
const orders = new Map();
module.exports = {
  name: 'yappy-mock',
  async createOrder({ amount, phone, project }) {
    const id = 'YAP-SIM-' + crypto.randomBytes(5).toString('hex').toUpperCase();
    const o = { id, amount, phone, project_id: project.id, status: 'pending', secret: crypto.randomBytes(16).toString('hex'), created_at: Date.now() };
    orders.set(id, o); return o;
  },
  getOrder: id => orders.get(id),
  async resolve(id, approve) {
    const o = orders.get(id); if (!o || o.status !== 'pending') return null;
    o.status = approve && !String(o.phone).endsWith('0000') ? 'approved' : 'declined';
    return { status: o.status, transactionId: o.status === 'approved' ? id : null, brand: 'Yappy', last4: String(o.phone).slice(-4), reason: o.status === 'declined' ? 'Pago rechazado o cancelado en Yappy (simulación)' : null };
  }
};
