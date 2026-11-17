/**
 * Frases de abertura sorteadas a cada post. Não citam preço nem link.
 * Não repete uma frase enquanto ainda houver outras fora das últimas `window` usadas.
 */
export const OPENERS = [
  '🔥 OFERTA IMPERDÍVEL!',
  '🚨 Achado do dia 🚨',
  '💥 Preço caiu, corre!',
  '⚡ Oferta relâmpago',
  '✅ Vale a pena conferir',
  '👀 Olha que achado',
  '🛒 Garante antes que acabe',
  '📉 Menor preço do momento',
  '🎯 Essa aqui não pode passar',
  '💰 Bolso agradece!',
  '🤩 Achadinho top',
  '🏃 Corre que é por tempo limitado',
  '🔎 Garimpei pra você',
  '🎁 Presente que é só alegria',
  '💣 Bomba de desconto',
  '🙌 Essa você precisa ver',
  '📦 Chegou a oferta que você esperava',
  '🧲 Não deixa escapar',
  '⏰ Só hoje, aproveita!',
  '🥇 Top das ofertas de hoje',
  '💎 Joia escondida no site',
  '🔥🔥 Sensacional, olha só',
  '👇 Confere essa oferta',
  '🛍️ Vale cada centavo',
  '📢 Atenção, oferta boa!',
  '🤑 Descontão chegou',
  '✨ Ofertinha do dia',
  '🧡 Pra quem gosta de economizar',
  '💸 Quer economizar? Olha aqui',
  '🏷️ Etiqueta nova, preço novo',
  '🚀 Decolou o desconto',
  '🎉 Boa notícia pra você',
  '📣 Pra quem estava esperando',
  '🫶 Não é sempre que aparece',
  '🕵️ Achei pra você',
  '🔔 Alerta de oferta!',
  '💡 Ideia de compra inteligente',
  '🧠 Compra inteligente do dia',
  '🌟 Destaque de hoje',
  '⭐ Recomendo demais',
  '🏆 Oferta campeã',
  '🎈 Oferta leve no bolso',
  '🛎️ Chamando quem gosta de desconto',
  '🤝 Bora aproveitar',
  '👊 Desconto que vale',
  '🍀 Sorte sua, achamos isso',
  '🪙 Preço de amigo',
  '🧾 Olha o preço que tá',
  '🔝 Entre as melhores do momento',
  '📌 Guardando essa pra você',
  '🥳 Festa de desconto',
  '🤯 Não acredito nesse preço',
  '😍 Esse preço é de apaixonar',
  '🏁 Largada da oferta',
  '🎊 Oferta que merece aplauso',
  '🧨 Explodiu o desconto',
  '🛒 Carrinho pedindo essa',
  '💬 Olha o que encontrei',
  '🙈 Não vai perder essa, né?',
  '🌈 Oferta colorida do dia',
];

export class OpenerPicker {
  constructor({ openers = OPENERS, window = 20, rng = Math.random } = {}) {
    this.openers = openers;
    this.window = window;
    this.rng = rng;
    this.recent = [];
  }

  pick() {
    const fresh = this.openers.filter((o) => !this.recent.includes(o));
    const pool = fresh.length ? fresh : this.openers;
    const choice = pool[Math.floor(this.rng() * pool.length)];
    this.recent.push(choice);
    if (this.recent.length > this.window) this.recent.shift();
    return choice;
  }
}

const shared = new OpenerPicker();
export const pickOpener = () => shared.pick();
