// Tool and hat models, all built in code: the coils, the Troll Slap glove, the Jetpack and the
// Angel Wings (worn on your back), the Rocket Launcher, the Scythe, the Invisibility Potion, and the
// hats (a carved pumpkin, an Angry Head mask, the Valkyrie helm, the Dominus). The same models float
// in the lobby's display cases and ride on your character. Each is merged into one or two meshes;
// matte plastic with a little glow.
import { T, matte, mergeChildren } from './engine.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { headGeometry, headMaterial } from './heads.js';

const mats = new Map();
const gm = (key, make) => { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); };
export const plastic = (color, glow) => gm('p' + color + '|' + (glow || 0), () => matte({ color, emissive: color, emissiveIntensity: glow ?? 0.25 }));
const vcMat = () => gm('vc', () => matte({ vertexColors: true, emissive: 0x222222, emissiveIntensity: 0.5 }));
const tmpC = new T.Color();
function painted(geo, color) {
    const p = geo.attributes.position, a = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
        const c = typeof color === 'function' ? color(p.getX(i), p.getY(i), p.getZ(i)) : tmpC.set(color);
        a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(a, 3));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k);
    return geo.index ? geo.toNonIndexed() : geo;
}
const mesh = (geos) => { const g = mergeGeometries(geos); g.computeVertexNormals(); const m = new T.Mesh(g, vcMat()); m.castShadow = true; m.receiveShadow = true; return m; };

// ----- the Troll Slap: a big cartoon hand (palm forward, fingers up, ~3 studs) -----
function glove() {
    const base = new T.Color(0xffe0c8), shade = base.clone().multiplyScalar(0.82), parts = [];
    const palm = new T.SphereGeometry(1, 16, 12); palm.scale(0.95, 1.05, 0.45); palm.translate(0, 0.95, 0);
    parts.push(painted(palm, base));
    [[-0.66, 1.0, 0.16], [-0.22, 1.18, 0.05], [0.24, 1.12, -0.05], [0.66, 0.92, -0.18]].forEach(([x, len, tilt]) => {
        const f = new T.CapsuleGeometry(0.25, len, 4, 10);
        f.rotateZ(tilt); f.translate(x - Math.sin(tilt) * len * 0.5, 1.78 + len * 0.5 * Math.cos(tilt), 0);
        parts.push(painted(f, base));
    });
    const th = new T.CapsuleGeometry(0.27, 0.8, 4, 10); th.rotateZ(1.0); th.translate(-1.15, 0.95, 0.1);
    parts.push(painted(th, shade));
    const cuff = new T.CylinderGeometry(0.78, 0.72, 0.55, 18); cuff.scale(1.05, 1, 0.62); cuff.translate(0, -0.05, 0);
    parts.push(painted(cuff, 0xff3a4a));
    const g = new T.Group(); const m = mesh(parts); m.position.y = -1.2; g.add(m);
    return g;
}
class Helix extends T.Curve {
    constructor(r, h, turns) { super(); this.r = r; this.h = h; this.turns = turns; }
    getPoint(t, out) { const a = t * Math.PI * 2 * this.turns; return (out || new T.Vector3()).set(Math.cos(a) * this.r, t * this.h - this.h / 2, Math.sin(a) * this.r); }
}
const helixGeo = new T.TubeGeometry(new Helix(0.95, 2.8, 5.5), 88, 0.18, 6, false);
function coil(color, color2) {
    const parts = [painted(helixGeo.clone(), color2 ? (x, y) => tmpC.set(color).lerp(new T.Color(color2), (y + 1.4) / 2.8) : color)];
    for (const y of [-1.48, 1.48]) { const cap = new T.CylinderGeometry(1.1, 1.1, 0.24, 24); cap.translate(0, y, 0); parts.push(painted(cap, 0xf4f4ff)); }
    const g = new T.Group(); g.add(mesh(parts)); return g;
}
// The Jetpack: two red rocket tanks with flame nozzles, strapped on a grey frame
function jetpack() {
    const parts = [];
    for (const s of [-0.62, 0.62]) {
        const tank = new T.CapsuleGeometry(0.55, 1.6, 6, 16); tank.translate(s, 0, 0); parts.push(painted(tank, (x, y) => tmpC.set(y > 0.5 ? 0xffffff : 0xff3a2a)));
        const fin = new T.BoxGeometry(0.1, 0.6, 0.6); fin.translate(s * 1.75, -0.7, 0); parts.push(painted(fin, 0xffd028));
        const noz = new T.CylinderGeometry(0.32, 0.45, 0.45, 14); noz.translate(s, -1.35, 0); parts.push(painted(noz, 0x3a3e4a));
    }
    const frame = new T.BoxGeometry(1.6, 1.8, 0.35); frame.translate(0, 0, 0.55); parts.push(painted(frame, 0x8a8e9a));
    const g = new T.Group(); g.add(mesh(parts)); return g;
}
// Angel Wings: two feathered wings (layers of white feather blades)
function wings() {
    const parts = [];
    for (const s of [-1, 1]) {
        for (let k = 0; k < 7; k++) {
            const len = 1.2 + k * 0.32, f = new T.CapsuleGeometry(0.2, len, 3, 8);
            f.scale(1, 1, 0.3);
            f.rotateZ(s * (0.55 + k * 0.17)); f.translate(s * (0.35 + Math.sin(0.55 + k * 0.17) * len * 0.5), 0.6 + Math.cos(0.55 + k * 0.17) * len * 0.5 - k * 0.1, -k * 0.04);
            parts.push(painted(f, (x, y) => tmpC.set(0xffffff).lerp(new T.Color(0xc8e0ff), Math.max(0, Math.min(1, 1 - y / 3)) * 0.5)));
        }
    }
    const g = new T.Group(); g.add(mesh(parts)); return g;
}
// The Rocket Launcher: a green tube with a red rocket peeking out
function rocket() {
    const parts = [];
    const tube = new T.CylinderGeometry(0.45, 0.45, 3, 16, 1, true); tube.rotateX(Math.PI / 2); parts.push(painted(tube, 0x4ac83a));
    for (const z of [-1.3, 1.3]) { const r = new T.TorusGeometry(0.48, 0.1, 6, 18); r.translate(0, 0, z); parts.push(painted(r, 0x2a6a22)); }
    const tip = new T.ConeGeometry(0.34, 0.8, 12); tip.rotateX(Math.PI / 2); tip.translate(0, 0, 1.75); parts.push(painted(tip, 0xff3a3a));
    const sight = new T.BoxGeometry(0.15, 0.4, 0.5); sight.translate(0, 0.6, 0.3); parts.push(painted(sight, 0x3a3e4a));
    const grip = new T.BoxGeometry(0.3, 0.8, 0.4); grip.rotateX(0.3); grip.translate(0, -0.7, -0.3); parts.push(painted(grip, 0x3a3e4a));
    const g = new T.Group(); g.add(mesh(parts)); return g;
}
// The Scythe: a long dark handle and a glowing purple blade
function scythe() {
    const parts = [];
    const h = new T.CylinderGeometry(0.12, 0.14, 4.6, 8); h.translate(0, 0, 0); parts.push(painted(h, 0x2a1a3a));
    const shape = new T.Shape();
    shape.moveTo(0, 0); shape.quadraticCurveTo(1.6, 0.9, 2.9, -0.5); shape.quadraticCurveTo(1.6, 0.35, 0, -0.45); shape.closePath();
    const blade = new T.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }); blade.translate(0, 2.0, -0.04);
    parts.push(painted(blade, (x) => tmpC.set(0xc87aff).lerp(new T.Color(0xffffff), Math.max(0, x / 2.9) * 0.4)));
    const g = new T.Group();
    const m = mesh(parts); g.add(m);
    m.material = gm('scythe', () => matte({ vertexColors: true, emissive: 0x8a3aff, emissiveIntensity: 0.35 }));
    return g;
}
// The Invisibility Potion: a round glass bottle of swirling purple
function potion() {
    const parts = [];
    const b = new T.SphereGeometry(0.85, 18, 14); parts.push(painted(b, (x, y) => tmpC.set(0x8a5aff).lerp(new T.Color(0xd8b8ff), Math.max(0, y))));
    const neck = new T.CylinderGeometry(0.3, 0.38, 0.7, 12); neck.translate(0, 1.05, 0); parts.push(painted(neck, 0xd8ccff));
    const cork = new T.CylinderGeometry(0.33, 0.3, 0.35, 12); cork.translate(0, 1.55, 0); parts.push(painted(cork, 0xa8743a));
    const eye = new T.SphereGeometry(0.3, 12, 8); eye.scale(1, 0.6, 0.4); eye.translate(0, 0, 0.78); parts.push(painted(eye, 0x1a0a3a));
    const g = new T.Group(); const m = mesh(parts);
    m.material = gm('potion', () => matte({ vertexColors: true, emissive: 0x6a3aff, emissiveIntensity: 0.45 }));
    g.add(m);
    return g;
}
const BUILD = {
    speedCoil: () => coil(0xff3a4a),
    gravityCoil: () => coil(0x3a8aff),
    superCoil: () => coil(0xa84aff, 0xffd028),
    slap: glove, jetpack, wings, rocket, scythe, potion,
};
// A tool model, about 3 studs tall, centred on its own origin
export function gearModel(id) {
    const f = BUILD[id];
    const g = f ? f() : new T.Group();
    mergeChildren(g);
    g.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; } });
    return g;
}
// Where a tool goes on your character: 'hand' (the right hand) or 'back'
export const toolSlot = (id) => (id === 'jetpack' || id === 'wings' ? 'back' : 'hand');
// The copy you carry: smaller, posed for the hand or the back
export function heldModel(id) {
    const holder = new T.Group();
    const g = gearModel(id);
    if (id.endsWith('Coil')) { g.scale.setScalar(0.42); g.position.set(0, -0.2, 0.7); }
    else if (id === 'slap') { g.scale.setScalar(0.6); g.rotation.set(-0.35, 0, -0.25); g.position.set(0, 0.3, 0.3); }
    else if (id === 'rocket') { g.scale.setScalar(0.65); g.position.set(0, 0.2, 0.6); }
    else if (id === 'scythe') { g.scale.setScalar(0.75); g.rotation.set(0.2, 0, 0); g.position.set(0, 0.4, 0.3); }
    else if (id === 'potion') { g.scale.setScalar(0.45); g.position.set(0, -0.1, 0.5); }
    else if (id === 'jetpack') { g.scale.setScalar(0.62); g.position.set(0, 0, -1.05); }
    else if (id === 'wings') { g.scale.setScalar(0.85); g.position.set(0, -0.3, -0.75); }
    holder.add(g);
    holder.userData.slot = toolSlot(id);
    return holder;
}

// =====================================================================================
// Hats
// =====================================================================================
function pumpkin() {
    const parts = [];
    for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2, l = new T.SphereGeometry(0.55, 14, 10); l.scale(0.75, 0.85, 1.05); l.translate(Math.sin(a) * 0.48, 0, Math.cos(a) * 0.48);
        l.rotateY(0); parts.push(painted(l, (x, y) => tmpC.set(0xff8a1a).lerp(new T.Color(0xc85a0a), Math.max(0, -y * 1.4))));
    }
    const stem = new T.CylinderGeometry(0.08, 0.13, 0.4, 8); stem.rotateZ(0.25); stem.translate(0.05, 0.6, 0); parts.push(painted(stem, 0x4a8a2a));
    // the carved face, glowing
    const face = [];
    for (const s of [-1, 1]) { const e = new T.ConeGeometry(0.13, 0.18, 3); e.rotateX(Math.PI / 2); e.rotateZ(Math.PI); e.translate(s * 0.22, 0.12, 0.98); face.push(painted(e, 0xffe24a)); }
    const mouth = new T.BoxGeometry(0.5, 0.12, 0.08); mouth.translate(0, -0.18, 0.98); face.push(painted(mouth, 0xffe24a));
    const g = new T.Group(); g.add(mesh(parts));
    const f = new T.Mesh(mergeGeometries(face), gm('pglow', () => new T.MeshBasicMaterial({ vertexColors: true }))); g.add(f);
    g.scale.setScalar(1.2);
    return g;
}
function valkyrie() {
    const parts = [];
    const dome = new T.SphereGeometry(0.75, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2); parts.push(painted(dome, 0xd8dce8));
    const band = new T.CylinderGeometry(0.78, 0.78, 0.18, 20); band.translate(0, 0.05, 0); parts.push(painted(band, 0xffd028));
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
        const f = new T.CapsuleGeometry(0.1, 0.5 + k * 0.12, 3, 6); f.scale(1, 1, 0.3);
        f.rotateZ(s * (0.4 + k * 0.18)); f.translate(s * (0.82 + k * 0.08), 0.45 + k * 0.06, -0.1 - k * 0.05); parts.push(painted(f, 0xffffff));
    }
    const g = new T.Group(); g.add(mesh(parts)); g.scale.setScalar(1.15); return g;
}
function dominus() {
    const parts = [];
    const hood = new T.ConeGeometry(0.85, 1.8, 18); hood.translate(0, 0.6, -0.05); parts.push(painted(hood, (x, y) => tmpC.set(0x1a1a24).lerp(new T.Color(0x3a3a4a), Math.max(0, y))));
    const rim = new T.TorusGeometry(0.72, 0.07, 6, 20); rim.rotateX(Math.PI / 2); rim.translate(0, -0.1, 0); parts.push(painted(rim, 0xffd028));
    const gem = new T.OctahedronGeometry(0.16); gem.translate(0, 0.25, 0.72); parts.push(painted(gem, 0xff2a5a));
    const g = new T.Group(); g.add(mesh(parts)); g.scale.setScalar(1.1); return g;
}
// The Angry Mask: a little Angry Head worn over your face
function mask() {
    const g = new T.Group();
    const m = new T.Mesh(headGeometry('normal'), gm('maskmat', () => headMaterial()));
    m.scale.setScalar(0.85); m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return g;
}
const HAT_BUILD = { pumpkin, valkyrie, dominus, mask };
export function hatModel(id) {
    const f = HAT_BUILD[id];
    const g = f ? f() : new T.Group();
    if (id !== 'mask') mergeChildren(g);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
}
// Where a hat sits above the head bone (in avatar units) / on the blocky head
export const HAT_SPOT = { pumpkin: [0, 1.15, 0], valkyrie: [0, 0.95, 0], dominus: [0, 1.0, 0], mask: [0, 0.55, 0.05] };
