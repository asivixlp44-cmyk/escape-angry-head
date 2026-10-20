// The Angry Heads: our own cartoon head (a big round face with a blonde bowl cut, bulging eyes
// that follow you, angry brows, a red-lipped mouth screaming wide open with rows of teeth), built
// in code as ONE mesh per head: every part's colour is in its vertices, and the jaw, the pupils and
// the brows move in the vertex shader (one shared shader for every head; each head has its own
// little material for its own jaw / eyes / brows). Five looks: the normal blonde head, the furious
// red one, the grey giant, the see-through ghost and the crowned boss.
//
// The server moves the heads (server/src/heads.js) and sends each maze's heads to the players in
// it 20 times a second; here they're drawn ~110 ms in the past, smoothly between two of those
// snapshots, and animated: bobbing, rocking, squashing as they bound along, jaws chomping, eyes on
// you. The jumpscare is the same head flying into the camera.
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { T, V3, scene, camera, tickers } from './engine.js';
import { HEAD_TYPES } from '../../shared/config.js';
import { softTex } from './materials.js';

const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, k) => a + (b - a) * k;
const col = (hex) => new T.Color(hex);

// ----- geometry -----
// Every part gets the same attributes: position, normal, color, aJaw (0..1: moves with the jaw),
// aEye (1: a pupil / iris that looks around), aBrow (1: an eyebrow)
function finish(g, colorFn, jaw, eye, brow) {
    if (g.index) {
        // weld the UV seam, then smooth normals, then one vertex per corner (every part merges flat)
        if (g.attributes.uv) g.deleteAttribute('uv');
        g = mergeVertices(g);
        g.computeVertexNormals();
        g = g.toNonIndexed();
    } else if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = p.count;
    const c = new Float32Array(n * 3), aj = new Float32Array(n), ae = new Float32Array(n), ab = new Float32Array(n);
    const tmp = new T.Color(), v = new V3();
    for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(p, i);
        const k = colorFn(v, tmp, i, g) || tmp;
        c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b;
        aj[i] = typeof jaw === 'function' ? jaw(v) : jaw || 0;
        ae[i] = eye || 0; ab[i] = brow || 0;
    }
    g.setAttribute('color', new T.BufferAttribute(c, 3));
    g.setAttribute('aJaw', new T.BufferAttribute(aj, 1));
    g.setAttribute('aEye', new T.BufferAttribute(ae, 1));
    g.setAttribute('aBrow', new T.BufferAttribute(ab, 1));
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.aIn) g.deleteAttribute('aIn');
    return g;
}
// the mouth: an ellipse on the front of the face (x, y), centred a little below the middle
const MOUTH = { y: -0.44, w: 0.42, h: 0.25 };
const mouthE = (x, y) => (x / MOUTH.w) ** 2 + ((y - MOUTH.y) / MOUTH.h) ** 2;
// the jaw: everything below the middle of the mouth, on the front half of the head
const jawWeight = (v) => smooth(MOUTH.y + 0.04, MOUTH.y - 0.06, v.y) * smooth(-0.35, 0.25, v.z);

function skull(d) {
    const g = new T.SphereGeometry(1, 84, 60);
    const p = g.attributes.position, v = new V3();
    const inside = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        let { x, y, z } = v;
        y *= 1.05;
        if (y < 0) { const k = (-y) ** 1.5; x *= 1 - 0.14 * k; z *= 1 - 0.02 * k; }
        // a chunky chin
        const ch = Math.exp(-((x * x) / 0.12 + ((y + 0.82) ** 2) / 0.05)) * Math.max(0, z);
        y -= ch * 0.08; z += ch * 0.06;
        // puffy cheeks
        for (const s of [-1, 1]) { const w = Math.exp(-(((x - s * 0.56) ** 2) + ((y + 0.12) ** 2)) / 0.06) * Math.max(0, z); x += s * w * 0.06; z += w * 0.06; }
        // a heavy brow ridge over the eyes
        const br = Math.exp(-((y - 0.4) ** 2) / 0.007) * Math.max(0, z - 0.5) * (1 - Math.min(1, Math.abs(x) / 0.7));
        z += br * 0.12;
        if (z > 0.3) {
            const e = mouthE(x, y);
            if (e < 1) {
                // the open mouth: a deep bowl pressed into the face
                const depth = 0.55 * Math.sqrt(1 - e), len = Math.hypot(x, y, z);
                x -= x / len * depth * 0.6; y -= (y - MOUTH.y) * depth * 0.35; z -= depth * 1.1;
                inside[i] = 1 - e;
            } else if (e < 1.45) {
                // puffy lips round it
                const k = Math.sin((e - 1) / 0.45 * Math.PI);
                z += k * 0.055;
            }
        }
        p.setXYZ(i, x, y, z);
    }
    const skin = col(d.skin), blush = col(0xff6a6a), lipC = col(d.ghost ? 0x5a8ac8 : 0xc22a36), dark = skin.clone().multiplyScalar(0.78);
    const throat = col(0x12020a), gum = col(0x8a1420);
    // how deep inside the mouth each vertex is rides along as an attribute through the welding
    g.setAttribute('aIn', new T.BufferAttribute(inside, 1));
    return finish(g, (q, out, i, geo) => {
        const ins = geo.attributes.aIn.getX(i);
        if (ins > 0) return out.copy(gum).lerp(throat, smooth(0.15, 0.7, ins));
        out.copy(skin);
        // rosy cheeks, darker under the chin, a hint of shadow round the eyes
        for (const s of [-1, 1]) { const w = Math.exp(-(((q.x - s * 0.54) ** 2) + ((q.y + 0.12) ** 2)) / 0.05) * Math.max(0, q.z); out.lerp(blush, w * 0.45); }
        out.lerp(dark, smooth(-0.55, -0.98, q.y) * 0.6);
        for (const s of [-1, 1]) { const w = Math.exp(-(((q.x - s * 0.34) ** 2) + ((q.y - 0.06) ** 2)) / 0.025) * Math.max(0, q.z); out.lerp(col(0xb8626a), w * 0.4); }
        if (q.z > 0.3) { const e = mouthE(q.x, q.y); if (e < 1.5) out.lerp(lipC, smooth(1.5, 1.12, e)); }
        return out;
    }, jawWeight);
}
function hair(d) {
    const g = new T.SphereGeometry(1, 64, 30, 0, TAU, 0, Math.PI * 0.72);
    const p = g.attributes.position, v = new V3();
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const th = Math.atan2(v.x, v.z), back = (1 - Math.cos(th)) / 2;
        // the hairline: bangs down to the brows, down to the ears at the sides, the nape behind
        let line = lerp(0.53, -0.6, back ** 0.7);
        // strands: a jagged fringe of locks
        const lock = Math.abs(((th * 7 / Math.PI) % 2 + 2) % 2 - 1);
        line += (0.07 + 0.03 * back) * lock * lock;
        let y = v.y * 1.05;
        if (y < line) y = line;
        // thick locks combed down from the crown
        const ridges = 0.03 * Math.sin(th * 14 + y * 2.5) + 0.012 * Math.sin(th * 31 - y * 3);
        const r = 1.08 + ridges + 0.06 * Math.max(0, y) + 0.05 * (1 - back) * smooth(0.25, 0.65, y);
        const flat = Math.hypot(v.x, v.z) || 1e-4, R = Math.sqrt(Math.max(0, 1 - Math.min(1, (y / 1.05) ** 2)));
        // the fringe flicks outward a little at its tips
        const flick = 1 + 0.05 * smooth(line + 0.12, line, y);
        p.setXYZ(i, v.x / flat * R * r * flick, y * (r / 1.03), v.z / flat * R * r * flick);
    }
    const base = col(d.hair), deep = col(d.hairDark), shine = base.clone().lerp(col(0xffffff), 0.4);
    return finish(g, (q, out) => {
        const th = Math.atan2(q.x, q.z);
        const s = Math.sin(th * 14 + q.y * 2.5);
        out.copy(base).lerp(deep, 0.35 - 0.35 * s);
        out.lerp(shine, smooth(0.55, 0.95, q.y) * (0.5 + 0.5 * s) * 0.55);
        out.lerp(deep, smooth(0.25, -0.5, q.y) * 0.45);
        return out;
    }, 0);
}
function sphereAt(r, sx, sy, sz, x, y, z, seg) {
    const g = new T.SphereGeometry(r, seg || 16, Math.max(8, (seg || 16) * 0.7));
    g.scale(sx, sy, sz); g.translate(x, y, z);
    return g;
}
function eyes(d) {
    const parts = [];
    const iris = col(d.boss ? 0xff2a2a : d.ghost ? 0x8affff : d.hair === 0x3a2418 ? 0xd8281e : 0x4a7ab8);
    const ER = 0.235;
    for (const s of [-1, 1]) {
        const cx = s * 0.34, cy = 0.1, cz = 0.75;
        // the bulging eyeball (white, pink and veiny toward the edges)
        parts.push(finish(sphereAt(ER, 1, 1, 1, cx, cy, cz, 24), (q, out) => {
            const f = Math.max(0, (q.z - cz) / ER);
            return out.set(0xfffaf6).lerp(col(0xe08a8a), (1 - f) ** 1.5 * 0.65);
        }, 0));
        // the iris and pupil: domes on the front of the eyeball that look about (aEye)
        const ir = new T.SphereGeometry(0.115, 20, 8, 0, TAU, 0, Math.PI * 0.42); ir.rotateX(Math.PI / 2); ir.translate(cx, cy, cz + ER - 0.075);
        parts.push(finish(ir, (q, out) => out.copy(iris).multiplyScalar(0.65 + 0.6 * smooth(cz + ER - 0.05, cz + ER + 0.03, q.z)), 0, 1));
        const pu = new T.SphereGeometry(0.056, 16, 6, 0, TAU, 0, Math.PI * 0.42); pu.rotateX(Math.PI / 2); pu.translate(cx, cy, cz + ER - 0.022);
        parts.push(finish(pu, (q, out) => out.set(0x08080e), 0, 1));
        // a glint
        parts.push(finish(sphereAt(0.026, 1, 1, 0.5, cx + 0.035, cy + 0.045, cz + ER + 0.014, 8), (q, out) => out.set(0xffffff), 0, 1));
        // the angry eyebrow: thick, its inner end pulled right down
        const b = new T.BoxGeometry(0.46, 0.13, 0.14, 6, 2, 1);
        const bp = b.attributes.position;
        for (let i = 0; i < bp.count; i++) { const bx = bp.getX(i); bp.setY(i, bp.getY(i) * (1 - Math.abs(bx) * 0.9) + 0.035 * Math.cos(bx * 5)); bp.setZ(i, bp.getZ(i) - bx * bx * 1.6); }
        b.rotateZ(s * 0.45); b.rotateY(-s * 0.55); b.translate(s * 0.33, 0.41, 0.93);
        parts.push(finish(b, (q, out) => out.set(d.hairDark).multiplyScalar(0.55), 0, 0, 1));
        // the frown lines between the brows
        const fl = new T.BoxGeometry(0.025, 0.12, 0.03); fl.rotateZ(s * 0.25); fl.translate(s * 0.045, 0.33, 0.995);
        parts.push(finish(fl, (q, out) => out.set(d.skin).multiplyScalar(0.68), 0, 0, 1));
    }
    return parts;
}
function face(d) {
    const parts = [];
    const skin = col(d.skin), nose = skin.clone().lerp(col(0xff7a7a), 0.28);
    // a big round nose with nostrils
    parts.push(finish(sphereAt(0.145, 1.1, 1.15, 1.15, 0, -0.04, 0.96, 20), () => nose, 0));
    for (const s of [-1, 1]) parts.push(finish(sphereAt(0.075, 1, 1, 1, s * 0.09, -0.08, 0.95, 12), () => nose, 0));
    for (const s of [-1, 1]) parts.push(finish(sphereAt(0.032, 1.3, 0.75, 1, s * 0.062, -0.13, 1.06, 8), (q, out) => out.set(0x4a1a1e), 0));
    // ears, peeking out under the hair
    for (const s of [-1, 1]) parts.push(finish(sphereAt(0.15, 0.5, 1, 0.8, s * 0.95, -0.17, -0.02, 14), () => skin.clone().lerp(col(0xff8a8a), 0.22), 0));
    // the tongue, deep in the open mouth
    parts.push(finish(sphereAt(0.21, 1.15, 0.36, 1, 0, MOUTH.y - 0.12, 0.6, 18), (q, out) => out.set(0xc83a4c).lerp(col(0xff8a9a), smooth(MOUTH.y - 0.15, MOUTH.y - 0.02, q.y) * 0.55), 1));
    // teeth: a row under the top lip and one along the bottom (on the jaw)
    for (const [row, n] of [[0, 9], [1, 8]]) {
        for (let k = 0; k < n; k++) {
            const u = (k + 0.5) / n * 2 - 1, x = u * MOUTH.w * (row ? 0.74 : 0.8);
            const yRim = MOUTH.y + (row ? -1 : 1) * MOUTH.h * Math.sqrt(Math.max(0.05, 1 - (x / MOUTH.w) ** 2)) * 0.86;
            const z = Math.sqrt(Math.max(0.2, 1 - x * x - yRim * yRim)) - 0.07;
            const tw = MOUTH.w * (row ? 0.17 : 0.17), th = row ? 0.07 : 0.085;
            const tg = new T.BoxGeometry(tw, th, 0.08, 1, 1, 1);
            tg.rotateY(-x * 1.3); tg.translate(x, yRim + (row ? th / 2 : -th / 2), z);
            parts.push(finish(tg, (q, out) => out.set(0xfffcf2).lerp(col(0xe8d6a8), 0.3 * Math.abs(u)), row));
        }
    }
    return parts;
}
function crown() {
    const parts = [];
    const gold = col(0xffc828), gem = [0xff2a5a, 0x3ad8ff, 0x46e85a];
    const ring = new T.CylinderGeometry(0.62, 0.66, 0.24, 28, 1, true); ring.translate(0, 1.02, -0.05);
    parts.push(finish(ring, () => gold, 0));
    for (let k = 0; k < 7; k++) {
        const a = k / 7 * TAU, sp = new T.ConeGeometry(0.11, 0.38, 6); sp.translate(Math.sin(a) * 0.62, 1.3, Math.cos(a) * 0.62 - 0.05);
        parts.push(finish(sp, () => gold, 0));
        parts.push(finish(sphereAt(0.06, 1, 1, 1, Math.sin(a) * 0.66, 1.03, Math.cos(a) * 0.66 - 0.05, 8), () => col(gem[k % 3]), 0));
    }
    return parts;
}
const geoCache = new Map();
export function headGeometry(type) {
    let g = geoCache.get(type);
    if (g) return g;
    const d = HEAD_TYPES[type] || HEAD_TYPES.normal;
    const parts = [skull(d), hair(d), ...eyes(d), ...face(d), ...(d.boss ? crown() : [])];
    g = mergeGeometries(parts);
    for (const q of parts) q.dispose();
    g.computeBoundingSphere();
    g.boundingSphere.radius = 1.6;
    geoCache.set(type, g);
    return g;
}

// ----- material: matte, vertex colours; the jaw swings open round a hinge below the ears, the
// pupils slide, the brows lift. Every head shares the shader; each has its own uniforms. -----
const HEAD_GLSL = {
    head: `uniform float uJaw; uniform vec2 uLook; uniform float uBrow;
        attribute float aJaw; attribute float aEye; attribute float aBrow;`,
    begin: `vec3 transformed = vec3(position);
        {
            float ja = uJaw * aJaw;
            vec3 piv = vec3(0.0, -0.12, -0.15);
            vec3 q = transformed - piv;
            float c = cos(ja), s = sin(ja);
            transformed = piv + vec3(q.x, c * q.y - s * q.z, s * q.y + c * q.z);
            transformed.xy += uLook * aEye;
            transformed.y += uBrow * aBrow * 0.06;
        }`,
    normal: `vec3 objectNormal = vec3(normal);
        { float ja = uJaw * aJaw; float c = cos(ja), s = sin(ja); objectNormal = vec3(objectNormal.x, c * objectNormal.y - s * objectNormal.z, s * objectNormal.y + c * objectNormal.z); }`,
};
export function headMaterial(o) {
    o = o || {};
    const u = { uJaw: { value: 0.15 }, uLook: { value: new T.Vector2() }, uBrow: { value: 0 } };
    const m = new T.MeshLambertMaterial({ vertexColors: true });
    if (o.ghost) { m.transparent = true; m.opacity = 0.62; m.depthWrite = false; m.emissive = new T.Color(0x3a7ac8); m.emissiveIntensity = 0.55; }
    m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = HEAD_GLSL.head + '\n' + sh.vertexShader
            .replace('#include <beginnormal_vertex>', HEAD_GLSL.normal)
            .replace('#include <begin_vertex>', HEAD_GLSL.begin);
    };
    m.customProgramCacheKey = () => 'angry-head';
    m.userData.u = u;
    return m;
}

// ----- one head on screen -----
const GLOW_GEO = new T.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
// a hot glow over both eyes while it hunts you (in the head's own space, so it bobs and rocks with it)
const EYE_GEO = mergeGeometries([-1, 1].map((s) => new T.PlaneGeometry(0.66, 0.66).translate(s * 0.34, 0.1, 1.0)));
export class HeadView {
    constructor(type, opts) {
        opts = opts || {};
        this.type = type;
        this.def = HEAD_TYPES[type] || HEAD_TYPES.normal;
        this.r = opts.r || this.def.r;
        this.mat = headMaterial({ ghost: this.def.ghost });
        this.mesh = new T.Mesh(headGeometry(type), this.mat);
        // every head casts and receives (a shared material on meshes with different shadow flags
        // makes three re-pick shaders every frame); the ghost doesn't cast but still receives
        this.mesh.castShadow = !this.def.ghost;
        this.mesh.receiveShadow = true;
        this.root = new T.Group();
        this.root.add(this.mesh);
        this.mesh.scale.setScalar(this.r);
        this.phase = Math.random() * 10;
        this.jaw = 0.15; this.look = new T.Vector2(); this.brow = 0; this.sq = 0; this.roll = 0; this.pitch = 0;
        this.mode = 0; this.speed = 0; this.bounce = 0; this.thump = false;
        if (!opts.noGlow) {
            this.glowMat = new T.MeshBasicMaterial({ map: softTex(), color: this.def.ghost ? 0x3aa8ff : this.def.boss ? 0xff3aa8 : 0xff2a1a, transparent: true, opacity: 0.12, depthWrite: false, blending: T.AdditiveBlending });
            this.glow = new T.Mesh(GLOW_GEO, this.glowMat);
            this.glow.position.y = 0.18; this.glow.scale.setScalar(this.r * 2.6); this.glow.renderOrder = 2;
            this.root.add(this.glow);
            this.eyeMat = new T.MeshBasicMaterial({ map: softTex(), color: this.def.ghost ? 0x6ad8ff : this.def.boss ? 0xffc83a : 0xff2a14, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending });
            this.eyeGlow = new T.Mesh(EYE_GEO, this.eyeMat);
            this.eyeGlow.renderOrder = 3; this.eyeGlow.visible = false;
            this.mesh.add(this.eyeGlow);
        }
    }
    // mode: 0 wander, 1 chase, 2 search, 3 stun, 4 laugh, 5 rest; eye: a world point to look at (or null)
    animate(dt, t, mode, speed, eye) {
        const ph = this.phase + t;
        const hurry = Math.min(1, speed / 14);
        // the jaw: chomping while it hunts, cackling when it gets you, hanging open when dazed
        let jaw = 0.12 + 0.06 * Math.sin(ph * 2.3);
        if (mode === 1) jaw = 0.2 + 0.2 * Math.abs(Math.sin(ph * 8.5));
        else if (mode === 4) jaw = 0.12 + 0.26 * Math.abs(Math.sin(ph * 15));
        else if (mode === 3) jaw = 0.34 + 0.03 * Math.sin(ph * 3);
        else if (mode === 5) jaw = 0.3 + 0.1 * Math.sin(ph * 10);
        this.jaw += (jaw - this.jaw) * Math.min(1, dt * 18);
        this.mat.userData.u.uJaw.value = this.jaw;
        // eyes: on you when you're near, rolling round when dazed, darting about otherwise
        const lx = new T.Vector2();
        if (mode === 3) lx.set(Math.cos(ph * 9) * 0.045, Math.sin(ph * 9) * 0.045);
        else if (eye) {
            const lp = this.mesh.worldToLocal(eye.clone());
            lx.set(Math.max(-1, Math.min(1, lp.x * 1.4)) * 0.05, Math.max(-1, Math.min(1, lp.y * 1.4)) * 0.04);
        } else lx.set(Math.sin(ph * 0.7) * 0.035, Math.sin(ph * 1.1) * 0.015);
        this.look.lerp(lx, Math.min(1, dt * 10));
        this.mat.userData.u.uLook.value.copy(this.look);
        this.brow += ((mode === 3 ? 1 : mode === 4 ? 0.6 : 0) - this.brow) * Math.min(1, dt * 8);
        this.mat.userData.u.uBrow.value = this.brow;
        // bounding along: bob, squash on each bounce, rock side to side, lean into the run
        const bounce = Math.abs(Math.sin(ph * (3 + hurry * 6)));
        // landing from a bound (for the dust puff)
        this.thump = hurry > 0.4 && bounce < 0.12 && this.bounce >= 0.12;
        this.bounce = bounce;
        if (this.glowMat) {
            const want = mode === 1 ? 0.5 + 0.2 * Math.sin(ph * 12) : mode === 4 ? 0.45 : mode === 3 ? 0.05 : 0.14;
            this.glowMat.opacity += (want - this.glowMat.opacity) * Math.min(1, dt * 6);
            const eyeWant = mode === 1 ? 0.8 + 0.2 * Math.sin(ph * 14) : mode === 4 ? 0.6 : 0;
            this.eyeMat.opacity += (eyeWant - this.eyeMat.opacity) * Math.min(1, dt * 8);
            this.eyeGlow.visible = this.eyeMat.opacity > 0.02;
        }
        const bob = (mode === 4 ? Math.abs(Math.sin(ph * 15)) * 0.5 : bounce * (0.25 + hurry * 0.9)) + Math.sin(ph * 1.3) * 0.3;
        this.mesh.position.y = this.r + 0.5 + bob;
        const sq = (1 - bounce) * hurry * 0.1;
        this.sq += (sq - this.sq) * Math.min(1, dt * 12);
        this.mesh.scale.set(this.r * (1 + this.sq * 0.5), this.r * (1 - this.sq), this.r * (1 + this.sq * 0.5));
        this.roll += ((mode === 3 ? Math.sin(ph * 6) * 0.3 : mode === 4 ? Math.sin(ph * 18) * 0.12 : Math.sin(ph * (2 + hurry * 4)) * (0.06 + hurry * 0.06)) - this.roll) * Math.min(1, dt * 8);
        this.pitch += ((mode === 1 ? 0.18 : mode === 4 ? -0.2 : 0.04 * Math.sin(ph * 0.9)) * (mode === 1 ? hurry : 1) - this.pitch) * Math.min(1, dt * 6);
        this.mesh.rotation.set(this.pitch, 0, this.roll);
    }
}

// =====================================================================================
// The heads of the maze you're in: snapshots in, smooth motion out
// =====================================================================================
const DELAY = 110;          // ms behind the newest snapshot (two of them are almost always in hand)
export const field = { stage: -1, views: [], snaps: [], chasing: 0, onEvent: null, group: new T.Group() };
field.group.name = 'heads';
scene.add(field.group);
const stars = [];
export function setHeadStage(i, types) {
    if (field.stage === i) return;
    for (const v of field.views) field.group.remove(v.root);
    field.views = [];
    field.snaps = [];
    field.stage = i;
    field.chasing = 0;
    if (i < 0 || !types) return;
    for (const type of types) {
        const v = new HeadView(type);
        v.root.visible = false;
        field.group.add(v.root);
        field.views.push(v);
    }
}
// m: { s, t, d: [x, z, ry, mode] per head, c: chase mask, e: events }
export function headSnapshot(m, now) {
    if (m.s !== field.stage) return;
    field.snaps.push({ t: m.t, d: m.d, at: now });
    while (field.snaps.length > 12) field.snaps.shift();
    field.chasing = m.c || 0;
    if (m.e && field.onEvent) for (const [k, e] of m.e) field.onEvent(k, e);
}
const tmpEye = new V3();
// serverNow: the shared clock (ms); me: the local player's position (the eyes follow it)
export function updateHeads(dt, t, serverNow, me) {
    const snaps = field.snaps;
    if (!field.views.length || !snaps.length) return;
    const rt = serverNow - DELAY;
    let a = snaps[0], b = snaps[0];
    for (let k = 0; k < snaps.length - 1; k++) if (snaps[k].t <= rt && snaps[k + 1].t >= rt) { a = snaps[k]; b = snaps[k + 1]; break; }
    if (rt > snaps[snaps.length - 1].t) a = b = snaps[snaps.length - 1];
    const k = b.t > a.t ? Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t))) : 1;
    field.views.forEach((v, i) => {
        const o = i * 4;
        if (a.d.length <= o + 3) return;
        // a head sent home jumps there (no streak through the walls)
        const kk = Math.abs(b.d[o] - a.d[o]) + Math.abs(b.d[o + 1] - a.d[o + 1]) > 30 ? 1 : k;
        const x = lerp(a.d[o], b.d[o], kk), z = lerp(a.d[o + 1], b.d[o + 1], kk);
        let dr = b.d[o + 2] - a.d[o + 2];
        if (dr > Math.PI) dr -= TAU; if (dr < -Math.PI) dr += TAU;
        const ry = a.d[o + 2] + dr * k, mode = b.d[o + 3];
        const px = v.root.position.x, pz = v.root.position.z;
        if (!v.root.visible) { v.root.visible = true; v.root.position.set(x, 0, z); }
        v.root.position.set(x, 0, z);
        const sp = Math.hypot(x - px, z - pz) / Math.max(dt, 1e-3);
        v.speed += (Math.min(40, sp) - v.speed) * Math.min(1, dt * 6);
        v.mode = mode;
        // a head that's after you turns its face to you as it closes in
        let face = ry;
        if (me && (mode === 1 || mode === 4) && Math.hypot(me.x - x, me.z - z) < 30) face = Math.atan2(me.x - x, me.z - z);
        let d2 = face - v.root.rotation.y;
        d2 = Math.atan2(Math.sin(d2), Math.cos(d2));
        v.root.rotation.y += d2 * Math.min(1, dt * 10);
        const near = me && Math.hypot(me.x - x, me.z - z) < 70;
        v.root.updateMatrixWorld();
        v.animate(dt, t, mode, v.speed, near ? tmpEye.set(me.x, me.y + 4, me.z) : null);
        if (mode === 3 && near) stars.push(v);
    });
}
// Where head k is drawn right now (catch tests use what you see)
export const headPos = (k) => { const v = field.views[k]; return v && v.root.visible ? v.root.position : null; };

// =====================================================================================
// The jumpscare: the head that got you lunges into the camera, mouth wide, screaming
// =====================================================================================
// It's drawn in a second pass over the finished frame (depth cleared), in its own little scene
// with its own light, so no wall can ever cut through the face. One head per look is made at load
// (warmScare) and reused, so nothing compiles when it happens.
export const scareScene = new T.Scene();
{
    const hemi = new T.HemisphereLight(0xfff2e8, 0x6a4a5a, 1.15), amb = new T.AmbientLight(0xffffff, 0.45);
    const key = new T.DirectionalLight(0xfff4ea, 1.6); key.position.set(0.4, 0.8, 1);
    scareScene.add(hemi, amb, key, key.target);
}
const scareViews = new Map();
function scareView(type) {
    let v = scareViews.get(type);
    if (!v) {
        v = new HeadView(type, { r: 1, noGlow: true });
        v.mesh.castShadow = false; v.mesh.receiveShadow = false;
        v.mesh.frustumCulled = false;
        v.root.visible = false;
        scareScene.add(v.root);
        scareViews.set(type, v);
    }
    return v;
}
export function warmScare() { for (const type of Object.keys(HEAD_TYPES)) scareView(type).root.visible = true; }
export function warmScareDone() { for (const v of scareViews.values()) v.root.visible = false; }
let scare = null;
export function jumpscare(type, ms) {
    if (scare) scare.v.root.visible = false;
    const v = scareView(HEAD_TYPES[type] ? type : 'normal');
    v.root.visible = true;
    scare = { v, t: 0, ms: ms || 1300 };
    placeScare(0);
}
export const scaring = () => !!scare;
const scareQ = new T.Quaternion(), scareOff = new V3();
function placeScare(dt) {
    const v = scare.v;
    scare.t += dt * 1000;
    const inK = Math.min(1, scare.t / 150);
    const z = lerp(-10, -2.05, 1 - (1 - inK) ** 3);
    // in front of the camera, facing it, shaking
    camera.updateMatrixWorld();
    scareOff.set((Math.random() - 0.5) * 0.07, 0.08 + (Math.random() - 0.5) * 0.07, z).applyMatrix4(camera.matrixWorld);
    v.root.position.copy(scareOff);
    camera.getWorldQuaternion(scareQ);
    v.root.quaternion.copy(scareQ);
    v.root.rotateX(-0.06);
    v.root.rotateZ(Math.sin(scare.t * 0.05) * 0.07);
    v.mesh.position.set(0, 0, 0);
    v.mesh.rotation.set(0, 0, 0);
    v.mesh.scale.setScalar(1 + Math.sin(scare.t * 0.06) * 0.03);
    const u = v.mat.userData.u;
    u.uJaw.value = 0.36 + 0.1 * Math.abs(Math.sin(scare.t * 0.03));
    u.uLook.value.set(0, 0);
    u.uBrow.value = 0.25;
}
// called by the renderer after the main pass
export function scareActive() { return !!scare; }
tickers.push((dt) => {
    if (!scare) return;
    placeScare(dt);
    if (scare.t >= scare.ms) { scare.v.root.visible = false; scare = null; }
});
export function dizzyHeads() { const s = stars.slice(); stars.length = 0; return s; }
