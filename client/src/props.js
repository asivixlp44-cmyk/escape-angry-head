// Set dressing for the mazes and the lobby, built from a handful of primitives each and handed to
// world.js as parts ({ g: geometry in the prop's own space (y up from the floor, facing +z),
// c: colour, s: surface kind or 'glow' for unlit } ), which it bakes into each place's merged
// batches: no draw calls of their own. Every theme has its own: crates and barrels in the basement,
// bookshelves in the library, beds in the hospital, tombstones in the graveyard...
import { T } from './engine.js';

const box = (sx, sy, sz, x, y, z, ry) => { const g = new T.BoxGeometry(sx, sy, sz); if (ry) g.rotateY(ry); g.translate(x || 0, (y || 0) + sy / 2, z || 0); return g; };
const cyl = (r0, r1, h, x, y, z, seg) => { const g = new T.CylinderGeometry(r0, r1, h, seg || 14); g.translate(x || 0, (y || 0) + h / 2, z || 0); return g; };
const ball = (r, x, y, z, sx, sy, sz, seg) => { const g = new T.SphereGeometry(r, seg || 14, Math.max(6, Math.round((seg || 14) * 0.7))); g.scale(sx || 1, sy || 1, sz || 1); g.translate(x || 0, y || 0, z || 0); return g; };
const torus = (r, t, x, y, z, rx) => { const g = new T.TorusGeometry(r, t, 6, 16); if (rx) g.rotateX(rx); g.translate(x || 0, y || 0, z || 0); return g; };
const P = (g, c, s) => ({ g, c, s });

// Each returns { parts, w, d } (footprint, for the collider); h is taken from the parts
export const PROPS = {
    crate: (r) => { const s = 3 + r() * 0.8; return { parts: [P(box(s, s, s), 0xd2a26a, 'planks'), P(box(s + 0.1, 0.35, 0.3, 0, s * 0.45, s / 2), 0x8a5a2a), P(box(0.3, s * 0.95, 0.3, s / 2 - 0.1, 0, s / 2), 0x8a5a2a), P(box(0.3, s * 0.95, 0.3, -s / 2 + 0.1, 0, s / 2), 0x8a5a2a)], w: s, d: s }; },
    crates: (r) => { const a = PROPS.crate(r), b = PROPS.crate(r); const parts = [...a.parts]; for (const p of b.parts) { const g = p.g.clone(); g.scale(0.7, 0.7, 0.7); g.rotateY(0.4); g.translate(0.3, a.w, -0.2); parts.push(P(g, p.c, p.s)); } return { parts, w: a.w, d: a.d }; },
    barrel: (r) => { const c = r() < 0.5 ? 0x8a5a2a : 0x3a8a4a; return { parts: [P(cyl(1.3, 1.3, 3.2, 0, 0, 0, 16), c, 'planks'), P(torus(1.33, 0.1, 0, 0.6, 0, Math.PI / 2), 0x4a4e5a), P(torus(1.33, 0.1, 0, 2.6, 0, Math.PI / 2), 0x4a4e5a), P(cyl(1.2, 1.2, 0.1, 0, 3.2, 0, 16), c === 0x3a8a4a ? 0x8aff4a : 0x6a4020, c === 0x3a8a4a ? 'glow' : undefined)], w: 2.7, d: 2.7 }; },
    toxic: (r) => { const p = PROPS.barrel(r); p.parts[0].c = 0xe8c828; p.parts[3] = P(cyl(1.2, 1.2, 0.12, 0, 3.2, 0, 16), 0x7aff3a, 'glow'); p.parts.push(P(box(1.2, 0.8, 0.05, 0, 1.2, 1.31), 0x1a1a1a)); return p; },
    boxes: (r) => { const parts = []; let y = 0; for (let k = 0; k < 3; k++) { const s = 2.6 - k * 0.5; parts.push(P(box(s, s * 0.8, s, (r() - 0.5) * 0.6, y, (r() - 0.5) * 0.6, r() * 0.5), 0xc8a070)); parts.push(P(box(s * 0.2, s * 0.82, s + 0.02, 0, y, 0), 0xe8d8b0)); y += s * 0.8; } return { parts, w: 2.8, d: 2.8 }; },
    shelf: (r) => { const parts = [P(box(5, 6, 1.6), 0x6a4020, 'planks')]; const cols = [0xa8242c, 0x2a5aa8, 0x2a8a4a, 0xc8a030, 0x6a2a8a, 0xe8e0c8]; for (let row = 0; row < 3; row++) { let x = -2.2; while (x < 2.1) { const w = 0.3 + r() * 0.35, h = 1.2 + r() * 0.5; parts.push(P(box(w, h, 1.2, x + w / 2, 0.4 + row * 1.9, 0.3), cols[Math.floor(r() * cols.length)])); x += w + 0.02; } parts.push(P(box(5, 0.2, 1.7, 0, 0.2 + row * 1.9, 0.05), 0x8a5a30)); } return { parts, w: 5, d: 1.8 }; },
    books: (r) => { const parts = []; for (let k = 0; k < 6; k++) parts.push(P(box(1.6 - r() * 0.4, 0.35, 1.1, (r() - 0.5) * 0.3, k * 0.35, 0, (r() - 0.5) * 0.5), [0xa8242c, 0x2a5aa8, 0x2a8a4a, 0xc8a030][k % 4])); parts.push(P(cyl(0.12, 0.12, 0.8, 0, 2.1, 0, 8), 0xf8f0d8), P(ball(0.18, 0, 3.05, 0, 0.7, 1.3, 0.7, 8), 0xffc848, 'glow')); return { parts, w: 1.8, d: 1.4 }; },
    candles: (r) => { const parts = []; for (let k = 0; k < 4; k++) { const x = (k % 2 - 0.5) * 0.9 + (r() - 0.5) * 0.2, z = (k > 1 ? 0.4 : -0.4), h = 0.8 + r() * 1.2; parts.push(P(cyl(0.16, 0.18, h, x, 0, z, 8), 0xf4ead0), P(ball(0.13, x, h + 0.2, z, 0.7, 1.5, 0.7, 6), 0xffc848, 'glow')); } return { parts, w: 1.6, d: 1.6 }; },
    bed: () => ({ parts: [P(box(3.4, 1.4, 6.5), 0xe8f2f0), P(box(3.6, 0.5, 6.7, 0, 1.4), 0x9ad8c8), P(box(2.6, 0.5, 1.4, 0, 1.9, -2.3), 0xffffff), P(box(0.2, 2.6, 0.2, -1.7, 0, -3.2), 0xa8b0b8), P(box(0.2, 2.6, 0.2, 1.7, 0, -3.2), 0xa8b0b8), P(box(3.6, 0.2, 0.2, 0, 2.5, -3.2), 0xa8b0b8)], w: 3.8, d: 6.8 }),
    cabinet: () => ({ parts: [P(box(3, 4.5, 1.6), 0xd8e4e0), P(box(1.3, 4.1, 0.05, -0.72, 0.2, 0.81), 0xc0d0cc), P(box(1.3, 4.1, 0.05, 0.72, 0.2, 0.81), 0xc0d0cc), P(box(0.5, 0.5, 0.06, 0, 3.4, 0.84), 0xff3a4a)], w: 3, d: 1.7 }),
    counter: (r) => ({ parts: [P(box(5, 3, 2.2), 0xffffff), P(box(5.2, 0.3, 2.4, 0, 3), 0x4a4e5a), P(cyl(0.5, 0.45, 0.8, -1.2, 3.3, 0, 12), 0x9aa0b0), P(cyl(0.55, 0.55, 0.12, -1.2, 4.1, 0, 12), 0x4a4e5a), P(box(1.4, 0.15, 0.9, 1.2, 3.3, 0, r() * 0.4), 0xc89a5a)], w: 5, d: 2.4 }),
    fridge: () => ({ parts: [P(box(3, 7, 2.6), 0xf0f6ff), P(box(0.15, 1.6, 0.2, 1.1, 4.4, 1.35), 0x9aa0b0), P(box(0.15, 1.2, 0.2, 1.1, 1.8, 1.35), 0x9aa0b0), P(box(3.02, 0.08, 2.62, 0, 3.4), 0xc8d0e0)], w: 3, d: 2.6 }),
    toys: (r) => { const cols = [0xff4a5a, 0xffd028, 0x3ac8ff, 0x46e85a, 0xb46aff]; const parts = []; for (let k = 0; k < 5; k++) { const s = 1 + r() * 0.8; parts.push(P(box(s, s, s, (r() - 0.5) * 2.4, k < 3 ? 0 : s * 0.9, (r() - 0.5) * 2.4, r()), cols[k % cols.length])); } parts.push(P(ball(1.1, 1.2, 1.1, 1.2), 0xff5ad8)); return { parts, w: 3.6, d: 3.6 }; },
    teddy: () => { const c = 0xc88a4a; return { parts: [P(ball(1.3, 0, 1.3, 0, 1, 1.1, 0.9), c), P(ball(0.95, 0, 3.1, 0), c), P(ball(0.35, -0.7, 3.8, 0), c), P(ball(0.35, 0.7, 3.8, 0), c), P(ball(0.35, 0, 2.95, 0.85, 1, 0.8, 0.7), 0xf0d0a0), P(ball(0.12, -0.32, 3.3, 0.85), 0x1a1a1a), P(ball(0.12, 0.32, 3.3, 0.85), 0x1a1a1a), P(ball(0.45, -1.2, 1.4, 0.3), c), P(ball(0.45, 1.2, 1.4, 0.3), c), P(ball(0.5, -0.6, 0.35, 0.8), c), P(ball(0.5, 0.6, 0.35, 0.8), c)], w: 3, d: 2.4 }; },
    duck: () => ({ parts: [P(ball(1.3, 0, 1.1, 0, 1.2, 0.85, 1), 0xffd828), P(ball(0.8, 0, 2.3, 0.6), 0xffd828), P(ball(0.45, 0, 2.15, 1.35, 1, 0.5, 1.1), 0xff8a1a), P(ball(0.12, -0.35, 2.55, 1.2), 0x1a1a1a), P(ball(0.12, 0.35, 2.55, 1.2), 0x1a1a1a)], w: 2.8, d: 3 }),
    tomb: (r) => { const h = 3 + r() * 1.5; const g = new T.CylinderGeometry(1.3, 1.3, 0.8, 16, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); g.rotateY(Math.PI / 2); g.translate(0, h, 0); return { parts: [P(box(2.6, h, 0.8), 0x9aa0a8, 'stone'), P(g, 0x9aa0a8), P(box(3.4, 0.5, 2, 0, 0, 0.6), 0x6a6e78), P(box(1.4, 0.18, 0.06, 0, h * 0.6, 0.42), 0x3a3e48), P(box(0.3, 0.9, 0.06, 0, h * 0.42, 0.42), 0x3a3e48)], w: 3.4, d: 2.2 }; },
    cross: () => ({ parts: [P(box(0.45, 4.5, 0.45), 0x8a8e98, 'stone'), P(box(2.4, 0.45, 0.45, 0, 3.1), 0x8a8e98, 'stone'), P(ball(1.6, 0, 0, 0, 1.1, 0.35, 1.2), 0x4a6a3a)], w: 2.4, d: 1.4 }),
    deadTree: (r) => { const parts = [P(cyl(0.4, 0.7, 6, 0, 0, 0, 8), 0x3a2a24)]; for (let k = 0; k < 4; k++) { const a = k * 1.7 + r(), l = 2 + r() * 1.5, g = new T.CylinderGeometry(0.12, 0.25, l, 6); g.translate(0, l / 2, 0); g.rotateZ(0.9 - r() * 0.3); g.rotateY(a); g.translate(0, 3.5 + k * 0.6, 0); parts.push(P(g, 0x3a2a24)); } return { parts, w: 1.6, d: 1.6 }; },
    lantern: () => ({ parts: [P(box(0.25, 5, 0.25), 0x2a2a32), P(box(1.2, 0.2, 0.25, 0.5, 4.9), 0x2a2a32), P(box(0.7, 1, 0.7, 0.95, 3.8), 0x2a2a32), P(box(0.5, 0.75, 0.5, 0.95, 3.9), 0xffc848, 'glow')], w: 1, d: 1 }),
    crystal: (r) => { const parts = []; for (let k = 0; k < 4; k++) { const h = 2 + r() * 3, g = new T.ConeGeometry(0.6 + r() * 0.3, h, 5); g.translate(0, h / 2, 0); g.rotateZ((r() - 0.5) * 0.8); g.rotateX((r() - 0.5) * 0.6); g.translate((r() - 0.5) * 2, 0, (r() - 0.5) * 1.6); parts.push(P(g, k % 2 ? 0x8ae8ff : 0xc8f4ff, k === 0 ? 'glow' : undefined)); } parts.push(P(ball(1.5, 0, 0, 0, 1.3, 0.4, 1), 0xffffff)); return { parts, w: 3, d: 2.6 }; },
    snowman: () => ({ parts: [P(ball(1.5, 0, 1.4, 0), 0xffffff), P(ball(1.05, 0, 3.4, 0), 0xffffff), P(ball(0.75, 0, 4.85, 0), 0xffffff), P(new T.ConeGeometry(0.16, 0.8, 8).rotateX(Math.PI / 2).translate(0, 4.85, 1), 0xff8a1a), P(ball(0.09, -0.25, 5.1, 0.68), 0x1a1a1a), P(ball(0.09, 0.25, 5.1, 0.68), 0x1a1a1a)], w: 3, d: 3 }),
    brazier: () => ({ parts: [P(cyl(0.3, 0.5, 2.6, 0, 0, 0, 8), 0x3a3238), P(cyl(1.2, 0.7, 1, 0, 2.6, 0, 12), 0x4a3e44), P(ball(0.85, 0, 3.7, 0, 1, 1.3, 1, 10), 0xff8a2a, 'glow'), P(ball(0.5, 0, 4.4, 0, 1, 1.4, 1, 8), 0xffd84a, 'glow')], w: 2.4, d: 2.4 }),
    rocks: (r) => { const parts = []; for (let k = 0; k < 4; k++) parts.push(P(new T.DodecahedronGeometry(0.8 + r() * 0.9).translate((r() - 0.5) * 2.4, 0.6, (r() - 0.5) * 2), 0x5a4a48, 'stone')); return { parts, w: 3.2, d: 2.8 }; },
    boiler: () => ({ parts: [P(cyl(2, 2, 6, 0, 0, 0, 18), 0xc8865a, 'metal'), P(ball(2, 0, 6, 0, 1, 0.5, 1), 0xb87a50), P(cyl(0.35, 0.35, 3, 0, 6.5, 0, 8), 0x6a6e7a), P(new T.CylinderGeometry(0.6, 0.6, 0.15, 16).rotateX(Math.PI / 2).translate(0, 3, 1.95), 0xffffff), P(box(0.08, 0.5, 0.05, 0, 3.1, 2.05), 0xff2a2a)], w: 4.2, d: 4.2 }),
    pipes: () => ({ parts: [P(cyl(0.45, 0.45, 9, -1, 0, 0, 10), 0x8a8e9a, 'metal'), P(cyl(0.3, 0.3, 9, 0.3, 0, 0.2, 10), 0xb06a3a), P(torus(0.55, 0.12, -1, 3, 0, Math.PI / 2), 0x4a4e5a), P(torus(0.55, 0.12, -1, 6, 0, Math.PI / 2), 0x4a4e5a), P(cyl(0.5, 0.5, 0.3, 0.3, 4.2, 0.2, 12), 0xff3a3a)], w: 2.4, d: 1.2 }),
    covered: (r) => { const s = 2.6 + r(); const g = new T.SphereGeometry(s * 0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, 1.3, 0.8); return { parts: [P(g, 0xf0ece4), P(box(s * 1.3, 0.2, s * 1.1), 0xe0dcd4)], w: s * 1.3, d: s * 1.1 }; },
    rockingHorse: () => { const parts = []; const rock = new T.TorusGeometry(2, 0.15, 6, 20, Math.PI * 0.5); rock.rotateZ(Math.PI * 1.25); rock.translate(0, 2.2, 0); rock.rotateY(Math.PI / 2); parts.push(P(rock, 0x8a4a2a), P(box(0.9, 1, 2.4, 0, 1.6, 0), 0xc87a3a), P(box(0.7, 1.4, 0.8, 0, 2.4, 1.2), 0xc87a3a), P(box(0.3, 0.8, 1.4, 0, 2.4, 1.6), 0xc87a3a), P(box(0.12, 0.9, 1.4, 0, 2.3, 0.2), 0x3a2418)); for (const [x, z] of [[-0.4, -0.9], [0.4, -0.9], [-0.4, 0.9], [0.4, 0.9]]) parts.push(P(box(0.25, 1.2, 0.25, x, 0.4, z), 0xc87a3a)); return { parts, w: 1.6, d: 4 }; },
    pillar: () => ({ parts: [P(cyl(1.3, 1.5, 12, 0, 0, 0, 14), 0xd8c8f0, 'marble'), P(box(3.4, 0.8, 3.4), 0xb8a8d8), P(box(3.2, 0.8, 3.2, 0, 12), 0xb8a8d8)], w: 3.4, d: 3.4 }),
    banner: () => ({ parts: [P(box(3, 7, 0.15, 0, 4), 0x8a1a3a), P(box(3.4, 0.25, 0.3, 0, 11), 0xffd028), P(box(1.4, 1.4, 0.18, 0, 8), 0xffd028)], w: 3.4, d: 0.4 }),
    pumpkin: (r) => { const s = 0.9 + r() * 0.8; const parts = []; for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; parts.push(P(ball(s * 0.62, Math.sin(a) * s * 0.42, s * 0.85, Math.cos(a) * s * 0.42, 0.78, 0.9, 1.0, 10), 0xff8a1a)); } parts.push(P(cyl(0.09 * s, 0.14 * s, 0.5 * s, 0, s * 1.6, 0, 6), 0x4a8a2a)); parts.push(P(ball(s * 0.18, -s * 0.28, s * 1.0, s * 0.92, 1, 1, 0.3, 6), 0xffe24a, 'glow'), P(ball(s * 0.18, s * 0.28, s * 1.0, s * 0.92, 1, 1, 0.3, 6), 0xffe24a, 'glow'), P(box(s * 0.7, s * 0.16, 0.1, 0, s * 0.62, s * 0.98), 0xffe24a, 'glow')); return { parts, w: s * 2, d: s * 2 }; },
};
// What each theme puts in its dead ends (and its rooms)
export const THEME_PROPS = {
    basement: ['crate', 'crates', 'barrel', 'pipes'],
    storage: ['boxes', 'crates', 'crate', 'shelf'],
    sewer: ['toxic', 'barrel', 'pipes', 'rocks'],
    boiler: ['boiler', 'pipes', 'barrel', 'crate'],
    library: ['shelf', 'books', 'candles', 'shelf'],
    hospital: ['bed', 'cabinet', 'bed', 'boxes'],
    kitchen: ['counter', 'fridge', 'barrel', 'counter'],
    playroom: ['toys', 'teddy', 'duck', 'toys'],
    graveyard: ['tomb', 'cross', 'deadTree', 'lantern'],
    ice: ['crystal', 'snowman', 'crystal', 'rocks'],
    lava: ['brazier', 'rocks', 'brazier', 'rocks'],
    attic: ['covered', 'rockingHorse', 'boxes', 'candles'],
    throne: ['brazier', 'pillar', 'banner', 'brazier'],
};
// Wall posters: what the maze tells you (drawn on canvas in world.js)
export const POSTERS = ['RUN!', 'DON\'T LOOK BACK', 'THEY CAN HEAR YOU', 'HAHA!', 'NO ESCAPE', 'MISSING', 'KEEP RUNNING', 'EXIT? →', 'BEHIND YOU'];
