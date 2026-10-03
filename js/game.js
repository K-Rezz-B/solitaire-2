// Logique pure du Klondike : aucune dépendance au DOM (testable sous Node).

export const SUITS = ['S', 'H', 'D', 'C'];
export const isRed = (suit) => suit === 'H' || suit === 'D';

const HISTORY_LIMIT = 150;
const top = (pile) => pile[pile.length - 1];

function shuffle(arr) {
  const rnd = new Uint32Array(arr.length);
  crypto.getRandomValues(rnd);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function newGame(drawCount = 1) {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) deck.push({ id: suit + rank, suit, rank, up: false });
  }
  shuffle(deck);

  const tableau = Array.from({ length: 7 }, () => []);
  for (let row = 0; row < 7; row++) {
    for (let col = row; col < 7; col++) tableau[col].push(deck.pop());
  }
  tableau.forEach((col) => (top(col).up = true));

  return {
    stock: deck,
    waste: [],
    foundations: [[], [], [], []],
    tableau,
    drawCount,
    moves: 0,
    score: 0,
    elapsed: 0,
    started: false,
    won: false,
    history: [],
  };
}

export function isValid(s) {
  if (!s || !Array.isArray(s.tableau) || s.tableau.length !== 7) return false;
  if (!Array.isArray(s.foundations) || s.foundations.length !== 4) return false;
  if (![1, 3].includes(s.drawCount) || !Array.isArray(s.history)) return false;
  const total = s.stock.length + s.waste.length +
    s.foundations.reduce((n, p) => n + p.length, 0) +
    s.tableau.reduce((n, p) => n + p.length, 0);
  return total === 52;
}

export function pileOf(s, type, index) {
  switch (type) {
    case 'stock': return s.stock;
    case 'waste': return s.waste;
    case 'foundation': return s.foundations[index];
    case 'tableau': return s.tableau[index];
    default: return null;
  }
}

function isSequence(cards) {
  for (let i = 1; i < cards.length; i++) {
    const a = cards[i - 1], b = cards[i];
    if (!b.up || isRed(a.suit) === isRed(b.suit) || a.rank !== b.rank + 1) return false;
  }
  return true;
}

/** Peut-on saisir la carte (et celles posées dessus) à cet emplacement ? */
export function canPick(s, loc) {
  const pile = pileOf(s, loc.type, loc.index);
  const card = pile?.[loc.cardIndex];
  if (!card || !card.up) return false;
  if (loc.type === 'tableau') return isSequence(pile.slice(loc.cardIndex));
  if (loc.type === 'waste' || loc.type === 'foundation') return loc.cardIndex === pile.length - 1;
  return false;
}

export function canDrop(s, cards, to) {
  const t = top(pileOf(s, to.type, to.index));
  const c = cards[0];
  if (to.type === 'foundation') {
    if (cards.length !== 1) return false;
    return t ? t.suit === c.suit && c.rank === t.rank + 1 : c.rank === 1;
  }
  if (to.type === 'tableau') {
    return t ? t.up && isRed(t.suit) !== isRed(c.suit) && c.rank === t.rank - 1 : c.rank === 13;
  }
  return false;
}

function snapshot(s) {
  const { stock, waste, foundations, tableau, moves, score } = s;
  return JSON.stringify({ stock, waste, foundations, tableau, moves, score });
}

function pushHistory(s) {
  s.history.push(snapshot(s));
  if (s.history.length > HISTORY_LIMIT) s.history.shift();
}

const addScore = (s, n) => { s.score = Math.max(0, s.score + n); };
export const isWon = (s) => s.foundations.every((p) => p.length === 13);

export function undo(s) {
  const snap = s.history.pop();
  if (!snap) return false;
  Object.assign(s, JSON.parse(snap));
  s.won = false;
  return true;
}

// Barème « standard » Windows : https://en.wikipedia.org/wiki/Klondike_(solitaire)#Scoring
export function move(s, from, to) {
  if (from.type === to.type && from.index === to.index) return false;
  if (from.type === 'foundation' && to.type === 'foundation') return false;
  if (!canPick(s, from)) return false;

  const src = pileOf(s, from.type, from.index);
  const cards = src.slice(from.cardIndex);
  if (!canDrop(s, cards, to)) return false;

  pushHistory(s);
  src.splice(from.cardIndex);
  pileOf(s, to.type, to.index).push(...cards);

  if (to.type === 'foundation') addScore(s, 10);
  else if (from.type === 'waste') addScore(s, 5);
  else if (from.type === 'foundation') addScore(s, -15);

  if (from.type === 'tableau') {
    const t = top(src);
    if (t && !t.up) { t.up = true; addScore(s, 5); }
  }
  s.moves++;
  s.won = isWon(s);
  return true;
}

export function draw(s) {
  if (!s.stock.length && !s.waste.length) return false;
  pushHistory(s);
  if (!s.stock.length) {
    s.stock = s.waste.reverse().map((c) => ({ ...c, up: false }));
    s.waste = [];
    addScore(s, s.drawCount === 1 ? -100 : -20);
  } else {
    const n = Math.min(s.drawCount, s.stock.length);
    for (let i = 0; i < n; i++) {
      const c = s.stock.pop();
      c.up = true;
      s.waste.push(c);
    }
  }
  s.moves++;
  return true;
}

/** Meilleure destination pour un tap/clic : fondation, puis tableau non vide, puis colonne vide. */
export function findTarget(s, from) {
  if (!canPick(s, from)) return null;
  const cards = pileOf(s, from.type, from.index).slice(from.cardIndex);

  if (cards.length === 1 && from.type !== 'foundation') {
    for (let i = 0; i < 4; i++) {
      const to = { type: 'foundation', index: i };
      if (canDrop(s, cards, to)) return to;
    }
  }
  let empty = null;
  for (let i = 0; i < 7; i++) {
    if (from.type === 'tableau' && from.index === i) continue;
    const to = { type: 'tableau', index: i };
    if (!canDrop(s, cards, to)) continue;
    if (s.tableau[i].length) return to;
    empty ??= to;
  }
  // Inutile de déplacer un roi déjà en bas d'une colonne vers une autre colonne vide
  if (empty && !(from.type === 'tableau' && from.cardIndex === 0)) return empty;
  return null;
}

export const canAutoComplete = (s) =>
  !s.won && !s.stock.length && !s.waste.length && s.tableau.every((col) => col.every((c) => c.up));

/** Envoie la plus petite carte jouable sur une fondation. */
export function autoStep(s) {
  let best = null;
  s.tableau.forEach((col, i) => {
    const c = top(col);
    if (!c || (best && c.rank >= best.rank)) return;
    for (let f = 0; f < 4; f++) {
      const to = { type: 'foundation', index: f };
      if (canDrop(s, [c], to)) {
        best = { rank: c.rank, from: { type: 'tableau', index: i, cardIndex: col.length - 1 }, to };
        break;
      }
    }
  });
  return best ? move(s, best.from, best.to) : false;
}
