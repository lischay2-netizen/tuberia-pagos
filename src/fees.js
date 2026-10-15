// Comisión de tarjeta (ESTIMADA hasta que Banco General confirme). Global por env, o por proyecto (card_fee_pct, card_fee_fixed).
const DEFAULT_PCT = Number(process.env.CARD_FEE_PCT ?? 3.75), DEFAULT_FIXED = Number(process.env.CARD_FEE_FIXED ?? 0.50);
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
function cardFee(project) {
  const pct = project?.card_fee_pct ?? DEFAULT_PCT, fixed = project?.card_fee_fixed ?? DEFAULT_FIXED;
  return { pct: Number(pct), fixed: Number(fixed), estimate: process.env.CARD_FEE_CONFIRMED !== '1' && project?.card_fee_confirmed !== true };
}
// Precio con Yappy = precio con tarjeta − comisión de tarjeta (redondeado a centavos, nunca < 0)
function yappyPrice(cardPrice, project) {
  const f = cardFee(project); const fee = round2(cardPrice * f.pct / 100 + f.fixed);
  const price = Math.max(0, round2(cardPrice - fee));
  return { price, savings: round2(cardPrice - price), fee: f };
}
// Yappy solo para cobros únicos: el Botón de Pago Yappy no documenta cobros recurrentes
const yappyAllowed = project => project.type !== 'subscription' && project.yappy_enabled !== false;
module.exports = { cardFee, yappyPrice, yappyAllowed, round2 };
