// The Angry Heads: simulated here, 20 times a second, only in the mazes someone is in. Every head
// wanders the corridors until it sees (or hears) a player, then hunts them down the shortest way
// through the maze; it gives up when it loses them for a few seconds, never goes into a safe room
// someone is in, can't reach anyone up on a bridge or a lookout, and is dazed for a while when
// slapped. Fast heads sprint in bursts and pant in between; ghost heads float straight through
// walls (slowly); the boss always knows where you are. Clients draw what this sends and decide
// when they're caught.
import { MAZES, CELL, WALL, HALF, cellAt, cellCenter, neighbours, bfs, lineClear } from '../../shared/maze.js';
import { STAGES, HEAD_TYPES, CFG } from '../../shared/config.js';

export const MODES = { wander: 0, chase: 1, search: 2, stun: 3, laugh: 4, rest: 5 };
const LOSE_SECS = 3.5;       // out of sight this long and a head gives up
const PLAN_SECS = 0.3;       // how often a chasing head re-plans its route
const REACH_Y = 7.5;         // players higher than this (bridges, lookouts, truss tops) are out of reach
const TAU = Math.PI * 2;
const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };

export class StageHeads {
    constructor(i) {
        this.i = i;
        this.m = MAZES[i];
        this.st = STAGES[i];
        this.heads = this.m.heads.map((h, k) => this.make(k, h));
        this.idle = 999;
        this.events = [];
        this.rnd = Math.random;
        this.block = new Uint8Array(this.m.cols * this.m.rows);   // the safe cells someone is in right now
        // slime and ice slow the heads down too (like the players); ghosts float over them
        this.slow = new Float32Array(this.m.cols * this.m.rows).fill(1);
        for (const z of this.m.hazards) { const c = cellAt(this.m, z.x, z.z); if (c >= 0 && (z.t === 'slime' || z.t === 'ice')) this.slow[c] = z.t === 'slime' ? 0.6 : 0.8; }
    }
    make(k, h) {
        const def = HEAD_TYPES[h.type], p = cellCenter(this.m, h.cell);
        return {
            k, type: h.type, def, r: def.r, home: h.cell, x: p.x, z: p.z, y: def.r + 0.6, ry: Math.random() * TAU,
            cell: h.cell, prev: -1, target: -1, wx: p.x, wz: p.z, mode: MODES.wander, t: 0, pause: 0,
            chase: null, seenT: 0, seenX: 0, seenZ: 0, plan: 0, burst: 0, speed: 0,
        };
    }
    reset() { this.heads = this.m.heads.map((h, k) => this.make(k, h)); }
    setMode(h, mode) {
        if (h.mode === mode) return;
        h.mode = mode; h.t = 0;
        if (mode !== MODES.chase && mode !== MODES.rest) h.chase = null;
        if (mode === MODES.wander) h.target = -1;
    }
    // A head sent back to where it started (a puff of smoke on the clients)
    sendHome(h) {
        const p = cellCenter(this.m, h.home);
        h.x = p.x; h.z = p.z; h.cell = h.home; h.prev = -1;
        this.setMode(h, MODES.wander);
        this.events.push([h.k, 'home']);
    }
    stun(h) { this.setMode(h, MODES.stun); this.events.push([h.k, 'stun']); }
    laugh(h) { this.setMode(h, MODES.laugh); this.events.push([h.k, 'laugh']); }

    // players: [{ id, x, y, z, ok }] (ok: can be hunted: not hidden, not morphed, not in a safe spot)
    step(dt, players) {
        // A checkpoint keeps the heads out only while someone is in it (so they don't cut the maze into
        // pockets a head can never leave); a head caught inside when someone arrives vanishes home
        const m = this.m, block = this.block;
        this.time = (this.time || 0) + dt;
        block.fill(0);
        for (const p of players) if (p.safe) { const c = cellAt(m, p.x, p.z); if (c >= 0 && m.safe[c]) block[c] = 1; }
        for (const h of this.heads) { const c = cellAt(m, h.x, h.z); if (c >= 0 && block[c]) this.sendHome(h); }
        for (const h of this.heads) { h.want = false; this.think(h, dt, players); }
        this.separate();
        // A head that wants to go somewhere but hasn't moved for a while (two heads face to face in a
        // corridor, a way blocked by a safe room someone just walked into) picks another way, and
        // may squeeze past the other heads for a moment
        for (const h of this.heads) {
            if (h.squeeze > 0) h.squeeze -= dt;
            // (net movement: two heads pushing against each other jiggle, but get nowhere)
            if (!h.want || h.ax === undefined || Math.hypot(h.x - h.ax, h.z - h.az) > 1.5) { h.ax = h.x; h.az = h.z; h.stuckT = 0; continue; }
            h.stuckT += dt;
            if (h.stuckT < 1.2) continue;
            h.ax = h.x; h.az = h.z;
            h.stuckT = 0; h.squeeze = 1.5;
            if (h.mode === MODES.wander) { h.target = -1; h.prev = -1; h.pause = 0; }
            else if (h.mode === MODES.search) this.setMode(h, MODES.wander);
            else h.plan = 0;
        }
    }
    think(h, dt, players) {
        const m = this.m, def = h.def;
        h.t += dt;
        if (h.mode === MODES.stun) {
            h.ry = wrap(h.ry + dt * 5);
            if (h.t > CFG.stunSecs) this.setMode(h, MODES.wander);
            return;
        }
        // after a catch it cackles, then vanishes home: never waiting where its victim respawns
        if (h.mode === MODES.laugh) { if (h.t > 1.7) this.sendHome(h); return; }
        // ----- who can it see or hear? -----
        let best = null, bd = Infinity;
        for (const p of players) {
            if (!p.ok || p.y > REACH_Y) continue;
            const d = Math.hypot(p.x - h.x, p.z - h.z);
            if (d > def.sight || d >= bd) continue;
            // just lost them to a safe room: it isn't interested in them for a bit unless they walk right up
            if (h.bored && h.bored.id === p.id && this.time < h.bored.until && d > def.hear * 0.7) continue;
            if (def.ghost || def.boss || d < def.hear || lineClear(m, h.x, h.z, p.x, p.z)) { best = p; bd = d; }
        }
        const target = h.chase && players.find((p) => p.id === h.chase);
        if (best && (h.mode !== MODES.chase && h.mode !== MODES.rest)) {
            h.chase = best.id; h.mode = MODES.chase; h.t = 0; h.burst = 0; h.plan = 0;
            this.events.push([h.k, 'spot']);
        }
        if (h.mode === MODES.chase || h.mode === MODES.rest) {
            // keep after the one it's chasing while it can still sense them; switch to someone closer
            const cur = target && target.ok && target.y <= REACH_Y ? target : null;
            if (best && (!cur || bd < Math.hypot(cur.x - h.x, cur.z - h.z) - 8)) h.chase = best.id;
            const p = players.find((q) => q.id === h.chase);
            const sensed = p && p.ok && p.y <= REACH_Y && (def.ghost || def.boss || Math.hypot(p.x - h.x, p.z - h.z) < def.hear || (Math.hypot(p.x - h.x, p.z - h.z) < def.sight && lineClear(m, h.x, h.z, p.x, p.z)));
            if (sensed) { h.seenT = 0; h.seenX = p.x; h.seenZ = p.z; } else h.seenT += dt;
            if (p && p.safe) {
                // they made it into a safe room: it backs off down the corridors instead of
                // camping the doorway
                this.retreat(h, p);
                this.events.push([h.k, 'lost']);
                return;
            }
            if (!p || !p.ok || h.seenT > LOSE_SECS) {
                // lost them: go and look where they were last seen
                h.mode = MODES.search; h.t = 0; h.chase = null;
                h.target = cellAt(m, h.seenX, h.seenZ);
                if (h.target < 0 || this.block[h.target]) h.target = -1;
                this.events.push([h.k, 'lost']);
            } else {
                // fast heads sprint in bursts and pant in between
                if (def.burst) {
                    h.burst += dt;
                    if (h.mode === MODES.chase && h.burst > def.burst) { h.mode = MODES.rest; h.burst = 0; this.events.push([h.k, 'rest']); }
                    else if (h.mode === MODES.rest && h.burst > def.rest) { h.mode = MODES.chase; h.burst = 0; }
                }
                const speed = h.mode === MODES.rest ? 3.5 : this.st.speed * def.chase;
                this.hunt(h, p, speed, dt);
                return;
            }
        }
        if (h.mode === MODES.search) {
            if (h.target < 0 || h.t > 8) { this.setMode(h, MODES.wander); return; }
            const c = cellCenter(m, h.target);
            if (Math.hypot(c.x - h.x, c.z - h.z) < 1.5) { this.setMode(h, MODES.wander); return; }
            this.followPath(h, h.target, this.st.speed * def.chase * 0.7, dt);
            return;
        }
        this.wander(h, dt);
    }
    // Off to a cell a few steps away: off the way to the EXIT if it can (a side corridor), far from the
    // player and rather back where they've already been than on ahead where they're going; bored of
    // them for a few seconds (so they get a chance to slip past). Search mode walks it there.
    retreat(h, p) {
        const m = this.m;
        const here = cellAt(m, h.x, h.z);
        if (here >= 0) h.cell = here;
        if (!this.onPath) { this.onPath = new Set(m.path); this.toExit = bfs(m, m.exit).dist; }
        const pc = cellAt(m, p.x, p.z), pd = pc >= 0 ? this.toExit[pc] : this.toExit[m.start] + 1;
        const { dist } = bfs(m, h.cell, this.block);
        let best = -1, bs = -Infinity;
        for (let c = 0; c < dist.length; c++) {
            if (dist[c] < 3 || dist[c] > 10 || m.safe[c]) continue;
            const q = cellCenter(m, c);
            const s = Math.hypot(q.x - p.x, q.z - p.z) + (this.toExit[c] - pd) * 4 + this.rnd() * 8 - (this.onPath.has(c) ? 60 : 0);
            if (s > bs) { bs = s; best = c; }
        }
        this.setMode(h, MODES.search);
        h.target = best;
        h.bored = { id: p.id, until: this.time + 6 };
    }
    // Walk the corridors: on to the next cell, rarely back the way it came, sometimes stopping to
    // look round
    wander(h, dt) {
        const m = this.m;
        if (h.pause > 0) { h.pause -= dt; h.ry = wrap(h.ry + Math.sin(h.t * 2.2) * dt * 1.2); return; }
        const arrived = h.target >= 0 && Math.abs(h.wx - h.x) < 0.8 && Math.abs(h.wz - h.z) < 0.8;
        if (h.target < 0 || arrived) {
            if (arrived) { h.prev = h.from; h.cell = h.target; } else { const here = cellAt(m, h.x, h.z); if (here >= 0) h.cell = here; h.prev = -1; }
            const opts = neighbours(m, h.cell).filter((b) => !this.block[b]);
            if (!opts.length) { h.pause = 1; return; }
            let pick = opts.filter((b) => b !== h.prev);
            if (!pick.length) pick = opts;
            // keep going straight more often than not
            const dx = h.cell - h.prev, straight = h.prev >= 0 ? pick.find((b) => b - h.cell === dx) : undefined;
            h.from = h.cell;
            h.target = straight !== undefined && this.rnd() < 0.55 ? straight : pick[Math.floor(this.rnd() * pick.length)];
            const c = cellCenter(m, h.target);
            h.wx = c.x; h.wz = c.z;
            if (this.rnd() < 0.12) h.pause = 0.6 + this.rnd() * 1.2;
        }
        this.moveTo(h, h.wx, h.wz, h.def.wander, dt, h.def.ghost);
    }
    // Chase a player: straight at them when there's nothing in the way, else the shortest way
    // round through the maze (re-planned a few times a second)
    hunt(h, p, speed, dt) {
        const m = this.m;
        if (h.def.ghost) { this.moveTo(h, p.x, p.z, speed, dt, true); return; }
        const near = Math.hypot(p.x - h.x, p.z - h.z);
        if (near < CELL * 1.2 && lineClear(m, h.x, h.z, p.x, p.z) && sameBand(m, h, p)) { this.moveTo(h, p.x, p.z, speed, dt); return; }
        const pc = cellAt(m, p.x, p.z);
        if (pc < 0) return;
        this.followPath(h, pc, speed, dt);
    }
    followPath(h, goal, speed, dt) {
        const m = this.m;
        h.plan -= dt;
        const here = cellAt(m, h.x, h.z);
        if (here >= 0) h.cell = here;
        if (Math.abs(h.wx - h.x) < 0.6 && Math.abs(h.wz - h.z) < 0.6) h.plan = 0;
        if (h.plan <= 0 || h.goal !== goal) {
            h.plan = PLAN_SECS; h.goal = goal;
            const { prev } = bfs(m, goal, this.block);
            // walk the BFS tree from where the head is back toward the goal: the run of cells in a
            // straight line from here is where it heads next (so it doesn't zig-zag cell by cell)
            let a = h.cell, next = a;
            const r0 = Math.floor(a / m.cols), c0 = a % m.cols;
            for (let k = 0; k < 8; k++) {
                const b = prev[a];
                if (b < 0) break;
                if (Math.floor(b / m.cols) !== r0 && b % m.cols !== c0) { if (next === h.cell) next = b; break; }
                next = b; a = b;
            }
            if (prev[h.cell] < 0 && h.cell !== goal) next = h.cell;
            const c = cellCenter(m, next);
            h.wx = c.x; h.wz = c.z;
        }
        this.moveTo(h, h.wx, h.wz, speed, dt, h.def.ghost);
    }
    moveTo(h, x, z, speed, dt, ghost) {
        const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz);
        h.speed = 0;
        if (d < 0.05) return;
        h.want = true;
        if (!h.def.ghost) { const here = cellAt(this.m, h.x, h.z); if (here >= 0) speed *= this.slow[here]; }
        const step = Math.min(d, speed * dt);
        let nx = h.x + dx / d * step, nz = h.z + dz / d * step;
        const m = this.m;
        if (ghost) {
            // through walls, but never into a safe cell someone is in, or out of the maze
            const c = cellAt(m, nx, nz);
            if (c < 0 || this.block[c]) return;
        } else {
            const q = clampToCorridor(m, nx, nz, h.r);
            nx = q.x; nz = q.z;
            const c = cellAt(m, nx, nz);
            if (c < 0 || this.block[c]) return;
        }
        h.speed = Math.hypot(nx - h.x, nz - h.z) / Math.max(dt, 1e-3);
        h.x = nx; h.z = nz;
        const want = Math.atan2(dx, dz);
        h.ry = wrap(h.ry + wrap(want - h.ry) * Math.min(1, dt * 8));
    }
    // Heads don't pass through each other (ghosts float through everything)
    separate() {
        const hs = this.heads;
        for (let a = 0; a < hs.length; a++) for (let b = a + 1; b < hs.length; b++) {
            const p = hs[a], q = hs[b];
            if (p.def.ghost || q.def.ghost || p.squeeze > 0 || q.squeeze > 0) continue;
            const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz), min = (p.r + q.r) * 0.85;
            if (d >= min || d < 1e-3) continue;
            const push = (min - d) / 2, ux = dx / d, uz = dz / d;
            for (const [h, s] of [[p, -1], [q, 1]]) {
                const c = clampToCorridor(this.m, h.x + ux * push * s, h.z + uz * push * s, h.r);
                const cell = cellAt(this.m, c.x, c.z);
                if (cell >= 0 && !this.block[cell]) { h.x = c.x; h.z = c.z; }
            }
        }
    }
    // [x, z, ry, mode] per head, rounded (what the clients draw)
    pack() {
        const out = [];
        for (const h of this.heads) out.push(Math.round(h.x * 10) / 10, Math.round(h.z * 10) / 10, Math.round(h.ry * 100) / 100, h.mode);
        return out;
    }
    // Which heads are chasing this player (a bit per head)
    chasing(id) {
        let mask = 0;
        this.heads.forEach((h, k) => { if (h.chase === id && h.mode === MODES.chase) mask |= 1 << k; });
        return mask;
    }
}

// Keeps a head of radius r inside the corridors: it can only cross a cell's edge where that edge
// is open, and then only through the middle of the passage
export function clampToCorridor(m, x, z, r) {
    const c = Math.max(0, Math.min(m.cols - 1, Math.floor((x - m.x0) / CELL)));
    const rr = Math.max(0, Math.min(m.rows - 1, Math.floor((z - m.z0) / CELL)));
    const a = rr * m.cols + c, rad = Math.min(r, HALF - 0.3);
    const lo = WALL / 2 + rad, hi = CELL - WALL / 2 - rad;
    let fx = x - m.x0 - c * CELL, fz = z - m.z0 - rr * CELL;
    const W = c === 0 || m.E[a - 1], E = c === m.cols - 1 || m.E[a];
    const S = rr === 0 || m.S[a - m.cols], N = rr === m.rows - 1 || m.S[a];
    if (fx < lo && W) fx = lo;
    if (fx > hi && E) fx = hi;
    if (fz < lo && S) fz = lo;
    if (fz > hi && N) fz = hi;
    if (fx < lo || fx > hi) fz = Math.max(lo, Math.min(hi, fz));
    if (fz < lo || fz > hi) fx = Math.max(lo, Math.min(hi, fx));
    return { x: m.x0 + c * CELL + fx, z: m.z0 + rr * CELL + fz };
}
// Is the player in the head's straight corridor band (so a straight dash can't cut a corner)?
function sameBand(m, h, p) {
    const ch = cellAt(m, h.x, h.z), cp = cellAt(m, p.x, p.z);
    if (ch < 0 || cp < 0) return false;
    if (ch === cp) return true;
    return (ch % m.cols === cp % m.cols) || (Math.floor(ch / m.cols) === Math.floor(cp / m.cols));
}
