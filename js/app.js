import * as G from './game.js';
import * as S from './storage.js';

const $ = (id) => document.getElementById(id);
const board = $('board');

// \uFE0E force le rendu texte (sinon iOS affiche ♥ ♦ en emoji)
const SUIT_CHAR = { S: '♠\uFE0E', H: '♥\uFE0E', D: '♦\uFE0E', C: '♣\uFE0E' };
const SUIT_NAME = { S: 'pique', H: 'cœur', D: 'carreau', C: 'trèfle' };
const RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const DRAG_THRESHOLD = 6;

// Doit correspondre EXACTEMENT à la media query de rotation dans style.css
const ROTATED_MQ = matchMedia('(orientation: portrait) and (pointer: coarse)');
const COARSE = matchMedia('(pointer: coarse)').matches;

const settings = S.load('settings', { drawCount: 1, bigIndex: COARSE, fourColor: false });
const stats = S.load('stats', { played: 0, won: 0, bestTime: null, bestScore: 0, streak: 0, bestStreak: 0 });

let state;
let L; // layout
let pos = {};      // id -> {x, y, z}
let locs = {};     // id -> {type, index, cardIndex}
let cardById = {};
let drag = null;
let autoTimer = null;
const cardEls = new Map();
const slotEls = {};

/* ---------- Création du DOM (une seule fois) ---------- */

function createSlots() {
  const make = (type, index, label) => {
    const el = document.createElement('div');
    el.className = `slot slot-${type}`;
    el.dataset.type = type;
    el.dataset.index = index;
    if (label) el.dataset.label = label;
    board.append(el);
    slotEls[`${type}${index}`] = el;
  };
  make('stock', 0);
  make('waste', 0);
  for (let i = 0; i < 4; i++) make('foundation', i, 'A');
  for (let i = 0; i < 7; i++) make('tableau', i, 'R');
}

function createCards() {
  for (const suit of G.SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      const id = suit + rank;
      const r = RANK[rank], s = SUIT_CHAR[suit];
      const center = rank > 10 ? `<span class="court">${r}</span>` : `<span class="pip">${s}</span>`;
      const el = document.createElement('div');
      el.className = `card suit-${suit} ${G.isRed(suit) ? 'red' : 'black'}`;
      el.dataset.id = id;
      el.innerHTML =
        `<div class="inner"><div class="face front"><span class="idx"><b>${r}</b><i>${s}</i></span>${center}</div>` +
        `<div class="face back"></div></div>`;
      board.append(el);
      cardEls.set(id, el);
    }
  }
}

/* ---------- Layout ----------
 * "top"  : disposition classique (talon + fondations au-dessus du tableau) — ordinateur.
 * "side" : paysage court (téléphone/tablette) — fondations à gauche, talon à droite.
 *          Le tableau récupère toute la hauteur → cartes nettement plus grandes et lisibles.
 */
function computeLayout() {
  const W = board.clientWidth, H = board.clientHeight;
  const big = settings.bigIndex;
  const side = W / H > 1.45 && (H < 600 || COARSE);

  if (side) {
    const gap = Math.min(14, Math.max(4, W * 0.011));
    const stripK = big ? 0.38 : 0.3;            // part visible d'une carte recouverte
    let cw = (W - gap * 10) / 9;                  // 1 col fondations + 7 tableau + 1 talon
    cw = Math.floor(Math.min(cw, 150, (H - gap * 3) / (2 + 2 * stripK) / 1.4));
    const ch = Math.round(cw * 1.4);
    const x0 = (W - (cw * 9 + gap * 8)) / 2;
    const colX = Array.from({ length: 9 }, (_, i) => x0 + i * (cw + gap));
    const topY = gap;
    const fStep = Math.min(ch + gap, (H - gap * 2 - ch) / 3);
    return {
      side: true, W, H, gap, cw, ch, bottom: H - gap,
      stock: { x: colX[8], y: topY },
      waste: { x: colX[8], y: topY + ch + gap },
      fan: { dx: 0, dy: ch * stripK },
      found: [0, 1, 2, 3].map((f) => ({ x: colX[0], y: topY + f * fStep })),
      tab: Array.from({ length: 7 }, (_, t) => ({ x: colX[1 + t], y: topY })),
    };
  }

  const gap = Math.min(18, Math.max(4, W * 0.016));
  let cw = (W - gap * 8) / 7;
  cw = Math.floor(Math.min(cw, 124, (H - gap * 3) / 3.6 / 1.4));
  const ch = Math.round(cw * 1.4);
  const x0 = (W - (cw * 7 + gap * 6)) / 2;
  const colX = Array.from({ length: 7 }, (_, i) => x0 + i * (cw + gap));
  const topY = gap, tabY = topY + ch + gap * 1.5;
  return {
    side: false, W, H, gap, cw, ch, bottom: H - gap,
    stock: { x: colX[0], y: topY },
    waste: { x: colX[1], y: topY },
    fan: { dx: cw * 0.3, dy: 0 },
    found: [0, 1, 2, 3].map((f) => ({ x: colX[3 + f], y: topY })),
    tab: colX.map((x) => ({ x, y: tabY })),
  };
}

function relayout() {
  L = computeLayout();
  board.style.setProperty('--cw', `${L.cw}px`);
  board.style.setProperty('--ch', `${L.ch}px`);
  board.classList.toggle('side', L.side);
  render();
}

function applyDisplaySettings() {
  document.body.classList.toggle('big', settings.bigIndex);
  document.body.classList.toggle('four-color', settings.fourColor);
}

/* ---------- Rendu ---------- */

function columnOffsets(col, startY) {
  const big = settings.bigIndex;
  let dOff = L.ch * 0.12, uOff = L.ch * (big ? 0.38 : 0.28);
  const rest = col.slice(0, -1);
  const nD = rest.filter((c) => !c.up).length, nU = rest.length - nD;
  const avail = L.bottom - startY - L.ch;
  // Compression : on tasse d'abord les cartes retournées, puis seulement les visibles
  if (nD * dOff + nU * uOff > avail) {
    dOff = Math.max(L.ch * 0.05, Math.min(dOff, (avail - nU * uOff) / Math.max(nD, 1)));
    if (nU && nD * dOff + nU * uOff > avail) uOff = Math.max(0, (avail - nD * dOff) / nU);
  }
  return { dOff, uOff };
}

function render({ stagger = false } = {}) {
  pos = {}; locs = {}; cardById = {};
  let z = 1;
  const place = (card, x, y, loc) => {
    pos[card.id] = { x, y, z: z++ };
    locs[card.id] = loc;
    cardById[card.id] = card;
  };

  state.stock.forEach((c, i) => place(c, L.stock.x, L.stock.y, { type: 'stock', index: 0, cardIndex: i }));

  const fanStart = state.drawCount === 3 ? Math.max(0, state.waste.length - 3) : state.waste.length;
  state.waste.forEach((c, i) => {
    const k = Math.max(0, i - fanStart);
    place(c, L.waste.x + k * L.fan.dx, L.waste.y + k * L.fan.dy, { type: 'waste', index: 0, cardIndex: i });
  });

  state.foundations.forEach((pile, f) =>
    pile.forEach((c, i) => place(c, L.found[f].x, L.found[f].y, { type: 'foundation', index: f, cardIndex: i })));

  state.tableau.forEach((col, t) => {
    const { dOff, uOff } = columnOffsets(col, L.tab[t].y);
    let y = L.tab[t].y;
    col.forEach((c, i) => {
      place(c, L.tab[t].x, y, { type: 'tableau', index: t, cardIndex: i });
      y += c.up ? uOff : dOff;
    });
  });

  // Cartes cachées sous une autre au même endroit : pas d'ombre (sinon halo sombre cumulé)
  const isBuried = ({ type, index, cardIndex }) => {
    if (type === 'stock') return cardIndex < state.stock.length - 1;
    if (type === 'foundation') return cardIndex < state.foundations[index].length - 1;
    if (type === 'waste') return cardIndex < Math.min(fanStart, state.waste.length - 1);
    return false;
  };
  // Fondations empilées en mode "side" : la fondation du bas doit passer au-dessus
  const zFound = (f) => (L.side ? f * 60 : 0);
  for (const [id, el] of cardEls) {
    const p = pos[id], loc = locs[id], c = cardById[id];
    const zz = loc.type === 'foundation' ? p.z + zFound(loc.index) + 100 : p.z;
    el.style.transitionDelay = stagger && loc.type === 'tableau' ? `${p.z * 14}ms` : '';
    el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    el.style.zIndex = zz;
    el.classList.toggle('up', c.up);
    el.classList.toggle('buried', isBuried(loc));
    el.setAttribute('aria-label', c.up ? `${RANK[c.rank]} de ${SUIT_NAME[c.suit]}` : 'Carte retournée');
  }
  if (stagger) setTimeout(() => cardEls.forEach((el) => (el.style.transitionDelay = '')), 1400);

  const setSlot = (key, p, zz = 0) => {
    slotEls[key].style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    slotEls[key].style.zIndex = zz;
  };
  setSlot('stock0', L.stock);
  setSlot('waste0', L.waste);
  for (let f = 0; f < 4; f++) setSlot(`foundation${f}`, L.found[f], 100 + zFound(f));
  for (let t = 0; t < 7; t++) setSlot(`tableau${t}`, L.tab[t]);
  slotEls.stock0.classList.toggle('recycle', !state.stock.length && state.waste.length > 0);

  renderHud();
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function renderHud() {
  $('time').textContent = fmtTime(state.elapsed);
  $('moves').textContent = state.moves;
  $('score').textContent = state.score;
  $('btn-undo').disabled = !state.history.length || !!autoTimer || state.won;
}

/* ---------- Boîte de confirmation (remplace confirm() natif, non pivotable) ---------- */

function ask(message, okLabel = 'Confirmer') {
  const dlg = $('dlg-confirm');
  $('confirm-msg').textContent = message;
  $('confirm-ok').textContent = okLabel;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) =>
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

/* ---------- Actions ---------- */

const persist = () => S.save('game', state);

function afterAction() {
  if (!state.started) {
    state.started = true;
    stats.played++;
    S.save('stats', stats);
  }
  render();
  persist();
  if (state.won) return onWin();
  if (G.canAutoComplete(state)) runAutoComplete();
}

function doDraw() {
  if (G.draw(state)) afterAction();
}

function doMove(from, to) {
  if (!G.move(state, from, to)) return false;
  afterAction();
  return true;
}

function doUndo() {
  if (autoTimer || state.won || !G.undo(state)) return;
  render();
  persist();
}

async function newGame() {
  if (state?.started && !state.won) {
    if (!(await ask('Abandonner la partie en cours ?', 'Abandonner'))) return;
    stats.streak = 0;
    S.save('stats', stats);
  }
  stopAutoComplete();
  board.classList.remove('won');
  state = G.newGame(settings.drawCount);
  for (const el of cardEls.values()) {
    el.classList.remove('up');
    el.style.transitionDelay = '';
  }
  render({ stagger: true });
  persist();
}

function runAutoComplete() {
  if (autoTimer) return;
  autoTimer = setInterval(() => {
    if (!G.autoStep(state)) return stopAutoComplete();
    render();
    if (state.won) { stopAutoComplete(); persist(); onWin(); }
  }, 110);
  renderHud();
}

function stopAutoComplete() {
  clearInterval(autoTimer);
  autoTimer = null;
  if (state) { persist(); renderHud(); }
}

function onWin() {
  stats.won++;
  stats.streak++;
  stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  stats.bestScore = Math.max(stats.bestScore, state.score);
  if (stats.bestTime === null || state.elapsed < stats.bestTime) stats.bestTime = state.elapsed;
  S.save('stats', stats);
  board.classList.add('won');
  $('win-time').textContent = fmtTime(state.elapsed);
  $('win-moves').textContent = state.moves;
  $('win-score').textContent = state.score;
  setTimeout(() => $('dlg-win').showModal(), 700);
}

/* ---------- Orientation paysage ----------
 * 1. Android (Chrome) : plein écran + screen.orientation.lock('landscape').
 * 2. iPhone : lock() impossible (exige le plein écran, absent sur iPhone) →
 *    rotation CSS de toute l'interface (voir style.css), quel que soit le verrou de rotation du téléphone.
 */
let lockTried = false;
function tryLockLandscape() {
  if (lockTried || !COARSE) return;
  lockTried = true;
  const el = document.documentElement;
  if (!el.requestFullscreen || !screen.orientation?.lock) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation.lock('landscape'))
    .catch(() => {}); // échec silencieux → la rotation CSS prend le relais
}

/** Convertit un déplacement écran en déplacement dans le repère (éventuellement pivoté) du plateau. */
function toBoardDelta(dx, dy) {
  return ROTATED_MQ.matches ? { dx: dy, dy: -dx } : { dx, dy };
}

/* ---------- Pointer Events (souris + tactile unifiés) ---------- */

function onPointerDown(e) {
  if (drag || autoTimer || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const cardEl = e.target.closest('.card');
  const slotEl = e.target.closest('.slot');
  const loc = cardEl ? locs[cardEl.dataset.id] : null;

  if (loc?.type === 'stock' || (!cardEl && slotEl?.dataset.type === 'stock')) {
    doDraw();
    return;
  }
  if (!loc || !G.canPick(state, loc)) return;

  const ids = G.pileOf(state, loc.type, loc.index).slice(loc.cardIndex).map((c) => c.id);
  drag = { loc, ids, x0: e.clientX, y0: e.clientY, moved: false, pointerId: e.pointerId };
  board.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const { dx, dy } = toBoardDelta(e.clientX - drag.x0, e.clientY - drag.y0);
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
  }
  drag.ids.forEach((id, i) => {
    const el = cardEls.get(id), p = pos[id];
    el.classList.add('dragging');
    el.style.zIndex = 1000 + i;
    el.style.transform = `translate3d(${p.x + dx}px, ${p.y + dy}px, 0)`;
  });
}

function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  d.ids.forEach((id) => cardEls.get(id).classList.remove('dragging'));

  if (e.type === 'pointercancel') return render();

  if (!d.moved) {
    const to = G.findTarget(state, d.loc);
    if (!to || !doMove(d.loc, to)) shake(d.ids);
    return;
  }
  const { dx, dy } = toBoardDelta(e.clientX - d.x0, e.clientY - d.y0);
  const to = findDropTarget(d, dx, dy);
  if (!to || !doMove(d.loc, to)) render();
}

const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

function findDropTarget(d, dx, dy) {
  const p = pos[d.ids[0]];
  const r = { x: p.x + dx, y: p.y + dy, w: L.cw, h: L.ch };
  const cards = d.ids.map((id) => cardById[id]);
  let best = null, bestArea = 0;

  const test = (to, rect) => {
    if (to.type === d.loc.type && to.index === d.loc.index) return;
    const a = overlap(r, rect);
    if (a > bestArea && G.canDrop(state, cards, to)) { best = to; bestArea = a; }
  };
  L.found.forEach((f, i) => test({ type: 'foundation', index: i }, { x: f.x, y: f.y, w: L.cw, h: L.ch }));
  state.tableau.forEach((col, t) => {
    const start = L.tab[t];
    const lastY = col.length ? pos[col[col.length - 1].id].y : start.y;
    test({ type: 'tableau', index: t }, { x: start.x, y: start.y, w: L.cw, h: lastY - start.y + L.ch });
  });
  return best;
}

function shake(ids) {
  const el = cardEls.get(ids[0]);
  el.classList.remove('nope');
  void el.offsetWidth; // relance l'animation
  el.classList.add('nope');
}

/* ---------- UI : menus, clavier, timer ---------- */

function renderStats() {
  const rate = stats.played ? Math.min(100, Math.round((stats.won / stats.played) * 100)) : 0;
  $('st-played').textContent = stats.played;
  $('st-won').textContent = `${stats.won} (${rate} %)`;
  $('st-time').textContent = stats.bestTime === null ? '—' : fmtTime(stats.bestTime);
  $('st-score').textContent = stats.bestScore;
  $('st-streak').textContent = `${stats.streak} (record ${stats.bestStreak})`;
}

function bindUI() {
  board.addEventListener('pointerdown', onPointerDown);
  board.addEventListener('pointermove', onPointerMove);
  board.addEventListener('pointerup', onPointerUp);
  board.addEventListener('pointercancel', onPointerUp);
  board.addEventListener('contextmenu', (e) => e.preventDefault());
  // pointerup (et non pointerdown) : seul événement tactile qui donne l'« activation utilisateur » requise par le plein écran
  document.addEventListener('pointerup', tryLockLandscape, true);

  $('btn-undo').addEventListener('click', doUndo);
  $('btn-new').addEventListener('click', newGame);
  $('btn-menu').addEventListener('click', () => {
    renderStats();
    document.querySelector(`input[name="draw"][value="${settings.drawCount}"]`).checked = true;
    $('opt-big').checked = settings.bigIndex;
    $('opt-four').checked = settings.fourColor;
    $('dlg-menu').showModal();
  });
  document.querySelectorAll('input[name="draw"]').forEach((input) =>
    input.addEventListener('change', () => {
      settings.drawCount = Number(input.value);
      S.save('settings', settings);
    }));
  $('opt-big').addEventListener('change', (e) => {
    settings.bigIndex = e.target.checked;
    S.save('settings', settings);
    applyDisplaySettings();
    relayout();
  });
  $('opt-four').addEventListener('change', (e) => {
    settings.fourColor = e.target.checked;
    S.save('settings', settings);
    applyDisplaySettings();
  });
  $('btn-reset-stats').addEventListener('click', async () => {
    if (!(await ask('Effacer toutes les statistiques ?', 'Effacer'))) return;
    Object.assign(stats, { played: 0, won: 0, bestTime: null, bestScore: 0, streak: 0, bestStreak: 0 });
    S.save('stats', stats);
    renderStats();
  });
  $('btn-replay').addEventListener('click', () => {
    $('dlg-win').close();
    newGame();
  });
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog').close()));

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
  });

  // Timer : ne tourne que si la partie est commencée et l'onglet visible
  setInterval(() => {
    if (!state.started || state.won || document.hidden) return;
    state.elapsed++;
    $('time').textContent = fmtTime(state.elapsed);
    if (state.elapsed % 5 === 0) persist();
  }, 1000);
  document.addEventListener('visibilitychange', () => document.hidden && persist());
  window.addEventListener('pagehide', persist);

  new ResizeObserver(relayout).observe(board);
}

function init() {
  applyDisplaySettings();
  createSlots();
  createCards();
  const saved = S.load('game', null);
  state = G.isValid(saved) && !saved.won ? saved : G.newGame(settings.drawCount);

  board.classList.add('no-anim');
  bindUI();
  relayout();
  requestAnimationFrame(() => requestAnimationFrame(() => board.classList.remove('no-anim')));

  if (G.canAutoComplete(state)) runAutoComplete();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
