// The world: the haunted lobby hall (the stage doors along its north wall, the gear in glass display
// cases, the Free Items booth, the hats, the "become the Angry Head" poster, the leaderboards, the
// dead tree hung with cages and the Headless Horseman) and the thirteen themed mazes (from
// shared/maze.js): walls with trims and pillars, the safe start room, the red-carpet checkpoints,
// the glowing EXIT, truss lookouts and plank bridges over the walls, slime / ice / lava floors,
// coins, keys, and each theme's props, lamps, posters and cobwebs. Every collider is made here too.
//
// Static geometry is merged per place and material (a handful of draw calls per maze); only the
// place you're in is drawn. Everything matte (Lambert) or unlit, with a soft dark-at-the-bottom
// shading baked into the vertex colours. Built in slices so the page never freezes while loading.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    T, V3, scene, mat, studVCMaterial, solids, triggers, prompts, tickers, solidBox, buildRig, animRig,
    billboard, texFrom, sharedTex, textCanvas, fitFont,
} from './engine.js';
import {
    surfaceMaterial, redWoodMaterial, trussMaterial, lavaMaterial, slimeMaterial, iceFloorMaterial, arrowTex, cpPadMaterial,
    softTex, coinMaterial, goldMaterial, neon, webMaterial, seeded,
} from './materials.js';
import { gearModel, hatModel } from './gear.js';
import { getQuality } from './fx.js';
import { PROPS, THEME_PROPS, POSTERS } from './props.js';
import { S, actions } from './state.js';
import {
    CFG, STAGES, THEMES, BOSS, BOSS_UNLOCK, gearById, hatById, PASSES, fmt, clock, stageOpen, limitedFree, clearedCount,
} from '../../shared/config.js';
import {
    CELL, WALL, WALL_H, HALF, ROOM_W, ROOM_D, DECK_Y, CAP, LOBBY, SPAWN as SPAWN_AT, DOORS, GEAR_PADS, BOOTH, LIMITED_PADS, HAT_PADS, MORPH_PAD, BOARD_SPOTS,
    MAZES, CHECKPOINTS, COINS, KEYS, cellCenter, neighbours, stageAt,
} from '../../shared/maze.js';

export const SPAWN = new V3(SPAWN_AT.x, SPAWN_AT.y + 0.6, SPAWN_AT.z);
export const SPAWN_YAW = SPAWN_AT.yaw;

// =====================================================================================
// Zones: -1 the lobby, i the stage i. Only the place you're in is drawn and animated.
// =====================================================================================
const zoneGroups = new Map();
export function zoneGroup(z) {
    let g = zoneGroups.get(z);
    if (!g) { g = new T.Group(); g.name = 'zone' + z; scene.add(g); zoneGroups.set(z, g); }
    return g;
}
let shownArea = null;
export function cullZones(area) {
    const a = area ?? -1;
    if (a === shownArea) return;
    shownArea = a;
    for (const [z, g] of zoneGroups) {
        g.visible = z === a;
        g.matrixWorldAutoUpdate = g.visible;
    }
}
const anim = (o) => { o.userData.anim = true; return o; };
const FAR_SIGNS = 110;
const spriteLOD = [];
function freezeStatic(only) {
    for (const [zone, g] of zoneGroups) {
        if (only !== undefined && zone !== only) continue;
        g.updateMatrixWorld(true);
        g.traverse((o) => {
            if (!o.userData.anim) o.matrixAutoUpdate = false;
            if (o.isSprite && !o.userData.keepFar) { const wp = new V3(); o.getWorldPosition(wp); spriteLOD.push({ sp: o, zone, x: wp.x, y: wp.y, z: wp.z, near2: o.userData.near2 || 0 }); }
        });
    }
}

// ----- static geometry, merged per zone and material at the end -----
const geoBatches = new Map();
function batchFor(zone, material, cast) {
    const k = zone + '|' + material.uuid + '|' + (cast ? 1 : 0);
    let b = geoBatches.get(k);
    if (!b) { b = { zone, material, cast, list: [], pos: [], nrm: [], uv: [], idx: [], col: [] }; geoBatches.set(k, b); }
    return b;
}
const white3 = new T.Color(0xffffff);
// Plain one-colour materials fold into two shared vertex-colour ones (matte and unlit)
let smoothVCm = null, basicVCm = null;
const smoothVC = () => smoothVCm || (smoothVCm = new T.MeshLambertMaterial({ vertexColors: true }));
const basicVC = () => basicVCm || (basicVCm = new T.MeshBasicMaterial({ vertexColors: true }));
function fold(material, color) {
    if (material.vertexColors || material.map || material.transparent || material.alphaTest > 0 || material.side !== T.FrontSide) return null;
    if (material.isMeshLambertMaterial && (!material.emissive || material.emissive.getHex() === 0)) return { m: smoothVC(), c: color ?? material.color };
    if (material.isMeshBasicMaterial && material.toneMapped !== false) return { m: basicVC(), c: color ?? material.color };
    return null;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function addGeo(zone, geo, material, cast, color, shade) {
    const f = fold(material, color);
    if (f) { material = f.m; color = f.c; }
    const b = batchFor(zone, material, cast);
    const vc = !!material.vertexColors;
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name) && !(vc && name === 'color')) geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (vc && (!geo.attributes.color || color !== undefined)) {
        const c = color !== undefined ? new T.Color(color) : white3, p = geo.attributes.position, n = p.count, a = new Float32Array(n * 3);
        let y0 = 0, y1 = 1;
        if (shade) { geo.computeBoundingBox(); y0 = shade[2] ?? geo.boundingBox.min.y; y1 = Math.max(y0 + 1e-3, shade[3] ?? geo.boundingBox.max.y); }
        for (let i = 0; i < n; i++) {
            const k = shade ? shade[0] + (shade[1] - shade[0]) * clamp01((p.getY(i) - y0) / (y1 - y0)) : 1;
            a[i * 3] = c.r * k; a[i * 3 + 1] = c.g * k; a[i * 3 + 2] = c.b * k;
        }
        geo.setAttribute('color', new T.BufferAttribute(a, 3));
    }
    if (!geo.index) { const idx = []; for (let i = 0; i < geo.attributes.position.count; i++) idx.push(i); geo.setIndex(idx); }
    b.list.push(geo);
}
// Axis-aligned boxes straight into their batch's vertex arrays. uvDiv: world-unit UVs / uvDiv
// (studs per texture tile), 0 for 0..1 per face. skip: face indices to leave out (3 = bottom).
// shade: [bottom, top(, y0, y1)] brightness by height.
const BOX_FACES = [[2, 1, 0, -1, -1, 1, 2, 1], [2, 1, 0, 1, -1, -1, 2, 1], [0, 2, 1, 1, 1, 1, 0, 2], [0, 2, 1, 1, -1, -1, 0, 2], [0, 1, 2, 1, -1, 1, 0, 1], [0, 1, 2, -1, -1, -1, 0, 1]];
const vcTmp = new T.Color();
function addBox(zone, material, cast, sx, sy, sz, x, y, z, uvDiv, color, skip, shade) {
    const f = fold(material, color);
    if (f) { material = f.m; color = f.c; }
    const b = batchFor(zone, material, cast);
    const vc = !!material.vertexColors;
    if (vc) vcTmp.set(color ?? 0xffffff);
    const size = [sx, sy, sz], c = [x, y, z], v = [0, 0, 0], n = [0, 0, 0];
    const ya = shade ? shade[2] ?? y - sy / 2 : 0, yb = shade ? shade[3] ?? y + sy / 2 : 1;
    for (let fi = 0; fi < 6; fi++) {
        if (skip && skip.includes(fi)) continue;
        const [u, vv, w, ud, vd, ws, su, sv] = BOX_FACES[fi];
        const base = b.pos.length / 3;
        const wu = size[u], hv = size[vv], dw = size[w] / 2 * ws;
        const us = uvDiv ? size[su] / uvDiv : 1, vs = uvDiv ? size[sv] / uvDiv : 1;
        for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 2; ix++) {
            v[u] = (ix * wu - wu / 2) * ud; v[vv] = (iy * hv - hv / 2) * vd; v[w] = dw;
            b.pos.push(v[0] + c[0], v[1] + c[1], v[2] + c[2]);
            n[0] = n[1] = n[2] = 0; n[w] = ws;
            b.nrm.push(n[0], n[1], n[2]);
            b.uv.push(ix * us + (uvDiv ? (c[su] - size[su] / 2) / uvDiv : 0), (1 - iy) * vs + (uvDiv ? (c[sv] - size[sv] / 2) / uvDiv : 0));
            if (vc) {
                const k = shade ? shade[0] + (shade[1] - shade[0]) * clamp01((v[1] + y - ya) / (yb - ya)) : 1;
                b.col.push(vcTmp.r * k, vcTmp.g * k, vcTmp.b * k);
            }
        }
        b.idx.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
}
function flushGeo() {
    for (const b of geoBatches.values()) {
        const parts = [...b.list];
        if (b.pos.length) {
            const g = new T.BufferGeometry();
            g.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3));
            g.setAttribute('normal', new T.Float32BufferAttribute(b.nrm, 3));
            g.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2));
            if (b.col.length) g.setAttribute('color', new T.Float32BufferAttribute(b.col, 3));
            g.setIndex(b.idx);
            parts.push(g);
        }
        if (!parts.length) continue;
        for (const g of parts) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
        const hasColor = parts.some((g) => g.attributes.color);
        if (hasColor) for (const g of parts) if (!g.attributes.color) g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
        const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts);
        if (!geo) { console.warn('[world] could not merge a batch', b.zone); continue; }
        geo.computeBoundingSphere();
        const mesh = new T.Mesh(geo, b.material);
        mesh.receiveShadow = true; mesh.castShadow = !!b.cast;
        mesh.matrixAutoUpdate = false;
        if (b.material.transparent) mesh.renderOrder = 2;
        zoneGroup(b.zone).add(mesh);
        if (parts.length > 1) for (const g of parts) g.dispose();
    }
    geoBatches.clear();
}
function worldUV(g, tile) {
    if (!g.attributes.uv) g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(nn.getX(i)), ay = Math.abs(nn.getY(i)), az = Math.abs(nn.getZ(i));
        if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) / tile, -p.getZ(i) / tile);
        else if (ax >= az) uv.setXY(i, -p.getZ(i) / tile, p.getY(i) / tile);
        else uv.setXY(i, p.getX(i) / tile, p.getY(i) / tile);
    }
    return g;
}
// A solid box drawn with a material and a collider
function wallBox(zone, material, sx, sy, sz, x, y, z, color, o) {
    o = o || {};
    addBox(zone, material, o.cast ?? true, sx, sy, sz, x, y, z, o.uv ?? 8, color, o.skip, o.shade);
    if (o.solid !== false) return solidBox(x, y, z, sx, sy, sz, { zone, mat: o.mat || 'stone', ...(o.extra || {}) });
    return null;
}
// Moves a static mesh into its zone's merged batches
function bake(zone, mesh, cast) {
    mesh.updateWorldMatrix(true, false);
    addGeo(zone, mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), mesh.material, cast);
    if (mesh.parent) mesh.parent.remove(mesh);
}
// A prop from props.js placed at (x, z) facing yaw, baked into the zone; with a collider
function placeProp(zone, name, x, z, yaw, rnd, o) {
    const def = PROPS[name];
    if (!def) return;
    o = o || {};
    const p = def(rnd);
    const m4p = new T.Matrix4().makeRotationY(yaw || 0).setPosition(x, o.y || 0, z);
    let top = 0;
    for (const part of p.parts) {
        const g = part.g.clone().applyMatrix4(m4p);
        g.computeBoundingBox(); top = Math.max(top, g.boundingBox.max.y - (o.y || 0));
        let material;
        if (part.s === 'glow') material = basicVC();
        else if (part.s) { material = surfaceMaterial(part.s); worldUV(g, 6); }
        else material = smoothVC();
        addGeo(zone, g, material, part.s !== 'glow', part.c, part.s === 'glow' ? null : [0.75, 1.05]);
    }
    if (o.solid !== false) {
        const c = Math.abs(Math.cos(yaw || 0)), s = Math.abs(Math.sin(yaw || 0));
        const w = p.w * c + p.d * s, d = p.w * s + p.d * c;
        solidBox(x, top / 2 + (o.y || 0), z, w * 0.9, top, d * 0.9, { zone, mat: /crate|shelf|box/.test(name) ? 'wood' : 'stone' });
    }
}

// ----- signs and boards -----
function txt(x, text, cx, cy, maxW, px, fill, stroke, weight, family) {
    const p = fitFont(x, text, maxW, px, weight || 800, family || 'Fredoka, "Arial Rounded MT Bold", sans-serif', 0.22);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    if (stroke) { x.lineWidth = p * 0.2; x.strokeStyle = stroke; x.strokeText(text, cx, cy); }
    x.fillStyle = fill; x.fillText(text, cx, cy);
    return p;
}
// A painted board facing `look`, its frame baked into the zone's batches
function board(zone, draw, key, w, h, pos, look, o) {
    o = o || {};
    const W = o.W || 1024;
    const map = sharedTex('board|' + key, () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = Math.round(W * h / w); draw(cv.getContext('2d'), cv.width, cv.height); return cv; });
    const grp = new T.Group(); grp.position.copy(pos); grp.lookAt(look); zoneGroup(zone).add(grp);
    if (o.frame !== null) {
        const frame = new T.Mesh(new RoundedBoxGeometry(w + 0.8, h + 0.8, 0.5, 2, 0.25), mat(o.frame ?? 0x3a2418)); grp.add(frame);
        bake(zone, frame, true);
    }
    const face = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    face.position.z = 0.3; grp.add(face);
    return grp;
}
// Big glowing title text on a plane
function bigTitle(zone, text, w, pos, look, colors, stroke) {
    const map = sharedTex('title|' + text + '|' + colors + '|' + stroke, () => {
        const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 220;
        const x = cv.getContext('2d');
        const px = fitFont(x, text, 1024 - 56, 150, 800, 'Montserrat, Fredoka, sans-serif', 0.16);
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.lineJoin = 'round'; x.lineWidth = px * 0.15; x.strokeStyle = stroke || '#1a0a2a'; x.strokeText(text, 512, 112);
        const g = x.createLinearGradient(0, 40, 0, 180);
        colors.forEach((c, i) => g.addColorStop(i / Math.max(1, colors.length - 1), c));
        x.fillStyle = g; x.fillText(text, 512, 112);
        return cv;
    });
    const m = new T.Mesh(new T.PlaneGeometry(w, w * 220 / 1024), new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide, forceSinglePass: true }));
    m.position.copy(pos); m.lookAt(look);
    m.renderOrder = 2;
    zoneGroup(zone).add(m);
    return m;
}
function label(zone, lines, w, pos, near, shared) {
    const sp = billboard(lines, w, 512, pos, zoneGroup(zone), shared);
    sp.userData.near2 = (near || 0) ** 2;
    return sp;
}
// A face-on picture of an Angry Head (posters, boards, the HUD)
export function drawHeadIcon(x, cx, cy, r, o) {
    o = o || {};
    x.save(); x.translate(cx, cy);
    x.fillStyle = o.hair || '#f0d27a'; x.beginPath(); x.ellipse(0, -r * 0.18, r * 1.06, r * 0.98, 0, 0, Math.PI * 2); x.fill();
    const g = x.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r * 1.05); g.addColorStop(0, o.skin2 || '#ffe0c8'); g.addColorStop(1, o.skin || '#e8a888');
    x.fillStyle = g; x.beginPath(); x.ellipse(0, r * 0.08, r * 0.9, r * 0.92, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = o.hair || '#f0d27a';
    x.beginPath(); x.moveTo(-r * 0.98, -r * 0.05);
    for (let k = 0; k <= 8; k++) { const u = -0.95 + k * 0.2375; x.lineTo(u * r, -r * (0.32 + (k % 2 ? 0.0 : 0.12))); }
    x.lineTo(r * 0.98, -r * 0.05); x.quadraticCurveTo(r * 0.9, -r * 1.2, 0, -r * 1.18); x.quadraticCurveTo(-r * 0.9, -r * 1.2, -r * 0.98, -r * 0.05); x.fill();
    x.strokeStyle = '#5a3a18'; x.lineWidth = r * 0.12; x.lineCap = 'round';
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(s * r * 0.12, -r * 0.08); x.lineTo(s * r * 0.55, -r * 0.24); x.stroke(); }
    for (const s of [-1, 1]) {
        x.fillStyle = '#fff'; x.beginPath(); x.arc(s * r * 0.34, r * 0.08, r * 0.2, 0, Math.PI * 2); x.fill();
        x.fillStyle = o.iris || '#3a6ab0'; x.beginPath(); x.arc(s * r * 0.32, r * 0.1, r * 0.1, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#111'; x.beginPath(); x.arc(s * r * 0.32, r * 0.1, r * 0.05, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = '#c22a36'; x.beginPath(); x.ellipse(0, r * 0.58, r * 0.46, r * 0.34, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#2a0408'; x.beginPath(); x.ellipse(0, r * 0.6, r * 0.38, r * 0.27, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#fff'; x.fillRect(-r * 0.3, r * 0.34, r * 0.6, r * 0.08);
    x.fillStyle = '#e85a6a'; x.beginPath(); x.ellipse(0, r * 0.74, r * 0.22, r * 0.1, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#f0a08a'; x.beginPath(); x.ellipse(0, r * 0.28, r * 0.12, r * 0.1, 0, 0, Math.PI * 2); x.fill();
    x.restore();
}
let headIconT = null;
export function headIconTex() {
    if (headIconT) return headIconT;
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    drawHeadIcon(cv.getContext('2d'), 128, 140, 100);
    headIconT = texFrom(cv);
    return headIconT;
}
let headUrl = '';
export function headIconUrl() {
    if (headUrl) return headUrl;
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    drawHeadIcon(cv.getContext('2d'), 64, 70, 50);
    headUrl = cv.toDataURL('image/png');
    return headUrl;
}

// =====================================================================================
// Shared state the HUD and main.js read
// =====================================================================================
export const coinState = { collected: new Set() };
export const keyState = { got: new Set() };   // replaced by the server's list when they disagree
const doors = [];             // { i, panel, lock, info, state }
const pads = [];              // display cases: { kind, id, label, key }
const cpPads = new Map();     // checkpoint id -> { pad, lit, s, k }
const beams = new Map();      // stage -> beam material
const coinMeshes = new Map(); // stage -> { mesh, list, key }
const keyMeshes = [];         // { k, g }
const exits = new Map();      // stage -> { field, label, need, key }
const guides = new Map();     // stage -> mesh
const glowPts = [];
const flowMats = [];
const lobbyAnim = { horseman: null };
const batTime = { value: 0 }, glowTime = { value: 0 }, guideTime = { value: 0 }, coinTime = { value: 0 };

// =====================================================================================
// THE LOBBY
// =====================================================================================
const L = LOBBY, LZ = -1;
const lobbyLamps = [];
function buildLobby() {
    const rnd = seeded(101);
    const stone = surfaceMaterial('stone'), planks = surfaceMaterial('planks'), stud = studVCMaterial();
    const W = 4, H = L.wallH;
    // ----- floor: dark studded slate, a purple carpet path to the doors with gold edges -----
    wallBox(LZ, stud, L.x1 - L.x0, 2, L.z1 - L.z0, 0, -1, 0, 0x4a4460, { mat: 'floor', uv: 8, cast: false });
    addBox(LZ, stud, false, 13, 0.1, 104, 0, 0.05, -2, 8, 0xffc848, [3]);
    addBox(LZ, stud, false, 11.4, 0.12, 104.2, 0, 0.07, -2, 8, 0x7a3ab0, [3]);
    addBox(LZ, stud, false, 166, 0.1, 11, 0, 0.05, L.z1 - 12, 8, 0xffc848, [3]);
    addBox(LZ, stud, false, 166.2, 0.12, 9.4, 0, 0.07, L.z1 - 12, 8, 0x7a3ab0, [3]);
    // ----- walls: purple stone with a glowing trim, battlements on top -----
    for (const [sx, sz, x, z] of [[L.x1 - L.x0 + W * 2, W, 0, L.z0 - W / 2], [L.x1 - L.x0 + W * 2, W, 0, L.z1 + W / 2], [W, L.z1 - L.z0, L.x0 - W / 2, 0], [W, L.z1 - L.z0, L.x1 + W / 2, 0]]) {
        wallBox(LZ, stone, sx, H, sz, x, H / 2, z, 0x8a7aaa, { shade: [0.5, 1.02], uv: 10 });
        addBox(LZ, neon(0xb46aff, 1.2), false, sx + 0.2, 0.4, sz + 0.2, x, 1.4, z);
        addBox(LZ, stone, true, sx + 1, 1.2, sz + 1, x, H + 0.6, z, 10, 0x5a4a7a);
    }
    for (let x = L.x0 - W; x <= L.x1 + W; x += 7) for (const z of [L.z0 - W / 2, L.z1 + W / 2]) addBox(LZ, stone, true, 3.2, 2.6, W + 0.6, x, H + 2.5, z, 10, 0x5a4a7a);
    for (let z = L.z0; z <= L.z1; z += 7) for (const x of [L.x0 - W / 2, L.x1 + W / 2]) addBox(LZ, stone, true, W + 0.6, 2.6, 3.2, x, H + 2.5, z, 10, 0x5a4a7a);
    // pumpkins on the battlements (the reference's), with glowing faces
    for (let k = 0; k < 16; k++) {
        const side = k % 4, t = 0.08 + ((k >> 2) / 4) * 0.84 + rnd() * 0.1;
        const x = side < 2 ? L.x0 + (L.x1 - L.x0) * t : side === 2 ? L.x0 - 2 : L.x1 + 2;
        const z = side === 0 ? L.z0 - 2 : side === 1 ? L.z1 + 2 : L.z0 + (L.z1 - L.z0) * t;
        placeProp(LZ, 'pumpkin', x, z, side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2, rnd, { y: H + 1.2, solid: false });
    }
    // ----- rafters, with cages hanging from them -----
    for (let z = -50; z <= 50; z += 25) addBox(LZ, planks, true, L.x1 - L.x0 + 8, 1.6, 1.6, 0, H - 1.5, z, 6, 0x6a4a3a);
    for (const [x, z, len] of [[-56, -25, 9], [52, 0, 7], [-30, 25, 11], [34, 50, 8], [-64, 50, 6], [64, -50, 10]]) cage(LZ, x, H - 2.3, z, len);
    // ----- the title over the doors -----
    bigTitle(LZ, 'ESCAPE ANGRY HEAD', 70, new V3(0, 27.5, L.z1 - 0.6), new V3(0, 27.5, 0), ['#fff6c0', '#ffc828', '#ff6a1a'], '#2a0a1a');
    for (const ex of [-42, 42]) {
        const emblem = new T.Mesh(new T.PlaneGeometry(10, 10), new T.MeshBasicMaterial({ map: headIconTex(), transparent: true, toneMapped: false }));
        emblem.position.set(ex, 27.5, L.z1 - 0.5); emblem.rotation.y = Math.PI; zoneGroup(LZ).add(emblem);
    }
    buildDoors();
    buildDisplays();
    buildBooth();
    buildHats();
    buildMorph();
    buildBoards();
    buildCenter(rnd);
    // the spawn: a white pad with the black sun
    const sp = new T.Mesh(new RoundedBoxGeometry(9, 0.5, 9, 2, 0.2), cpPadMaterial(false));
    sp.position.set(SPAWN.x, 0.25, SPAWN.z); sp.receiveShadow = true; zoneGroup(LZ).add(sp);
    solidBox(SPAWN.x, 0.25, SPAWN.z, 9, 0.5, 9, { zone: LZ, mat: 'stone' });
    // green arrows from the spawn to Stage 1's door (like the reference's)
    const d0 = DOORS[0], ax = SPAWN.x - 7, az = SPAWN.z + 10, bx = d0.x, bz = d0.z - 9;
    for (let k = 0; k < 7; k++) { const t = k / 6; floorArrow(LZ, ax + (bx - ax) * t, 0.14, az + (bz - az) * t, Math.atan2(bx - ax, bz - az), 6); }
    // the codes board on the south wall
    board(LZ, (x, Wd, Hd) => {
        const g = x.createLinearGradient(0, 0, 0, Hd); g.addColorStop(0, '#5a2a8a'); g.addColorStop(1, '#2a0a4a');
        x.fillStyle = g; x.fillRect(0, 0, Wd, Hd);
        txt(x, '🎟️ FREE CODES', Wd / 2, Hd * 0.2, Wd * 0.9, Hd * 0.2, '#ffe24a', '#1a0a2a');
        txt(x, 'ANGRY · HEAD · ESCAPE', Wd / 2, Hd * 0.5, Wd * 0.92, Hd * 0.16, '#ffffff', '#1a0a2a');
        txt(x, 'Redeem them in ⚙️ Settings', Wd / 2, Hd * 0.78, Wd * 0.86, Hd * 0.12, '#d8c0ff', '#1a0a2a', 700);
    }, 'codes', 14, 7.5, new V3(-22, 6, L.z0 + 0.4), new V3(-22, 6, 0), { frame: 0xffc848 });
    // candles along the south wall
    for (let k = 0; k < 14; k++) {
        const x = -76 + k * 11 + rnd() * 3;
        if (Math.abs(x) < 8 || (x > 26 && x < 80)) continue;
        placeProp(LZ, 'candles', x, L.z0 + 2.4, 0, rnd, { solid: false });
    }
    for (const [x, z, ry] of [[L.x0, L.z0, 0], [L.x1, L.z0, -Math.PI / 2], [L.x0, L.z1, Math.PI / 2], [L.x1, L.z1, Math.PI]]) web(LZ, x, H - 0.5, z, ry, 9);
    buildBats();
    lampGlows(LZ, lobbyLamps);
}
// a hanging iron cage on a chain
function cage(zone, x, y, z, chain) {
    const iron = 0x2a2a32;
    addBox(zone, smoothVC(), true, 0.25, chain, 0.25, x, y - chain / 2, z, 0, iron);
    const cy = y - chain - 2.4;
    for (const dy of [2.4, -2.4]) { const g = new T.CylinderGeometry(2, 2, 0.3, 14); g.translate(x, cy + dy, z); addGeo(zone, g, smoothVC(), true, iron); }
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; addBox(zone, smoothVC(), true, 0.18, 4.8, 0.18, x + Math.cos(a) * 1.9, cy, z + Math.sin(a) * 1.9, 0, iron); }
    if (Math.round(x + z) % 2 === 0) { const s = new T.SphereGeometry(0.7, 10, 8); s.translate(x, cy - 1.6, z); addGeo(zone, s, smoothVC(), true, 0xf0ead8); }
    lobbyLamps.push([x, cy + 2.8, z, 0xffb050, 3]);
}
function web(zone, x, y, z, ry, s) {
    const m = new T.Mesh(new T.PlaneGeometry(s, s), webMaterial());
    m.geometry.translate(s / 2, -s / 2, 0);
    m.position.set(x, y, z); m.rotation.y = ry + Math.PI / 4;
    zoneGroup(zone).add(m);
}
// Green floor arrows: one mesh per place, pulsing one after another
let arrowMat = null;
const arrowSets = new Map();
function floorArrow(zone, x, y, z, yaw, size) {
    const g = new T.PlaneGeometry(size, size);
    g.rotateX(-Math.PI / 2); g.rotateY(yaw); g.translate(x, y + 0.08, z);
    if (!arrowSets.has(zone)) arrowSets.set(zone, []);
    arrowSets.get(zone).push(g);
}
function buildArrows() {
    arrowMat = arrowMat || new T.MeshBasicMaterial({ map: arrowTex(), transparent: true, depthWrite: false, toneMapped: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    for (const [zone, list] of arrowSets) {
        const geo = mergeGeometries(list.map((g) => { const n = g.attributes.position.count; g.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3).fill(1), 3)); return g; }));
        const m = new T.Mesh(geo, arrowMat); m.renderOrder = 1; zoneGroup(zone).add(m);
        const col = geo.attributes.color, per = 4;
        let acc = 0;
        tickers.push((dt, t) => {
            if (!m.parent.visible) return;
            acc += dt;
            if (acc < 1 / 20) return;
            acc = 0;
            for (let i = 0; i < list.length; i++) {
                const k = 0.65 + (0.5 + 0.5 * Math.sin(t * 4 - i * 0.9)) * 0.6;
                for (let v = 0; v < per; v++) col.setXYZ(i * per + v, k, k, k);
            }
            col.needsUpdate = true;
        });
    }
}

// ----- the stage doors (north wall): lit doorways in wooden frames; the BOSS door red -----
const panelMats = {
    open: new T.MeshBasicMaterial({ color: 0xffe85a }),
    done: new T.MeshBasicMaterial({ color: 0x7affa0 }),
    locked: new T.MeshLambertMaterial({ color: 0x2a2436 }),
    boss: new T.MeshBasicMaterial({ color: 0xff2a3a }),
};
tickers.push((dt, t) => {
    const k = 0.85 + 0.15 * Math.sin(t * 3);
    panelMats.open.color.setRGB(Math.min(1, k + 0.1), 0.91 * k, 0.35 * k);
    panelMats.boss.color.setRGB(1, 0.16 + 0.1 * Math.sin(t * 5), 0.22);
});
function buildDoors() {
    const wood = surfaceMaterial('planks'), z = L.z1;
    for (const d of DOORS) {
        const boss = d.i === BOSS, x = d.x, w = 8, h = 12;
        const frameC = boss ? 0x6a1a1a : 0x9a4a24;
        wallBox(LZ, wood, 1.4, h + 1.4, 2.4, x - w / 2 - 0.7, (h + 1.4) / 2, z - 1, frameC, { uv: 4, mat: 'wood' });
        wallBox(LZ, wood, 1.4, h + 1.4, 2.4, x + w / 2 + 0.7, (h + 1.4) / 2, z - 1, frameC, { uv: 4, mat: 'wood' });
        addBox(LZ, wood, true, w + 2.8, 1.4, 2.4, x, h + 0.7, z - 1, 4, frameC);
        const panel = new T.Mesh(new T.PlaneGeometry(w, h), panelMats.locked);
        panel.position.set(x, h / 2, z - 0.25); panel.rotation.y = Math.PI;
        zoneGroup(LZ).add(panel);
        const s = STAGES[d.i];
        board(LZ, (cx, W2, H2) => {
            cx.fillStyle = boss ? '#5a0a14' : '#6a3418'; cx.fillRect(0, 0, W2, H2);
            cx.strokeStyle = boss ? '#ff4a5a' : '#c8843a'; cx.lineWidth = 10; cx.strokeRect(5, 5, W2 - 10, H2 - 10);
            if (boss) { txt(cx, 'BOSS', W2 / 2, H2 * 0.42, W2 * 0.9, H2 * 0.62, '#ff3a4a', '#1a0004'); txt(cx, '👑 The Throne', W2 / 2, H2 * 0.82, W2 * 0.9, H2 * 0.2, '#ffd0d4', '#1a0004', 700); }
            else { txt(cx, 'Stage ' + (d.i + 1), W2 / 2, H2 * 0.4, W2 * 0.9, H2 * 0.48, '#ffffff', '#2a1006'); txt(cx, s.ic + ' ' + s.name, W2 / 2, H2 * 0.8, W2 * 0.92, H2 * 0.22, '#ffe6a0', '#2a1006', 700); }
        }, 'door-' + d.i, 10.4, 3.6, new V3(x, h + 3.4, z - 1.2), new V3(x, h + 3.4, 0), { frame: null, W: 512 });
        const lock = label(LZ, [{ t: '🔒', c: '#ffffff', s: '#000', px: 90 }], 4.4, new V3(x, h * 0.55, z - 2.6), 0, true);
        const info = label(LZ, [{ t: ' ', c: '#fff', s: '#000', px: 40 }], 8.5, new V3(x, 2.2, z - 3.2), 0);
        doors.push({ i: d.i, panel, lock, info, state: '' });
        triggers.push({ min: new V3(x - w / 2, 0, z - 3.6), max: new V3(x + w / 2, h, z), zone: LZ, enter: () => actions.door(d.i) });
        prompts.push({ pos: new V3(x, 1, z - 4), r: 5.5, zone: LZ, label: () => (stageOpen(S, d.i) ? 'Enter Stage ' + (d.i + 1) : '🔒 ' + doorNeed(d.i)), act: () => actions.door(d.i) });
        lobbyLamps.push([x - w / 2 - 0.7, h + 1.8, z - 2.4, boss ? 0xff4a4a : 0xffc860, 3.5], [x + w / 2 + 0.7, h + 1.8, z - 2.4, boss ? 0xff4a4a : 0xffc860, 3.5]);
    }
}
export const doorNeed = (i) => (i === BOSS ? 'Escape ' + BOSS_UNLOCK + ' stages first (' + clearedCount(S) + '/' + BOSS_UNLOCK + ')' : 'Escape Stage ' + i + ' first');
export function refreshDoors() {
    for (const d of doors) {
        const open = stageOpen(S, d.i), done = !!(S.cleared && S.cleared[d.i] !== undefined);
        const state = (open ? 'o' : 'l') + (done ? 'd' : '') + clearedCount(S);
        if (state === d.state) continue;
        d.state = state;
        d.panel.material = !open ? panelMats.locked : d.i === BOSS ? panelMats.boss : done ? panelMats.done : panelMats.open;
        d.lock.userData.hidden = open;
        d.lock.visible = !open;
        const best = done ? '✔ Best ' + clock(S.cleared[d.i]) : open ? (d.i === BOSS ? '👑 DEFEAT THE BOSS!' : '▶ NEW!') : d.i === BOSS ? '🔒 ' + clearedCount(S) + '/' + BOSS_UNLOCK + ' stages' : '🔒 Escape Stage ' + d.i;
        d.info.userData.set([{ t: best, c: done ? '#9aff7a' : open ? '#ffe24a' : '#c8c0d8', s: '#120a1a', px: 40 }]);
    }
}

// ----- display cases: a marble pedestal, a glass tube, the item turning inside, a price label -----
const glassMat = new T.MeshLambertMaterial({ color: 0xc8f0ff, transparent: true, opacity: 0.22, depthWrite: false, side: T.DoubleSide, forceSinglePass: true, emissive: 0x4a8aaa, emissiveIntensity: 0.3 });
function displayCase(zone, x, z, model, labelLines, color) {
    wallBox(zone, surfaceMaterial('marble'), 5.2, 1.2, 5.2, x, 0.6, z, 0xd8d0e8, { uv: 6, mat: 'stone' });
    addBox(zone, neon(color ?? 0x8aff7a, 1.1), false, 4.6, 0.12, 4.6, x, 1.26, z);
    const glass = new T.Mesh(new T.CylinderGeometry(2.2, 2.2, 6.2, 24, 1, true), glassMat);
    glass.position.set(x, 4.3, z); glass.renderOrder = 3; zoneGroup(zone).add(glass);
    const top = new T.CylinderGeometry(2.4, 2.4, 0.4, 24); top.translate(x, 7.6, z); addGeo(zone, top, smoothVC(), true, 0x3a2a4a);
    lobbyLamps.push([x, 4.2, z, color ?? 0xffffff, 5]);
    model.position.set(x, 4.2, z); zoneGroup(zone).add(anim(model));
    const lb = label(zone, labelLines, 7, new V3(x, 9.6, z), 4);
    solidBox(x, 4, z, 4.4, 8, 4.4, { zone, mat: 'glass' });
    tickers.push((dt, t) => { if (!model.parent.visible) return; model.rotation.y = t * 1.1 + x * 0.3 + z; model.position.y = 4.2 + Math.sin(t * 1.8 + z) * 0.3; });
    return lb;
}
const gearLines = (g, owned, on, free) => [
    { t: g.name, c: '#ffffff', s: '#1a0a2a', px: 54 },
    owned ? { t: on ? '✔ EQUIPPED' : '✔ OWNED', c: '#9aff7a', s: '#0a2a0a', px: 44 } : free ? { t: '🎁 FREE! Take it', c: '#9aff7a', s: '#0a2a0a', px: 44 } : { t: '🪙 ' + fmt(g.price) + ' Coin', c: '#ffe24a', s: '#2a1a00', px: 46 },
];
function buildDisplays() {
    for (const p of GEAR_PADS) {
        const g = gearById[p.id];
        const lb = displayCase(LZ, p.x, p.z, gearModel(p.id), gearLines(g, false, false), g.color);
        pads.push({ kind: 'gear', id: p.id, label: lb, key: '' });
        triggers.push({ min: new V3(p.x - 3, 0, p.z - 3), max: new V3(p.x + 5, 6, p.z + 3), zone: LZ, enter: () => actions.gearPad(p.id) });
        prompts.push({ pos: new V3(p.x + 3, 1, p.z), r: 5.5, zone: LZ, label: () => (S.gear[p.id] ? (S.tool === p.id ? 'Put away ' : 'Equip ') + g.name : 'Buy ' + g.name + ' (🪙 ' + fmt(g.price) + ')'), act: () => actions.gearPad(p.id, true) });
    }
    bigTitle(LZ, '🛒 SHOP', 22, new V3(L.x0 + 0.6, 22, -10), new V3(0, 22, -10), ['#ffffff', '#c8f0ff'], '#0a1a3a');
}
// ----- the Free Items booth (south-west): the limited Scythe and Potion, free after playtime -----
const playNow = () => (S.playtime || 0) + (Date.now() - (S.profileAt || Date.now())) / 1000;
export const limitedLeft = (g) => clock(Math.max(0, CFG[g.limited] * 60 - playNow()));
function buildBooth() {
    const { x, z } = BOOTH, wood = surfaceMaterial('planks');
    wallBox(LZ, wood, 26, 12, 1.2, x, 6, z - 9, 0x7a4aaa, { uv: 6, mat: 'wood' });
    wallBox(LZ, wood, 1.2, 12, 18, x - 13, 6, z, 0x7a4aaa, { uv: 6, mat: 'wood' });
    wallBox(LZ, wood, 1.2, 12, 18, x + 13, 6, z, 0x7a4aaa, { uv: 6, mat: 'wood' });
    addBox(LZ, wood, true, 29, 1.2, 21, x, 12.6, z, 6, 0x3a1a5a);
    addBox(LZ, neon(0xd86aff, 1.2), false, 29.4, 0.3, 21.4, x, 12, z);
    bigTitle(LZ, '✨ Free Items ✨', 22, new V3(x, 15.5, z + 9.5), new V3(x, 15.5, z + 30), ['#fff6a0', '#ffd028'], '#2a0a3a');
    for (const p of LIMITED_PADS) {
        const g = gearById[p.id];
        const m = gearModel(p.id); if (p.id === 'scythe') m.scale.multiplyScalar(0.8);
        const lb = displayCase(LZ, p.x, p.z, m, gearLines(g, false, false), 0xc86aff);
        const plate = billboard([{ t: 'LIMITED', g: ['#8aff7a', '#22c83a'], s: '#06300a', px: 60 }], 4.2, 512, new V3(p.x, 1.9, p.z + 2.9), zoneGroup(LZ), true);
        plate.userData.keepFar = true;
        pads.push({ kind: 'limited', id: p.id, label: lb, key: '' });
        triggers.push({ min: new V3(p.x - 3, 0, p.z - 3), max: new V3(p.x + 3, 6, p.z + 4.5), zone: LZ, enter: () => actions.limitedPad(p.id) });
        prompts.push({ pos: new V3(p.x, 1, p.z + 3.5), r: 5, zone: LZ, label: () => (S.gear[p.id] ? 'Equip ' + g.name : limitedFree(g, playNow()) ? 'Take the FREE ' + g.name : 'Free in ' + limitedLeft(g)), act: () => actions.limitedPad(p.id, true) });
    }
    const caul = new T.SphereGeometry(2.2, 16, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65); caul.translate(x + 9, 2.2, z - 5); addGeo(LZ, caul, smoothVC(), true, 0x22222a);
    const brew = new T.CylinderGeometry(1.9, 1.9, 0.2, 16); brew.translate(x + 9, 3.2, z - 5); addGeo(LZ, brew, basicVC(), false, 0x8aff4a);
    solidBox(x + 9, 1.6, z - 5, 4.2, 3.2, 4.2, { zone: LZ, mat: 'stone' });
    lobbyLamps.push([x + 9, 3.6, z - 5, 0x8aff4a, 6], [x - 9, 10, z - 7, 0xd86aff, 4], [x + 9, 10, z - 7, 0xd86aff, 4]);
}
// ----- hats on pedestals along the south wall (east half) -----
function buildHats() {
    for (const p of HAT_PADS) {
        const h = hatById[p.id];
        const m = hatModel(p.id); m.scale.multiplyScalar(1.7);
        const lb = displayCase(LZ, p.x, p.z, m, [{ t: h.name, c: '#ffffff', s: '#1a0a2a', px: 54 }, { t: '🪙 ' + fmt(h.price) + ' Coin', c: '#ffe24a', s: '#2a1a00', px: 46 }], h.color);
        pads.push({ kind: 'hat', id: p.id, label: lb, key: '' });
        triggers.push({ min: new V3(p.x - 3, 0, p.z - 3), max: new V3(p.x + 3, 6, p.z + 5), zone: LZ, enter: () => actions.hatPad(p.id) });
        prompts.push({ pos: new V3(p.x, 1, p.z + 3.5), r: 5, zone: LZ, label: () => (S.hats[p.id] ? (S.hat === p.id ? 'Take off ' : 'Wear ') + h.name : 'Buy ' + h.name + ' (🪙 ' + fmt(h.price) + ')'), act: () => actions.hatPad(p.id, true) });
    }
    bigTitle(LZ, '🎩 HATS = MORE COINS!', 28, new V3(53, 15, L.z0 + 0.6), new V3(53, 15, 0), ['#ffffff', '#ffe0a0'], '#2a1a00');
}
// ----- "Become the Angry Head" (the reference's 100 Coin board) and its green pad -----
function buildMorph() {
    const { x, z } = MORPH_PAD;
    board(LZ, (cx, W2, H2) => {
        cx.fillStyle = '#f4f4f8'; cx.fillRect(0, 0, W2, H2);
        drawHeadIcon(cx, W2 * 0.27, H2 * 0.46, H2 * 0.3);
        cx.fillStyle = '#22c83a'; cx.beginPath(); cx.moveTo(W2 * 0.45, H2 * 0.4); cx.lineTo(W2 * 0.55, H2 * 0.4); cx.lineTo(W2 * 0.55, H2 * 0.32); cx.lineTo(W2 * 0.63, H2 * 0.47); cx.lineTo(W2 * 0.55, H2 * 0.62); cx.lineTo(W2 * 0.55, H2 * 0.54); cx.lineTo(W2 * 0.45, H2 * 0.54); cx.closePath(); cx.fill();
        const nx = W2 * 0.8, ny = H2 * 0.14, u = H2 * 0.1;
        cx.fillStyle = '#ffd028'; cx.fillRect(nx - u * 0.7, ny, u * 1.4, u * 1.3);
        cx.fillStyle = '#1a1a1a'; cx.fillRect(nx - u * 0.35, ny + u * 0.4, u * 0.15, u * 0.2); cx.fillRect(nx + u * 0.2, ny + u * 0.4, u * 0.15, u * 0.2);
        cx.fillStyle = '#2a7ad8'; cx.fillRect(nx - u * 1.1, ny + u * 1.4, u * 2.2, u * 2.2);
        cx.fillStyle = '#ffd028'; cx.fillRect(nx - u * 1.8, ny + u * 1.4, u * 0.65, u * 2); cx.fillRect(nx + u * 1.15, ny + u * 1.4, u * 0.65, u * 2);
        cx.fillStyle = '#46c83a'; cx.fillRect(nx - u * 1.1, ny + u * 3.65, u * 1.05, u * 2.2); cx.fillRect(nx + u * 0.05, ny + u * 3.65, u * 1.05, u * 2.2);
        txt(cx, 'BECOME THE ANGRY HEAD!', W2 / 2, H2 * 0.88, W2 * 0.94, H2 * 0.11, '#c8121e', '#ffffff');
    }, 'morph', 16, 9, new V3(L.x0 + 0.6, 8.5, z), new V3(0, 8.5, z), { frame: 0x1a1a24 });
    const pad = new T.Mesh(new RoundedBoxGeometry(8, 0.4, 8, 2, 0.15), mat(0x22e83a, { emissive: 0x1a8a2a, ei: 0.6 }));
    pad.position.set(x, 0.2, z); zoneGroup(LZ).add(pad);
    const lb = label(LZ, [{ t: '😡 BECOME THE HEAD', c: '#ffffff', s: '#3a0006', px: 50 }, { t: '🪙 ' + PASSES.Morph.price + ' Coin', c: '#ffe24a', s: '#2a1a00', px: 46 }], 8, new V3(x, 5, z), 4);
    pads.push({ kind: 'morph', id: 'Morph', label: lb, key: '' });
    triggers.push({ min: new V3(x - 4, 0, z - 4), max: new V3(x + 4, 5, z + 4), zone: LZ, enter: () => actions.morphPad() });
    prompts.push({ pos: new V3(x, 1, z), r: 5.5, zone: LZ, label: () => (S.passes.Morph ? (S.morph ? 'Turn back into yourself' : 'Become the Angry Head!') : 'Become the Angry Head (🪙 ' + PASSES.Morph.price + ')'), act: () => actions.morphPad(true) });
    lobbyLamps.push([x, 1, z, 0x46ff5a, 7]);
}
export function refreshPads() {
    for (const p of pads) {
        let key, lines;
        if (p.kind === 'gear' || p.kind === 'limited') {
            const g = gearById[p.id], owned = !!S.gear[p.id], on = S.tool === p.id, free = p.kind === 'limited' && limitedFree(g, playNow());
            const wait = p.kind === 'limited' && !owned && !free;
            const left = wait ? Math.ceil((CFG[g.limited] * 60 - playNow()) / 60) : 0;
            key = owned + '|' + on + '|' + free + '|' + left;
            lines = wait ? [{ t: g.name, c: '#ffffff', s: '#1a0a2a', px: 54 }, { t: '🎁 FREE in ' + left + ' min', c: '#d8b8ff', s: '#1a0a2a', px: 42 }] : gearLines(g, owned, on, free);
        } else if (p.kind === 'hat') {
            const h = hatById[p.id], owned = !!S.hats[p.id], on = S.hat === p.id;
            key = owned + '|' + on;
            lines = [{ t: h.name, c: '#ffffff', s: '#1a0a2a', px: 54 }, owned ? { t: on ? '✔ WEARING' : '✔ OWNED', c: '#9aff7a', s: '#0a2a0a', px: 44 } : { t: '🪙 ' + fmt(h.price) + ' Coin', c: '#ffe24a', s: '#2a1a00', px: 46 }];
        } else {
            key = !!S.passes.Morph + '|' + !!S.morph;
            lines = [{ t: '😡 BECOME THE HEAD', c: '#ffffff', s: '#3a0006', px: 50 }, S.passes.Morph ? { t: S.morph ? '✔ YOU ARE THE HEAD' : 'Step on to transform', c: '#9aff7a', s: '#0a2a0a', px: 40 } : { t: '🪙 ' + PASSES.Morph.price + ' Coin', c: '#ffe24a', s: '#2a1a00', px: 46 }];
        }
        if (key === p.key) continue;
        p.key = key;
        p.label.userData.set(lines);
    }
}
// ----- the leaderboards on the east wall -----
const boardCanvases = {};
const BOARD_TITLES = { coins: '🪙 Top Coins', escapes: '🚪 Most Escapes', scares: '😡 Top Scares' };
function buildBoards() {
    const x = L.x1 - 0.8;
    for (const b of BOARD_SPOTS) {
        const frame = new T.Mesh(new RoundedBoxGeometry(1.2, 22, 18, 3, 0.6), mat(0x2a1a4a)); frame.position.set(x, 13, b.z);
        zoneGroup(LZ).add(frame); bake(LZ, frame, true);
        addBox(LZ, neon(0x8a5aff, 1.2), false, 1.4, 0.4, 18.4, x, 24.1, b.z);
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 620;
        const tex = texFrom(cv);
        const sc = new T.Mesh(new T.PlaneGeometry(16.4, 19.9), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
        sc.position.set(x - 0.7, 13, b.z); sc.rotation.y = -Math.PI / 2;
        zoneGroup(LZ).add(sc);
        solidBox(x, 12, b.z, 1.4, 24, 18, { zone: LZ, mat: 'stone' });
        boardCanvases[b.key] = { cv, tex, title: BOARD_TITLES[b.key] };
        drawBoard(b.key, []);
    }
}
function drawBoard(key, rows) {
    const b = boardCanvases[key];
    if (!b) return;
    const x = b.cv.getContext('2d'), W = 512;
    x.fillStyle = '#141a3a'; x.fillRect(0, 0, W, 620);
    const g = x.createLinearGradient(0, 0, 0, 80); g.addColorStop(0, '#3a8aff'); g.addColorStop(1, '#1a4ab8');
    x.fillStyle = g; x.fillRect(0, 0, W, 80);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const tpx = fitFont(x, b.title, W - 48, 46, 700, 'Fredoka, sans-serif', 0.18);
    x.lineWidth = tpx * 0.16; x.strokeStyle = '#0a1a4a'; x.lineJoin = 'round'; x.strokeText(b.title, W / 2, 42); x.fillStyle = '#ffffff'; x.fillText(b.title, W / 2, 42);
    for (let i = 0; i < 10; i++) {
        const y = 120 + i * 49, r = rows[i];
        const rg = x.createLinearGradient(0, y - 22, 0, y + 22); rg.addColorStop(0, i % 2 ? '#2a5ad8' : '#3a6ae8'); rg.addColorStop(1, i % 2 ? '#1a3ab0' : '#2a4ac0');
        x.fillStyle = rg; x.fillRect(16, y - 22, W - 32, 44);
        x.textAlign = 'left'; x.font = '700 26px Fredoka, sans-serif';
        x.fillStyle = i === 0 ? '#ffd028' : i === 1 ? '#e0e6f0' : i === 2 ? '#f0a06a' : '#c8d4ff';
        x.fillText('№' + (i + 1), 26, y);
        if (!r) continue;
        x.fillStyle = '#ffffff'; x.font = '600 26px Fredoka, sans-serif';
        let n = r.n; while (x.measureText(n).width > 250 && n.length > 3) n = n.slice(0, -1);
        x.fillText(n, 100, y);
        x.textAlign = 'right'; x.fillStyle = '#ffe24a';
        x.fillText(fmt(r.v), W - 30, y);
    }
    b.tex.needsUpdate = true;
}
const boardKeys = {};
export function renderBoards(m) {
    for (const key of Object.keys(boardCanvases)) {
        const rows = (m && m[key]) || [], k = JSON.stringify(rows);
        if (boardKeys[key] === k) continue;
        boardKeys[key] = k;
        drawBoard(key, rows);
    }
}
// ----- the middle: the dead tree with its cages, a giant jack-o'-lantern, the Headless Horseman -----
function buildCenter(rnd) {
    const bark = 0x3a2a30, tx = 0, tz = 12;
    const ring = new T.CylinderGeometry(13, 13.5, 1.2, 32); ring.translate(tx, 0.6, tz); addGeo(LZ, worldUV(ring, 6), surfaceMaterial('stone'), true, 0x9a8aaa);
    const soil = new T.CylinderGeometry(12, 12, 1.3, 32); soil.translate(tx, 0.65, tz); addGeo(LZ, soil, smoothVC(), false, 0x2a1e1a);
    solidBox(tx, 0.6, tz, 24, 1.2, 24, { zone: LZ, mat: 'stone' });
    const trunk = new T.CylinderGeometry(1.6, 2.6, 16, 10); trunk.translate(tx, 8, tz); addGeo(LZ, trunk, smoothVC(), true, bark, [0.6, 1.0]);
    solidBox(tx, 8, tz, 4.4, 16, 4.4, { zone: LZ, mat: 'wood' });
    const ends = [];
    for (let k = 0; k < 7; k++) {
        const a = k / 7 * Math.PI * 2 + rnd() * 0.4, len = 7 + rnd() * 5, tilt = 0.7 + rnd() * 0.4, y0 = 11 + rnd() * 5;
        const b = new T.CylinderGeometry(0.25, 0.85, len, 6); b.translate(0, len / 2, 0); b.rotateZ(-tilt); b.rotateY(a); b.translate(tx, y0, tz);
        addGeo(LZ, b, smoothVC(), true, bark);
        const ex = tx + Math.cos(a) * Math.sin(tilt) * len, ey = y0 + Math.cos(tilt) * len, ez = tz - Math.sin(a) * Math.sin(tilt) * len;
        ends.push([ex, ey, ez]);
        const tw = new T.CylinderGeometry(0.08, 0.22, 3, 5); tw.translate(0, 1.5, 0); tw.rotateZ(0.6); tw.rotateY(a + 1); tw.translate(ex, ey, ez); addGeo(LZ, tw, smoothVC(), true, bark);
    }
    ends.slice(0, 4).forEach(([x, y, z], k) => cage(LZ, x, y, z, 2 + k));
    placeProp(LZ, 'pumpkin', tx - 6, tz - 6.5, -0.4, () => 0.95, { y: 1.2 });
    lobbyLamps.push([tx - 6, 3.8, tz - 4.5, 0xffa030, 8]);
    // the Headless Horseman (the reference's), holding up his glowing pumpkin head
    const rig = buildRig({ shirt: 0x2a1a3a, shorts: 0x1a1a22, socks: 0x2a2a32, hair: 0x000000, skin: 0x2a1a3a });
    rig.userData.head.visible = false;
    rig.position.set(tx + 7.5, 1.2, tz - 6); rig.rotation.y = -0.5; rig.scale.setScalar(1.25);
    zoneGroup(LZ).add(anim(rig));
    rig.traverse((o) => { o.userData.anim = true; });
    const ph = PROPS.pumpkin(() => 0.4);
    const pg = mergeGeometries(ph.parts.map((p) => {
        const g = p.g.clone(), n = g.attributes.position.count, c = new T.Color(p.c), a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
        g.setAttribute('color', new T.BufferAttribute(a, 3));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
        return g.index ? g.toNonIndexed() : g;
    }));
    const pumpkin = new T.Mesh(pg, new T.MeshLambertMaterial({ vertexColors: true, emissive: 0x6a2a00, emissiveIntensity: 0.5 }));
    pumpkin.castShadow = true; pumpkin.receiveShadow = true;
    rig.userData.arms[1].add(pumpkin);
    pumpkin.position.set(0, -2.7, 0.3);
    lobbyAnim.horseman = rig;
    label(LZ, [{ t: '🎃 "Escape the ANGRY HEADS...', c: '#ffe0a0', s: '#1a0a00', px: 38 }, { t: '...if you can! HAHAHA!"', c: '#ffe0a0', s: '#1a0a00', px: 38 }], 11, new V3(tx + 7.5, 13.5, tz - 6), 0);
    solidBox(tx + 7.5, 4, tz - 6, 3, 8, 3, { zone: LZ, mat: 'stone' });
    for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2 + 0.3; placeProp(LZ, 'pumpkin', tx + Math.cos(a) * 14.6, tz + Math.sin(a) * 14.6, -a + Math.PI / 2, rnd, { solid: false }); }
}
// ----- bats flapping in circles over the hall (one mesh, all moved in the vertex shader) -----
function buildBats() {
    const pos = [], center = [], info = [], idx = [];
    const rnd = seeded(7);
    for (let k = 0; k < 26; k++) {
        const cx = (rnd() - 0.5) * 120, cy = 22 + rnd() * 16, cz = (rnd() - 0.5) * 100, r = 6 + rnd() * 14, sp = (0.4 + rnd() * 0.5) * (rnd() < 0.5 ? -1 : 1), ph = rnd() * 6.28;
        const b = pos.length / 3;
        for (const [x, y, z, w] of [[0, 0, 0.5, 0], [0, 0, -0.5, 0], [-1.4, 0.1, 0, 1], [1.4, 0.1, 0, 1], [-0.7, 0, 0.3, 0.5], [0.7, 0, 0.3, 0.5]]) { pos.push(x, y, z); center.push(cx, cy, cz); info.push(r, sp, ph, w); }
        idx.push(b, b + 2, b + 4, b + 1, b + 2, b, b, b + 5, b + 3, b + 1, b, b + 3);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('aCenter', new T.Float32BufferAttribute(center, 3));
    g.setAttribute('aInfo', new T.Float32BufferAttribute(info, 4));
    g.setIndex(idx);
    const m = new T.ShaderMaterial({
        side: T.DoubleSide, uniforms: { uTime: batTime },
        vertexShader: `attribute vec3 aCenter; attribute vec4 aInfo; uniform float uTime;
            void main() {
                float a = uTime * aInfo.y + aInfo.z;
                vec3 p = position * 1.3;
                p.y += sin(uTime * 14.0 + aInfo.z * 3.0) * 0.9 * aInfo.w;
                float s = sin(a), c = cos(a), dir = sign(aInfo.y);
                vec3 q = vec3(p.x * s * dir + p.z * c, p.y, p.x * -c * dir + p.z * s);
                vec3 w = aCenter + vec3(cos(a) * aInfo.x, sin(uTime * 0.7 + aInfo.z) * 2.0, sin(a) * aInfo.x) + q;
                gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
            }`,
        fragmentShader: 'void main() { gl_FragColor = vec4(0.07, 0.04, 0.1, 1.0); }',
    });
    const bats = new T.Mesh(g, m);
    bats.frustumCulled = false;
    zoneGroup(LZ).add(bats);
}
// ----- lamp glows: one point cloud per place, flickering in the shader -----
function lampGlows(zone, list) {
    if (!list.length) return;
    const pos = [], col = [], info = [];
    const c = new T.Color();
    for (const [x, y, z, color, size] of list) { pos.push(x, y, z); c.set(color); col.push(c.r, c.g, c.b); info.push(size || 3, Math.random() * 6.28); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.setAttribute('aInfo', new T.Float32BufferAttribute(info, 2));
    const m = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, vertexColors: true,
        uniforms: { uTime: glowTime, uScale: { value: innerHeight }, uMap: { value: softTex() } },
        vertexShader: `attribute vec2 aInfo; uniform float uTime; uniform float uScale; varying vec3 vC; varying float vA;
            void main() {
                vC = color;
                float f = 0.82 + 0.1 * sin(uTime * 9.0 + aInfo.y) + 0.08 * sin(uTime * 23.0 + aInfo.y * 2.0);
                vA = f;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = min(240.0, aInfo.x * 2.4 * f * uScale / max(1.0, -mv.z));
            }`,
        fragmentShader: `uniform sampler2D uMap; varying vec3 vC; varying float vA;
            void main() { float a = texture2D(uMap, gl_PointCoord).a * 0.55 * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC * a, a); }`,
    });
    const pts = new T.Points(g, m);
    pts.frustumCulled = false; pts.renderOrder = 4;
    zoneGroup(zone).add(pts);
    glowPts.push(m);
}
addEventListener('resize', () => { for (const m of glowPts) m.uniforms.uScale.value = innerHeight; });
// ----- light cones: a soft beam slanting from each wall lamp down to the floor, all of a place's in
// one mesh, flickering with the lamps (Medium and High; Low skips them: every see-through layer
// costs on a phone) -----
const coneMeshes = [];
const coneMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, vertexColors: true,
    uniforms: { uTime: glowTime },
    vertexShader: `attribute float aPh; uniform float uTime; varying vec3 vC; varying float vA;
        void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float edge = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
            float f = 0.85 + 0.1 * sin(uTime * 9.0 + aPh) + 0.05 * sin(uTime * 23.0 + aPh * 2.0);
            vC = color; vA = pow(uv.y, 1.25) * pow(edge, 1.4) * f;
            gl_Position = projectionMatrix * mv;
        }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main() { gl_FragColor = vec4(vC, vA * 0.2); }`,
});
// list: [x, y, z, color, size, dx, dz] (dx, dz: out from the wall)
function lampCones(zone, list) {
    const parts = [], c = new T.Color();
    for (const [x, y, z, color, , dx, dz] of list) {
        const h = y - 0.1, g = new T.CylinderGeometry(0.35, 5.2, h, 14, 1, true);
        g.translate(0, h / 2 + 0.1, 0);
        const p = g.attributes.position, n = p.count;
        for (let i = 0; i < n; i++) {
            const k = 1 - (p.getY(i) - 0.1) / h;   // 0 at the lamp, 1 on the floor
            p.setX(i, p.getX(i) + x + dx * 2.8 * k); p.setZ(i, p.getZ(i) + z + dz * 2.8 * k);
        }
        g.computeVertexNormals();
        c.set(color);
        const col = new Float32Array(n * 3), ph = new Float32Array(n).fill(Math.random() * 6.28);
        for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        g.setAttribute('color', new T.BufferAttribute(col, 3));
        g.setAttribute('aPh', new T.BufferAttribute(ph, 1));
        parts.push(g);
    }
    if (!parts.length) return;
    const mesh = new T.Mesh(mergeGeometries(parts), coneMat);
    mesh.renderOrder = 3;
    zoneGroup(zone).add(mesh);
    coneMeshes.push(mesh);
}

// =====================================================================================
// THE MAZES
// =====================================================================================
let portalM = null;
function portalMat() {
    if (portalM) return portalM;
    portalM = new T.ShaderMaterial({
        uniforms: { uTime: batTime },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uTime; varying vec2 vUv;
            void main(){ vec2 p = vUv - 0.5; p.x *= 0.7; float r = length(p), a = atan(p.y, p.x);
                float sw = 0.5 + 0.5 * sin(a * 3.0 - r * 18.0 + uTime * 4.0);
                vec3 c = mix(vec3(0.35, 0.1, 0.8), vec3(0.85, 0.5, 1.0), sw) * (1.2 - r * 1.4) + vec3(1.0) * smoothstep(0.12, 0.0, r) * 0.6;
                gl_FragColor = vec4(c, 1.0);
            }`,
    });
    return portalM;
}
const exitMat = new T.ShaderMaterial({
    uniforms: { uTime: batTime },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){ float g = 0.75 + 0.25 * sin(vUv.y * 14.0 - uTime * 5.0); vec3 c = mix(vec3(0.3, 1.0, 0.45), vec3(1.0), smoothstep(0.35, 0.0, abs(vUv.x - 0.5)) * 0.6) * g;
            gl_FragColor = vec4(c, 1.0);
        }`,
});
const fieldMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.DoubleSide, forceSinglePass: true, uniforms: { uTime: batTime },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){ float h = fract(sin(dot(floor(vUv * vec2(20.0, 30.0)), vec2(12.9, 78.2))) * 43758.5);
            float a = 0.18 + 0.12 * sin(vUv.y * 40.0 + uTime * 6.0) + step(0.96, h) * 0.3;
            gl_FragColor = vec4(1.0, 0.18, 0.25, a);
        }`,
});
const beamMatExit = new T.MeshBasicMaterial({ color: 0x3aff6a, transparent: true, opacity: 0.12, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, forceSinglePass: true });
const cellOf = (m, x, z) => Math.floor((z - m.z0) / CELL) * m.cols + Math.floor((x - m.x0) / CELL);
function buildStage(m) {
    const i = m.i, s = STAGES[i], th = THEMES[s.theme], Z = i;
    const rnd = seeded(500 + i * 31);
    const wallMat = surfaceMaterial(th.wall), floorMat = th.floor === 'stud' ? studVCMaterial() : surfaceMaterial(th.floor);
    const floorKind = { grass: 'grass', snow: 'snow', carpet: 'carpet', planks: 'wood', grate: 'metal', tiles: 'tile', checker: 'tile', marble: 'tile' }[th.floor] || 'floor';
    const trim = th.trim, wc = th.wallC;
    const lamps = [];
    const sr = m.startRoom, er = m.exitRoom;
    // ----- floors: the maze, the start room and the exit room -----
    wallBox(Z, floorMat, m.x1 - m.x0 + WALL, 2, m.z1 - m.z0 + WALL, (m.x0 + m.x1) / 2, -1, (m.z0 + m.z1) / 2, th.floorC, { mat: floorKind, cast: false });
    wallBox(Z, floorMat, ROOM_W, 2, ROOM_D, (sr.x0 + sr.x1) / 2, -1, (sr.z0 + sr.z1) / 2, th.floorC, { mat: floorKind, cast: false });
    wallBox(Z, floorMat, ROOM_W, 2, ROOM_D, (er.x0 + er.x1) / 2, -1, (er.z0 + er.z1) / 2, th.floorC, { mat: floorKind, cast: false });
    // ----- the walls: merged runs, with a base trim, a cap trim and pillars where they meet -----
    const SH = [0.56, 1.06];
    const H = WALL / 2;
    const wall = (x0, x1, z0, z1) => {
        const sx = x1 - x0, sz = z1 - z0, x = (x0 + x1) / 2, z = (z0 + z1) / 2, alongX = sx > sz;
        addBox(Z, wallMat, true, sx, WALL_H, sz, x, WALL_H / 2, z, 8, wc, [3], SH);
        solidBox(x, (WALL_H + CAP) / 2, z, sx, WALL_H + CAP, sz, { zone: Z, mat: 'wall', wall: true });
        addBox(Z, smoothVC(), false, sx + (alongX ? 0 : 0.5), 1.1, sz + (alongX ? 0.5 : 0), x, 0.55, z, 0, trim, [3]);
        addBox(Z, smoothVC(), true, sx + (alongX ? 0.4 : 0.6), CAP, sz + (alongX ? 0.6 : 0.4), x, WALL_H + CAP / 2, z, 0, trim);
    };
    const corners = new Set();
    for (let r = 0; r <= m.rows; r++) {
        let run = -1;
        for (let c = 0; c <= m.cols; c++) {
            const has = c < m.cols && (r === 0 ? c !== m.startCol : r === m.rows ? c !== m.exitCol : !!m.S[(r - 1) * m.cols + c]);
            if (has && run < 0) run = c;
            if (!has && run >= 0) {
                const z = m.z0 + r * CELL;
                wall(m.x0 + run * CELL - H, m.x0 + c * CELL + H, z - H, z + H);
                for (let k = run; k <= c; k++) corners.add(k + ',' + r);
                run = -1;
            }
        }
    }
    for (let c = 0; c <= m.cols; c++) {
        let run = -1;
        for (let r = 0; r <= m.rows; r++) {
            const has = r < m.rows && (c === 0 || c === m.cols || !!m.E[r * m.cols + c - 1]);
            if (has && run < 0) run = r;
            if (!has && run >= 0) {
                const x = m.x0 + c * CELL;
                wall(x - H, x + H, m.z0 + run * CELL - H, m.z0 + r * CELL + H);
                for (let k = run; k <= r; k++) corners.add(c + ',' + k);
                run = -1;
            }
        }
    }
    const pc = new T.Color(wc).multiplyScalar(0.84).getHex();
    for (const key of corners) {
        const [c, r] = key.split(',').map(Number), x = m.x0 + c * CELL, z = m.z0 + r * CELL;
        addBox(Z, wallMat, true, WALL + 0.9, WALL_H + 0.3, WALL + 0.9, x, (WALL_H + 0.3) / 2, z, 8, pc, [3], SH);
        addBox(Z, smoothVC(), true, WALL + 1.4, CAP + 0.5, WALL + 1.4, x, WALL_H + 0.3 + (CAP + 0.5) / 2, z, 0, trim);
    }
    // ----- the rooms: three walls each (the maze's edge is the fourth) -----
    for (const rm of [sr, er]) {
        const zFar = rm === sr ? rm.z0 : rm.z1;
        wall(rm.x0 - H, rm.x0 + H, rm.z0 - H, rm.z1 + H);
        wall(rm.x1 - H, rm.x1 + H, rm.z0 - H, rm.z1 + H);
        wall(rm.x0 - H, rm.x1 + H, zFar - H, zFar + H);
    }
    // the doorways into and out of the maze: coloured frames
    for (const [x, z, exit] of [[m.x0 + (m.startCol + 0.5) * CELL, m.z0, false], [m.x0 + (m.exitCol + 0.5) * CELL, m.z1, true]]) {
        const fc = exit ? 0x2ad84a : th.accent;
        addBox(Z, smoothVC(), true, CELL - WALL + 1, 1.2, WALL + 0.6, x, 14.6, z, 0, fc);
        for (const sx of [-1, 1]) addBox(Z, smoothVC(), true, 0.8, 14, WALL + 0.6, x + sx * (CELL - WALL) / 2, 7, z, 0, fc);
    }
    // ----- the start room: red carpet, the first checkpoint, the stage board, the way home -----
    const sx = (sr.x0 + sr.x1) / 2;
    addBox(Z, studVCMaterial(), false, 12, 0.12, ROOM_D - 2, sx, 0.06, (sr.z0 + sr.z1) / 2, 8, 0xc8202e, [3]);
    board(Z, (x, W2, H2) => {
        const g = x.createLinearGradient(0, 0, 0, H2); g.addColorStop(0, '#2a0a12'); g.addColorStop(1, '#0a0206');
        x.fillStyle = g; x.fillRect(0, 0, W2, H2);
        x.fillStyle = '#c8121e';
        x.beginPath(); for (let k = 0; k <= 40; k++) { const a = k / 40 * Math.PI * 2, rr = H2 * (0.4 + 0.06 * Math.sin(k * 7.3) + 0.04 * Math.sin(k * 3.1)); const px = W2 * 0.5 + Math.cos(a) * rr * 2.2, py = H2 * 0.5 + Math.sin(a) * rr; if (k) x.lineTo(px, py); else x.moveTo(px, py); } x.fill();
        x.fillStyle = '#1a0a0a'; x.beginPath(); x.arc(W2 * 0.2, H2 * 0.5, H2 * 0.3, 0, Math.PI * 2); x.fill();
        drawHeadIcon(x, W2 * 0.2, H2 * 0.53, H2 * 0.22);
        txt(x, (i === BOSS ? 'BOSS' : 'Stage ' + (i + 1)) + ':', W2 * 0.62, H2 * 0.33, W2 * 0.6, H2 * 0.2, '#ffe0e0', '#1a0004', 800, 'Montserrat, Fredoka, sans-serif');
        txt(x, i === BOSS ? 'The Throne' : s.name, W2 * 0.62, H2 * 0.58, W2 * 0.62, H2 * 0.22, '#ffffff', '#1a0004', 800, 'Montserrat, Fredoka, sans-serif');
        txt(x, s.diff + ' · ' + s.heads.length + ' heads' + (s.keys ? ' · 🔑 x' + s.keys : ''), W2 * 0.62, H2 * 0.8, W2 * 0.6, H2 * 0.11, '#ffc8c8', '#1a0004', 700);
    }, 'stagebd-' + i, 22, 9, new V3(sx - 3, 13, sr.z0 + H + 0.35), new V3(sx - 3, 13, sr.z1 + 10), { frame: 0x1a0a0a });
    // the way back to the lobby (behind you as you start)
    const lx = sx + 10;
    const portal = new T.Mesh(new T.PlaneGeometry(7, 10), portalMat());
    portal.position.set(lx, 5, sr.z0 + H + 0.25); zoneGroup(Z).add(portal);
    addBox(Z, smoothVC(), true, 8.4, 11.4, 0.6, lx, 5.7, sr.z0 + H + 0.1, 0, 0x2a1a3a, [2]);
    label(Z, [{ t: '🏠 LOBBY', c: '#ffffff', s: '#1a0a3a', px: 60 }], 5, new V3(lx, 11.8, sr.z0 + 2.5), 0, true);
    triggers.push({ min: new V3(lx - 3.5, 0, sr.z0), max: new V3(lx + 3.5, 9, sr.z0 + H + 1.6), zone: Z, enter: () => actions.lobbyPortal() });
    lamps.push([lx, 5, sr.z0 + 3, 0xb46aff, 6]);
    // ----- checkpoints, their beams, the EXIT -----
    for (const cp of CHECKPOINTS.filter((c) => c.s === i)) buildCheckpoint(Z, cp);
    buildBeam(Z, i);
    buildExit(Z, m);
    // ----- lookouts and the bridge -----
    for (const lo of m.lookouts) { trussTower(Z, lo.truss, th, i === 0); deck(Z, lo.deck); label(Z, [{ t: '👀 LOOKOUT', c: '#ffffff', s: '#1a1a1a', px: 50 }], 4.5, new V3(lo.deck.x, DECK_Y + 4, lo.deck.z), 3, true); }
    if (m.bridge) buildBridge(Z, m, th);
    // ----- floor hazards -----
    for (const hz of m.hazards) {
        const material = hz.t === 'slime' ? slimeMaterial() : hz.t === 'ice' ? iceFloorMaterial() : lavaMaterial();
        addBox(Z, material, false, hz.sx, 0.14, hz.sz, hz.x, 0.07, hz.z, 6, undefined, [3]);
        solidBox(hz.x, 0.03, hz.z, hz.sx, 0.06, hz.sz, { zone: Z, mat: hz.t === 'ice' ? 'ice' : hz.t, [hz.t]: true });
        if (hz.t === 'lava' && rnd() < 0.5) lamps.push([hz.x, 0.6, hz.z, 0xff6a1a, 4]);
        if (hz.t === 'slime' && rnd() < 0.35) lamps.push([hz.x, 0.5, hz.z, 0x8aff4a, 5]);
    }
    // ----- coins and keys -----
    buildCoins(Z, i);
    for (const k of KEYS.filter((q) => q.s === i)) buildKey(Z, k);
    // ----- green guide arrows on the floor at the junctions, and the Guide product's trail -----
    for (const a of m.arrows) floorArrow(Z, a.x, 0.14, a.z, a.yaw, 7);
    buildGuide(Z, m);
    // ----- props in the dead ends and rooms -----
    const list = THEME_PROPS[s.theme] || THEME_PROPS.basement;
    const coinCells = new Set(m.coins.map((c) => cellOf(m, c.x, c.z)));
    const keyCells = new Set(m.keys.map((k) => k.cell));
    m.deadEnds.forEach((a, k) => {
        const open = neighbours(m, a)[0];
        if (open === undefined) return;
        const p = cellCenter(m, a), q = cellCenter(m, open);
        const bx = Math.sign(p.x - q.x), bz = Math.sign(p.z - q.z);
        placeProp(Z, list[k % list.length], p.x + bx * 4.6, p.z + bz * 4.6, Math.atan2(-bx, -bz), rnd);
        if (!coinCells.has(a) && !keyCells.has(a) && rnd() < 0.5) placeProp(Z, list[(k + 1) % list.length], p.x + bx * 2 + bz * 3.6, p.z + bz * 2 + bx * 3.6, Math.atan2(-bx, -bz) + 0.4, rnd);
    });
    placeProp(Z, list[0], sr.x0 + 4.5, sr.z0 + 4.5, 0.3, rnd);
    placeProp(Z, list[1], sr.x0 + 4.5, sr.z1 - 6, -0.4 + Math.PI / 2, rnd);
    placeProp(Z, list[2], er.x0 + 4.5, er.z1 - 4.5, Math.PI - 0.3, rnd);
    placeProp(Z, list[3], er.x1 - 4.5, er.z0 + 6, -Math.PI / 2, rnd);
    // wall lamps, posters and cobwebs along the corridors
    let lampN = 0;
    for (let a = 0; a < m.cols * m.rows; a++) {
        const p = cellCenter(m, a), r = rnd();
        const nb = neighbours(m, a);
        const walls = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([wx, wz]) => !nb.includes(a + wx + wz * m.cols) && !(m.bridge && m.bridge.A === a) && !m.lookouts.some((lo) => lo.cell === a));
        if (!walls.length) continue;
        const [wx, wz] = walls[Math.floor(rnd() * walls.length)];
        const fx = p.x + wx * (HALF - 0.12), fz = p.z + wz * (HALF - 0.12), yaw = Math.atan2(-wx, -wz);
        if (r < 0.32 && lampN++ < 70) wallLamp(Z, fx, 15, fz, yaw, th, lamps);
        else if (r < 0.42) poster(Z, fx, 7 + rnd() * 3, fz, yaw, POSTERS[Math.floor(rnd() * POSTERS.length)], rnd);
        else if (r < 0.48) web(Z, p.x + wx * HALF, WALL_H - 0.5, p.z + wz * HALF, Math.atan2(wx, wz) + (rnd() < 0.5 ? 0 : Math.PI / 2), 6);
    }
    lampGlows(Z, lamps);
    lampCones(Z, lamps.filter((l) => l.length > 5));
}
// A checkpoint: a red carpet (the reference's) with the white star pad, a "safe room" sign
function buildCheckpoint(Z, cp) {
    if (cp.k > 0) addBox(Z, studVCMaterial(), false, CELL - WALL - 0.4, 0.1, CELL - WALL - 0.4, cp.x, 0.05, cp.z, 8, 0xd02030, [3]);
    const pad = new T.Mesh(new RoundedBoxGeometry(8, 0.5, 8, 2, 0.2), cpPadMaterial(false));
    pad.position.set(cp.x, 0.25, cp.z); pad.rotation.y = cp.yaw; pad.receiveShadow = true;
    zoneGroup(Z).add(pad);
    solidBox(cp.x, 0.25, cp.z, 8, 0.5, 8, { zone: Z, mat: 'stone', cp: true });
    cpPads.set(cp.id, { pad, lit: false, s: cp.s, k: cp.k });
    triggers.push({ min: new V3(cp.x - 4.5, -1, cp.z - 4.5), max: new V3(cp.x + 4.5, 8, cp.z + 4.5), zone: Z, enter: () => actions.checkpoint(cp.id) });
    if (cp.k > 0) label(Z, [{ t: '🚩 SAFE ROOM', c: '#9aff7a', s: '#0a2a0a', px: 54 }, { t: 'The heads can\'t come in here', c: '#ffffff', s: '#1a0a0a', px: 34 }], 9, new V3(cp.x, 10, cp.z), 3, true);
}
export function lightCheckpoint(id, on) {
    const c = cpPads.get(id);
    if (!c || c.lit === on) return;
    c.lit = on;
    c.pad.material = cpPadMaterial(on);
}
export function resetCheckpoints(stage, upTo) {
    for (const [id, c] of cpPads) if (c.s === stage) lightCheckpoint(id, c.k <= upTo);
    const b = beams.get(stage);
    if (b) b.uniforms.uReached.value = upTo;
}
// Beams of light over a stage's checkpoints: green once reached, the next one pulsing
function buildBeam(Z, i) {
    const list = CHECKPOINTS.filter((c) => c.s === i);
    const pos = [], uv = [], ids = [], idx = [], seg = 14, Hh = 40, R = 3.6;
    list.forEach((cp) => {
        const base = pos.length / 3;
        for (let k = 0; k <= seg; k++) {
            const a = k / seg * Math.PI * 2, x = cp.x + Math.cos(a) * R, z = cp.z + Math.sin(a) * R;
            pos.push(x, 0.5, z, x, 0.5 + Hh, z); uv.push(k / seg, 0, k / seg, 1); ids.push(cp.k, cp.k);
        }
        for (let k = 0; k < seg; k++) { const a = base + k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('aIdx', new T.Float32BufferAttribute(ids, 1));
    g.setIndex(idx);
    const m = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, forceSinglePass: true,
        uniforms: { uReached: { value: -1 }, uTime: batTime },
        vertexShader: 'attribute float aIdx; varying vec2 vUv; varying float vIdx; void main(){ vUv = uv; vIdx = aIdx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uReached; uniform float uTime; varying vec2 vUv; varying float vIdx;
            void main(){
                float lit = step(vIdx, uReached + 0.5), next = 1.0 - step(0.5, abs(vIdx - uReached - 1.0));
                vec3 c = mix(vec3(1.0, 0.85, 0.35), vec3(0.35, 1.0, 0.5), lit);
                float a = pow(1.0 - vUv.y, 1.7) * (0.1 + lit * 0.06 + next * (0.28 + 0.12 * sin(uTime * 4.0)));
                gl_FragColor = vec4(c * a, a);
            }`,
    });
    const mesh = new T.Mesh(g, m);
    mesh.frustumCulled = false; mesh.renderOrder = 3;
    zoneGroup(Z).add(mesh);
    beams.set(i, m);
}
// The EXIT room: a glowing doorway under a big green EXIT sign, a beam of green light you can see
// over the walls, and a red force field across the way in while you still need the key
function buildExit(Z, m) {
    const er = m.exitRoom, ex = (er.x0 + er.x1) / 2, ez = er.z1 - WALL / 2;
    const door = new T.Mesh(new T.PlaneGeometry(10, 14), exitMat);
    door.position.set(ex, 7, ez - 0.2); door.rotation.y = Math.PI; zoneGroup(Z).add(door);
    addBox(Z, smoothVC(), true, 12, 1.4, 1.2, ex, 14.7, ez - 0.4, 0, 0x1a1a1a);
    for (const s of [-1, 1]) addBox(Z, smoothVC(), true, 1.2, 15.4, 1.2, ex + s * 5.6, 7.7, ez - 0.4, 0, 0x1a1a1a);
    board(Z, (x, W2, H2) => {
        x.fillStyle = '#0a5a1a'; x.fillRect(0, 0, W2, H2);
        x.fillStyle = '#22d83a'; x.fillRect(8, 8, W2 - 16, H2 - 16);
        txt(x, '🏃 EXIT', W2 / 2, H2 * 0.54, W2 * 0.86, H2 * 0.7, '#ffffff', '#063010', 800, 'Montserrat, Fredoka, sans-serif');
    }, 'exitsign', 12, 4, new V3(ex, 18.5, ez - 0.6), new V3(ex, 18.5, er.z0), { frame: 0x1a1a1a, W: 512 });
    const pad = new T.Mesh(new RoundedBoxGeometry(12, 0.4, 9, 2, 0.15), mat(0x2ae84a, { emissive: 0x16a02a, ei: 0.7 }));
    pad.position.set(m.exitPad.x, 0.2, m.exitPad.z); zoneGroup(Z).add(pad);
    triggers.push({ min: new V3(m.exitPad.x - 6, -1, m.exitPad.z - 4.5), max: new V3(m.exitPad.x + 6, 8, m.exitPad.z + 4.5), zone: Z, enter: () => actions.exit(m.i) });
    const need = STAGES[m.i].keys;
    let field = null, lb = null;
    if (need) {
        field = new T.Mesh(new T.PlaneGeometry(CELL - WALL, 16), fieldMat);
        field.position.set(m.x0 + (m.exitCol + 0.5) * CELL, 8, m.z1 + 0.2); field.renderOrder = 3; zoneGroup(Z).add(field);
        lb = label(Z, [{ t: '🔒 Find the key' + (need > 1 ? 's' : '') + '! 0/' + need, c: '#ffe24a', s: '#2a0a00', px: 50 }], 11, new V3(m.x0 + (m.exitCol + 0.5) * CELL, 17.5, m.z1 - 2), 0);
    }
    exits.set(m.i, { field, label: lb, need, key: '' });
    const beam = new T.Mesh(new T.CylinderGeometry(4, 6, 120, 16, 1, true), beamMatExit);
    beam.position.set(m.exitPad.x, 60, m.exitPad.z); zoneGroup(Z).add(beam); beam.renderOrder = 3;
}
export function refreshExit(stage, got) {
    const e = exits.get(stage);
    if (!e || !e.need) return;
    const open = got >= e.need, key = got + '|' + open;
    if (key === e.key) return;
    e.key = key;
    e.field.visible = !open;
    e.label.userData.set([open ? { t: '🔓 The EXIT is open!', c: '#9aff7a', s: '#0a2a0a', px: 50 } : { t: '🔒 Find the key' + (e.need > 1 ? 's' : '') + '! ' + got + '/' + e.need, c: '#ffe24a', s: '#2a0a00', px: 50 }]);
}
// A truss up a wall (black iron between red wood pillars on the first stage, like the reference)
function trussTower(Z, t, th, red) {
    const h = DECK_Y;
    const g = new T.BoxGeometry(t.sx, h, t.sz); g.translate(t.x, h / 2, t.z); worldUV(g, 2.6);
    addGeo(Z, g, trussMaterial(), true);
    solidBox(t.x, h / 2, t.z, t.sx, h, t.sz, { zone: Z, mat: 'truss', climb: true });
    const alongX = t.sx > t.sz, w = 1.6;
    for (const s of [-1, 1]) {
        const px = t.x + (alongX ? s * (t.sx / 2 + w / 2) : 0), pz = t.z + (alongX ? 0 : s * (t.sz / 2 + w / 2));
        wallBox(Z, red ? redWoodMaterial() : surfaceMaterial('planks'), alongX ? w : 2.2, WALL_H - 2, alongX ? 2.2 : w, px, (WALL_H - 2) / 2, pz, red ? undefined : th.trim, { uv: 4, mat: 'wood' });
    }
    label(Z, [{ t: '⬆ CLIMB', c: '#ffffff', s: '#1a1a1a', px: 50 }], 3.6, new V3(t.x - (t.nx || 0) * 2.5, 5.5, t.z - (t.nz || 0) * 2.5), 7, true);
}
// A plank deck on top of the walls
function deck(Z, d) {
    wallBox(Z, surfaceMaterial('planks'), d.sx, 1, d.sz, d.x, DECK_Y - 0.5, d.z, 0xc89a62, { uv: 4, mat: 'wood', extra: { deck: true } });
}
function buildBridge(Z, m, th) {
    const b = m.bridge;
    trussTower(Z, b.truss, th, false);
    const A = cellCenter(m, b.A);
    for (const d of b.decks) {
        deck(Z, d);
        // rope rails on both long edges; a solid rail on the outer one so you don't tumble off it
        const alongX = d.sx > d.sz, len = alongX ? d.sx : d.sz, n = Math.max(2, Math.round(len / 4));
        for (const side of [-1, 1]) {
            const ox = alongX ? 0 : side * (d.sx / 2 - 0.2), oz = alongX ? side * (d.sz / 2 - 0.2) : 0;
            for (let k = 0; k <= n; k++) {
                const u = -len / 2 + len * k / n;
                addBox(Z, smoothVC(), true, 0.3, 2.2, 0.3, d.x + (alongX ? u : ox), DECK_Y + 1.1, d.z + (alongX ? oz : u), 0, 0x6a4a2a);
            }
            addBox(Z, smoothVC(), false, alongX ? len : 0.15, 0.15, alongX ? 0.15 : len, d.x + ox, DECK_Y + 2, d.z + oz, 0, 0xd8b878);
        }
        const outer = alongX ? Math.sign(d.z - A.z) : Math.sign(d.x - A.x);
        if (alongX) solidBox(d.x, DECK_Y + 1.2, d.z + outer * (d.sz / 2 - 0.2), d.sx, 2.4, 0.4, { zone: Z, mat: 'wood' });
        else solidBox(d.x + outer * (d.sx / 2 - 0.2), DECK_Y + 1.2, d.z, 0.4, 2.4, d.sz, { zone: Z, mat: 'wood' });
    }
    floorArrow(Z, b.end.x, DECK_Y + 0.02, b.end.z, Math.atan2(b.drop.x - b.end.x, b.drop.z - b.end.z), 4);
    label(Z, [{ t: '⬇ JUMP DOWN', c: '#9aff7a', s: '#0a2a0a', px: 54 }], 5, new V3(b.end.x, DECK_Y + 4.5, b.end.z), 3, true);
    label(Z, [{ t: '🌉 SHORTCUT', c: '#ffe24a', s: '#2a1a00', px: 54 }, { t: 'The heads can\'t follow you up there!', c: '#ffffff', s: '#1a1a1a', px: 32 }], 7, new V3(b.truss.x - (b.truss.nx || 0) * 3, 10, b.truss.z - (b.truss.nz || 0) * 3), 9, true);
}
// A caged wall lamp; its light is a glow in the place's point cloud
function wallLamp(Z, x, y, z, yaw, th, lamps) {
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    addBox(Z, smoothVC(), false, Math.abs(dz) * 1.4 + 0.4, 0.4, Math.abs(dx) * 1.4 + 0.4, x + dx * 0.2, y + 1.2, z + dz * 0.2, 0, 0x2a2a30);
    const bulb = new T.SphereGeometry(0.45, 10, 8); bulb.translate(x + dx * 0.7, y, z + dz * 0.7);
    addGeo(Z, bulb, basicVC(), false, 0xfff0c0);
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2; addBox(Z, smoothVC(), false, 0.08, 1.3, 0.08, x + dx * 0.7 + Math.cos(a) * 0.55, y, z + dz * 0.7 + Math.sin(a) * 0.55, 0, 0x2a2a30); }
    lamps.push([x + dx * 0.9, y, z + dz * 0.9, th.mood === 'lava' || th.mood === 'boiler' ? 0xff9a50 : th.mood === 'sewer' ? 0xb8ff9a : th.mood === 'ice' ? 0xc8f0ff : 0xffe2a0, 4.5, dx, dz]);
}
// A paper poster stuck on the wall (one shared texture per text)
function poster(Z, x, y, z, yaw, text, rnd) {
    const map = sharedTex('poster|' + text, () => {
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 320; const c = cv.getContext('2d');
        c.fillStyle = '#efe6d2'; c.fillRect(0, 0, 256, 320);
        const r2 = seeded(text.length * 7 + 3);
        c.fillStyle = 'rgba(120,90,50,0.2)'; for (let k = 0; k < 30; k++) c.fillRect(r2() * 256, r2() * 320, 6, 6);
        const pic = text === 'MISSING' || text === 'HAHA!';
        if (pic) drawHeadIcon(c, 128, 180, 72);
        txt(c, text, 128, pic ? 50 : 160, 230, text.length > 10 ? 40 : 60, '#b8101a', null, 800, 'Montserrat, Fredoka, sans-serif');
        return cv;
    });
    const m = new T.Mesh(new T.PlaneGeometry(3.2, 4), posterMat(map));
    m.position.set(x, y, z); m.rotation.y = yaw; m.rotation.z = (rnd() - 0.5) * 0.12;
    m.receiveShadow = true;
    zoneGroup(Z).add(m);
}
const posterMats = new Map();
function posterMat(map) {
    let m = posterMats.get(map);
    if (!m) { m = new T.MeshLambertMaterial({ map, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }); posterMats.set(map, m); }
    return m;
}
// ----- coins: one instanced mesh per maze, spinning in the vertex shader -----
const m4 = new T.Matrix4(), q0 = new T.Quaternion(), v0 = new V3(), s0 = new V3();
let coinMat = null;
function buildCoins(Z, i) {
    const list = COINS.filter((c) => c.s === i);
    if (!list.length) return;
    const geo = new T.CylinderGeometry(1.1, 1.1, 0.3, 20); geo.rotateX(Math.PI / 2);
    if (!coinMat) {
        coinMat = coinMaterial().clone();
        coinMat.onBeforeCompile = (sh) => {
            sh.uniforms.uTime = coinTime;
            sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
                float gid = float(gl_InstanceID), ga = uTime * 2.6 + gid, gc = cos(ga), gs = sin(ga);
                transformed = vec3(gc * transformed.x + gs * transformed.z, transformed.y + sin(uTime * 2.0 + gid) * 0.3, gc * transformed.z - gs * transformed.x);`);
        };
        coinMat.customProgramCacheKey = () => 'coin-spin';
    }
    const mesh = new T.InstancedMesh(geo, coinMat, list.length);
    mesh.castShadow = false; mesh.receiveShadow = true;
    zoneGroup(Z).add(mesh);
    coinMeshes.set(i, { mesh, list, key: '' });
    placeCoins(i);
}
function placeCoins(i) {
    const c = coinMeshes.get(i);
    if (!c) return;
    c.list.forEach((q, k) => c.mesh.setMatrixAt(k, m4.compose(v0.set(q.x, q.y, q.z), q0.identity(), s0.setScalar(coinState.collected.has(q.i) ? 0.0001 : 1))));
    c.mesh.instanceMatrix.needsUpdate = true;
    c.mesh.computeBoundingSphere();
}
export function refreshCoins(stage) {
    const c = coinMeshes.get(stage);
    if (!c) return;
    let key = '';
    for (const q of c.list) key += coinState.collected.has(q.i) ? '1' : '0';
    if (key === c.key) return;
    c.key = key;
    placeCoins(stage);
}
// ----- keys: a big golden key turning over its dead end -----
function buildKey(Z, k) {
    const parts = [];
    const ring = new T.TorusGeometry(0.9, 0.28, 8, 20); ring.translate(0, 1.6, 0); parts.push(ring);
    const shaft = new T.BoxGeometry(0.4, 2.6, 0.35); shaft.translate(0, -0.6, 0); parts.push(shaft);
    for (const y of [-1.5, -0.9]) { const t = new T.BoxGeometry(0.9, 0.35, 0.35); t.translate(0.55, y, 0); parts.push(t); }
    const geos = parts.map((p) => { for (const kk of Object.keys(p.attributes)) if (kk !== 'position' && kk !== 'normal') p.deleteAttribute(kk); return p.index ? p.toNonIndexed() : p; });
    const g = new T.Mesh(mergeGeometries(geos), goldMaterial());
    g.castShadow = true; g.receiveShadow = true;
    const grp = new T.Group(); grp.position.set(k.x, k.y + 1, k.z); grp.add(g); zoneGroup(Z).add(anim(grp));
    grp.traverse((o) => { o.userData.anim = true; });
    const glow = new T.Sprite(new T.SpriteMaterial({ map: softTex(), color: 0xffd028, transparent: true, opacity: 0.6, depthWrite: false, blending: T.AdditiveBlending }));
    glow.scale.set(8, 8, 1); grp.add(glow); glow.userData.keepFar = true;
    label(Z, [{ t: '🔑 KEY', c: '#ffe24a', s: '#2a1a00', px: 54 }], 4, new V3(k.x, k.y + 6.4, k.z), 0, true);
    keyMeshes.push({ k, g: grp });
}
export function refreshKeys() { for (const km of keyMeshes) km.g.visible = !keyState.got.has(km.k.id); }
// ----- the Guide product: a glowing trail of arrows all the way to the EXIT -----
function buildGuide(Z, m) {
    const pts = m.path.map((a) => cellCenter(m, a));
    const sr = m.startRoom, er = m.exitRoom;
    pts.unshift({ x: (sr.x0 + sr.x1) / 2, z: (sr.z0 + sr.z1) / 2 });
    pts.push({ x: (er.x0 + er.x1) / 2, z: m.exitPad.z });
    const list = [];
    let acc = 0;
    for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1], len = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(b.x - a.x, b.z - a.z);
        for (let u = 0; u < len; u += 4) {
            const g = new T.PlaneGeometry(3, 3); g.rotateX(-Math.PI / 2); g.rotateY(yaw); g.translate(a.x + (b.x - a.x) * u / len, 0.22, a.z + (b.z - a.z) * u / len);
            const n = g.attributes.position.count; g.setAttribute('aD', new T.Float32BufferAttribute(new Float32Array(n).fill(acc + u), 1));
            g.deleteAttribute('normal');
            list.push(g);
        }
        acc += len;
    }
    const geo = mergeGeometries(list);
    const mat2 = new T.ShaderMaterial({
        transparent: true, depthWrite: false, uniforms: { uTime: guideTime, uMap: { value: arrowTex() } },
        vertexShader: 'attribute float aD; varying vec2 vUv; varying float vD; void main(){ vUv = uv; vD = aD; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uTime; uniform sampler2D uMap; varying vec2 vUv; varying float vD;
            void main(){ vec4 c = texture2D(uMap, vUv); float w = 0.55 + 0.45 * sin(vD * 0.25 - uTime * 6.0); if (c.a < 0.05) discard; gl_FragColor = vec4(c.rgb * (0.7 + w * 0.6) + vec3(0.1, 0.3, 0.1) * w, c.a * 0.9); }`,
    });
    const mesh = new T.Mesh(geo, mat2);
    mesh.renderOrder = 2; mesh.visible = false; mesh.frustumCulled = false;
    zoneGroup(Z).add(mesh);
    guides.set(m.i, mesh);
}
export function setGuide(stage, on) { for (const [s, g] of guides) g.visible = !!on && s === stage; }

// =====================================================================================
// Per-frame world animation
// =====================================================================================
const lastRefresh = { t: -9 };
export function updateWorld(dt, t, area, me) {
    coinTime.value = t; batTime.value = t; glowTime.value = t; guideTime.value = t;
    const cones = getQuality() !== 'low';
    for (const m of coneMeshes) m.visible = cones;
    for (const m of flowMats) m.map.offset.set((t * 0.02) % 1, (t * 0.05) % 1);
    if (area === -1 && lobbyAnim.horseman) {
        const r = lobbyAnim.horseman;
        animRig(r, Math.sin(t * 1.2) * 0.2, 0.3);
        r.userData.arms[1].rotation.set(-2.5 + Math.sin(t * 2) * 0.15, 0, 0.2);
    }
    for (const km of keyMeshes) if (km.g.visible && km.k.s === area) { km.g.rotation.y = t * 1.6; km.g.position.y = km.k.y + 1 + Math.sin(t * 2.2) * 0.4; km.g.updateMatrix(); }
    if (me) for (const l of spriteLOD) {
        if (l.zone !== area) continue;
        const d2 = (l.x - me.x) ** 2 + (l.z - me.z) ** 2 + ((l.y - me.y) * 0.6) ** 2;
        const vis = d2 > l.near2 && d2 < FAR_SIGNS * FAR_SIGNS && !l.sp.userData.hidden;
        if (l.sp.visible !== vis) l.sp.visible = vis;
    }
    if (t - lastRefresh.t > 0.5) { lastRefresh.t = t; refreshPads(); refreshDoors(); }
}

// =====================================================================================
// Build everything in slices (the page stays responsive while the server join runs alongside)
// =====================================================================================
// The lobby and the first stages (first: their indices) are built behind the loading screen; every
// other maze the first time someone goes into it (ensureStage), so the game starts in seconds
const builtStages = new Set();
export async function buildWorld(pause, first) {
    pause = pause || (() => Promise.resolve());
    buildLobby();
    await pause();
    for (const i of first || MAZES.map((m) => m.i)) { builtStages.add(i); buildStage(MAZES[i]); await pause(); }
    flowMats.push(slimeMaterial(), lavaMaterial());
    buildArrows();
    flushGeo();
    freezeStatic();
    cullZones(-1);
}
// Builds stage i now if it isn't yet (true if it did)
export function ensureStage(i) {
    if (i == null || i < 0 || !MAZES[i] || builtStages.has(i)) return false;
    builtStages.add(i);
    buildStage(MAZES[i]);
    flushGeo();
    freezeStatic(i);
    const a = shownArea; shownArea = null; cullZones(a);
    return true;
}
export const stageBuilt = (i) => builtStages.has(i);
// Stand-ins for the warm-up with the materials only some (not yet built) mazes use: the EXIT's force field
export function lazyStandIns() {
    const g = new T.Group();
    g.add(new T.Mesh(new T.PlaneGeometry(1, 1), fieldMat));
    return g;
}
// The sky / light mood of a place
export function moodOf(area) { return area == null || area < 0 ? 'lobby' : THEMES[STAGES[area].theme].mood; }
export { stageAt, textCanvas, solids };

// Gets every shader and texture onto the GPU while the loading screen shows: shaders compile in the
// background (compileAsync), the shadow pass's depth shaders included, then the textures upload and
// a GPU fence says when they're done. The stand-ins made here are kept, so their shaders stay alive.
const SHADOW_SIDE = { [T.FrontSide]: T.BackSide, [T.BackSide]: T.FrontSide, [T.DoubleSide]: T.DoubleSide };
const warmKeep = [];
export async function warmUp(renderer, camera, pause, extraScenes) {
    const vis = [];
    scene.traverse((o) => { if (o !== scene && !o.visible) { vis.push(o); o.visible = true; } });
    try { await renderer.compileAsync(scene, camera); } catch (e) { renderer.compile(scene, camera); }
    for (const sc of extraScenes || []) { try { await renderer.compileAsync(sc, camera); } catch (e) { renderer.compile(sc, camera); } }
    if (renderer.shadowMap.enabled) {
        const kinds = new Map();
        scene.traverse((o) => {
            if (!o.isMesh || !o.castShadow) return;
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
                const side = m.shadowSide ?? SHADOW_SIDE[m.side];
                const key = [o.isSkinnedMesh, o.isInstancedMesh, !!(o.isInstancedMesh && o.instanceColor), !!m.map, side, m.alphaTest > 0].join();
                if (kinds.has(key)) continue;
                const d = new T.MeshDepthMaterial({ side, map: m.map, alphaMap: m.alphaMap, alphaTest: m.alphaTest });
                let p;
                if (o.isSkinnedMesh) { p = new T.SkinnedMesh(o.geometry, d); p.bind(o.skeleton, o.bindMatrix); }
                else if (o.isInstancedMesh) { p = new T.InstancedMesh(o.geometry, d, 1); if (o.instanceColor) p.setColorAt(0, new T.Color(1, 1, 1)); }
                else p = new T.Mesh(o.geometry, d);
                kinds.set(key, p);
            }
        });
        const stand = new T.Group();
        for (const p of kinds.values()) stand.add(p);
        const rt = new T.WebGLRenderTarget(1, 1);
        const prev = renderer.getRenderTarget(), fog = scene.fog;
        let ready = null;
        renderer.setRenderTarget(rt);
        scene.fog = null;
        try { ready = renderer.compileAsync(stand, camera, scene); } catch (e) { /* compiles on first use */ }
        scene.fog = fog;
        renderer.setRenderTarget(prev);
        if (ready) { try { await ready; } catch (e) { /* compiles on first use */ } }
        rt.dispose();
        warmKeep.push(stand);
        try { renderer.compile(new T.Group(), camera, scene); } catch (e) { /* next frame */ }
    }
    for (const o of vis) o.visible = false;
    const texs = new Set();
    const collect = (o) => {
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of ms) {
            for (const k of ['map', 'normalMap', 'emissiveMap', 'alphaMap']) if (m[k]) texs.add(m[k]);
            if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) texs.add(v); }
        }
    };
    scene.traverse(collect);
    for (const sc of extraScenes || []) sc.traverse(collect);
    let n = 0;
    for (const tx of texs) {
        renderer.initTexture(tx);
        if (++n % 12 === 0) await pause();
    }
    const gl = renderer.getContext();
    if (gl.fenceSync) {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const t0 = performance.now();
        while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 15));
        gl.deleteSync(sync);
    }
    shownArea = null;
    cullZones(-1);
}
