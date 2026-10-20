// HUD and panels: Coins, the place you're in and what to do next along the top (with the next gift
// and the boosts running), the Shop / Be the Head buttons and the reference's quick boosts (Guide,
// No Damage, Jump Higher) on the left, the menu icons top right (the top left stays free for the
// Bloxity overlay), the hotbar, the red "RUN!" edges when a head is after you, the stage intro
// splash, the "Haha!", the ESCAPED! card, "Keep going?" and every panel.
import { $, V3, floatText } from './engine.js';
import { S, actions, net } from './state.js';
import { sfx, setMusicDuck, getVolumes, setVolume } from './audio.js';
import * as BX from './bloxity.js';
import { getQuality, setQuality } from './fx.js';
import {
    CFG, STAGES, BOSS, BOSS_UNLOCK, DIFFS, TRAILS, GEAR, gearById, HATS, hatById, PASSES, PRODUCTS, priceOf, passForTool, passForHat,
    GIFTS, DAILY, dailyStatus, rewardText, fmt, fmtComma, clock, playtimeText, stageOpen, clearedCount, limitedFree, coinMult,
} from '../../shared/config.js';

const C = (n) => '<span class="cup"></span>' + fmt(n);
function setHtml(node, html) { if (node && node.innerHTML !== html) node.innerHTML = html; }
function setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const promptEl = $('#promptBtn'), promptTxtEl = $('#promptTxt');
// Every button clicks
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) sfx(b.classList.contains('g-green') ? 'clickBuy' : 'click'); }, true);
const toolIcon = (id) => (id.startsWith('hat:') ? hatById[id.slice(4)].ic : id === 'morph' ? '😡' : gearById[id] ? gearById[id].ic : '❔');

// ----- Coins counter (counts up smoothly) -----
let shownCoins = 0, shownText = -1;
export function animateCounters(dt) {
    if (Math.abs(shownCoins - S.coins) < 0.5) shownCoins = S.coins;
    else shownCoins += (S.coins - shownCoins) * Math.min(1, dt * 8);
    const n = Math.round(shownCoins);
    if (n !== shownText) { shownText = n; setText($('#coinVal'), fmtComma(n)); }
}
export function bumpCoins() { const p = $('#coinBar'); p.classList.remove('bump'); requestAnimationFrame(() => p.classList.add('bump')); }

// ----- HUD refresh (10x a second) -----
const sessionSecs = () => (S.sessionSecs || 0) + (Date.now() - S.profileAt) / 1000;
export function updateHud(area) {
    const now = net.now();
    const secs = sessionSecs();
    const next = GIFTS.findIndex((g, k) => !S.giftClaimed[k]);
    const ready = GIFTS.some((g, k) => !S.giftClaimed[k] && secs >= g.min * 60);
    $('#giftBadge').hidden = !ready;
    const chip = $('#giftChip');
    chip.classList.toggle('ready', ready);
    setText(chip, ready ? '🎁 CLAIM YOUR GIFT!' : next < 0 ? '🎁 All gifts claimed' : '🎁 Gift in ' + clock(GIFTS[next].min * 60 - secs));
    $('#dailyBadge').hidden = !dailyStatus(S.daily, now).can;
    const m = coinMult(S, now, S.friends);
    $('#boostTag').hidden = m < 1.05;
    setText($('#boostTag'), 'x' + (Math.round(m * 100) / 100));
    setText($('#friendBoost'), 'Friend Boost: ' + Math.round(Math.min(CFG.friendMax, S.friends || 0) * CFG.friendBoost * 100) + '%');
    const s = area >= 0 ? STAGES[area] : null;
    const lb = $('#btnLobby');
    if (lb.hidden !== area < 0) lb.hidden = area < 0;
    setText($('#placePill'), s ? (area === BOSS ? '👑 BOSS: The Throne' : s.ic + ' Stage ' + (area + 1) + ' · ' + s.name) : '🏠 Lobby');
    const mb = $('#btnMorph');
    mb.classList.toggle('on', !!S.morph);
    setHtml(mb, '<span class="sheen"></span>' + (S.morph ? 'Be Yourself' : 'Be the Head') + '<span class="ico" aria-hidden="true">' + (S.morph ? '🙂' : '😡') + '</span>');
}
let guideKey = '';
export function setGuideLine(text) { if (text === guideKey) return; guideKey = text; setText($('#guideLine'), text); }
// The boosts running out under the Coins (only touched when a number changes)
let chipKey = '';
export function setStatusChips(t) {
    const now = Date.now();
    const sec = (u) => Math.max(0, Math.ceil((u - now) / 1000));
    const key = [sec(t.jump), sec(t.shield), sec(t.guide), sec(t.invis), t.fuel < 0 ? -1 : Math.round(t.fuel * 20)].join(',');
    if (key === chipKey) return;
    chipKey = key;
    for (const [id, u, ic] of [['#chipJump', t.jump, '🦘'], ['#chipShield', t.shield, '🛡️'], ['#chipGuide', t.guide, '🧭'], ['#chipInvis', t.invis, '👻']]) {
        const s = sec(u);
        $(id).hidden = s <= 0;
        if (s > 0) setText($(id), ic + ' ' + clock(s));
    }
    $('#fuelChip').hidden = t.fuel < 0;
    if (t.fuel >= 0) $('#fuelChip i').style.width = Math.round(t.fuel * 100) + '%';
    for (const [id, active] of [['#qJump', t.jump > now], ['#qShield', t.shield > now], ['#qGuide', t.guide > now]]) $(id).classList.toggle('active', active);
}

// ----- being chased: red edges, an arrow toward the head, "RUN!" -----
let chaseKey = '';
export function setChase(level, angle) {
    const k = Math.round(level * 20) / 20, a = Math.round(angle * 20) / 20;
    const key = k + '|' + a;
    if (key === chaseKey) return;
    chaseKey = key;
    $('#chase').style.opacity = (k * 0.95).toFixed(2);
    $('#runTxt').style.opacity = k > 0.55 ? Math.min(1, (k - 0.55) * 4).toFixed(2) : '0';
    const ar = $('#chaseArrow');
    ar.style.opacity = k > 0.1 ? Math.min(1, k * 2).toFixed(2) : '0';
    ar.style.transform = `rotate(${(-a + Math.PI).toFixed(3)}rad)`;
}

// ----- toasts, banners, cheers -----
export function toast(text, color) {
    const d = document.createElement('div');
    d.className = 'toast o';
    d.style.color = color || '#fff';
    d.textContent = text;
    const box = $('#toasts');
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.remove(), 2900);
}
const replay = (el, cls) => { el.classList.remove(cls); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add(cls))); };
let introTimer;
export function showStageIntro(i, k) {
    const s = STAGES[i];
    if (!s) return;
    setText($('#introN'), i === BOSS ? 'BOSS: The Throne' : 'Stage ' + (i + 1) + ': ' + s.name);
    const d = DIFFS[s.diff];
    setHtml($('#introS'), `<span class="diff" style="background:${d.color}">${d.label}</span> ${s.heads.length} angry heads${s.keys ? ' · 🔑 find ' + s.keys + ' key' + (s.keys > 1 ? 's' : '') : ''}${k ? ' · 🚩 checkpoint ' + k : ''} · ${C(s.coins)}`);
    const el = $('#intro');
    el.hidden = false; replay(el, 'go');
    clearTimeout(introTimer);
    introTimer = setTimeout(() => { el.hidden = true; }, 3600);
}
let hahaTimer;
export function showHaha() {
    const el = $('#haha');
    el.hidden = false; replay(el, 'go');
    const b = $('#blackout');
    clearTimeout(hahaTimer);
    hahaTimer = setTimeout(() => {
        el.hidden = true;
        b.style.transition = 'none'; b.style.opacity = 1;
        requestAnimationFrame(() => { b.style.transition = 'opacity 0.5s ease'; b.style.opacity = 0; });
    }, 1300);
}
const CHEERS = ['💪 Nice!', '😎 They can\'t catch you!', '🔥 Keep running!', '⭐ So close to the EXIT!', '🧠 Big brain!', '🏃 Unstoppable!'];
let cheerN = 0, cheerTimer;
export function cheer() {
    const el = $('#cheer');
    setText(el, CHEERS[cheerN++ % CHEERS.length]);
    el.hidden = false; replay(el, 'go');
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => { el.hidden = true; }, 2400);
}
export function flash(color, ms) {
    const f = $('#flash');
    f.style.transition = 'none'; f.style.background = color || '#fff'; f.style.opacity = 0.9;
    requestAnimationFrame(() => { f.style.transition = 'opacity ' + ((ms || 600) / 1000) + 's ease'; f.style.opacity = 0; });
}
export function teleportFx() { replay($('#tpFx'), 'go'); }
const COMIC = ['#ffe24a', '#ff6ad8', '#6affc8', '#ffffff'];
let comicN = 0;
export function comicPop(pos, text) { floatText(text, COMIC[comicN++ % COMIC.length], new V3(pos.x, pos.y + 7.5, pos.z), text.length > 6 ? 9 : 7, true); }
// The Sprint button's stamina ring
let sprintKey = '';
export function setSprintMeter(k, on, toggled) {
    const key = Math.round(k * 40) + '|' + (on || toggled);
    if (key === sprintKey) return;
    sprintKey = key;
    const b = $('#sprintBtn');
    b.style.setProperty('--p', k.toFixed(3));
    b.classList.toggle('on', !!(on || toggled));
}

// ----- ESCAPED! -----
let escTimer = null, escNext = -1;
export function showEscaped(m) {
    const s = STAGES[m.i];
    setText($('#escS'), m.i === BOSS ? '👑 You beat THE ANGRY QUEEN!' : s.ic + ' Stage ' + (m.i + 1) + ': ' + s.name);
    setHtml($('#escC'), '+' + C(m.n) + ' Coins');
    $('#escFirst').parentElement.hidden = !m.first;
    setText($('#escT'), '⏱️ ' + clock(m.secs) + (m.best === m.secs ? ' · NEW BEST!' : ' · best ' + clock(m.best)));
    // (the server sends the next stage only when this escape opened it: the profile with the
    // unlock arrives just after this message)
    escNext = m.i === BOSS ? -1 : m.next >= 0 ? m.next : m.bossOpen && (S.cleared || {})[BOSS] === undefined ? BOSS : -1;
    const nb = $('#escNext');
    nb.hidden = escNext < 0;
    $('#escaped').hidden = false;
    let left = 9;
    const label = () => setText(nb, (escNext === BOSS ? '👑 Fight the BOSS' : '▶ Stage ' + (escNext + 1)) + ' (' + left + ')');
    if (escNext >= 0) label();
    clearInterval(escTimer);
    escTimer = setInterval(() => {
        left--;
        if (escNext >= 0) label();
        if (left <= 0) { clearInterval(escTimer); if (escNext >= 0) actions.enterStage(escNext); else actions.teleportLobby(); }
    }, 1000);
    setMusicDuck(true);
}
export function hideEscaped() { if ($('#escaped').hidden) return; $('#escaped').hidden = true; clearInterval(escTimer); setMusicDuck(false); }
$('#escNext').addEventListener('click', () => { const n = escNext; hideEscaped(); if (n >= 0) actions.enterStage(n); });
$('#escLobby').addEventListener('click', () => { hideEscaped(); actions.teleportLobby(); });

// ----- "Keep going?" -----
let reviveTimer = null, reviveUntil = 0, reviveSecs = 8;
export function showRevive(price, secs) {
    reviveSecs = secs; reviveUntil = Date.now() + secs * 1000;
    setHtml($('#revivePrice'), '🪙 ' + fmt(price));
    const el = $('#revive');
    el.hidden = false;
    clearInterval(reviveTimer);
    reviveTimer = setInterval(() => {
        const k = Math.max(0, (reviveUntil - Date.now()) / (reviveSecs * 1000));
        $('#reviveFill').style.width = (k * 100) + '%';
        if (k <= 0) hideRevive();
    }, 100);
}
export function hideRevive() { $('#revive').hidden = true; clearInterval(reviveTimer); }
export const reviveOpen = () => !$('#revive').hidden;
$('#reviveBtn').addEventListener('click', () => actions.revive());
// ----- welcome back: continue from your checkpoint -----
let contTimer = null;
export function showContinue(i, k) {
    const s = STAGES[i];
    if (!s) return;
    setText($('#contTitle'), 'Welcome back!');
    setText($('#contText'), 'Carry on with ' + (i === BOSS ? 'the BOSS' : 'Stage ' + (i + 1) + ': ' + s.name) + (k ? ' from checkpoint ' + k : '') + '?');
    $('#continue').hidden = false;
    clearTimeout(contTimer);
    contTimer = setTimeout(hideContinue, 20000);
}
export function hideContinue() { $('#continue').hidden = true; clearTimeout(contTimer); }
$('#contGo').addEventListener('click', () => actions.continueRun());
$('#contNo').addEventListener('click', hideContinue);

// ----- a pad popup: buy or equip / wear -----
let gearPopId = null, gearPopTimer;
export function showToolPop(id) {
    hideContinue();   // (both sit at the bottom: the pad you're on wins)
    let name, desc, btn;
    if (id.startsWith('hat:')) { const h = hatById[id.slice(4)]; name = h.name; desc = h.desc; btn = S.hats[h.id] ? (S.hat === h.id ? 'Take off' : 'Wear') : C(h.price); }
    else if (id === 'morph') { name = PASSES.Morph.name; desc = PASSES.Morph.desc; btn = S.passes.Morph ? (S.morph ? 'Turn back' : 'Transform!') : C(PASSES.Morph.price); }
    else { const g = gearById[id]; if (!g) return; name = g.name; desc = g.desc; btn = S.gear[id] ? (S.tool === id ? 'Put away' : 'Equip') : C(g.price); }
    gearPopId = id;
    setHtml($('#gpIc'), toolIcon(id)); setText($('#gpName'), name); setText($('#gpDesc'), desc + '.');
    setHtml($('#gpBuy'), btn);
    $('#gearPop').hidden = false;
    clearTimeout(gearPopTimer);
    gearPopTimer = setTimeout(() => { $('#gearPop').hidden = true; }, 7000);
}
$('#gpBuy').addEventListener('click', () => {
    $('#gearPop').hidden = true;
    const id = gearPopId;
    if (!id) return;
    if (id.startsWith('hat:')) actions.hatPad(id.slice(4), true);
    else if (id === 'morph') actions.morphPad(true);
    else if (S.gear[id]) actions.equip(id);
    else actions.gearPad(id, true);
});
$('#gpClose').addEventListener('click', () => { $('#gearPop').hidden = true; });

// ----- hotbar (the tools you own), with a recharge sweep -----
let hotKey = '';
const cooldowns = {};
export const hotbarTools = () => GEAR.map((g) => g.id).filter((id) => S.gear[id]);
export function renderHotbar() {
    const owned = hotbarTools();
    const key = owned.join(',') + '|' + S.tool;
    if (key === hotKey) return;
    hotKey = key;
    const bar = $('#hotbar');
    bar.innerHTML = '';
    owned.forEach((id, i) => {
        const b = document.createElement('button');
        b.className = 'slot' + (S.tool === id ? ' on' : '');
        b.dataset.id = id;
        b.innerHTML = `<span class="n o1">${i + 1}</span>${gearById[id].ic}<span class="cd"></span>`;
        b.title = gearById[id].name + (i < 9 ? ' (' + (i + 1) + ')' : '');
        b.addEventListener('click', () => actions.equip(id));
        bar.appendChild(b);
    });
}
export function setToolCooldown(id, secs) { cooldowns[id] = { until: performance.now() + secs * 1000, secs }; }
setInterval(() => {
    const now = performance.now();
    for (const b of document.querySelectorAll('#hotbar .slot')) {
        const c = cooldowns[b.dataset.id], k = c && c.until > now ? (c.until - now) / (c.secs * 1000) : 0;
        const v = k.toFixed(2);
        const cd = b.querySelector('.cd');
        if (cd.dataset.v !== v) { cd.dataset.v = v; cd.style.setProperty('--c', v); }
    }
}, 100);

// =====================================================================================
// Purchases: everything costs Coins. A confirm shows the price; the server checks and takes it.
// =====================================================================================
let pendingBuy = null, pendingAct = null;
export function buy(kind, key) {
    const item = kind === 'pass' ? PASSES[key] : PRODUCTS[key];
    if (!item) return;
    if (kind === 'pass' && S.passes[key]) { toast(item.name + ' already owned!', '#6fe0ff'); if (item.tool) actions.equip(item.tool); return; }
    pendingBuy = { kind, key };
    const price = priceOf(kind, key);
    const short = price - (S.coins || 0);
    setHtml($('#confirmIc'), item.ic || '🛒');
    setText($('#confirmTitle'), item.name);
    setText($('#confirmText'), item.desc || '');
    setHtml($('#confirmCost'), C(price) + ' Coins');
    const yes = $('#confirmYes');
    yes.disabled = short > 0;
    setText(yes, short > 0 ? 'Need ' + fmt(short) + ' more' : 'Buy');
    setText($('#confirmNote'), short > 0 ? 'Escape stages to earn Coins (x2 the first time!), and grab the coins in the mazes.' : 'You have ' + fmtComma(S.coins) + ' Coins');
    $('#confirm').hidden = false;
    setMusicDuck(true);
}
export function notEnough(m) { toast('Not enough Coins! You need ' + fmt(m.need) + ' more for ' + m.name, '#ff5a7a'); }
function closeConfirm() { $('#confirm').hidden = true; pendingBuy = null; pendingAct = null; if (!modalOpen()) setMusicDuck(false); }
$('#confirmYes').addEventListener('click', () => { const p = pendingBuy, a = pendingAct; closeConfirm(); if (p) net.send('buy', p); else if (a) a(); });
// The same card for a yes / no question that isn't a purchase
export function askConfirm(ic, title, text, yesText, act) {
    pendingBuy = null; pendingAct = act;
    setHtml($('#confirmIc'), ic);
    setText($('#confirmTitle'), title);
    setText($('#confirmText'), text);
    setHtml($('#confirmCost'), '');
    const yes = $('#confirmYes');
    yes.disabled = false;
    setText(yes, yesText);
    setText($('#confirmNote'), '');
    $('#confirm').hidden = false;
    setMusicDuck(true);
}
$('#confirmNo').addEventListener('click', closeConfirm);
$('#confirmClose').addEventListener('click', closeConfirm);

// =====================================================================================
// Panels
// =====================================================================================
let modalKind = null, modalTab = null;
export function openModal(kind, tab) { modalKind = kind; modalTab = tab || null; renderModal(); $('#modal').hidden = false; setMusicDuck(true); }
export function closeModal() { $('#modal').hidden = true; modalKind = null; setMusicDuck(false); }
export function refreshModal() { if (!$('#modal').hidden) renderModal(); }
export const modalOpen = () => !$('#modal').hidden;
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });
function el(tag, cls, html) { const d = document.createElement(tag); if (cls) d.className = cls; if (html !== undefined) d.innerHTML = html; return d; }
function sec(body, text) { body.appendChild(el('div', 'sec o1', esc(text))); }
function note(body, text) { body.appendChild(el('p', 'note o1', text)); }
function card(o) {
    const d = el('div', 'card' + (o.cls ? ' ' + o.cls : ''));
    d.innerHTML = `<div class="ic">${o.ic}</div><div class="nm o1">${esc(o.name)}</div>${o.desc ? `<div class="ds o1">${esc(o.desc)}</div>` : ''}`;
    if (o.btn) {
        const b = el('button', 'btn ' + (o.btnCls || 'g-green') + ' o1', o.btn);
        b.disabled = !!o.disabled;
        b.addEventListener('click', o.onClick);
        d.appendChild(b);
    }
    return d;
}
function tabs(list) {
    const t = $('#modalTabs');
    t.innerHTML = '';
    if (!list) return;
    for (const [id, label] of list) {
        const b = el('button', 'btn g-blue o1' + (modalTab === id ? ' on' : ''), label);
        b.addEventListener('click', () => { modalTab = id; renderModal(); });
        t.appendChild(b);
    }
}
function renderModal() {
    const body = $('#modalBody');
    const scroll = body.scrollTop;
    body.innerHTML = '';
    const titles = { store: 'SHOP!', config: 'SETTINGS', gifts: 'GIFTS', invite: 'INVITE', stages: 'STAGES' };
    setText($('#modalTitle'), titles[modalKind] || '');
    tabs(null);
    ({ store: renderStore, config: renderConfig, gifts: renderGifts, invite: renderInvite, stages: renderStages }[modalKind] || (() => {}))(body);
    body.scrollTop = scroll;
}
const playNow = () => (S.playtime || 0) + (Date.now() - (S.profileAt || Date.now())) / 1000;
// ----- the Shop -----
function gearCard(g) {
    const own = !!S.gear[g.id], free = g.limited && limitedFree(g, playNow());
    const left = g.limited && !own && !free ? Math.ceil((CFG[g.limited] * 60 - playNow()) / 60) : 0;
    return card({
        ic: g.ic, name: g.name, desc: g.desc + (left ? ' · FREE in ' + left + ' min of play' : ''), cls: (g.limited ? 'lim' : '') + (own ? ' own' : ''),
        btn: own ? (S.tool === g.id ? 'Equipped' : 'Equip') : free ? '🎁 Get it FREE' : C(g.price), btnCls: own ? 'g-blue' : free || S.coins >= g.price ? 'g-green' : 'g-grey',
        onClick: () => (own ? actions.equip(g.id) : free ? (closeModal(), toast('🎁 Walk to the Free Items booth in the lobby to take it!', '#d8b8ff')) : buy('pass', passForTool(g.id))),
    });
}
function hatCard(h) {
    const own = !!S.hats[h.id];
    return card({ ic: h.ic, name: h.name, desc: h.desc, cls: own ? 'own' : '', btn: own ? (S.hat === h.id ? 'Wearing' : 'Wear') : C(h.price), btnCls: own ? 'g-blue' : S.coins >= h.price ? 'g-green' : 'g-grey', onClick: () => (own ? actions.wearHat(h.id) : buy('pass', passForHat(h.id))) });
}
function prodCard(key, cls) {
    const p = PRODUCTS[key];
    return card({ ic: p.ic, name: p.name, desc: p.desc, cls, btn: C(p.price), btnCls: S.coins >= p.price ? 'g-green' : 'g-grey', onClick: () => buy('product', key) });
}
function passCard(key, cls) {
    const p = PASSES[key], own = !!S.passes[key];
    return card({ ic: p.ic, name: p.name, desc: p.desc, cls: (cls || '') + (own ? ' own' : ''), btn: own ? (key === 'Morph' ? (S.morph ? 'Turn back' : 'Transform!') : 'Owned') : C(p.price), btnCls: own ? 'g-blue' : S.coins >= p.price ? 'g-green' : 'g-grey', disabled: own && key !== 'Morph', onClick: () => (own && key === 'Morph' ? (closeModal(), actions.toggleMorph()) : buy('pass', key)) });
}
function renderStore(body) {
    tabs([['gear', '🌀 Gear'], ['hats', '🎩 Hats'], ['boosts', '⚡ Boosts'], ['morph', '😡 Morph'], ['trails', '✨ Trails']]);
    const tab = modalTab || 'gear';
    const g = el('div', 'grid');
    if (tab === 'gear') for (const d of GEAR) g.appendChild(gearCard(d));
    else if (tab === 'hats') for (const h of HATS) g.appendChild(hatCard(h));
    else if (tab === 'boosts') { for (const k of ['Guide', 'NoDamage', 'JumpBoost', 'CoinBoost']) g.appendChild(prodCard(k, k === 'Guide' ? 'hot' : '')); g.appendChild(passCard('DoubleCoins', 'gold')); }
    else if (tab === 'morph') g.appendChild(passCard('Morph', 'hot'));
    else if (tab === 'trails') {
        for (const t of TRAILS) {
            const own = !!S.trails[t.id], on = S.trail === t.id;
            const h = '#' + t.color.toString(16).padStart(6, '0');
            const sw = `<span style="display:inline-block;width:3.6rem;height:1.2rem;border-radius:1rem;border:3px solid #160a24;background:${t.rainbow ? 'linear-gradient(90deg,#ff3c5a,#ffb51c,#46ec50,#28c8ff,#8a5aff)' : h};box-shadow:0 0 0.8rem ${h}"></span>`;
            g.appendChild(card({ ic: sw, name: t.name, desc: t.price ? '' : 'Free', cls: on ? 'own' : '', btn: on ? 'Equipped' : own ? 'Equip' : C(t.price), btnCls: own ? 'g-blue' : 'g-green', disabled: on || (!own && S.coins < t.price), onClick: () => net.send('trail', { id: t.id }) }));
        }
    }
    body.appendChild(g);
    if (tab === 'hats') note(body, 'Every hat multiplies the Coins you earn. Wear one!');
    else if (tab === 'morph') note(body, 'Become a giant Angry Head! Go into any stage you\'ve opened and catch the players running through it. Each catch pays +' + CFG.scareCoins + ' Coins. Turn back any time with the "Be Yourself" button.');
    else note(body, 'Everything costs Coins: escape stages (x2 the first time!), grab the coins in the mazes, claim gifts and daily rewards.');
}
// ----- Stages: go to any stage you've opened, or the lobby -----
function renderStages(body) {
    const g = el('div', 'grid');
    g.appendChild(card({ ic: '🏠', name: 'Lobby', desc: 'The shop, the hats, the doors', btn: 'Go', onClick: () => { closeModal(); actions.teleportLobby(); } }));
    if (S.run && S.run.s >= 0) g.appendChild(card({ ic: '🚩', name: 'My checkpoint', desc: 'Stage ' + (S.run.s + 1), btn: 'Go', onClick: () => { closeModal(); actions.enterStage(S.run.s, S.run.cp); } }));
    body.appendChild(g);
    sec(body, 'Stages (' + clearedCount(S) + '/' + (STAGES.length - 1) + ' escaped)');
    const r = el('div', 'grid');
    STAGES.forEach((s, i) => {
        const open = stageOpen(S, i), done = (S.cleared || {})[i] !== undefined, d = DIFFS[s.diff];
        r.appendChild(card({
            ic: open ? s.ic : '🔒', name: i === BOSS ? 'BOSS' : 'Stage ' + (i + 1), desc: s.name + (done ? ' · ✔ ' + clock(S.cleared[i]) : ''), cls: (done ? 'own' : '') + (open ? '' : ' lock') + (i === BOSS ? ' hot' : ''),
            btn: open ? (done ? 'Play again' : 'PLAY') : i === BOSS ? clearedCount(S) + '/' + BOSS_UNLOCK : 'Locked', btnCls: open ? 'g-green' : 'g-grey', disabled: !open,
            onClick: () => { closeModal(); actions.enterStage(i); },
        }));
        void d;
    });
    body.appendChild(r);
    note(body, 'Escape a stage to open the next one. The BOSS door opens after ' + BOSS_UNLOCK + ' escapes. Escaping pays Coins every time (x2 the first time!).');
}
// ----- Settings -----
function slider(body, ic, label, kind) {
    const r = el('div', 'row');
    r.innerHTML = `<span class="ic">${ic}</span><span class="tx" style="flex:0 0 8rem"><b class="o1">${label}</b></span>`;
    const s = el('input');
    s.type = 'range'; s.min = 0; s.max = 100; s.value = Math.round((getVolumes()[kind] ?? 1) * 100);
    s.setAttribute('aria-label', label);
    s.addEventListener('input', () => setVolume(kind, s.value / 100));
    r.appendChild(s);
    body.appendChild(r);
}
function renderConfig(body) {
    sec(body, 'Sound');
    slider(body, '🎵', 'Music', 'music');
    slider(body, '👣', 'Footsteps', 'asmr');
    slider(body, '🔔', 'Effects', 'sfx');
    sec(body, 'Graphics & camera');
    const q = el('div', 'row');
    q.innerHTML = '<span class="ic">✨</span><span class="tx"><b class="o1">Quality</b><small class="o1">Low is smoothest on older PCs and phones</small></span>';
    for (const [k, n] of [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]) {
        const b = el('button', 'btn ' + (getQuality() === k ? 'g-green' : 'g-grey') + ' o1', n);
        b.addEventListener('click', () => { setQuality(k); renderModal(); });
        q.appendChild(b);
    }
    body.appendChild(q);
    const f = el('div', 'row');
    f.innerHTML = '<span class="ic">🎥</span><span class="tx"><b class="o1">Camera follows you</b><small class="o1">Swings round behind you as you run</small></span>';
    const fb = el('button', 'btn ' + (actions.getFollow() ? 'g-green' : 'g-grey') + ' o1', actions.getFollow() ? 'ON' : 'OFF');
    fb.addEventListener('click', () => { actions.setFollow(!actions.getFollow()); renderModal(); });
    f.appendChild(fb);
    body.appendChild(f);
    sec(body, 'Codes');
    const c = el('div', 'row');
    c.innerHTML = '<span class="ic">🎟️</span>';
    const inp = el('input', 'input'); inp.placeholder = 'Enter a code'; inp.maxLength = 24;
    const go = el('button', 'btn g-green o1', 'Redeem');
    go.addEventListener('click', () => { if (inp.value.trim()) net.send('code', { code: inp.value.trim() }); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); e.stopPropagation(); });
    c.appendChild(inp); c.appendChild(go);
    body.appendChild(c);
    const stats = el('div', 'row');
    stats.innerHTML = `<span class="ic">📊</span><span class="tx"><b class="o1">Escapes ${fmt(S.escapes)} · Stages ${clearedCount(S)}/${STAGES.length - 1} · Caught ${fmt(S.caught)} times</b><small class="o1">Playtime ${playtimeText(S.playtime)} · Coins earned ${fmt(S.totalCoins)} · Scares ${fmt(S.scares)}${S.bossWins ? ' · Boss wins ' + S.bossWins : ''}</small></span>`;
    body.appendChild(stats);
}
export function codeResult(m) { toast(m.ok ? '🎟️ ' + m.text : m.text, m.ok ? '#7dff6b' : '#ff5a7a'); }
// ----- Gifts (playtime) -----
function renderGifts(body) {
    note(body, 'Keep playing to unlock gifts! (' + Math.floor(sessionSecs() / 60) + ' min played this session)');
    const g = el('div', 'grid');
    const secs = sessionSecs();
    GIFTS.forEach((gift, k) => {
        const claimed = !!S.giftClaimed[k], ready = secs >= gift.min * 60;
        g.appendChild(card({
            ic: gift.boost ? '⏱️' : '🎁', name: rewardText(gift), desc: gift.min + ' min',
            cls: claimed ? 'own' : ready ? 'hot' : '', btn: claimed ? 'Claimed' : ready ? 'CLAIM' : clock(gift.min * 60 - secs), btnCls: ready && !claimed ? 'g-green' : 'g-grey',
            disabled: claimed || !ready, onClick: () => net.send('gift', { k }),
        }));
    });
    body.appendChild(g);
    sec(body, '⏳ Free limited items');
    const l = el('div', 'grid');
    for (const gd of GEAR.filter((x) => x.limited)) l.appendChild(gearCard(gd));
    body.appendChild(l);
}
// ----- Invite -----
function renderInvite(body) {
    note(body, 'Escape the heads together! Friend Boost gives +' + Math.round(CFG.friendBoost * 100) + '% Coins for every Bloxity friend in your server (up to +' + Math.round(CFG.friendBoost * CFG.friendMax * 100) + '%).');
    const r = el('div', 'row');
    r.innerHTML = '<span class="ic">🔗</span><span class="tx"><b class="o1">Invite link</b><small class="o1">Send it to a friend</small></span>';
    const b = el('button', 'btn g-green o1', 'Copy');
    b.addEventListener('click', async () => {
        const link = BX.getInviteLink() || location.href;
        try { await navigator.clipboard.writeText(link); toast('Invite link copied!', '#7dff6b'); } catch (e) { toast(link, '#ffffff'); }
    });
    r.appendChild(b);
    body.appendChild(r);
    const list = el('div', 'grid');
    body.appendChild(list);
    if (BX.bloxity.ready && BX.identity().loggedIn) {
        BX.getFriends().then((fr) => {
            if (!fr.length) { list.appendChild(el('p', 'note o1', 'No Bloxity friends yet.')); return; }
            for (const f of fr.slice(0, 24)) {
                const nm = f.displayName || f.username || 'Friend';
                list.appendChild(card({ ic: '🙂', name: nm, btn: 'Invite', onClick: async () => { const ok = await BX.inviteFriend(f._id || f.id); toast(ok ? 'Invited ' + nm + '!' : 'Could not invite ' + nm, ok ? '#7dff6b' : '#ff5a7a'); } }));
            }
        });
    } else note(body, 'Log in to Bloxity to invite your friends directly.');
}

// =====================================================================================
// Daily rewards (they pop up once you've escaped a stage, never in the middle of a maze)
// =====================================================================================
export function openDailyOnJoin() {
    if (openDailyOnJoin.done || !dailyStatus(S.daily, net.now()).can) return;
    if (!S.escapes && (Date.now() - S.joinedAt) < 240000) return;
    openDailyOnJoin.done = true;
    setTimeout(() => { if (!S.run) openDaily(); else openDailyOnJoin.done = false; }, 1500);
}
function openDaily() { renderDaily(); $('#daily').hidden = false; setMusicDuck(true); }
function renderDaily() {
    const st = dailyStatus(S.daily, net.now());
    const cards = $('#dailyCards');
    cards.innerHTML = '';
    DAILY.forEach((r, i) => {
        const done = i < st.day || (!st.can && i === st.day);
        const now = st.can && i === st.day;
        const d = el('div', 'dcard o1' + (done ? ' done' : '') + (now ? ' now' : ''));
        d.innerHTML = `<span class="d">Day ${i + 1}</span><span class="i">${r.hat ? hatById[r.hat].ic : r.boost ? '⏱️' : '🪙'}</span><span>${esc(rewardText(r))}</span>`;
        cards.appendChild(d);
    });
    $('#dailyClaim').disabled = !st.can;
    setText($('#dailyLeft'), st.can ? 'Your daily reward is ready!' : 'Come back tomorrow for Day ' + ((st.streak % 7) + 1) + '!');
}
$('#dailyClaim').addEventListener('click', () => { net.send('daily'); setTimeout(renderDaily, 300); });
$('#dailyClose').addEventListener('click', () => { $('#daily').hidden = true; setMusicDuck(false); });
export const refreshDaily = () => { if (!$('#daily').hidden) renderDaily(); };

// =====================================================================================
// HUD buttons
// =====================================================================================
const quick = (key) => () => buy('product', key);
$('#btnShop').addEventListener('click', () => openModal('store'));
$('#btnLobby').addEventListener('click', () => askConfirm('🏠', 'Back to the Lobby?', 'Your checkpoint is saved: carry on from it any time.', 'Go', () => actions.lobbyPortal()));
$('#btnMorph').addEventListener('click', () => (S.passes.Morph ? actions.toggleMorph() : buy('pass', 'Morph')));
$('#qGuide').addEventListener('click', () => { if (!S.run) { toast('🧭 The Guide shows the way to a stage\'s EXIT: use it inside a maze!', '#9aff7a'); return; } quick('Guide')(); });
$('#qShield').addEventListener('click', quick('NoDamage'));
$('#qJump').addEventListener('click', quick('JumpBoost'));
$('#sprintBtn').addEventListener('click', () => actions.toggleSprint());
$('#coinPlus').addEventListener('click', () => openModal('store'));
$('#btnStore').addEventListener('click', () => openModal('store'));
$('#btnStages').addEventListener('click', () => openModal('stages'));
$('#btnConfig').addEventListener('click', () => openModal('config'));
$('#btnInvite').addEventListener('click', () => openModal('invite'));
$('#btnGift').addEventListener('click', () => openModal('gifts'));
$('#giftChip').addEventListener('click', () => {
    const secs = sessionSecs(), k = GIFTS.findIndex((g, i) => !S.giftClaimed[i] && secs >= g.min * 60);
    if (k >= 0) net.send('gift', { k }); else openModal('gifts');
});
$('#btnDaily').addEventListener('click', openDaily);
actions.openStore = () => openModal('store');
actions.buy = buy;

// Closes the topmost popup (Escape / controller B); false when nothing was open
export function closeTop() {
    for (const id of ['#confirm', '#daily']) {
        if (!$(id).hidden) {
            if (id === '#confirm') closeConfirm(); else $('#dailyClose').click();
            return true;
        }
    }
    if (modalOpen()) { closeModal(); return true; }
    if (!$('#gearPop').hidden) { $('#gearPop').hidden = true; return true; }
    if (!$('#continue').hidden) { hideContinue(); return true; }
    if (reviveOpen()) { hideRevive(); return true; }
    return false;
}
export const anyPopup = () => ['#confirm', '#daily', '#modal', '#escaped'].some((id) => !$(id).hidden);
