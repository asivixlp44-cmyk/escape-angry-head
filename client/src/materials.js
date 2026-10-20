// Textures and materials, all drawn in code at load (no image files) and all matte (Lambert) or
// unlit (Basic). Every maze wall and floor is a painted albedo plus a normal map made from the same
// painting's height (bricks, planks, tiles, rivets catch the light), tinted per stage through
// vertex colours, so all of them share ONE shader (the studded floor's). Also: the reference's red
// wood and black truss, the white star checkpoint pads (green once reached), coins, keys, slime,
// lava, ice and the green guide arrows. Each is made once and shared. No bloom, no reflections.
import { T, texFrom, matte, NEON_BOOST, renderer } from './engine.js';

const cache = new Map();
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
export const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; };
export function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const wrap = (t) => { t.wrapS = t.wrapT = T.RepeatWrapping; return t; };
const pick = (rnd, a) => a[Math.floor(rnd() * a.length) % a.length];
const lerp = (a, b, k) => a + (b - a) * k;
// Draws fn at (x, y) and at its wrapped copies near the edges, so the texture tiles seamlessly
function wrapped(W, H, x, y, r, fn) {
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
        const px = x + ox, py = y + oy;
        if (px + r < 0 || px - r > W || py + r < 0 || py - r > H) continue;
        fn(px, py);
    }
}
function fillNoise(x, W, H, rnd, n, colors, size, alpha) {
    for (let i = 0; i < n; i++) {
        const px = rnd() * W, py = rnd() * H, s = size * (0.5 + rnd());
        x.globalAlpha = alpha ?? 1;
        x.fillStyle = pick(rnd, colors);
        wrapped(W, H, px, py, s, (a, b) => x.fillRect(a, b, s, s));
    }
    x.globalAlpha = 1;
}
function blotches(x, W, H, rnd, n, color, r0, r1) {
    for (let i = 0; i < n; i++) {
        const px = rnd() * W, py = rnd() * H, r = r0 + rnd() * (r1 - r0);
        wrapped(W, H, px, py, r, (u, v) => { const g = x.createRadialGradient(u, v, 0, u, v, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(u - r, v - r, r * 2, r * 2); });
    }
}
function cracks(x, N, rnd, n, color, width) {
    x.strokeStyle = color; x.lineWidth = width; x.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
        let px = rnd() * N, py = rnd() * N, a = rnd() * Math.PI * 2;
        const pts = [[px, py]];
        for (let k = 0; k < 5 + rnd() * 7; k++) { a += (rnd() - 0.5) * 1.3; px += Math.cos(a) * 8; py += Math.sin(a) * 8; pts.push([px, py]); }
        for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { x.beginPath(); pts.forEach(([u, v], j) => (j ? x.lineTo(u + ox, v + oy) : x.moveTo(u + ox, v + oy))); x.stroke(); }
    }
}
function voronoiEdges(N, pts, width) {
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let d1 = 1e9, d2 = 1e9;
        for (const [px, py] of pts) {
            let dx = Math.abs(x - px), dy = Math.abs(y - py);
            if (dx > N / 2) dx = N - dx;
            if (dy > N / 2) dy = N - dy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        out[y * N + x] = Math.max(0, 1 - (d2 - d1) / width);
    }
    return out;
}
function imageFrom(N, fn) {
    const c = canvas(N), x = c.getContext('2d'), img = x.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { const [r, g, b] = fn(i); img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
    x.putImageData(img, 0, 0);
    return c;
}
const tex = (c) => wrap(texFrom(c));
const aniso = () => Math.min(8, renderer.capabilities.getMaxAnisotropy());

// =====================================================================================
// Painted surfaces: each painter draws the colour picture AND a grey height picture (white =
// raised) on a second canvas; the height becomes the normal map. Painted in light neutral tones
// so the stage's vertex colour tints them.
// =====================================================================================
function heightToNormal(hc, strength) {
    const N = hc.width, M = hc.height, src = hc.getContext('2d').getImageData(0, 0, N, M).data;
    const h = (x, y) => src[(((y + M) % M) * N + ((x + N) % N)) * 4] / 255;
    const out = canvas(N, M), x = out.getContext('2d'), img = x.createImageData(N, M);
    for (let y = 0; y < M; y++) for (let xx = 0; xx < N; xx++) {
        const dx = (h(xx + 1, y) - h(xx - 1, y)) * strength, dy = (h(xx, y + 1) - h(xx, y - 1)) * strength;
        const l = Math.hypot(dx, dy, 1), i = (y * N + xx) * 4;
        img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(out);
    t.colorSpace = T.NoColorSpace;
    return wrap(t);
}
function painter(N, draw, strength) {
    const a = canvas(N), hc = canvas(N);
    const x = a.getContext('2d'), hx = hc.getContext('2d');
    hx.fillStyle = '#808080'; hx.fillRect(0, 0, N, N);
    draw(x, hx, N);
    const map = tex(a);
    map.anisotropy = aniso();
    const nrm = heightToNormal(hc, strength ?? 3);
    nrm.anisotropy = aniso();
    return { map, nrm };
}
const SURF = {
    // the reference's poured concrete: speckles, soft stains, form-tie holes
    concrete: () => painter(256, (x, h, N) => {
        const rnd = seeded(11);
        x.fillStyle = '#d8dade'; x.fillRect(0, 0, N, N);
        blotches(x, N, N, rnd, 22, 'rgba(120,124,132,0.16)', 16, 46);
        blotches(x, N, N, rnd, 12, 'rgba(255,255,255,0.2)', 12, 34);
        fillNoise(x, N, N, rnd, 1400, ['#a8acb4', '#bcc0c6', '#eef0f2'], 1.6, 0.55);
        fillNoise(x, N, N, rnd, 260, ['#5a5e66', '#70747c'], 1.8, 0.75);
        fillNoise(h, N, N, rnd, 900, ['#707070', '#909090'], 2, 0.6);
        for (const [cx, cy] of [[N * 0.25, N * 0.25], [N * 0.75, N * 0.75]]) {
            x.fillStyle = '#7a7e86'; x.beginPath(); x.arc(cx, cy, 4, 0, Math.PI * 2); x.fill();
            h.fillStyle = '#303030'; h.beginPath(); h.arc(cx, cy, 4, 0, Math.PI * 2); h.fill();
        }
        // a faint seam between pours
        x.fillStyle = 'rgba(90,94,100,0.35)'; x.fillRect(0, N - 3, N, 2);
        h.fillStyle = '#404040'; h.fillRect(0, N - 3, N, 2);
    }, 2.2),
    planks: () => painter(256, (x, h, N) => {
        const rnd = seeded(47), PW = 32;
        for (let col = 0; col < N / PW; col++) {
            const px = col * PW, off = rnd() * N;
            x.fillStyle = pick(rnd, ['#e8c898', '#dcb888', '#f0d4a8', '#d4ae7c']); x.fillRect(px, 0, PW, N);
            for (let k = 0; k < 7; k++) {
                x.strokeStyle = pick(rnd, ['rgba(110,70,30,0.3)', 'rgba(255,240,220,0.25)']); x.lineWidth = 1 + rnd();
                x.beginPath(); const gx = px + 4 + rnd() * (PW - 8); x.moveTo(gx, 0);
                for (let py = 0; py <= N; py += 32) x.lineTo(gx + Math.sin(py * 0.05 + k) * 1.4, py);
                x.stroke();
            }
            // a knot
            if (rnd() < 0.6) { const ky = (off) % N; x.fillStyle = 'rgba(120,70,30,0.5)'; x.beginPath(); x.ellipse(px + PW / 2, ky, 4, 7, 0, 0, Math.PI * 2); x.fill(); }
            x.fillStyle = 'rgba(40,20,8,0.85)'; x.fillRect(px, 0, 3, N);
            h.fillStyle = '#202020'; h.fillRect(px, 0, 3, N);
            // the end joint of the plank, at a different height in each column
            const jy = Math.floor(rnd() * N);
            x.fillRect(px, jy, PW, 3); h.fillRect(px, jy, PW, 3);
            x.fillStyle = '#5a5a62';
            for (const ny of [jy + 8, jy - 8]) { x.beginPath(); x.arc(px + PW / 2, (ny + N) % N, 2.2, 0, Math.PI * 2); x.fill(); }
        }
    }, 3),
    brick: () => painter(256, (x, h, N) => {
        const rnd = seeded(23), BH = 32, BW = 64;
        x.fillStyle = '#a8aca0'; x.fillRect(0, 0, N, N);
        h.fillStyle = '#303030'; h.fillRect(0, 0, N, N);
        for (let r = 0; r < N / BH; r++) for (let c = -1; c < N / BW + 1; c++) {
            const bx = c * BW + (r % 2 ? BW / 2 : 0), by = r * BH;
            x.fillStyle = pick(rnd, ['#e8e4dc', '#dcd6cc', '#f0ece4', '#d0ccc0']);
            x.fillRect(bx + 3, by + 3, BW - 6, BH - 6);
            h.fillStyle = '#b8b8b8'; h.fillRect(bx + 3, by + 3, BW - 6, BH - 6);
            h.fillStyle = '#d0d0d0'; h.fillRect(bx + 6, by + 6, BW - 12, BH - 12);
        }
        fillNoise(x, N, N, rnd, 900, ['rgba(0,0,0,0.15)', 'rgba(255,255,255,0.18)'], 2, 0.8);
        // damp moss streaks running down
        for (let k = 0; k < 6; k++) { const sx = rnd() * N, w = 6 + rnd() * 14; const g = x.createLinearGradient(0, 0, 0, N); g.addColorStop(0, 'rgba(60,120,40,0.0)'); g.addColorStop(1, 'rgba(60,120,40,0.35)'); x.fillStyle = g; x.fillRect(sx, 0, w, N); }
    }, 4),
    metal: () => painter(256, (x, h, N) => {
        const rnd = seeded(31);
        x.fillStyle = '#e0d8d0'; x.fillRect(0, 0, N, N);
        fillNoise(x, N, N, rnd, 700, ['rgba(120,90,60,0.18)', 'rgba(255,255,255,0.2)'], 2, 1);
        blotches(x, N, N, rnd, 10, 'rgba(160,80,30,0.35)', 10, 30);
        // panels with seams and rivets
        for (const p of [0, N / 2]) {
            x.fillStyle = 'rgba(60,40,30,0.6)'; x.fillRect(p, 0, 3, N); x.fillRect(0, p, N, 3);
            h.fillStyle = '#202020'; h.fillRect(p, 0, 3, N); h.fillRect(0, p, N, 3);
            for (let k = 8; k < N; k += 21) for (const [rx, ry] of [[p + 9, k], [k, p + 9]]) {
                x.fillStyle = '#f4ece4'; x.beginPath(); x.arc(rx, ry, 3, 0, Math.PI * 2); x.fill();
                h.fillStyle = '#ffffff'; h.beginPath(); h.arc(rx, ry, 3.2, 0, Math.PI * 2); h.fill();
            }
        }
        // rust running down from the rivets
        for (let k = 0; k < 8; k++) { const sx = rnd() * N; const g = x.createLinearGradient(0, 0, 0, N / 2); g.addColorStop(0, 'rgba(150,70,20,0.45)'); g.addColorStop(1, 'rgba(150,70,20,0)'); x.fillStyle = g; x.fillRect(sx, (k % 2) * N / 2, 3, N / 2); }
    }, 3.5),
    books: () => painter(256, (x, h, N) => {
        const rnd = seeded(5), SH = 64;
        for (let r = 0; r < N / SH; r++) {
            const y0 = r * SH;
            x.fillStyle = '#3a2010'; x.fillRect(0, y0, N, SH);
            h.fillStyle = '#202020'; h.fillRect(0, y0, N, SH);
            let px = 0;
            while (px < N) {
                const w = 6 + Math.floor(rnd() * 10), hh = SH - 12 - Math.floor(rnd() * 14);
                const col = pick(rnd, ['#a8242c', '#2a5aa8', '#2a8a4a', '#c8a030', '#6a2a8a', '#c8642a', '#e8e0c8', '#1a3a5a', '#8a1a3a']);
                x.fillStyle = col; x.fillRect(px, y0 + SH - 8 - hh, Math.min(w, N - px), hh);
                x.fillStyle = 'rgba(255,230,160,0.55)'; x.fillRect(px + 1, y0 + SH - 8 - hh + 6, Math.max(1, w - 2), 2); x.fillRect(px + 1, y0 + SH - 18, Math.max(1, w - 2), 2);
                x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(px + w - 1, y0 + SH - 8 - hh, 1, hh);
                h.fillStyle = '#c0c0c0'; h.fillRect(px, y0 + SH - 8 - hh, Math.min(w, N - px), hh);
                px += w;
            }
            // the shelf board
            x.fillStyle = '#6a3c1a'; x.fillRect(0, y0 + SH - 8, N, 8);
            x.fillStyle = 'rgba(255,200,140,0.3)'; x.fillRect(0, y0 + SH - 8, N, 2);
            h.fillStyle = '#e0e0e0'; h.fillRect(0, y0 + SH - 8, N, 8);
        }
    }, 3),
    tiles: () => painter(256, (x, h, N) => {
        const rnd = seeded(13), S = 64;
        x.fillStyle = '#9aa8a2'; x.fillRect(0, 0, N, N);
        h.fillStyle = '#404040'; h.fillRect(0, 0, N, N);
        for (let r = 0; r < N / S; r++) for (let c = 0; c < N / S; c++) {
            x.fillStyle = pick(rnd, ['#f4fbf8', '#eaf6f0', '#f8fffc', '#e4f2ec']); x.fillRect(c * S + 2, r * S + 2, S - 4, S - 4);
            h.fillStyle = '#d0d0d0'; h.fillRect(c * S + 2, r * S + 2, S - 4, S - 4);
            if (rnd() < 0.25) { x.fillStyle = 'rgba(120,140,110,0.18)'; x.fillRect(c * S + 2, r * S + 2, S - 4, S - 4); }
        }
        cracks(x, N, rnd, 3, 'rgba(60,70,64,0.5)', 1.2);
        blotches(x, N, N, rnd, 6, 'rgba(120,110,70,0.18)', 12, 30);
    }, 3),
    subway: () => painter(256, (x, h, N) => {
        const rnd = seeded(17), BH = 32, BW = 64;
        x.fillStyle = '#a8b0c0'; x.fillRect(0, 0, N, N);
        h.fillStyle = '#404040'; h.fillRect(0, 0, N, N);
        for (let r = 0; r < N / BH; r++) for (let c = -1; c < N / BW + 1; c++) {
            const bx = c * BW + (r % 2 ? BW / 2 : 0), by = r * BH;
            const g = x.createLinearGradient(0, by, 0, by + BH); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#e4ecf8');
            x.fillStyle = g; x.beginPath(); x.roundRect(bx + 2, by + 2, BW - 4, BH - 4, 5); x.fill();
            h.fillStyle = '#e0e0e0'; h.beginPath(); h.roundRect(bx + 2, by + 2, BW - 4, BH - 4, 6); h.fill();
        }
        blotches(x, N, N, rnd, 5, 'rgba(160,120,60,0.15)', 10, 28);
    }, 3.5),
    toys: () => painter(256, (x, h, N) => {
        const rnd = seeded(29), S = 64;
        const cols = ['#ff4a5a', '#ffd028', '#3ac8ff', '#46e85a', '#b46aff', '#ff8a2a', '#ff6ad8'];
        for (let r = 0; r < N / S; r++) for (let c = 0; c < N / S; c++) {
            const col = cols[(r * 3 + c * 2 + Math.floor(rnd() * 2)) % cols.length];
            x.fillStyle = col; x.fillRect(c * S, r * S, S, S);
            x.fillStyle = 'rgba(255,255,255,0.3)'; x.fillRect(c * S + 3, r * S + 3, S - 6, 6);
            x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(c * S, r * S + S - 4, S, 4); x.fillRect(c * S + S - 4, r * S, 4, S);
            h.fillStyle = '#a0a0a0'; h.fillRect(c * S + 2, r * S + 2, S - 4, S - 4);
            // a big painted letter / star on some blocks
            if (rnd() < 0.4) { x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = '700 40px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(pick(rnd, ['A', 'B', 'C', '★', '1', '2', '♥']), c * S + S / 2, r * S + S / 2 + 2); }
        }
    }, 3),
    hedge: () => painter(256, (x, h, N) => {
        const rnd = seeded(37);
        x.fillStyle = '#3a6a2a'; x.fillRect(0, 0, N, N);
        h.fillStyle = '#505050'; h.fillRect(0, 0, N, N);
        for (let i = 0; i < 2200; i++) {
            const px = rnd() * N, py = rnd() * N, s = 3 + rnd() * 5, a = rnd() * Math.PI;
            const col = pick(rnd, ['#4a8a34', '#5aa040', '#3a7428', '#6ab84a', '#2e5e22', '#78c858']);
            wrapped(N, N, px, py, s, (u, v) => { x.fillStyle = col; x.beginPath(); x.ellipse(u, v, s, s * 0.55, a, 0, Math.PI * 2); x.fill(); h.fillStyle = '#a0a0a0'; h.beginPath(); h.ellipse(u, v, s * 0.8, s * 0.4, a, 0, Math.PI * 2); h.fill(); });
        }
    }, 2.5),
    ice: () => painter(256, (x, h, N) => {
        const rnd = seeded(67);
        x.fillStyle = '#d8f2ff'; x.fillRect(0, 0, N, N);
        blotches(x, N, N, rnd, 26, 'rgba(255,255,255,0.7)', 16, 44);
        blotches(x, N, N, rnd, 14, 'rgba(120,190,240,0.35)', 12, 36);
        cracks(x, N, rnd, 9, 'rgba(255,255,255,0.95)', 1.5);
        cracks(x, N, rnd, 6, 'rgba(90,160,220,0.6)', 1.2);
        cracks(h, N, rnd, 8, '#202020', 2);
    }, 2),
    stone: () => painter(256, (x, h, N) => {
        const rnd = seeded(53);
        x.fillStyle = '#7a7676'; x.fillRect(0, 0, N, N);
        h.fillStyle = '#303030'; h.fillRect(0, 0, N, N);
        const rows = [0, 54, 120, 186, 256];
        for (let r = 0; r < rows.length - 1; r++) {
            let px = -Math.floor(rnd() * 40);
            while (px < N) {
                const w = 50 + Math.floor(rnd() * 60), y0 = rows[r], hh = rows[r + 1] - y0;
                const shade = pick(rnd, ['#dcd6d2', '#cfc8c4', '#e6e0dc', '#c4beba']);
                wrapped(N, N, px + w / 2, y0 + hh / 2, w, (u) => {
                    x.fillStyle = shade; x.beginPath(); x.roundRect(u - w / 2 + 3, y0 + 3, w - 6, hh - 6, 8); x.fill();
                    h.fillStyle = '#c0c0c0'; h.beginPath(); h.roundRect(u - w / 2 + 3, y0 + 3, w - 6, hh - 6, 10); h.fill();
                });
                px += w;
            }
        }
        fillNoise(x, N, N, rnd, 1200, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.12)'], 2, 1);
    }, 4),
    wallpaper: () => painter(256, (x, h, N) => {
        const rnd = seeded(71);
        for (let k = 0; k < 8; k++) { x.fillStyle = k % 2 ? '#f2e6d2' : '#e8d8bc'; x.fillRect(k * 32, 0, 32, N); }
        // damask flowers
        x.fillStyle = 'rgba(160,110,70,0.35)';
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
            const cx = c * 64 + (r % 2 ? 32 : 0) + 16, cy = r * 64 + 32;
            for (let p = 0; p < 6; p++) { const a = p * Math.PI / 3; wrapped(N, N, cx, cy, 14, (u, v) => { x.beginPath(); x.ellipse(u + Math.cos(a) * 7, v + Math.sin(a) * 7, 6, 3, a, 0, Math.PI * 2); x.fill(); }); }
        }
        blotches(x, N, N, rnd, 8, 'rgba(120,80,40,0.22)', 14, 40);
        // a peeling strip
        x.fillStyle = 'rgba(90,60,30,0.4)'; x.fillRect(150, 160, 18, 70);
        h.fillStyle = '#606060'; h.fillRect(150, 160, 18, 70);
        // the wainscot rail
        x.fillStyle = '#8a5a30'; x.fillRect(0, N - 18, N, 10); h.fillStyle = '#e0e0e0'; h.fillRect(0, N - 18, N, 10);
    }, 2.5),
    // ----- floors -----
    grate: () => painter(256, (x, h, N) => {
        const S = 32;
        x.fillStyle = '#3a3c44'; x.fillRect(0, 0, N, N);
        h.fillStyle = '#202020'; h.fillRect(0, 0, N, N);
        for (let r = 0; r < N / S; r++) for (let c = 0; c < N / S; c++) {
            x.fillStyle = '#c8ccd4'; x.fillRect(c * S, r * S, S, 5); x.fillRect(c * S, r * S, 5, S);
            h.fillStyle = '#e0e0e0'; h.fillRect(c * S, r * S, S, 5); h.fillRect(c * S, r * S, 5, S);
            x.fillStyle = '#5a5c64'; x.fillRect(c * S + 9, r * S + 9, S - 14, S - 14);
        }
    }, 4),
    carpet: () => painter(256, (x, h, N) => {
        const rnd = seeded(43);
        x.fillStyle = '#e8e0d8'; x.fillRect(0, 0, N, N);
        // a gold diamond pattern woven in
        x.strokeStyle = 'rgba(255,220,120,0.65)'; x.lineWidth = 4;
        for (let k = -4; k < 8; k++) { x.beginPath(); x.moveTo(k * 64, 0); x.lineTo(k * 64 + N, N); x.stroke(); x.beginPath(); x.moveTo(k * 64, N); x.lineTo(k * 64 + N, 0); x.stroke(); }
        fillNoise(x, N, N, rnd, 2400, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.1)'], 1.4, 1);
        fillNoise(h, N, N, rnd, 2000, ['#707070', '#909090'], 1.4, 1);
    }, 1.6),
    checker: () => painter(256, (x, h, N) => {
        const S = 64, rnd = seeded(61);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { x.fillStyle = (r + c) % 2 ? '#f6f6fa' : '#26262e'; x.fillRect(c * S, r * S, S, S); }
        h.fillStyle = '#404040';
        for (let k = 0; k <= 4; k++) { h.fillRect(k * S - 1, 0, 3, N); h.fillRect(0, k * S - 1, N, 3); }
        blotches(x, N, N, rnd, 5, 'rgba(140,100,60,0.18)', 10, 26);
    }, 2.5),
    grass: () => painter(256, (x, h, N) => {
        const rnd = seeded(19);
        x.fillStyle = '#d8e8c8'; x.fillRect(0, 0, N, N);
        for (let i = 0; i < 3000; i++) {
            const px = rnd() * N, py = rnd() * N, l = 3 + rnd() * 5;
            x.strokeStyle = pick(rnd, ['#b8d8a0', '#e8f8d8', '#a0c888', '#c8e0b0']); x.lineWidth = 1.4;
            wrapped(N, N, px, py, l, (u, v) => { x.beginPath(); x.moveTo(u, v); x.lineTo(u + (rnd() - 0.5) * 3, v - l); x.stroke(); });
        }
        fillNoise(h, N, N, rnd, 1600, ['#606060', '#a0a0a0'], 2, 1);
        // a few dark leaves
        fillNoise(x, N, N, rnd, 60, ['rgba(90,60,30,0.5)', 'rgba(140,90,40,0.5)'], 3, 1);
    }, 2),
    snow: () => painter(256, (x, h, N) => {
        const rnd = seeded(73);
        x.fillStyle = '#f4faff'; x.fillRect(0, 0, N, N);
        blotches(x, N, N, rnd, 20, 'rgba(180,210,240,0.35)', 14, 40);
        fillNoise(x, N, N, rnd, 260, ['#ffffff', '#cfe8ff'], 1.5, 1);
        blotches(h, N, N, rnd, 30, 'rgba(255,255,255,0.5)', 10, 30);
    }, 2),
    marble: () => painter(256, (x, h, N) => {
        const rnd = seeded(89), S = 128;
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) { x.fillStyle = (r + c) % 2 ? '#f6f2fa' : '#e6dcf0'; x.fillRect(c * S, r * S, S, S); }
        cracks(x, N, rnd, 10, 'rgba(150,120,190,0.45)', 1.6);
        cracks(x, N, rnd, 8, 'rgba(255,255,255,0.8)', 1.2);
        h.fillStyle = '#404040';
        for (let k = 0; k <= 2; k++) { h.fillRect(k * S - 1, 0, 3, N); h.fillRect(0, k * S - 1, N, 3); }
        x.fillStyle = 'rgba(200,170,90,0.6)';
        for (let k = 0; k <= 2; k++) { x.fillRect(k * S - 1, 0, 2, N); x.fillRect(0, k * S - 1, N, 2); }
    }, 2),
};
// The surface for a wall / floor kind: { map, nrm }, built once
export const surface = (kind) => once('surf|' + kind, () => (SURF[kind] || SURF.concrete)());
// One matte vertex-coloured material per surface (the studded floor's shader: map + normal map + vertex colours)
export function surfaceMaterial(kind, scale) {
    return once('surfmat|' + kind + '|' + (scale || 1), () => {
        const s = surface(kind);
        return matte({ color: 0xffffff, vertexColors: true, map: s.map, normalMap: s.nrm, normalScale: new T.Vector2(scale || 1, scale || 1) });
    });
}

// =====================================================================================
// The reference's red wood (the pillars round the trusses) and the black iron truss
// =====================================================================================
export const redWoodMaterial = () => once('redwood', () => {
    const s = painter(256, (x, h, N) => {
        const rnd = seeded(97), PH = 32;
        for (let r = 0; r < N / PH; r++) {
            x.fillStyle = pick(rnd, ['#c8343a', '#b82a30', '#d43c42', '#ac262c']); x.fillRect(0, r * PH, N, PH);
            for (let k = 0; k < 6; k++) {
                x.strokeStyle = pick(rnd, ['rgba(90,10,14,0.45)', 'rgba(255,140,140,0.25)']); x.lineWidth = 1 + rnd() * 1.4;
                x.beginPath(); const gy = r * PH + 3 + rnd() * (PH - 6); x.moveTo(0, gy);
                for (let px = 0; px <= N; px += 24) x.lineTo(px, gy + Math.sin(px * 0.04 + k * 2) * 2.2);
                x.stroke();
            }
            x.fillStyle = 'rgba(50,6,8,0.85)'; x.fillRect(0, r * PH, N, 3);
            h.fillStyle = '#202020'; h.fillRect(0, r * PH, N, 3);
            const jx = Math.floor(rnd() * N); x.fillRect(jx, r * PH, 3, PH); h.fillRect(jx, r * PH, 3, PH);
        }
        // knots
        for (let k = 0; k < 4; k++) { x.fillStyle = 'rgba(80,8,12,0.6)'; x.beginPath(); x.ellipse(rnd() * N, rnd() * N, 8, 4, 0, 0, Math.PI * 2); x.fill(); }
    }, 3);
    return matte({ map: s.map, normalMap: s.nrm });
});
export const trussTex = () => once('truss', () => {
    const N = 128, c = canvas(N), x = c.getContext('2d');
    x.clearRect(0, 0, N, N);
    x.strokeStyle = '#2a2c34'; x.lineWidth = 14; x.lineCap = 'square';
    x.strokeRect(7, 7, N - 14, N - 14);
    x.beginPath(); x.moveTo(7, 7); x.lineTo(N - 7, N - 7); x.moveTo(N - 7, 7); x.lineTo(7, N - 7); x.stroke();
    x.strokeStyle = '#5a5e6a'; x.lineWidth = 4;
    x.strokeRect(5, 5, N - 10, N - 10);
    x.beginPath(); x.moveTo(5, 5); x.lineTo(N - 5, N - 5); x.stroke();
    return wrap(texFrom(c));
});
export const trussMaterial = () => once('trussmat', () => matte({ map: trussTex(), alphaTest: 0.45, side: T.DoubleSide }));

// =====================================================================================
// Floors with a job: slime pools (slow you down), ice (slippery), lava cracks (burn)
// =====================================================================================
const lavaPts = () => { const rnd = seeded(79); return Array.from({ length: 16 }, () => [rnd() * 256, rnd() * 256]); };
export const lavaTex = () => once('lava', () => {
    const N = 256, e = voronoiEdges(N, lavaPts(), 14);
    return tex(imageFrom(N, (i) => { const k = Math.min(1, e[i] * 1.4); const n = ((i * 2654435761) >>> 0) % 12; return [lerp(120 + n, 255, k), lerp(30 + n, 190, k * k), lerp(10 + n, 40, k)]; }));
});
export const lavaMaterial = () => once('lavamat', () => new T.MeshBasicMaterial({ map: lavaTex() }));
export const slimeTex = () => once('slime', () => {
    const N = 256, rnd = seeded(41);
    const a = voronoiEdges(N, Array.from({ length: 22 }, () => [rnd() * N, rnd() * N]), 7);
    const b = voronoiEdges(N, Array.from({ length: 9 }, () => [rnd() * N, rnd() * N]), 12);
    return tex(imageFrom(N, (i) => {
        const k = Math.min(1, a[i] ** 2 * 0.8 + b[i] ** 2 * 0.6);
        return [lerp(60, 200, k), lerp(170, 255, k), lerp(30, 120, k)];
    }));
});
export const slimeMaterial = () => once('slimemat', () => new T.MeshBasicMaterial({ map: slimeTex() }));
export const iceFloorMaterial = () => once('icefloor', () => { const s = surface('ice'); return matte({ map: s.map, normalMap: s.nrm, emissive: 0x2a7aaa, emissiveIntensity: 0.3 }); });

// ----- the green guide arrows (on the floor, like the reference's painted arrows) -----
export const arrowTex = () => once('arrow', () => {
    const W = 256, H = 256, c = canvas(W, H), x = c.getContext('2d');
    const path = () => { x.beginPath(); x.moveTo(128, 10); x.lineTo(240, 128); x.lineTo(172, 128); x.lineTo(172, 246); x.lineTo(84, 246); x.lineTo(84, 128); x.lineTo(16, 128); x.closePath(); };
    path(); x.lineJoin = 'round'; x.lineWidth = 14; x.strokeStyle = '#0a3a12'; x.stroke();
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#6aff5a'); g.addColorStop(1, '#14c82a');
    path(); x.fillStyle = g; x.fill();
    x.fillStyle = 'rgba(255,255,255,0.3)'; x.beginPath(); x.moveTo(128, 30); x.lineTo(206, 114); x.lineTo(128, 96); x.lineTo(50, 114); x.closePath(); x.fill();
    return texFrom(c);
});
// ----- the checkpoint pad: white with a big black star (the reference's), green once reached -----
export const cpPadTex = (on) => once('cp' + (on ? 1 : 0), () => {
    const N = 256, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = on ? '#4af05a' : '#f4f4f8'; x.fillRect(0, 0, N, N);
    x.fillStyle = on ? '#22b434' : '#c8cad4'; x.fillRect(0, 0, N, 10); x.fillRect(0, N - 10, N, 10); x.fillRect(0, 0, 10, N); x.fillRect(N - 10, 0, 10, N);
    x.save(); x.translate(N / 2, N / 2); x.fillStyle = '#16161e';
    x.beginPath(); x.arc(0, 0, 30, 0, Math.PI * 2); x.fill();
    x.fillStyle = on ? '#4af05a' : '#f4f4f8'; x.beginPath(); x.arc(0, 0, 19, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#16161e';
    // curved sun rays, like the reference's pad
    for (let k = 0; k < 8; k++) {
        x.save(); x.rotate(k * Math.PI / 4);
        x.beginPath(); x.moveTo(-9, 26); x.quadraticCurveTo(-4, 70, 18, 108); x.quadraticCurveTo(4, 66, 11, 26); x.closePath(); x.fill();
        x.restore();
    }
    x.restore();
    return texFrom(c);
});
export const cpPadMaterial = (on) => once('cpmat' + (on ? 1 : 0), () => matte({ map: cpPadTex(on), emissive: on ? 0x1a6a2a : 0x202024, emissiveIntensity: on ? 0.35 : 0.1 }));

// Soft glow dot (lamp glows, pads, coins)
export const softTex = () => once('soft', () => {
    const c = canvas(64), x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return texFrom(c);
});
export const goldMaterial = () => once('goldmat', () => matte({ color: 0xffc828, emissive: 0x8a5a00, emissiveIntensity: 0.45 }));
// Coins: gold discs with an angry face stamped on both sides
export const coinTex = () => once('coin', () => {
    const N = 128, c = canvas(N), x = c.getContext('2d'), m = N / 2;
    const g = x.createRadialGradient(m - 14, m - 18, 6, m, m, m);
    g.addColorStop(0, '#fff6a8'); g.addColorStop(0.6, '#ffd028'); g.addColorStop(1, '#e09a08');
    x.fillStyle = g; x.fillRect(0, 0, N, N);
    x.strokeStyle = '#b87400'; x.lineWidth = 8; x.beginPath(); x.arc(m, m, m - 8, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#9a5a00'; x.strokeStyle = '#9a5a00'; x.lineWidth = 5; x.lineCap = 'round';
    for (const s of [-1, 1]) { x.beginPath(); x.arc(m + s * 15, m - 8, 6, 0, Math.PI * 2); x.fill(); x.beginPath(); x.moveTo(m + s * 6, m - 18); x.lineTo(m + s * 24, m - 26); x.stroke(); }
    x.beginPath(); x.ellipse(m, m + 18, 16, 10, 0, 0, Math.PI * 2); x.fill();
    return texFrom(c);
});
export const coinMaterial = () => once('coinmat', () => matte({ map: coinTex(), emissive: 0x6a4000, emissiveIntensity: 0.55 }));
// Unlit glowing colour (neon trims, lamps, exit signs), a little brighter than the colour itself
export const neon = (color, boost) => once('neon|' + color + '|' + (boost || 1.2), () => { const m = new T.MeshBasicMaterial({ color }); m.color.multiplyScalar(NEON_BOOST * (boost || 1.2) / 1.25); return m; });
// Cobwebs for the corners (see-through)
export const webTex = () => once('web', () => {
    const N = 128, c = canvas(N), x = c.getContext('2d');
    x.strokeStyle = 'rgba(255,255,255,0.75)'; x.lineWidth = 1.2;
    for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI / 2; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * N * 1.2, Math.sin(a) * N * 1.2); x.stroke(); }
    for (let r = 14; r < N * 1.2; r += 14) { x.beginPath(); for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI / 2, rr = r * (1 - 0.08 * Math.sin(k * 1.7)); const px = Math.cos(a) * rr, py = Math.sin(a) * rr; if (k) x.quadraticCurveTo(Math.cos(a - 0.13) * rr * 0.92, Math.sin(a - 0.13) * rr * 0.92, px, py); else x.moveTo(px, py); } x.stroke(); }
    return texFrom(c);
});
export const webMaterial = () => once('webmat', () => new T.MeshBasicMaterial({ map: webTex(), transparent: true, depthWrite: false, side: T.DoubleSide, forceSinglePass: true, opacity: 0.8 }));
