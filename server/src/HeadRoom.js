import { Room } from 'colyseus';
import { GameState, PlayerState } from './schema.js';
import {
    getProfile, hasProfile, markDirty, saveProfiles, adoptGuestProgress, loadProfile, releaseProfile,
    topProfiles, recordSession, saveSoon, USE_DB,
} from './profiles.js';
import { sealProfile, openSave } from './saves.js';
import { verifyBloxityToken } from './bloxity.js';
import { StageHeads, MODES } from './heads.js';
import {
    CFG, STAGES, BOSS, BOSS_UNLOCK, TOOLS, gearById, hatById, PASSES, PRODUCTS, HITTERS, trailById, priceOf, revivePrice, GIFTS, DAILY, CODES,
    KITS, SKINS, dailyStatus, dayKey, rewardText, coinMult, clamp, stageOpen, limitedFree, fmt,
} from '../../shared/config.js';
import { MAZES, CHECKPOINTS, COINS, KEYS, SPAWN, DOORS, LIMITED_PADS, WORLD, stageAt, isSafe, cpOf } from '../../shared/maze.js';

const GREEN = '#7dff6b', GOLD = '#ffd028', BLUE = '#6fe0ff', RED = '#ff6a7a';

function cleanName(name) {
    return String(name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20);
}
const randomName = () => 'Player' + Math.floor(1000 + Math.random() * 9000);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Guest ids come from the browser; they can never claim a Bloxity identity
const guestUid = (uid, fallback) => String(uid || fallback).replace(/^legion_/, 'guest_').slice(0, 64);
const cleanAvatar = (av) => (typeof av === 'string' && av.length <= 2000 ? av : '');
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const newRun = (s, k) => ({ s, k0: k || 0, cp: k || 0, start: Date.now(), coins: new Set(), keys: new Set() });

export const liveRooms = new Set();

// One shared server: the lobby and all thirteen mazes. Movement is client-side; the heads are
// simulated here (heads.js) and only in the mazes someone is in. Everything that changes progress
// (Coins, checkpoints, escapes, unlocks) or touches other players (slaps, morph catches) is decided
// here. There are no real-money purchases: every price is in Coins, checked and taken here.
export class HeadRoom extends Room {
    maxClients = CFG.maxPlayers;

    onCreate() {
        liveRooms.add(this);
        this.setState(new GameState());
        this.setPatchRate(50);
        this.sessions = new Map();
        this.joinCount = 0;
        this.sims = STAGES.map((s, i) => new StageHeads(i));
        this.secAcc = 0;

        const on = (type, fn) => this.onMessage(type, (client, m) => { try { fn.call(this, client, m || {}); } catch (e) { console.warn('[msg]', type, e.message); } });
        on('move', this.onMove);
        on('enter', this.onEnter);
        on('lobby', this.onLobby);
        on('cp', this.onCheckpoint);
        on('coin', this.onCoin);
        on('key', this.onKey);
        on('exit', this.onExit);
        on('caught', this.onCaught);
        on('revive', this.onRevive);
        on('hit', this.onHit);
        on('potion', this.onPotion);
        on('slap', this.onSlap);
        on('buy', this.onBuy);
        on('tool', this.onTool);
        on('hat', this.onHat);
        on('morph', this.onMorph);
        on('limited', this.onLimited);
        on('trail', this.onTrail);
        on('daily', this.onDaily);
        on('gift', this.onGift);
        on('code', this.onCode);
        on('meta', this.onMeta);
        on('auth', this.onBloxityLogin);
        on('avatar', this.onAvatar);
        on('emote', this.onEmote);
        on('chat', this.onChat);
        on('friends', this.onFriends);

        this.setSimulationInterval((ms) => this.update(ms), 50);
        this.clock.setInterval(() => this.broadcastBoards(), 10000);
    }

    async onAuth(client, options) {
        const legion = options && options.token ? await verifyBloxityToken(options.token) : null;
        return legion ? { legion } : { guest: true };
    }

    async onJoin(client, options, auth) {
        options = options || {};
        const guest = guestUid(options.uid, client.sessionId);
        let uid = guest, name = cleanName(options.name);
        if (auth && auth.legion) {
            uid = 'legion_' + auth.legion.id;
            name = cleanName(auth.legion.name) || name;
            await adoptGuestProgress(uid, guest, name);
        }
        await loadProfile(uid);
        // A fresh server on a temporary disk restores the browser's signed backup.
        // With a database the profile is never lost, so backups are not accepted at all.
        const restore = !USE_DB && !hasProfile(uid) && openSave(options.save, [uid, guest]);
        const profile = getProfile(uid, name, randomName());
        if (restore) { Object.assign(profile, restore); markDirty(); }
        this.fixProfile(profile);
        const player = new PlayerState();
        player.name = profile.name;
        player.av = cleanAvatar(options.av);
        player.x = SPAWN.x; player.y = SPAWN.y; player.z = SPAWN.z; player.ry = 0;
        player.kit = this.joinCount % KITS.length;
        player.skin = (this.joinCount * 3) % SKINS.length;
        this.joinCount++;
        this.state.players.set(client.sessionId, player);
        const s = {
            id: client.sessionId, client, profile, player,
            pos: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z }, area: -1, run: null, status: {},
            joinedAt: Date.now(), giftClaimed: {}, friends: 0, guest, lastChat: 0, lastSlap: 0, lastHit: 0, lastPotion: 0,
            lastRevive: 0, lastCaught: 0, caughtBy: null, scared: new Map(), playSecs: 0,
            stats: { fresh: Date.now() - (profile.firstPlay || 0) < 60000, entered: -1, escapes: 0, deaths: 0, coins0: profile.totalCoins, buys: 0, touch: false, fps: 0, scares: 0, cps: 0 },
        };
        this.sessions.set(client.sessionId, s);
        this.syncPublic(client.sessionId);
        client.send('hello', { now: Date.now(), bloxity: uid.startsWith('legion_') });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
    }

    // Older saves / hand-edited data: keep every field the right shape
    fixProfile(p) {
        for (const k of ['coins', 'totalCoins', 'escapes', 'caught', 'scares', 'bossWins', 'playtime', 'boostUntil']) if (!finite(p[k])) p[k] = 0;
        p.coins = Math.max(0, Math.floor(p.coins));
        if (!p.trails || typeof p.trails !== 'object') p.trails = { starter: true };
        if (!trailById[p.trail] || !p.trails[p.trail]) p.trail = 'starter';
        for (const k of ['gear', 'passes', 'hats', 'cleared', 'codes']) if (!p[k] || typeof p[k] !== 'object') p[k] = {};
        for (const k of Object.keys(p.gear)) if (!TOOLS.includes(k)) delete p.gear[k];
        if (typeof p.tool !== 'string' || (p.tool && !p.gear[p.tool])) p.tool = '';
        if (typeof p.hat !== 'string' || (p.hat && !p.hats[p.hat])) p.hat = '';
        p.morph = !!(p.morph && p.passes.Morph);
        p.stage = clamp(Math.floor(finite(p.stage) ? p.stage : -1), -1, STAGES.length - 1);
        p.cp = clamp(Math.floor(finite(p.cp) ? p.cp : 0), 0, 6);
        if (p.stage >= 0 && !cpOf(p.stage, p.cp)) p.cp = 0;
    }

    onDrop(client) {
        this.allowReconnection(client, 30);
    }
    onReconnect(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        s.client = client;
        client.send('hello', { now: Date.now(), bloxity: s.profile.uid.startsWith('legion_') });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
    }

    onLeave(client) {
        const s = this.sessions.get(client.sessionId);
        this.state.players.delete(client.sessionId);
        this.sessions.delete(client.sessionId);
        markDirty();
        if (!s) return;
        const st = s.stats;
        recordSession({
            at: new Date(), secs: Math.round((Date.now() - s.joinedAt) / 1000), fresh: st.fresh, entered: st.entered,
            escapes: st.escapes, deaths: st.deaths, cps: st.cps, coins: (s.profile.totalCoins || 0) - (st.coins0 || 0), buys: st.buys,
            scares: st.scares, touch: st.touch, fps: st.fps, endStage: s.profile.stage, cleared: Object.keys(s.profile.cleared || {}).length,
            gifts: Object.keys(s.giftClaimed).length,
        }).catch((e) => console.warn('[stats]', e.message));
        if (!isOnline(s.profile.uid)) releaseProfile(s.profile.uid, isOnline);
    }

    onDispose() { liveRooms.delete(this); markDirty(); return saveProfiles(); }

    // ----- helpers -----
    syncPublic(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile, pl = s.player;
        pl.tool = p.tool || '';
        pl.hat = p.hat || '';
        pl.trail = p.trail || 'starter';
        pl.morph = !!p.morph;
        pl.escapes = Math.min(65535, p.escapes || 0);
        pl.name = p.name;
    }
    sendProfile(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile;
        s.client.send('profile', {
            coins: p.coins, totalCoins: p.totalCoins, escapes: p.escapes, caught: p.caught, scares: p.scares, bossWins: p.bossWins, playtime: p.playtime,
            cleared: p.cleared, stage: p.stage, cp: p.cp, trails: p.trails, trail: p.trail, gear: p.gear, tool: p.tool, hats: p.hats, hat: p.hat,
            passes: p.passes, morph: p.morph, boostUntil: p.boostUntil, daily: p.daily, codes: p.codes, firstPlay: p.firstPlay,
            giftClaimed: s.giftClaimed, sessionSecs: s.playSecs, run: s.run ? { s: s.run.s, cp: s.run.cp, keys: [...s.run.keys], coins: [...s.run.coins] } : null,
            save: sealProfile(p),
        });
    }
    changed(id) { this.syncPublic(id); this.sendProfile(id); saveSoon(); }
    toast(s, text, color) { s.client.send('toast', { text, color: color || '#ffffff' }); }
    mult(s) { return coinMult(s.profile, Date.now(), s.friends); }
    addCoins(s, base, why, extra) {
        const n = Math.max(1, Math.round(base * this.mult(s)));
        s.profile.coins = (s.profile.coins || 0) + n;
        s.profile.totalCoins = (s.profile.totalCoins || 0) + n;
        s.client.send('earn', { n, why, ...(extra || {}) });
        return n;
    }
    // A status everyone sees on a player (n no damage, i invisible) for a few seconds
    setStatus(s, letter, secs) {
        s.status[letter] = Date.now() + secs * 1000;
        this.syncStatus(s);
        this.clock.setTimeout(() => this.syncStatus(s), secs * 1000 + 30);
    }
    syncStatus(s) {
        const now = Date.now();
        let st = '';
        for (const [k, until] of Object.entries(s.status)) if (until > now) st += k;
        if (s.player.st !== st) s.player.st = st;
    }
    has(s, letter) { return (s.status[letter] || 0) > Date.now(); }
    near(s, x, y, z, r, dy) { return dist2(s.pos, { x, z }) <= r * r && Math.abs(s.pos.y - y) <= dy; }
    wait(last, secs) { return Math.max(0, Math.ceil((secs * 1000 - (Date.now() - last)) / 1000)); }

    // ----- the heads: 20 times a second, in the mazes someone is in -----
    update(ms) {
        const dt = Math.min(0.1, (ms || 50) / 1000);
        this.secAcc += dt;
        if (this.secAcc >= 1) { this.secAcc -= 1; this.tick(); }
        const by = new Map();
        for (const s of this.sessions.values()) if (s.area >= 0) { if (!by.has(s.area)) by.set(s.area, []); by.get(s.area).push(s); }
        const now = Date.now();
        this.sims.forEach((sim, i) => {
            const list = by.get(i);
            if (!list) { sim.idle += dt; return; }
            // a maze nobody has been in for a while starts over with every head at home
            if (sim.idle > 60) sim.reset();
            sim.idle = 0;
            const m = MAZES[i];
            const players = list.map((s) => {
                const safe = isSafe(m, s.pos.x, s.pos.z);
                return { id: s.id, x: s.pos.x, y: s.pos.y, z: s.pos.z, safe, ok: !s.profile.morph && !this.has(s, 'i') && !safe };
            });
            sim.step(dt, players);
            const d = sim.pack(), e = sim.events.length ? sim.events : undefined;
            for (const s of list) s.client.send('h', { s: i, t: now, d, c: sim.chasing(s.id), e });
            sim.events = [];
        });
    }
    // Every second: playtime
    tick() {
        for (const s of this.sessions.values()) {
            s.profile.playtime = (s.profile.playtime || 0) + 1;
            s.playSecs++;
        }
        markDirty();
    }

    // ----- movement & the runs -----
    onMove(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !finite(m.x) || !finite(m.y) || !finite(m.z)) return;
        const pl = s.player;
        pl.x = clamp(m.x, WORLD.x0, WORLD.x1); pl.y = clamp(m.y, WORLD.y0, WORLD.y1); pl.z = clamp(m.z, WORLD.z0, WORLD.z1);
        pl.ry = finite(m.ry) ? m.ry : 0;
        pl.anim = clamp(m.a | 0, 0, 4);
        s.pos = { x: pl.x, y: pl.y, z: pl.z };
        const area = stageAt(pl.x, pl.y, pl.z);
        if (area !== null && area !== s.area) {
            s.area = area;
            pl.area = area;
            // back in the lobby: the run is over (the stage's checkpoint is kept for "continue")
            if (area === -1 && s.run) { s.run = null; s.profile.stage = -1; s.profile.cp = 0; this.changed(client.sessionId); }
        }
    }
    // Into stage i (a lobby door, the stage list, or continuing from checkpoint k)
    onEnter(client, m) {
        const s = this.sessions.get(client.sessionId);
        const i = m.i | 0, st = STAGES[i];
        if (!s || !st) return;
        const p = s.profile;
        if (!stageOpen(p, i)) {
            const why = i === BOSS ? 'Escape ' + BOSS_UNLOCK + ' stages to open the BOSS door!' : 'Escape Stage ' + i + ' first!';
            return this.toast(s, '🔒 ' + why, BLUE);
        }
        let k = 0;
        if (m.k && p.stage === i && (m.k | 0) <= p.cp) k = m.k | 0;
        const cp = cpOf(i, k) || cpOf(i, 0);
        s.run = newRun(i, cp.k);
        p.stage = i; p.cp = cp.k;
        s.pos = { x: cp.x, y: cp.y, z: cp.z };
        s.area = i; s.player.area = i;
        s.stats.entered = Math.max(s.stats.entered, i);
        this.setStatus(s, 'n', CFG.spawnShield);
        client.send('goStage', { i, k: cp.k });
        this.changed(client.sessionId);
    }
    onLobby(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        s.run = null; s.profile.stage = -1; s.profile.cp = 0;
        s.pos = { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z };
        s.area = -1; s.player.area = -1;
        this.changed(client.sessionId);
    }
    onCheckpoint(client, m) {
        const s = this.sessions.get(client.sessionId);
        const cp = CHECKPOINTS[m.id | 0];
        if (!s || !cp || !s.run || s.run.s !== cp.s || s.profile.morph || !this.near(s, cp.x, cp.y, cp.z, 14, 8)) return;
        if (cp.k <= s.run.cp) return;
        s.run.cp = cp.k; s.profile.cp = cp.k;
        s.stats.cps++;
        this.addCoins(s, 2, 'cp', { id: cp.id });
        this.changed(client.sessionId);
    }
    onCoin(client, m) {
        const s = this.sessions.get(client.sessionId);
        const c = COINS[m.i | 0];
        if (!s || !c || !s.run || s.run.s !== c.s || s.profile.morph || s.run.coins.has(c.i) || !this.near(s, c.x, c.y, c.z, 11, 9)) return;
        s.run.coins.add(c.i);
        this.addCoins(s, CFG.pickupCoins, 'coin', { i: c.i });
        this.changed(client.sessionId);
    }
    onKey(client, m) {
        const s = this.sessions.get(client.sessionId);
        const k = KEYS[m.id | 0];
        if (!s || !k || !s.run || s.run.s !== k.s || s.profile.morph || s.run.keys.has(k.id) || !this.near(s, k.x, k.y, k.z, 12, 9)) return;
        s.run.keys.add(k.id);
        const need = STAGES[k.s].keys, got = s.run.keys.size;
        this.addCoins(s, CFG.keyCoins, 'key', { id: k.id, got, need });
        this.changed(client.sessionId);
    }
    // The EXIT pad: escape the stage
    onExit(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !s.run || s.profile.morph) return;
        const i = s.run.s, mz = MAZES[i], st = STAGES[i], p = s.profile;
        if (!this.near(s, mz.exitPad.x, 0, mz.exitPad.z, 10, 8)) return;
        if (s.run.keys.size < st.keys) {
            client.send('keys', { s: i, ids: [...s.run.keys] });
            return this.toast(s, '🔑 The EXIT is locked! Find the key' + (st.keys > 1 ? 's (' + s.run.keys.size + '/' + st.keys + ')' : '') + ' first!', GOLD);
        }
        const secs = (Date.now() - s.run.start) / 1000;
        if (secs < (s.run.k0 > 0 ? 5 : Math.max(8, st.par * CFG.minRunShare))) return this.toast(s, 'Too fast! Run through the maze to escape!', BLUE);
        const first = !p.cleared[i];
        const n = this.addCoins(s, st.coins * (first ? CFG.firstClearMult : 1), 'escape', { i });
        const best = first ? Math.round(secs) : Math.min(p.cleared[i], Math.round(secs));
        p.cleared[i] = best;
        p.escapes = (p.escapes || 0) + 1;
        if (i === BOSS) p.bossWins = (p.bossWins || 0) + 1;
        s.stats.escapes++;
        p.stage = -1; p.cp = 0;
        s.run = null;
        const next = i < BOSS - 1 ? i + 1 : -1;
        client.send('escaped', { i, n, first, secs: Math.round(secs), best, next, bossOpen: stageOpen(p, BOSS), escapes: p.escapes });
        this.broadcast('announce', { text: (i === BOSS ? '👑 ' + p.name + ' DEFEATED THE BOSS!' : '🚪 ' + p.name + ' escaped Stage ' + (i + 1) + '!'), color: GOLD }, { except: client });
        this.changed(client.sessionId);
    }
    // Caught by a head (k) or by a player playing as one (by): a death, back to the checkpoint
    onCaught(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.profile.morph || Date.now() - s.lastCaught < 900) return;
        s.lastCaught = Date.now();
        const p = s.profile;
        p.caught = (p.caught || 0) + 1;
        s.stats.deaths++;
        s.caughtBy = null;
        this.sendProfile(client.sessionId);
        if (typeof m.by === 'string') {
            const o = this.sessions.get(m.by);
            if (!o || o === s || !o.profile.morph || o.area !== s.area || dist2(o.pos, s.pos) > 26 * 26) return;
            const last = o.scared.get(s.id) || 0;
            if (Date.now() - last < CFG.scareGap * 1000) return;
            o.scared.set(s.id, Date.now());
            o.profile.scares = (o.profile.scares || 0) + 1;
            o.stats.scares++;
            this.addCoins(o, CFG.scareCoins, 'scare', { who: p.name });
            o.client.send('scared', { who: p.name });
            this.changed(o.id);
            return;
        }
        const sim = s.area >= 0 ? this.sims[s.area] : null, h = sim && sim.heads[m.k | 0];
        if (!h || dist2(h, s.pos) > (h.r + 10) ** 2) return;
        sim.laugh(h);
        s.caughtBy = { s: s.area, k: h.k };
        markDirty();
    }
    // "Keep going?": the client puts itself back where it was caught; the head that got it goes home
    onRevive(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !s.run || Date.now() - s.lastRevive < 1500) return;
        const p = s.profile, price = revivePrice(s.run.s);
        if ((p.coins || 0) < price) return client.send('broke', { need: price - (p.coins || 0), price, name: 'Revive' });
        s.lastRevive = Date.now();
        p.coins -= price;
        s.stats.buys++;
        if (s.caughtBy && s.caughtBy.s === s.run.s) { const h = this.sims[s.caughtBy.s].heads[s.caughtBy.k]; if (h) this.sims[s.caughtBy.s].sendHome(h); }
        s.caughtBy = null;
        this.setStatus(s, 'n', CFG.spawnShield);
        client.send('revived', {});
        this.changed(client.sessionId);
    }
    // Troll Slap / Rocket Launcher / Scythe on a head: it's dazed for a few seconds
    onHit(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.area < 0) return;
        const tool = s.profile.tool, hit = HITTERS[tool];
        if (!hit || !s.profile.gear[tool] || Date.now() - s.lastHit < hit.cooldown * 1000 * 0.8) return;
        const sim = this.sims[s.area], h = sim.heads[m.k | 0];
        if (!h || dist2(h, s.pos) > (hit.range + h.r + 8) ** 2) return;
        s.lastHit = Date.now();
        sim.stun(h);
        this.broadcastStage(s.area, 'hfx', { s: s.area, k: h.k, tool, by: client.sessionId });
    }
    broadcastStage(i, type, msg) { for (const o of this.sessions.values()) if (o.area === i) o.client.send(type, msg); }
    // The Invisibility Potion: the heads can't see you for a few seconds
    onPotion(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.profile.tool !== 'potion' || !s.profile.gear.potion) return;
        if (this.wait(s.lastPotion, CFG.potionCooldown)) return this.toast(s, '🧪 The potion refills in ' + this.wait(s.lastPotion, CFG.potionCooldown) + 's', BLUE);
        s.lastPotion = Date.now();
        this.setStatus(s, 'i', CFG.potionSecs);
        client.send('potionOn', { secs: CFG.potionSecs });
    }
    // A Troll Slap on another player: knock them flying
    onSlap(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.profile.tool !== 'slap' || !s.profile.gear.slap) return;
        const now = Date.now();
        if (now - s.lastSlap < 900) return;
        s.lastSlap = now;
        const t = this.sessions.get(String(m.t || ''));
        if (!t || t === s || dist2(t.pos, s.pos) > (CFG.slapRange + 5) ** 2) { this.broadcast('slapFx', { s: client.sessionId }, { except: client }); return; }
        const dx = t.pos.x - s.pos.x, dz = t.pos.z - s.pos.z, l = Math.hypot(dx, dz) || 1;
        t.client.send('slapped', { dx: dx / l, dz: dz / l, by: s.profile.name });
        this.broadcast('slapFx', { s: client.sessionId, t: String(m.t) });
    }

    // ----- the Coins shop: the server checks the price, takes the Coins, then grants -----
    onBuy(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || (m.kind !== 'pass' && m.kind !== 'product')) return;
        const p = s.profile, key = String(m.key || '');
        const item = (m.kind === 'pass' ? PASSES : PRODUCTS)[key];
        if (!item) return;
        if (m.kind === 'pass' && p.passes[key]) return this.toast(s, item.name + ' already owned!', BLUE);
        const price = priceOf(m.kind, key);
        if ((p.coins || 0) < price) return client.send('broke', { need: price - (p.coins || 0), price, name: item.name });
        p.coins -= price;
        this.grant(s, client.sessionId, m.kind, key);
    }
    grant(s, id, kind, key) {
        const client = s.client, p = s.profile;
        s.stats.buys++;
        if (kind === 'pass') {
            const pass = PASSES[key];
            p.passes[key] = true;
            if (pass.tool) { p.gear[pass.tool] = true; p.tool = pass.tool; }
            if (pass.hat) { p.hats[pass.hat] = true; p.hat = pass.hat; }
            if (key === 'Morph') p.morph = true;
            this.toast(s, pass.ic + ' ' + pass.name + ' unlocked!', GREEN);
            client.send('fx', { kind: 'unlock', key });
        } else {
            if (key === 'JumpBoost') client.send('boost', { kind: 'jump', secs: CFG.jumpBoostSecs });
            else if (key === 'NoDamage') { this.setStatus(s, 'n', CFG.noDamageSecs); client.send('boost', { kind: 'shield', secs: CFG.noDamageSecs }); }
            else if (key === 'Guide') client.send('boost', { kind: 'guide', secs: CFG.guideSecs });
            else if (key === 'CoinBoost') { p.boostUntil = Math.max(Date.now(), p.boostUntil || 0) + CFG.boostMinutes * 60000; this.toast(s, '⏱️ x2 Coins for ' + CFG.boostMinutes + ' minutes!', GOLD); }
            client.send('fx', { kind: 'confetti', key });
        }
        this.changed(id);
    }
    onTool(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const id = String(m.id || '');
        if (id && !s.profile.gear[id]) return;
        s.profile.tool = id;
        this.changed(client.sessionId);
    }
    onHat(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const id = String(m.id || '');
        if (id && !s.profile.hats[id]) return;
        s.profile.hat = id;
        this.changed(client.sessionId);
    }
    onMorph(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !s.profile.passes.Morph) return;
        s.profile.morph = !!m.on;
        if (s.profile.morph && s.run) { s.run = null; s.profile.stage = -1; s.profile.cp = 0; }
        this.changed(client.sessionId);
    }
    // The Free Items booth: a limited item is free once you've played long enough
    onLimited(client, m) {
        const s = this.sessions.get(client.sessionId);
        const g = gearById[String(m.id || '')], pad = g && LIMITED_PADS.find((q) => q.id === g.id);
        if (!s || !g || !pad || s.profile.gear[g.id] || !this.near(s, pad.x, 0, pad.z, 10, 6)) return;
        if (!limitedFree(g, s.profile.playtime)) return this.toast(s, g.ic + ' ' + g.name + ' is free after ' + CFG[g.limited] + ' minutes of play!', BLUE);
        s.profile.gear[g.id] = true;
        s.profile.passes['G_' + g.id] = true;
        s.profile.tool = g.id;
        this.toast(s, g.ic + ' You got the ' + g.name + '!', GREEN);
        client.send('fx', { kind: 'unlock', key: 'G_' + g.id });
        this.changed(client.sessionId);
    }

    // ----- trails -----
    onTrail(client, m) {
        const s = this.sessions.get(client.sessionId);
        const d = trailById[m.id];
        if (!s || !d) return;
        const p = s.profile;
        if (!p.trails[d.id]) {
            if (p.coins < d.price) return client.send('broke', { need: d.price - p.coins, price: d.price, name: d.name });
            p.coins -= d.price;
            p.trails[d.id] = true;
            s.stats.buys++;
            this.toast(s, d.name + ' trail unlocked!', GREEN);
        }
        p.trail = d.id;
        this.changed(client.sessionId);
    }

    // ----- rewards -----
    giveReward(s, r) {
        const p = s.profile;
        if (r.coins) { p.coins += r.coins; p.totalCoins += r.coins; }
        if (r.boost) p.boostUntil = Math.max(Date.now(), p.boostUntil || 0) + CFG.boostMinutes * 60000;
        if (r.hat && hatById[r.hat]) {
            if (!p.hats[r.hat]) { p.hats[r.hat] = true; p.passes['H_' + r.hat] = true; if (!p.hat) p.hat = r.hat; } else { p.coins += 100; p.totalCoins += 100; }
        }
    }
    onDaily(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, now = Date.now();
        const st = dailyStatus(p.daily, now);
        if (!st.can) return this.toast(s, 'Come back tomorrow for more!', BLUE);
        const r = DAILY[st.day];
        p.daily = { last: dayKey(now), streak: st.streak + 1 };
        this.giveReward(s, r);
        this.toast(s, 'Day ' + p.daily.streak + ' reward: ' + rewardText(r) + '!', GREEN);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }
    onGift(client, m) {
        const s = this.sessions.get(client.sessionId);
        const k = m.k | 0, g = GIFTS[k];
        if (!s || !g || s.giftClaimed[k]) return;
        if (s.playSecs < g.min * 60 - 2) return this.toast(s, 'Keep playing to unlock this gift!', BLUE);
        s.giftClaimed[k] = true;
        this.giveReward(s, g);
        this.toast(s, '🎁 ' + rewardText(g) + '!', GREEN);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }
    onCode(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const code = String(m.code || '').trim().toUpperCase().slice(0, 24);
        const r = CODES[code];
        const p = s.profile;
        if (!r) return client.send('codeResult', { ok: false, text: 'Invalid code' });
        if (p.codes[code]) return client.send('codeResult', { ok: false, text: 'Code already used' });
        p.codes[code] = true;
        this.giveReward(s, r);
        client.send('codeResult', { ok: true, text: rewardText(r) + '!' });
        this.changed(client.sessionId);
    }
    // What the client tells us about itself, for the play stats
    onMeta(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        if (typeof m.touch === 'boolean') s.stats.touch = m.touch;
        if (finite(m.fps)) s.stats.fps = clamp(Math.round(m.fps), 0, 240);
    }

    broadcastBoards(client) {
        const row = (key) => topProfiles(key).filter((p) => (p[key] || 0) > 0).map((p) => ({ n: p.name, v: Math.floor(p[key] || 0) }));
        const m = { coins: row('totalCoins'), escapes: row('escapes'), scares: row('scares') };
        if (client) client.send('boards', m); else this.broadcast('boards', m);
    }

    // ----- Bloxity -----
    async onBloxityLogin(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || s.authing) return;
        s.authing = true;
        const legion = await verifyBloxityToken(m.token);
        s.authing = false;
        if (!legion || !this.sessions.has(client.sessionId)) return;
        const uid = 'legion_' + legion.id;
        if (s.profile.uid === uid) return;
        const name = cleanName(legion.name) || s.profile.name;
        const guestProfile = s.profile;
        await adoptGuestProgress(uid, guestProfile.uid, name);
        await loadProfile(uid);
        if (!this.sessions.has(client.sessionId)) return;
        s.profile = getProfile(uid, name, randomName());
        this.fixProfile(s.profile);
        if (!isOnline(guestProfile.uid)) releaseProfile(guestProfile.uid, isOnline);
        s.player.name = s.profile.name;
        this.changed(client.sessionId);
        client.send('authed', { name: s.profile.name });
        this.toast(s, 'Logged in as ' + s.profile.name, GREEN);
        this.broadcastBoards();
    }
    onAvatar(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (s && m) s.player.av = cleanAvatar(m.av);
    }
    onEmote(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.id !== 'string' || m.id.length > 40) return;
        this.broadcast('emote', { s: client.sessionId, id: m.id }, { except: client });
    }
    onChat(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.text !== 'string') return;
        const now = Date.now();
        if (now - s.lastChat < 800) return;
        s.lastChat = now;
        const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (text) this.broadcast('chat', { s: client.sessionId, name: s.profile.name, text });
    }
    onFriends(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || !Array.isArray(m.names)) return;
        const here = new Set([...this.sessions.values()].filter((o) => o !== s).map((o) => o.profile.name));
        const n = new Set(m.names.slice(0, 50).map(String).filter((x) => here.has(x))).size;
        const friends = Math.min(CFG.friendMax, n);
        if (friends === s.friends) return;
        s.friends = friends;
        s.player.friends = friends;
    }
}

function isOnline(uid) {
    for (const room of liveRooms) for (const s of room.sessions.values()) if (s.profile.uid === uid) return true;
    return false;
}
void DOORS; void MODES; void fmt; void RED;
