// The whole map as plain data, shared by the client (which builds meshes and colliders from it)
// and the server (which moves the heads through the mazes and checks pads, coins, keys and exits).
//
// The lobby sits at the origin: a haunted hall 180 x 140 studs with the stage doors along its north
// wall. Every stage is its own maze far out to the east: a grid of CELL-stud cells with WALL-thick,
// WALL_H-tall walls, a safe start room south of it (with the first checkpoint) and the EXIT room
// north of it. Row 0 is the south edge (z0), column 0 the west edge (x0); +z is north.
// Mazes are generated from a fixed seed per stage, so the client and the server build the same one.
import { STAGES, HEAD_TYPES, rngFrom } from './config.js';

export const CELL = 16;               // studs per maze cell
export const WALL = 3;                // wall thickness
export const WALL_H = 24;             // wall height
export const HALF = (CELL - WALL) / 2; // half a corridor's width (6.5)
export const ROOM_W = 30, ROOM_D = 26; // the start / exit rooms
export const DECK_Y = WALL_H + 1.4;   // the tops of the bridges and lookouts (just over the wall caps)
export const CAP = 0.7;               // the trim along the top of every wall

// ----- the lobby -----
export const LOBBY = { x0: -90, x1: 90, z0: -70, z1: 70, wallH: 34 };
export const SPAWN = { x: 0, y: 0, z: -44, yaw: 0 };
// The stage doors along the north wall: Stage 1 on the left as you come in (east), the BOSS door last
export const DOORS = STAGES.map((s, i) => ({ i, x: 78 - i * 13, z: LOBBY.z1 - 1.6 }));
// The gear on display down the west wall (the limited ones are in the Free Items booth)
export const GEAR_PADS = ['speedCoil', 'gravityCoil', 'slap', 'jetpack', 'wings', 'superCoil', 'rocket']
    .map((id, k) => ({ id, x: LOBBY.x0 + 9, z: -46 + k * 12 }));
// The Free Items booth (south-west corner): the limited items, free after enough playtime
export const BOOTH = { x: -58, z: -54 };
export const LIMITED_PADS = [{ id: 'scythe', x: -66, z: -50 }, { id: 'potion', x: -50, z: -50 }];
// Hats on pedestals along the south wall (east half)
export const HAT_PADS = ['pumpkin', 'mask', 'valkyrie', 'dominus'].map((id, k) => ({ id, x: 34 + k * 13, z: LOBBY.z0 + 10 }));
// "Become the Angry Head" (the reference's 100 Coin poster), north-west, by the BOSS door
export const MORPH_PAD = { x: LOBBY.x0 + 12, z: 46 };
// The leaderboards on the east wall
export const BOARD_SPOTS = [{ key: 'coins', z: -38 }, { key: 'escapes', z: -12 }, { key: 'scares', z: 14 }];

// ----- the stages -----
export function stageOrigin(i) { return { x: 700 + (i % 4) * 520, z: -700 + Math.floor(i / 4) * 560 }; }

export const MAZES = [];        // per stage: everything below
export const CHECKPOINTS = [];  // { id, s, k, x, y, z, yaw }: k 0 = the start room's pad
export const COINS = [];        // { i, s, x, y, z }
export const KEYS = [];         // { id, s, x, y, z }

const idxOf = (m, c, r) => r * m.cols + c;
export const cellCenter = (m, cell) => ({ x: m.x0 + ((cell % m.cols) + 0.5) * CELL, z: m.z0 + (Math.floor(cell / m.cols) + 0.5) * CELL });
export function cellAt(m, x, z) {
    const c = Math.floor((x - m.x0) / CELL), r = Math.floor((z - m.z0) / CELL);
    if (c < 0 || r < 0 || c >= m.cols || r >= m.rows) return -1;
    return idxOf(m, c, r);
}
// Is the edge between cell a and its neighbour b open?
export function passable(m, a, b) {
    const d = b - a;
    if (d === 1) return (a % m.cols) < m.cols - 1 && !m.E[a];
    if (d === -1) return (b % m.cols) < m.cols - 1 && !m.E[b];
    if (d === m.cols) return !m.S[a];
    if (d === -m.cols) return !m.S[b];
    return false;
}
export function neighbours(m, a) {
    const out = [], c = a % m.cols, r = Math.floor(a / m.cols);
    if (c > 0 && !m.E[a - 1]) out.push(a - 1);
    if (c < m.cols - 1 && !m.E[a]) out.push(a + 1);
    if (r > 0 && !m.S[a - m.cols]) out.push(a - m.cols);
    if (r < m.rows - 1 && !m.S[a]) out.push(a + m.cols);
    return out;
}
// Breadth-first distances (in cells) from `from`; `blocked` cells are never entered
export function bfs(m, from, blocked) {
    const n = m.cols * m.rows, dist = new Int16Array(n).fill(-1), prev = new Int16Array(n).fill(-1), q = new Int16Array(n);
    let h = 0, t = 0;
    dist[from] = 0; q[t++] = from;
    while (h < t) {
        const a = q[h++];
        for (const b of neighbours(m, a)) {
            if (dist[b] >= 0 || (blocked && blocked[b] && b !== from)) continue;
            dist[b] = dist[a] + 1; prev[b] = a; q[t++] = b;
        }
    }
    return { dist, prev };
}
// Is (x, z) inside a wall of this maze? (inside the grid; edges within WALL/2, corners always)
export function solidAt(m, x, z) {
    const lx = x - m.x0, lz = z - m.z0;
    if (lx < 0 || lz < 0 || lx > m.cols * CELL || lz > m.rows * CELL) return true;
    const c = Math.min(m.cols - 1, Math.floor(lx / CELL)), r = Math.min(m.rows - 1, Math.floor(lz / CELL));
    const fx = lx - c * CELL, fz = lz - r * CELL, h = WALL / 2;
    const w = fx < h, e = fx > CELL - h, s = fz < h, n = fz > CELL - h;
    if ((w || e) && (s || n)) return true;
    const a = idxOf(m, c, r);
    if (w) return c === 0 || !!m.E[a - 1];
    if (e) return c === m.cols - 1 || !!m.E[a];
    if (s) return r === 0 ? c !== m.startCol : !!m.S[a - m.cols];
    if (n) return r === m.rows - 1 ? c !== m.exitCol : !!m.S[a];
    return false;
}
// A clear straight line between two points (no wall in the way), sampled every 1.5 studs
export function lineClear(m, ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 1.5));
    for (let k = 1; k < n; k++) if (solidAt(m, ax + (bx - ax) * k / n, az + (bz - az) * k / n)) return false;
    return true;
}
// Which stage (or the lobby, -1) a point is in; null if neither
export function stageAt(x, y, z) {
    if (x >= LOBBY.x0 - 2 && x <= LOBBY.x1 + 2 && z >= LOBBY.z0 - 2 && z <= LOBBY.z1 + 2) return -1;
    for (const m of MAZES) { const b = m.box; if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return m.i; }
    return null;
}
// The safe spots: the start room, the checkpoint cells and the entry cell (no catches there, and
// no head goes into one while someone is in it)
export function isSafe(m, x, z) {
    if (z < m.z0 || z > m.z1) return true;
    const cell = cellAt(m, x, z);
    return cell >= 0 && !!m.safe[cell];
}

function genMaze(i) {
    const s = STAGES[i], o = stageOrigin(i), rnd = rngFrom(4099 + i * 7919);
    const cols = s.cols, rows = s.rows, N = cols * rows;
    const m = {
        i, cols, rows, x0: o.x, z0: o.z, x1: o.x + cols * CELL, z1: o.z + rows * CELL,
        E: new Uint8Array(N).fill(1), S: new Uint8Array(N).fill(1),
        startCol: Math.floor(cols / 2), exitCol: 0, start: 0, exit: 0,
        path: [], safe: new Uint8Array(N), checkpoints: [], heads: [], coins: [], keys: [],
        lookouts: [], bridge: null, hazards: [], arrows: [], deadEnds: [],
    };
    const open = (a, b) => {
        if (b === a + 1) m.E[a] = 0; else if (b === a - 1) m.E[b] = 0;
        else if (b === a + cols) m.S[a] = 0; else if (b === a - cols) m.S[b] = 0;
    };
    // ----- carve: a growing tree (newest cell most of the time, sometimes a random one), which
    // mixes long winding corridors with plenty of side branches and dead ends -----
    m.start = idxOf(m, m.startCol, 0);
    const seen = new Uint8Array(N), live = [m.start];
    seen[m.start] = 1;
    const newest = s.boss ? 0.55 : 0.86;
    while (live.length) {
        const k = rnd() < newest ? live.length - 1 : Math.floor(rnd() * live.length);
        const a = live[k], c = a % cols, r = Math.floor(a / cols), nb = [];
        if (c > 0 && !seen[a - 1]) nb.push(a - 1);
        if (c < cols - 1 && !seen[a + 1]) nb.push(a + 1);
        if (r > 0 && !seen[a - cols]) nb.push(a - cols);
        if (r < rows - 1 && !seen[a + cols]) nb.push(a + cols);
        if (!nb.length) { live.splice(k, 1); continue; }
        const b = nb[Math.floor(rnd() * nb.length)];
        open(a, b); seen[b] = 1; live.push(b);
    }
    // ----- the exit: the top-row cell farthest from the start -----
    let fromStart = bfs(m, m.start);
    let best = -1;
    for (let c = 0; c < cols; c++) { const a = idxOf(m, c, rows - 1); if (fromStart.dist[a] > best) { best = fromStart.dist[a]; m.exit = a; } }
    m.exitCol = m.exit % cols;
    // ----- loops: knock out a few more walls, so there's often another way round a head (never an
    // open 2x2 square except in the boss's arena, and never a big shortcut to the exit) -----
    const loops = Math.round(s.open * N), keep = best * (s.boss ? 0.6 : 0.85);
    for (let n = 0, tries = 0; n < loops && tries < N * 20; tries++) {
        const a = Math.floor(rnd() * N), c = a % cols, r = Math.floor(a / cols), east = rnd() < 0.5;
        if (east ? c >= cols - 1 || !m.E[a] : r >= rows - 1 || !m.S[a]) continue;
        if (east) m.E[a] = 0; else m.S[a] = 0;
        if ((!s.boss && makesSquare(m, a)) || bfs(m, m.start).dist[m.exit] < keep) { if (east) m.E[a] = 1; else m.S[a] = 1; continue; }
        n++;
    }
    fromStart = bfs(m, m.start);
    for (let a = m.exit; a >= 0; a = fromStart.prev[a]) m.path.unshift(a);
    const onPath = new Uint8Array(N);
    m.path.forEach((a) => { onPath[a] = 1; });
    const L = m.path.length;
    // ----- the safe cells: the entry cell and the checkpoints along the way -----
    m.safe[m.start] = 1;
    const cpCount = s.boss ? 0 : L > 34 ? 3 : L > 18 ? 2 : 1;
    const cpCells = [];
    for (let k = 1; k <= cpCount; k++) {
        let at = Math.round((L - 1) * k / (cpCount + 1));
        // prefer a plain corridor cell (two ways out), searching a little either way
        for (let d = 0; d < 4; d++) {
            const a = m.path[Math.min(L - 2, at + d)], b = m.path[Math.max(1, at - d)];
            if (neighbours(m, a).length === 2) { at = m.path.indexOf(a); break; }
            if (neighbours(m, b).length === 2) { at = m.path.indexOf(b); break; }
        }
        const cell = m.path[Math.max(1, Math.min(L - 2, at))];
        if (cpCells.includes(cell)) continue;
        cpCells.push(cell);
        m.safe[cell] = 1;
    }
    // the start room's pad, then the checkpoint cells (facing on along the path)
    const sx = m.x0 + (m.startCol + 0.5) * CELL;
    m.checkpoints.push({ k: 0, x: sx, y: 0, z: m.z0 - ROOM_D / 2 - 1, yaw: 0, cell: -1 });
    cpCells.sort((a, b) => m.path.indexOf(a) - m.path.indexOf(b)).forEach((cell, k) => {
        const p = cellCenter(m, cell), nx = m.path[m.path.indexOf(cell) + 1], q = cellCenter(m, nx);
        m.checkpoints.push({ k: k + 1, x: p.x, y: 0, z: p.z, yaw: Math.atan2(q.x - p.x, q.z - p.z), cell });
    });
    // dead ends (one way out), for coins and keys
    for (let a = 0; a < N; a++) if (neighbours(m, a).length === 1 && a !== m.start && a !== m.exit && !m.safe[a]) m.deadEnds.push(a);
    // ----- the heads: spread out, well away from the entry and the checkpoints -----
    const cand = [];
    for (let a = 0; a < N; a++) {
        if (m.safe[a] || fromStart.dist[a] < 4) continue;
        if (neighbours(m, a).some((b) => m.safe[b])) continue;
        cand.push(a);
    }
    const chosen = [m.start];
    const cdist = (a, b) => Math.hypot((a % cols) - (b % cols), Math.floor(a / cols) - Math.floor(b / cols));
    const nearExit = bfs(m, m.exit).dist;
    for (const type of s.heads) {
        let bestA = -1, bestD = -1;
        for (const a of cand) {
            if (chosen.includes(a)) continue;
            // the boss starts near the middle of its arena; the rest spread out
            // (off the way to the EXIT and not right beside it if it can: a head that starts in your
            // corridor, and goes back there after every catch, would always be in the way)
            const d = HEAD_TYPES[type].boss ? 100 - cdist(a, idxOf(m, cols >> 1, rows >> 1)) * 4 : Math.min(...chosen.map((b) => cdist(a, b))) + rnd() * 0.8 - (onPath[a] ? 2.5 : 0) - (nearExit[a] < 4 ? 3 : 0);
            if (d > bestD) { bestD = d; bestA = a; }
        }
        if (bestA < 0) bestA = cand[Math.floor(rnd() * cand.length)];
        chosen.push(bestA);
        m.heads.push({ type, cell: bestA });
    }
    // ----- keys: the dead ends farthest off the path (the EXIT is locked until you have them) -----
    if (s.keys) {
        const offPath = bfsMulti(m, m.path);
        const ends = m.deadEnds.slice().sort((a, b) => offPath[b] - offPath[a] || fromStart.dist[b] - fromStart.dist[a]);
        for (let k = 0; k < s.keys && k < ends.length; k++) {
            const p = cellCenter(m, ends[k]);
            m.keys.push({ cell: ends[k], x: p.x, y: 3, z: p.z });
        }
    }
    // ----- coins: in the dead ends (a risk!), and a few along the way -----
    const keyCells = new Set(m.keys.map((k) => k.cell));
    const ends = m.deadEnds.filter((a) => !keyCells.has(a));
    const nEnd = Math.min(ends.length, Math.max(5, Math.round(N / 6)));
    for (let k = 0; k < nEnd; k++) { const j = k + Math.floor(rnd() * (ends.length - k)); [ends[k], ends[j]] = [ends[j], ends[k]]; }
    for (let k = 0; k < nEnd; k++) { const p = cellCenter(m, ends[k]); m.coins.push({ x: p.x, y: 3, z: p.z }); }
    for (let k = 3; k < L - 2; k += 5) { if (m.safe[m.path[k]]) continue; const p = cellCenter(m, m.path[k]); m.coins.push({ x: p.x + (rnd() - 0.5) * 4, y: 3, z: p.z + (rnd() - 0.5) * 4 }); }
    // ----- the bridge: a plank bridge over the walls, a shortcut no head can follow -----
    if (s.bridge) m.bridge = findBridge(m, rnd, i);
    // ----- lookouts: a truss up a wall to a little platform on top (safe, and you can see around) -----
    for (const f of i === 0 ? [0.25, 0.62] : [0.4]) {
        let k = Math.round((L - 1) * f);
        while (k < L - 1 && m.safe[m.path[k]]) k++;
        const lo = lookoutAt(m, m.path[k], rnd);
        if (lo && !m.lookouts.some((q) => q.cell === lo.cell) && !(m.bridge && (m.bridge.A === lo.cell || m.bridge.B === lo.cell))) m.lookouts.push(lo);
    }
    // ----- floor hazards -----
    if (s.hazard) placeHazards(m, s.hazard, rnd, onPath);
    // ----- green guide arrows on the floor at the path's junctions (fewer in later stages) -----
    const share = i === 0 ? 1 : i < 3 ? 0.7 : i < 6 ? 0.45 : i < 9 ? 0.3 : s.boss ? 0 : 0.2;
    for (let k = 1; k < L - 1; k++) {
        const a = m.path[k];
        if (neighbours(m, a).length < 3 || m.safe[a] || rnd() > share) continue;
        const p = cellCenter(m, a), q = cellCenter(m, m.path[k + 1]);
        m.arrows.push({ x: p.x, z: p.z, yaw: Math.atan2(q.x - p.x, q.z - p.z) });
    }
    // ----- the rooms and the space the stage owns -----
    const ex = m.x0 + (m.exitCol + 0.5) * CELL;
    m.startRoom = { x0: sx - ROOM_W / 2, x1: sx + ROOM_W / 2, z0: m.z0 - ROOM_D, z1: m.z0 };
    m.exitRoom = { x0: ex - ROOM_W / 2, x1: ex + ROOM_W / 2, z0: m.z1, z1: m.z1 + ROOM_D };
    m.exitPad = { x: ex, z: m.z1 + ROOM_D * 0.55 };
    m.lobbyDoor = { x: sx, z: m.z0 - ROOM_D + 2.2 };
    m.box = { x0: m.x0 - 8, x1: m.x1 + 8, z0: m.z0 - ROOM_D - 8, z1: m.z1 + ROOM_D + 8 };
    return m;
}
function makesSquare(m, a) {
    const cols = m.cols, c = a % cols, r = Math.floor(a / cols);
    for (const [dc, dr] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        const c0 = c + dc, r0 = r + dr;
        if (c0 < 0 || r0 < 0 || c0 >= cols - 1 || r0 >= m.rows - 1) continue;
        const b = idxOf(m, c0, r0);
        if (!m.E[b] && !m.S[b] && !m.E[b + cols] && !m.S[b + 1]) return true;
    }
    return false;
}
// Distance (cells) from the nearest of a set of cells
function bfsMulti(m, from) {
    const n = m.cols * m.rows, d = new Int16Array(n).fill(9999), q = [];
    for (const a of from) { d[a] = 0; q.push(a); }
    for (let h = 0; h < q.length; h++) for (const b of neighbours(m, q[h])) if (d[b] > d[q[h]] + 1) { d[b] = d[q[h]] + 1; q.push(b); }
    return d;
}
// Does cell a have a wall on side (wx, wz)?
function hasWall(m, a, wx, wz) {
    const c = a % m.cols, r = Math.floor(a / m.cols);
    if (wx < 0) return c === 0 || !!m.E[a - 1];
    if (wx > 0) return c === m.cols - 1 || !!m.E[a];
    if (wz < 0) return r === 0 ? c !== m.startCol : !!m.S[a - m.cols];
    return r === m.rows - 1 ? c !== m.exitCol : !!m.S[a];
}
// A truss against cell a's wall on side (wx, wz), and a deck on top of that wall from `lo` to `hi`
// along it. The deck starts just past the wall's inner face, so a climber at the top of the truss
// steps over onto it (nothing hangs over the truss).
function wallDeck(m, a, wx, wz, lo, hi) {
    const p = cellCenter(m, a), alongZ = wx !== 0;
    const nOff = HALF + 2.3;
    const deck = alongZ ? { x: p.x + wx * nOff, z: (lo + hi) / 2, sx: 4.4, sz: hi - lo } : { x: (lo + hi) / 2, z: p.z + wz * nOff, sx: hi - lo, sz: 4.4 };
    const truss = { x: p.x + wx * (HALF - 0.7), z: p.z + wz * (HALF - 0.7), sx: alongZ ? 1.4 : 3.2, sz: alongZ ? 3.2 : 1.4, nx: wx, nz: wz };
    return { deck, truss };
}
// Two cells of the path in a straight line a few cells apart that the path takes the long way
// round between: a truss up a side wall of the first, a plank bridge along the top of that wall
// line over to the second, then drop down into it
function findBridge(m, rnd, i) {
    const P = m.path, L = P.length;
    let best = null, bestScore = 0;
    for (let a = 1; a < L - 4; a++) {
        for (let b = a + 6; b < L - 1; b++) {
            const A = P[a], B = P[b];
            if (m.safe[A] || m.safe[B]) continue;
            const ca = A % m.cols, ra = Math.floor(A / m.cols), cb = B % m.cols, rb = Math.floor(B / m.cols);
            if (ca !== cb && ra !== rb) continue;
            const span = Math.abs(ca - cb) + Math.abs(ra - rb);
            if (span < 2 || span > 6) continue;
            const alongX = ra === rb;
            const sides = alongX ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
            const side = sides.find(([wx, wz]) => hasWall(m, A, wx, wz));
            if (!side) continue;
            const score = (b - a) - span * 1.5 + rnd() * 0.5;
            if (score > bestScore) { bestScore = score; best = { a, b, A, B, alongX, side }; }
        }
    }
    if (!best) return null;
    const pa = cellCenter(m, best.A), pb = cellCenter(m, best.B), { alongX, side } = best;
    const dir = alongX ? Math.sign(pb.x - pa.x) : Math.sign(pb.z - pa.z);
    const ua = alongX ? pa.x : pa.z, ub = alongX ? pb.x : pb.z;
    const base = wallDeck(m, best.A, side[0], side[1], Math.min(ua - dir * 3, ub + dir * 3), Math.max(ua - dir * 3, ub + dir * 3));
    // the deck, broken by gaps to jump on later stages
    const gaps = i < 4 ? 0 : i < 8 ? 1 : 2, gapW = i < 8 ? 4.5 : 5.5;
    const u0 = ua - dir * 3, len = Math.abs(ub - ua) + 6;
    const cuts = [];
    for (let g = 0; g < gaps; g++) cuts.push(3 + (len - 6) * (g + 1) / (gaps + 1));
    const pieces = [];
    let from = 0;
    for (const c of cuts) { pieces.push([from, c - gapW / 2]); from = c + gapW / 2; }
    pieces.push([from, len]);
    const d = base.deck;
    const decks = pieces.map(([p0, p1]) => {
        const a0 = u0 + dir * p0, a1 = u0 + dir * p1, lo = Math.min(a0, a1), hi = Math.max(a0, a1);
        return alongX ? { x: (lo + hi) / 2, z: d.z, sx: hi - lo, sz: d.sz } : { x: d.x, z: (lo + hi) / 2, sx: d.sx, sz: hi - lo };
    });
    const endX = alongX ? pb.x : d.x, endZ = alongX ? d.z : pb.z;
    return { A: best.A, B: best.B, alongX, dir, side, truss: base.truss, decks, end: { x: endX, z: endZ }, drop: { x: pb.x, z: pb.z }, skip: best.b - best.a };
}
// A lookout: a truss up one of path cell a's walls to a little deck on top of it
function lookoutAt(m, a, rnd) {
    const walls = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([wx, wz]) => hasWall(m, a, wx, wz));
    if (!walls.length) return null;
    const [wx, wz] = walls[Math.floor(rnd() * walls.length)];
    const p = cellCenter(m, a), u = wx !== 0 ? p.z : p.x;
    const { deck, truss } = wallDeck(m, a, wx, wz, u - 4, u + 4);
    return { cell: a, truss, deck };
}
function placeHazards(m, kind, rnd, onPath) {
    const N = m.cols * m.rows;
    if (kind === 'slime' || kind === 'ice') {
        // pools / patches covering a cell's floor (some on the way, so you have to cross them)
        const share = kind === 'ice' ? 0.24 : 0.14;
        for (let a = 0; a < N; a++) {
            if (m.safe[a] || a === m.exit || m.keys.some((k) => k.cell === a)) continue;
            if (rnd() > share * (onPath[a] ? 1.3 : 1)) continue;
            const p = cellCenter(m, a);
            m.hazards.push({ t: kind, x: p.x, z: p.z, sx: CELL - WALL - 0.2, sz: CELL - WALL - 0.2 });
        }
    } else if (kind === 'lava') {
        // glowing lava cracks across some of the passages between cells: jump them!
        for (let a = 0; a < N; a++) {
            for (const b of [a + 1, a + m.cols]) {
                if (b >= N || (b === a + 1 && a % m.cols === m.cols - 1) || !passable(m, a, b)) continue;
                if (m.safe[a] || m.safe[b] || rnd() > (onPath[a] && onPath[b] ? 0.32 : 0.16)) continue;
                const p = cellCenter(m, a), q = cellCenter(m, b), mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
                const alongX = b === a + 1;
                m.hazards.push({ t: 'lava', x: mx, z: mz, sx: alongX ? 3.2 : CELL - WALL, sz: alongX ? CELL - WALL : 3.2 });
            }
        }
    }
}

for (let i = 0; i < STAGES.length; i++) {
    const m = genMaze(i);
    MAZES.push(m);
    for (const cp of m.checkpoints) CHECKPOINTS.push({ id: CHECKPOINTS.length, s: i, ...cp });
    for (const c of m.coins) COINS.push({ i: COINS.length, s: i, ...c });
    for (const k of m.keys) KEYS.push({ id: KEYS.length, s: i, ...k });
}
export const cpOf = (s, k) => CHECKPOINTS.find((c) => c.s === s && c.k === k) || null;
// The whole world's extent (the server clamps positions to it)
export const WORLD = { x0: -120, x1: 700 + 4 * 520, z0: -760, z1: -700 + 4 * 560, y0: -40, y1: 140 };
