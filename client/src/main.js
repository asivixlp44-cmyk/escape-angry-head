import { Client } from '@colyseus/sdk';
import {
    T, V3, $, canvas, scene, camera, sun, renderer, solids, triggers, prompts, tickers,
    billboard, buildRig, animRig, airPose, climbPose, holdPose, floatText, updateEffects, lerpAngle, updateSky, setMood, SUN_DIRECTION, mat,
} from './engine.js';
import { S, actions, net } from './state.js';
import { initAudio, resumeAudio, audioDebug, startMusic, sfx, step as surfStep, setVolume, audioSuspended, loopSound, setMusicIntensity, setHeartbeat } from './audio.js';
import * as BX from './bloxity.js';
import { createAvatar, loadBase, packAvatar, unpackAvatar } from './avatar.js';
import { pad, pollGamepad, rumble, onGamepadConnection } from './gamepad.js';
import {
    render, updateFx, dust, sparkleColumn, ring, fireworks, setQuality, getQuality, autoQualityAllowed, makeTrail, splash,
    coinBurst, zapFx, poofFx, confetti, updateAmbient, setSpeedLines, fxWarmGroup, fxShowAll, slapBurst, flame, setOverlay,
} from './fx.js';
import {
    buildWorld, warmUp, SPAWN, SPAWN_YAW, renderBoards, updateWorld, cullZones, refreshPads, refreshDoors, lightCheckpoint, resetCheckpoints,
    coinState, keyState, refreshCoins, refreshKeys, refreshExit, setGuide, moodOf, doorNeed, headIconUrl, ensureStage, lazyStandIns,
} from './world.js';
import { heldModel, hatModel, HAT_SPOT, toolSlot } from './gear.js';
import { HeadView, field as heads, setHeadStage, headSnapshot, updateHeads, headPos, jumpscare, scareScene, scareActive, warmScare, warmScareDone } from './heads.js';
import {
    updateHud, toast, showStageIntro, showEscaped, hideEscaped, flash, teleportFx, showRevive, hideRevive, reviveOpen, renderHotbar, hotbarTools,
    animateCounters, bumpCoins, openDailyOnJoin, refreshModal, refreshDaily, openModal, notEnough, buy, closeTop, anyPopup, promptEl, promptTxtEl,
    codeResult, cheer, setSprintMeter, showToolPop, setChase, showHaha, showContinue, hideContinue, comicPop, setGuideLine, setToolCooldown, setStatusChips,
} from './ui.js';
import {
    CFG, STAGES, BOSS, KITS, SKINS, trailById, gearById, hatById, HITTERS, passForTool, passForHat, fmt, clamp, revivePrice, stageOpen, limitedFree,
} from '../../shared/config.js';
import { MAZES, CHECKPOINTS, COINS, KEYS, WALL_H, stageAt, isSafe, cpOf } from '../../shared/maze.js';

// =====================================================================================
// Local player
// =====================================================================================
const HW = 1, PH = 5, STEP = 1.25, PIVOT = 2.6;
const P = {
    pos: SPAWN.clone(), vel: new V3(), kv: new V3(), hv: new V3(), onGround: false, ground: null, facing: SPAWN_YAW, moving: false,
    animPhase: 0, airTime: 0, peakY: 0, area: -1, lastStepN: 0, squash: 1, squashV: 0, climbing: null, climbT: 0,
    lastHit: -99, slapAnim: 0, jumpPress: -9, coyote: 0, onIce: false, jumps: 0, sprint: 1, sprinting: false,
    shieldT: 0, caughtT: -9, deathT: -9, fuel: CFG.jetFuel, jetting: false, gliding: false, zapT: -9, lastGroundY: 0,
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let shake = 0;
function addShake(a) { if (!reduceMotion) shake = Math.min(1.2, shake + a); }
let rig = null, headLabel, nameLabelText = '';
const timers = { jumpUntil: 0, noDmgUntil: 0, guideUntil: 0, invisUntil: 0 };

// The sparkly bubble you get for a moment after spawning (and with No Damage); the purple shimmer
// of the Invisibility Potion
const bubbleShader = (c1, c2) => new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uA: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); vP = position; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform float uA; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main(){
            float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.2);
            vec3 q = floor(vP * 5.0 + vec3(0.0, uTime * 2.0, 0.0));
            float sp = step(0.93, h(q)) * (0.5 + 0.5 * sin(uTime * 9.0 + h(q + 1.7) * 30.0));
            vec3 c = mix(vec3(${c1}), vec3(${c2}), 0.5 + 0.5 * sin(uTime * 2.0 + vP.y));
            gl_FragColor = vec4(c, (f * 0.7 + sp * 0.5 + 0.06) * uA);
        }`,
});
const shieldMat = bubbleShader('0.55, 0.85, 1.0', '0.75, 1.0, 0.85');
const invisMat = bubbleShader('0.55, 0.3, 1.0', '0.9, 0.6, 1.0');
const shieldGeo = new T.SphereGeometry(3.6, 28, 18);
tickers.push((dt, t) => { shieldMat.uniforms.uTime.value = t; invisMat.uniforms.uTime.value = t; });
// a bubble ('shield' / 'invis') on a character, shown while `on`
function setBubble(g, kind, on) {
    const u = g.userData, key = kind + 'B';
    if (on && !u[key]) { u[key] = new T.Mesh(shieldGeo, kind === 'invis' ? invisMat : shieldMat); u[key].position.y = 2.6; u[key].renderOrder = 7; g.add(u[key]); }
    if (u[key]) { u[key].visible = on; if (on) u[key].scale.setScalar(1 + Math.sin(performance.now() / 160) * 0.03); }
}

// ----- a character: rig (feet, yaw) -> pivot (hips) -> body (blocky or Bloxity) + tool + hat -----
function buildCharacter(kit, skin) {
    const g = new T.Group();
    const pivot = new T.Group(); pivot.position.y = PIVOT; g.add(pivot);
    const k = KITS[kit % KITS.length];
    const body = buildRig({ ...k, skin: SKINS[skin % SKINS.length] });
    body.position.y = -PIVOT;
    pivot.add(body);
    g.userData = { pivot, body, baseBody: body, tool: '', held: null, hatId: '', hat: null, trail: null, trailId: '', morph: null };
    return g;
}
// The tool in your right hand (or on your back: the jetpack, the wings)
const HOLD = new V3(1.45, 3.25, 1.45);
function setTool(g, id) {
    const u = g.userData;
    if (u.tool === (id || '')) return;
    u.tool = id || '';
    if (u.held) { u.held.parent && u.held.parent.remove(u.held); u.held = null; }
    if (!id || !gearById[id]) return;
    const h = heldModel(id);
    if (h.userData.slot === 'back') h.position.set(0, 3.3, 0); else h.position.copy(HOLD);
    u.body.add(h); u.held = h;
}
function setHat(g, id) {
    const u = g.userData;
    if (u.hatId === (id || '')) return;
    u.hatId = id || '';
    if (u.hat) { u.hat.parent && u.hat.parent.remove(u.hat); u.hat = null; }
    if (!id || !hatById[id]) return;
    const h = hatModel(id);
    u.hat = h;
    (u.blox ? u.body : u.body.userData.head).add(h);
    placeHat(u);
}
// Things that follow the Bloxity avatar's bones: the tool (hand or back) and the hat
const boneTmp = new V3();
function placeHat(u) {
    if (!u.hat) return;
    const spot = HAT_SPOT[u.hatId] || [0, 1, 0];
    if (!u.blox) { u.hat.position.set(spot[0], 4.6 + spot[1] * 0.75, spot[2]); u.hat.scale.setScalar(0.85); return; }
    const b = u.blox.bones.Neck1;
    if (!b) return;
    b.getWorldPosition(boneTmp);
    u.body.worldToLocal(boneTmp);
    u.hat.position.set(boneTmp.x + spot[0], boneTmp.y + spot[1], boneTmp.z + spot[2]);
}
function followBones(u) {
    if (!u.blox) return;
    if (u.held || u.hat) u.blox.model.updateMatrixWorld(true);
    if (u.held) {
        if (u.held.userData.slot === 'back') {
            const b = u.blox.bones.Spine2 || u.blox.bones.Spine1;
            if (b) { b.getWorldPosition(boneTmp); u.body.worldToLocal(boneTmp); u.held.position.set(boneTmp.x, boneTmp.y + 0.2, boneTmp.z); }
        } else {
            const b = u.blox.bones.ArmR2_leaf || u.blox.bones.ArmR2;
            if (b) { b.getWorldPosition(boneTmp); u.body.worldToLocal(boneTmp); u.held.position.copy(boneTmp); }
        }
    }
    placeHat(u);
}
function setTrail(g, id) {
    const u = g.userData;
    const d = trailById[id] || trailById.starter;
    if (!u.trail) u.trail = makeTrail(d.color);
    if (u.trailId !== d.id) {
        u.trailId = d.id;
        u.trail.setColor(d.color, d.rainbow);
        u.trail.width = d.id === 'starter' ? 0.5 : 0.8;
    }
}
// Playing as an Angry Head: the body hides, a big head bounds along in its place
function setMorph(g, on) {
    const u = g.userData;
    if (!!u.morph === !!on) return;
    if (on) {
        u.morph = new HeadView('normal', { r: 3.4 });
        u.morph.root.position.y = -0.8;
        g.add(u.morph.root);
        u.pivot.visible = false;
    } else {
        g.remove(u.morph.root);
        u.morph.mat.dispose();
        u.morph = null;
        u.pivot.visible = true;
    }
}

// ----- Bloxity avatars: replace the blocky body's meshes, keep the pivot, tools and labels -----
function dressRig(group, avatar) {
    const u = group.userData, body = u.baseBody;
    body.children.forEach((c) => { if (c !== u.held && c !== u.hat) c.visible = false; });
    body.add(avatar.root);
    u.blox = avatar;
    if (u.hat) { const id = u.hatId; u.hatId = ''; u.hat.parent && u.hat.parent.remove(u.hat); u.hat = null; setHat(group, id); }
}
let localAvatar = null, localAvatarReq = 0;
async function setupLocalAvatar() {
    const req = ++localAvatarReq;
    const a = await createAvatar(BX.currentAvatar(), BX.getSkinTextureUrl());
    if (!a) return;
    if (req !== localAvatarReq || !rig) { a.dispose(); return; }
    if (localAvatar) localAvatar.dispose();
    localAvatar = a;
    dressRig(rig, a);
}
function syncMyAvatar() {
    const av = BX.currentAvatar();
    if (localAvatar && av) { localAvatar.setProportions(av.proportions); localAvatar.setEquipped(av, BX.getSkinTextureUrl()); }
    net.send('avatar', { av: packAvatar(av) });
}
async function playEmoteOn(avatar, id) {
    if (!avatar) return;
    const cat = await BX.loadEmotes();
    const e = cat.get(id);
    if (e && e.clip) avatar.playEmote(e.clip);
}
function chatBubble(group, text) {
    if (!group) return;
    if (group.userData.bubbleLbl) { group.remove(group.userData.bubbleLbl); group.userData.bubbleLbl.material.map.dispose(); }
    const b = billboard([{ t: '💬 ' + text, c: '#ffffff', s: '#1a1a3a', px: 44 }], 9, 1024, new V3(0, 10, 0), group);
    group.userData.bubbleLbl = b;
    setTimeout(() => { if (group.userData.bubbleLbl === b) { group.remove(b); b.material.map.dispose(); group.userData.bubbleLbl = null; } }, 5000);
}
const nameLines = (name, morph) => (morph ? [{ t: '😡 ' + (name || ' '), c: '#ff6a6a', s: '#2a0004', px: 60 }] : [{ t: name || ' ', c: '#ffffff', s: '#1a1a3a', px: 60 }]);

function buildPlayer(kit, skin) {
    if (rig) { scene.remove(rig); if (rig.userData.trail) rig.userData.trail.dispose(); }
    rig = buildCharacter(kit, skin);
    scene.add(rig);
    nameLabelText = '';
    headLabel = billboard(nameLines(S.name), 6.5, 512, new V3(0, 7.8, 0), rig);
    headLabel.visible = false;
    rig.position.copy(P.pos);
    localAvatar = null;
    setupLocalAvatar();
}

// =====================================================================================
// Collision: boxes from the place you're in
// =====================================================================================
let nearBoxes = [], nearTriggers = triggers, nearPrompts = prompts, nearZoneKey = null;
function refreshNear(area) {
    if (area === nearZoneKey) return;
    nearZoneKey = area;
    const ok = (o) => o.zone === undefined || o.zone === area;
    nearBoxes = solids.filter(ok);
    nearTriggers = triggers.filter(ok);
    nearPrompts = prompts.filter(ok);
    cullZones(area);
}
const overlaps = (c, x, y, z) => !c.off && c.max.x > x - HW && c.min.x < x + HW && c.max.y > y && c.min.y < y + PH && c.max.z > z - HW && c.min.z < z + HW;
function freeAt(x, y, z) {
    for (const c of nearBoxes) if (overlaps(c, x, y, z)) return false;
    return true;
}
function moveAxis(axis, d) {
    if (d === 0) return;
    const p = P.pos;
    p[axis] += d;
    for (const c of nearBoxes) {
        if (!overlaps(c, p.x, p.y, p.z)) continue;
        if (axis === 'y') {
            if (d < 0) { if (c.max.y - p.y > Math.max(STEP, -d + 0.05)) continue; p.y = c.max.y; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = c; }
            else { if (p.y + PH - c.min.y > d + 0.05) continue; p.y = c.min.y - PH - 1e-4; if (P.vel.y > 0) P.vel.y = 0; }
        } else {
            const rise = c.max.y - p.y;
            if (rise > 0 && rise <= STEP && (P.onGround || P.vel.y <= 0) && !c.climb && freeAt(p.x, c.max.y + 0.01, p.z)) { p.y = c.max.y + 0.001; continue; }
            if (d > 0) p[axis] = c.min[axis] - HW - 1e-4; else p[axis] = c.max[axis] + HW + 1e-4;
        }
    }
}
function groundProbe(maxDrop) {
    const p = P.pos;
    let best = -Infinity, bs = null;
    for (const c of nearBoxes) {
        if (c.off || c.climb) continue;
        if (c.max.x <= p.x - HW || c.min.x >= p.x + HW || c.max.z <= p.z - HW || c.min.z >= p.z + HW) continue;
        if (c.max.y <= p.y + 0.01 && c.max.y >= p.y - maxDrop && c.max.y > best) { best = c.max.y; bs = c; }
    }
    if (bs) { p.y = best; P.onGround = true; P.ground = bs; P.vel.y = Math.max(0, P.vel.y); }
    return !!bs;
}
function trussTouching() {
    const p = P.pos, e = 0.4;
    for (const c of nearBoxes) {
        if (!c.climb) continue;
        if (c.max.x > p.x - HW - e && c.min.x < p.x + HW + e && c.max.z > p.z - HW - e && c.min.z < p.z + HW + e && c.max.y > p.y + 0.2 && c.min.y < p.y + PH) return c;
    }
    return null;
}
const overlapsBox = (t, p) => t.max.x > p.x - HW && t.min.x < p.x + HW && t.max.y > p.y && t.min.y < p.y + PH && t.max.z > p.z - HW && t.min.z < p.z + HW;
function groundUnder(pos) {
    for (const c of nearBoxes) if (!c.off && pos.x > c.min.x && pos.x < c.max.x && pos.z > c.min.z && pos.z < c.max.z && Math.abs(c.max.y - pos.y) < 0.6) return c;
    return null;
}

// ----- gear stats -----
const tool = () => S.tool || '';
function walkSpeed() {
    let w = CFG.walk;
    const id = tool();
    if (id === 'speedCoil') w *= CFG.speedCoil;
    else if (id === 'superCoil') w *= CFG.superSpeed;
    else if (id === 'scythe') w *= CFG.scytheSpeed;
    if (P.sprinting) w *= CFG.sprint;
    if (P.ground && P.ground.slime) w *= 0.55;
    if (S.morph) w *= 1.08;
    return qaWalk || w;
}
const gravity = () => CFG.grav * (tool() === 'gravityCoil' ? CFG.gravityCoil : tool() === 'superCoil' ? CFG.superGrav : 1);
const jumpV = () => CFG.jumpV * (timers.jumpUntil > Date.now() ? Math.sqrt(CFG.jumpBoost) : 1) * (P.ground && P.ground.slime ? 0.75 : 1);

function teleport(pos, yaw, fx) {
    P.pos.copy(pos); P.vel.set(0, 0, 0); P.kv.set(0, 0, 0); P.hv.set(0, 0, 0);
    P.facing = yaw || 0; cam.yaw = (yaw || 0) + Math.PI;
    P.climbing = null; P.peakY = pos.y; P.airTime = 0; P.lastGroundY = pos.y; P.fuel = CFG.jetFuel;
    if (rig && rig.userData.trail) rig.userData.trail.reset();
    enterArea(stageAt(pos.x, pos.y, pos.z) ?? -1, true);
    for (const t of nearTriggers) t.inside = overlapsBox(t, pos);
    sendMove(true);
    if (fx) { teleportFx(); sfx('teleport'); }
}
// Arriving somewhere: its sky, its colliders, its heads, its music
function enterArea(a, now) {
    if (a === P.area && !now) return;
    if (a >= 0) ensureStage(a);
    const changed = a !== P.area;
    P.area = a;
    refreshNear(a);
    setMood(moodOf(a), now);
    setHeadStage(a >= 0 ? a : -1, a >= 0 ? MAZES[a].heads.map((h) => h.type) : null);
    if (changed) { setGuide(-9, false); timers.guideUntil = 0; }
    if (a >= 0) { refreshCoins(a); refreshKeys(); refreshExit(a, keyState.got.size); }
}
function teleportLobby(fx) {
    teleport(SPAWN, SPAWN_YAW, fx !== false);
    net.send('lobby');
    S.run = null;
    P.shieldT = CFG.spawnShield;
}
actions.teleportLobby = () => { hideRevive(); hideEscaped(); teleportLobby(); };
actions.lobbyPortal = () => { if (clockT - P.deathT < 1 || P.area < 0) return; actions.teleportLobby(); toast('🏠 Back to the lobby', '#d8c0ff'); };
// Back to your checkpoint in this run, or the lobby without one
function respawn(fx) {
    const r = S.run, cp = r ? cpOf(r.s, r.cp) : null;
    if (cp) { teleport(new V3(cp.x, cp.y + 0.6, cp.z), cp.yaw, fx !== false); P.shieldT = CFG.spawnShield; }
    else teleportLobby(fx);
}

// =====================================================================================
// Runs: into a stage, checkpoints, coins, keys, the EXIT
// =====================================================================================
let doorT = -9;
actions.door = (i) => {
    if (clockT - doorT < 1.5 || !running) return;
    doorT = clockT;
    if (!stageOpen(S, i)) { toast('🔒 ' + doorNeed(i) + '!', '#ffb0b0'); sfx('denied'); return; }
    sfx('door');
    net.send('enter', { i });
};
actions.enterStage = (i, k) => { hideEscaped(); hideContinue(); net.send('enter', { i, k: k || 0 }); };
actions.continueRun = () => { hideContinue(); if (S.stage >= 0) net.send('enter', { i: S.stage, k: S.cp || 0 }); };
actions.checkpoint = (id) => {
    const cp = CHECKPOINTS[id];
    if (!cp || !S.run || cp.s !== S.run.s || S.morph) return;
    if (cp.k <= S.run.cp) return;
    S.run.cp = cp.k;
    resetCheckpoints(cp.s, cp.k);
    sendMove(true); net.send('cp', { id });
    sfx('checkpoint'); rumble(0.4, 180);
    sparkleColumn(P.pos, 0x46ff5a); ring(P.pos, 0x46ff5a, 8, 0.7);
    toast('🚩 Checkpoint! You\'re safe in here', '#9aff7a');
    cheer();
};
actions.exit = (i) => {
    if (!S.run || S.run.s !== i || S.morph || clockT - exitT < 3) return;
    exitT = clockT;
    const need = STAGES[i].keys;
    if (keyState.got.size < need) { toast('🔑 The EXIT is locked! Find the key' + (need > 1 ? 's' : '') + ' (' + keyState.got.size + '/' + need + ')', '#ffe24a'); sfx('denied'); return; }
    sendMove(true); net.send('exit');
};
let exitT = -9;
function checkPickups() {
    if (P.area < 0 || !S.run || S.morph) return;
    const p = P.pos;
    for (const c of COINS) {
        if (c.s !== P.area || coinState.collected.has(c.i)) continue;
        const dx = c.x - p.x, dy = c.y - (p.y + 2.5), dz = c.z - p.z;
        if (dx * dx + dy * dy + dz * dz < 4.2 * 4.2) {
            coinState.collected.add(c.i);
            refreshCoins(P.area);
            coinBurst(new V3(c.x, c.y, c.z));
            sfx('coin');
            sendMove(true); net.send('coin', { i: c.i });
        }
    }
    for (const k of KEYS) {
        if (k.s !== P.area || keyState.got.has(k.id)) continue;
        if ((k.x - p.x) ** 2 + (k.z - p.z) ** 2 < 4.5 * 4.5 && Math.abs(k.y + 1 - (p.y + 2.5)) < 5) {
            keyState.got.add(k.id);
            refreshKeys(); refreshExit(P.area, keyState.got.size);
            sfx('key'); sparkleColumn(new V3(k.x, k.y, k.z), 0xffd028); ring(P.pos, 0xffd028, 8, 0.6); confetti(P.pos);
            const need = STAGES[P.area].keys;
            toast(keyState.got.size >= need ? '🔑 You have the key' + (need > 1 ? 's' : '') + '! Now get to the EXIT!' : '🔑 Key ' + keyState.got.size + '/' + need + '! Find the rest', '#ffe24a');
            sendMove(true); net.send('key', { id: k.id });
        }
    }
}

// =====================================================================================
// Getting caught: the head's jumpscare, back to the checkpoint, and "Keep going?" for a few Coins
// =====================================================================================
let reviveTo = null, catcher = null;
const safeNow = () => P.area < 0 || isSafe(MAZES[P.area], P.pos.x, P.pos.z);
function caught(type, msg) {
    if (clockT - P.deathT < 2.2) return;
    P.deathT = clockT;
    reviveTo = S.run ? { pos: P.pos.clone(), yaw: P.facing, s: S.run.s } : null;
    net.send('caught', msg);
    jumpscare(type, 1300);
    showHaha();
    sfx('scream'); setTimeout(() => sfx('haha'), 180);
    flash('#ff1a2a', 900); addShake(1.1); rumble(1, 600);
    P.vel.set(0, 0, 0); P.hv.set(0, 0, 0); P.kv.set(0, 0, 0);
    frozenUntil = clockT + 1.35;
    setTimeout(() => {
        respawn(true);
        if (reviveTo && reviveTo.s === (S.run && S.run.s) && reviveTo.pos.distanceTo(P.pos) > 24) { showRevive(revivePrice(reviveTo.s), CFG.reviveSecs); sfx('reviveOffer'); }
    }, 1350);
}
let frozenUntil = -9;
actions.revive = () => { if (reviveTo) net.send('revive'); };
function checkCaught() {
    if (P.area < 0 || S.morph || clockT < frozenUntil) return;
    if (P.shieldT > 0 || timers.noDmgUntil > Date.now() || timers.invisUntil > Date.now() || safeNow() || qaNoHazards) return;
    const p = P.pos;
    // by a head
    for (let k = 0; k < heads.views.length; k++) {
        const hp = headPos(k), v = heads.views[k];
        if (!hp || v.mode === 3) continue;
        const r = v.r, dx = hp.x - p.x, dz = hp.z - p.z;
        if (dx * dx + dz * dz < (r + 1.1) ** 2 && p.y < r * 2 + 1) { caught(v.type, { k }); return; }
    }
    // by a player playing as a head
    for (const [id, r] of remotes) {
        if (!r.morph || r.area !== P.area) continue;
        const q = r.rig.position;
        if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < 4.4 * 4.4 && Math.abs(q.y - p.y) < 5) { caught('normal', { by: id }); toast('😡 ' + r.name + ' caught you!', '#ff8a8a'); return; }
    }
}

// =====================================================================================
// Pads in the lobby: gear, hats, the morph, the limited items
// =====================================================================================
actions.gearPad = (id, fromPrompt) => {
    if (S.gear[id]) { if (fromPrompt) actions.equip(id); else showToolPop(id); return; }
    if (fromPrompt) buy('pass', passForTool(id)); else showToolPop(id);
};
actions.limitedPad = (id, fromPrompt) => {
    const g = gearById[id];
    if (S.gear[id]) { if (fromPrompt) actions.equip(id); return; }
    if (limitedFree(g, S.playtime + (Date.now() - S.profileAt) / 1000)) { net.send('limited', { id }); return; }
    if (fromPrompt) buy('pass', passForTool(id)); else showToolPop(id);
};
actions.hatPad = (id, fromPrompt) => {
    if (S.hats[id]) { if (fromPrompt) actions.wearHat(id); else showToolPop('hat:' + id); return; }
    if (fromPrompt) buy('pass', passForHat(id)); else showToolPop('hat:' + id);
};
actions.wearHat = (id) => {
    if (!S.hats[id]) { buy('pass', passForHat(id)); return; }
    const next = S.hat === id ? '' : id;
    S.hat = next;
    net.send('hat', { id: next });
    sfx('equip');
    toast(next ? hatById[next].ic + ' Wearing the ' + hatById[next].name + ' (x' + hatById[next].mult + ' Coins)' : 'Hat off', '#ffe0a0');
};
let morphT = -9;
actions.morphPad = (fromPrompt) => {
    if (clockT - morphT < 1.5) return;
    if (!S.passes.Morph) { if (fromPrompt) buy('pass', 'Morph'); else showToolPop('morph'); return; }
    morphT = clockT;
    actions.toggleMorph();
};
actions.toggleMorph = () => {
    if (!S.passes.Morph) { buy('pass', 'Morph'); return; }
    const on = !S.morph;
    S.morph = on;
    net.send('morph', { on });
    sfx(on ? 'morph' : 'equip'); flash(on ? '#ff3a4a' : '#ffffff', 500); poofFx(P.pos);
    toast(on ? '😡 You are the ANGRY HEAD! Go into a stage and catch players (+' + CFG.scareCoins + ' Coins each)' : '🙂 Back to yourself', on ? '#ff8a8a' : '#ffffff');
};
// Equip (or put away) a tool; buy it first if you don't own it
actions.equip = (id) => {
    if (!S.gear[id]) { buy('pass', passForTool(id)); return; }
    const next = S.tool === id ? '' : id;
    S.tool = next;
    net.send('tool', { id: next });
    sfx('equip');
    renderHotbar(); refreshPads();
    const tips = {
        speedCoil: '🌀 Speed Coil: you run 35% faster!', gravityCoil: '🪐 Gravity Coil: floaty high jumps!', superCoil: '💫 Super Coil: faster AND higher!',
        slap: '🖐️ Troll Slap: click near a head to slap it away!', jetpack: '🚀 Jetpack: hold Jump to fly up!', wings: '🪽 Angel Wings: hold Jump to glide, jump again in the air!',
        rocket: '🎯 Rocket Launcher: click to blast the nearest head!', scythe: '⚔️ Scythe: click to slash a head away!', potion: '🧪 Potion: click to turn invisible for 8s!',
    };
    if (next && tips[next]) toast(tips[next], '#ffffff');
};

// ----- tools: hit a head (slap / rocket / scythe), slap a player, drink the potion -----
const ray = new T.Raycaster(), ndc = new T.Vector2();
function useTool(center, sx, sy) {
    const id = tool();
    if (!rig || !id || clockT < frozenUntil) return;
    if (id === 'potion') { net.send('potion'); return; }
    const hit = HITTERS[id];
    if (!hit) return;
    if (clockT - P.lastHit < hit.cooldown) { if (id !== 'slap') toast('⏳ Recharging...', '#c8c0d8'); else slapPlayer(); return; }
    // the head to hit: for the rocket, the one nearest where you aim; else the nearest in front
    let best = -1, bd = Infinity;
    const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
    if (id === 'rocket') {
        const x = center || sx === undefined ? innerWidth / 2 : sx, y = center || sy === undefined ? innerHeight / 2 : sy;
        ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
        ray.setFromCamera(ndc, camera);
    }
    for (let k = 0; k < heads.views.length; k++) {
        const hp = headPos(k), v = heads.views[k];
        if (!hp) continue;
        const dx = hp.x - P.pos.x, dz = hp.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d > hit.range + v.r) continue;
        if (id === 'rocket') {
            const c = new V3(hp.x, v.r + 0.5, hp.z), miss = ray.ray.distanceToPoint(c);
            if (c.clone().sub(ray.ray.origin).dot(ray.ray.direction) < 0 || miss > v.r + 2 + d * 0.06) continue;
            if (miss < bd) { bd = miss; best = k; }
        } else {
            if (d > v.r + 2.5 && (dx * fx + dz * fz) / d < 0.2) continue;
            if (d < bd) { bd = d; best = k; }
        }
    }
    if (best < 0 && id === 'slap') { slapPlayer(); return; }
    P.lastHit = clockT; P.slapAnim = 0.28;
    setToolCooldown(id, hit.cooldown);
    const hp = best >= 0 ? headPos(best) : null;
    if (id === 'rocket') {
        sfx('rocket');
        const from = rig.localToWorld(new V3(1.4, 3.4, 2));
        const to = hp ? new V3(hp.x, heads.views[best].r + 0.5, hp.z) : ray.ray.at(60, new V3());
        flyRocket(from, to, () => { dust(to, 18, 2.5, 0xffa040); splash(to, 0xff6a1a, 24, 2); sfx('boom'); addShake(0.4); });
    } else sfx(id === 'scythe' ? 'slash' : 'whoosh');
    if (best >= 0) {
        if (hp) P.facing = Math.atan2(hp.x - P.pos.x, hp.z - P.pos.z);
        net.send('hit', { k: best });
    } else if (id !== 'rocket') toast('Get closer to a head to hit it!', '#c8c0d8');
}
function slapPlayer() {
    if (clockT - P.lastHit < 0.9) return;
    P.lastHit = clockT; P.slapAnim = 0.28;
    sfx('whoosh');
    let best = '', bd = Infinity;
    const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
    for (const [rid, r] of remotes) {
        if (r.area !== P.area) continue;
        const dx = r.rig.position.x - P.pos.x, dz = r.rig.position.z - P.pos.z, dy = r.rig.position.y - P.pos.y, d = Math.hypot(dx, dz);
        if (d > CFG.slapRange || Math.abs(dy) > 6 || (d > 2.5 && (dx * fx + dz * fz) / d < 0.15)) continue;
        if (d < bd) { bd = d; best = rid; }
    }
    if (best) { const r = remotes.get(best).rig; P.facing = Math.atan2(r.position.x - P.pos.x, r.position.z - P.pos.z); }
    net.send('slap', { t: best });
}
// A rocket flying along a short arc, then the bang
const rockets = [];
const rocketGeo = new T.CapsuleGeometry(0.3, 1.2, 4, 8); rocketGeo.rotateX(Math.PI / 2);
const rocketMat = mat(0xff3a3a, { emissive: 0xff6a2a, ei: 0.8 });
function flyRocket(from, to, done) {
    const m = new T.Mesh(rocketGeo, rocketMat);
    m.position.copy(from); scene.add(m);
    rockets.push({ m, from: from.clone(), to: to.clone(), t: 0, len: Math.max(0.15, from.distanceTo(to) / 90), done });
}
tickers.push((dt) => {
    for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.t += dt / r.len;
        const k = Math.min(1, r.t);
        const prev = r.m.position.clone();
        r.m.position.lerpVectors(r.from, r.to, k); r.m.position.y += Math.sin(k * Math.PI) * 2;
        r.m.lookAt(r.m.position.clone().add(r.m.position.clone().sub(prev)));
        flame(r.m.position, 0.3, 0.8, new V3(0, 1, 0));
        if (k >= 1) { scene.remove(r.m); r.done(); rockets.splice(i, 1); }
    }
});

// =====================================================================================
// Friend Boost
// =====================================================================================
let friendNames = [], friendsT = 3, friendSyncT = 5;
async function refreshFriends() {
    if (!BX.bloxity.ready || !BX.identity().loggedIn) return;
    const list = await BX.getFriends();
    friendNames = list.map((f) => f.displayName || f.username).filter(Boolean);
    syncFriends();
}
function syncFriends() {
    const room = net.room;
    if (!room || !room.state || !room.state.players || !friendNames.length) return;
    const here = [];
    room.state.players.forEach((p, id) => { if (id !== room.sessionId && friendNames.includes(p.name)) here.push(p.name); });
    net.send('friends', { names: here });
}

// =====================================================================================
// Other players
// =====================================================================================
const remotes = new Map();
let joinSynced = false;
class Remote {
    constructor(p) {
        this.rig = buildCharacter(p.kit, p.skin);
        this.rig.position.set(p.x, p.y, p.z);
        this.rig.rotation.y = p.ry;
        scene.add(this.rig);
        this.name = p.name; this.morph = !!p.morph; this.area = p.area;
        this.label = billboard(nameLines(p.name, p.morph), 6, 512, new V3(0, 7.8, 0), this.rig);
        this.labelKey = p.name + '|' + p.morph;
        this.av = null; this.blox = null; this.dead = false; this.phase = 0; this.vel = 0;
        this.lastX = p.x; this.lastZ = p.z; this.stepN = 0; this.swing = 0;
        this.setAvatar(p.av);
    }
    setAvatar(av) {
        this.av = av;
        const data = av ? unpackAvatar(av) : null;
        if (this.blox) { this.blox.setProportions(data && data.proportions); this.blox.setEquipped(data || {}); return; }
        if (this.loading) return;
        this.loading = true;
        createAvatar(data).then((a) => {
            this.loading = false;
            if (!a) return;
            if (this.dead) { a.dispose(); return; }
            this.blox = a;
            dressRig(this.rig, a);
            if (this.av !== av) this.setAvatar(this.av);
        });
    }
    update(p, dt, t) {
        const r = this.rig, u = r.userData;
        this.morph = !!p.morph; this.area = p.area; this.name = p.name;
        // only the players in the same place as you are drawn
        const here = p.area === P.area;
        if (r.visible !== here) { r.visible = here; if (u.trail) u.trail.reset(); }
        const k = 1 - Math.exp(-dt * 12);
        const far = (r.position.x - p.x) ** 2 + (r.position.z - p.z) ** 2 + (r.position.y - p.y) ** 2 > 900;
        if (far || !here) { r.position.set(p.x, p.y, p.z); if (u.trail) u.trail.reset(); }
        else { r.position.x += (p.x - r.position.x) * k; r.position.y += (p.y - r.position.y) * k; r.position.z += (p.z - r.position.z) * k; }
        r.rotation.y = lerpAngle(r.rotation.y, p.ry, k);
        if (p.av !== this.av) this.setAvatar(p.av);
        if (!here) { this.lastX = r.position.x; this.lastZ = r.position.z; return; }
        const moved = Math.hypot(r.position.x - this.lastX, r.position.z - this.lastZ);
        this.vel += ((dt > 0 ? moved / dt : 0) - this.vel) * Math.min(1, dt * 6);
        this.lastX = r.position.x; this.lastZ = r.position.z;
        setMorph(r, this.morph);
        setTool(r, this.morph ? '' : p.tool); setHat(r, this.morph ? '' : p.hat); setTrail(r, p.trail);
        const air = p.anim === 2 || p.anim === 4, climb = p.anim === 3;
        const moving = p.anim === 1 && this.vel > 1;
        if (u.morph) { u.morph.root.updateMatrixWorld(); u.morph.animate(dt, t, moving ? 1 : 0, this.vel, null); }
        else {
            this.phase += dt * (moving ? Math.min(18, 4 + this.vel * 0.3) : climb ? 9 : 0);
            if (climb) climbPose(u.body, this.phase); else if (air) airPose(u.body); else if (moving) animRig(u.body, this.phase, 0.85); else animRig(u.body, 0, 0);
            const handTool = u.held && u.held.userData.slot === 'hand';
            if (handTool && !climb) holdPose(u.body);
            if (this.swing > 0) this.swing = Math.max(0, this.swing - dt);
            if (this.blox) { this.blox.update(dt, { moving, air, speed: this.vel, t, pose: climb ? 'climb' : undefined, hold: !!handTool, slap: this.swing > 0 ? 1 - this.swing / 0.28 : 0 }); followBones(u); }
            const own = !this.blox;
            u.pivot.position.y = PIVOT + (moving && own ? Math.abs(Math.sin(this.phase)) * 0.16 : 0);
        }
        const stepN = Math.floor(this.phase / Math.PI);
        if (moving && stepN !== this.stepN && camera.position.distanceToSquared(r.position) < 900) { const s = groundUnder(r.position); if (s) stepQuiet(s.mat); }
        this.stepN = stepN;
        u.trail.update(trailAt(r), (moving || air) && r.visible && !u.morph, dt, t);
        setBubble(r, 'shield', (p.st || '').includes('n'));
        setBubble(r, 'invis', (p.st || '').includes('i'));
        const key = p.name + '|' + p.morph;
        if (key !== this.labelKey) { this.labelKey = key; this.label.userData.set(nameLines(p.name, p.morph)); this.label.position.y = p.morph ? 9.5 : 7.8; }
    }
    dispose() {
        this.dead = true;
        if (this.blox) this.blox.dispose();
        if (this.rig.userData.trail) this.rig.userData.trail.dispose();
        scene.remove(this.rig);
    }
}
const trailTmp = new V3();
function trailAt(r) { return trailTmp.set(r.position.x - Math.sin(r.rotation.y) * 0.9, r.position.y + 2.4, r.position.z - Math.cos(r.rotation.y) * 0.9); }
let quietT = 0;
function stepQuiet(m) { if (clockT - quietT < 0.06) return; quietT = clockT; surfStep(surfaceSound(m), false); }

const seenIds = new Set();
function syncRemotes(dt, t) {
    const room = net.room;
    if (!room || !room.state || !room.state.players) return;
    const seen = seenIds;
    seen.clear();
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId) {
            S.name = p.name; S.friends = p.friends;
            if (!rig || rig.userData.kit !== p.kit) { buildPlayer(p.kit, p.skin); rig.userData.kit = p.kit; P.shieldT = CFG.spawnShield; }
            S.st = p.st || '';
            return;
        }
        seen.add(id);
        let r = remotes.get(id);
        if (!r) {
            r = new Remote(p); remotes.set(id, r);
            if (joinSynced) BX.playerJoined(p.name); else BX.playerInRoom(p.name);
        }
        r.update(p, dt, t);
    });
    for (const [id, r] of remotes) if (!seen.has(id)) { r.dispose(); remotes.delete(id); }
    joinSynced = true;
}

// =====================================================================================
// Networking
// =====================================================================================
const BLOXITY_GAME_ID = import.meta.env.VITE_BLOXITY_GAME_ID || '';
const ON_BLOXITY_HOST = /\.play\.bloxity\.io$/.test(location.hostname);
const DEV_CHANNEL = /\.dev\.play\.bloxity\.io$/.test(location.hostname);
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (ON_BLOXITY_HOST ? `https://${location.hostname.replace(/\.play\.bloxity\.io$/, '.host.bloxity.io')}`
        : BLOXITY_GAME_ID ? `https://${BLOXITY_GAME_ID}.host.bloxity.io`
        : import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2653` : location.origin);
async function serverEndpoint() {
    let url = SERVER_URL;
    if (BLOXITY_GAME_ID) {
        const r = await BX.resolveEndpoint(BLOXITY_GAME_ID, DEV_CHANNEL ? 'preview' : undefined);
        if (r && r.cold) $('#loading').textContent = 'Waking up a server…';
        url = (r && r.endpoint) || SERVER_URL;
    }
    if (!/^https?:/i.test(url)) return url;
    if (!(await serverUp(url))) {
        $('#loading').textContent = 'Waking up a server…';
        const until = Date.now() + 60000;
        while (Date.now() < until) {
            await new Promise((res) => setTimeout(res, 2000));
            if (await serverUp(url)) break;
        }
    }
    return url;
}
async function serverUp(url) {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(url.replace(/\/$/, '') + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        return r.ok;
    } catch (e) { return false; }
}
let lastMoveSent = 0, lastMoveKey = '';
function sendMove(force) {
    const now = performance.now();
    if (!force && now - lastMoveSent < 66) return;
    const a = P.jetting || P.gliding ? 4 : P.climbing ? 3 : !P.onGround ? 2 : P.moving ? 1 : 0;
    const m = { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), ry: +P.facing.toFixed(3), a };
    const key = m.x + ',' + m.y + ',' + m.z + ',' + m.ry + ',' + a;
    if (!force && key === lastMoveKey && now - lastMoveSent < 500) return;
    lastMoveKey = key; lastMoveSent = now;
    net.send('move', m);
}
function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function playerUid() {
    let uid = storageGet('eah_uid');
    if (!uid) {
        uid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        storageSet('eah_uid', uid);
    }
    return uid;
}
const sessionOf = (id) => (net.room && id === net.room.sessionId ? rig : remotes.get(id) && remotes.get(id).rig);

let lastCoins = null, firstProfile = true;
async function connect(name, endpoint) {
    const client = new Client(endpoint || await serverEndpoint());
    const id = BX.identity();
    const room = await client.joinOrCreate('angry', {
        uid: playerUid(), name: name || id.name, token: id.token, av: packAvatar(BX.currentAvatar()),
        save: storageGet('eah_save') || '',
    });
    net.room = room;
    joinSynced = false;
    room.onMessage('hello', (m) => { net.offset = m.now - Date.now(); net.bloxity = !!m.bloxity; });
    room.onMessage('authed', () => { net.bloxity = true; });
    room.onMessage('emote', (m) => { const r = remotes.get(m.s); if (r) playEmoteOn(r.blox, m.id); });
    room.onMessage('chat', (m) => { toast(m.name + ': ' + m.text, '#ffffff'); chatBubble(sessionOf(m.s), m.text); });
    BX.updateRoom(room.roomId);
    BX.gameplayStart();
    room.onMessage('profile', (m) => {
        if (m.save) storageSet('eah_save', m.save);
        delete m.save;
        const run = m.run; delete m.run;
        Object.assign(S, m);
        S.profileAt = Date.now();
        if (lastCoins !== null && S.coins > lastCoins) bumpCoins();
        lastCoins = S.coins;
        if (firstProfile) {
            firstProfile = false;
            // came back in the middle of a stage: offer to carry on from its checkpoint
            if (S.stage >= 0 && !run) setTimeout(() => { if (P.area < 0) showContinue(S.stage, S.cp); }, 2200);
            const next = S.stage >= 0 ? S.stage : STAGES.findIndex((q, i) => stageOpen(S, i) && S.cleared[i] === undefined);
            setTimeout(() => ensureStage(next), 1500);
        }
        renderHotbar(); refreshPads(); refreshDoors();
        refreshModal(); refreshDaily();
        openDailyOnJoin();
    });
    room.onMessage('toast', (m) => toast(m.text, m.color));
    room.onMessage('announce', (m) => toast(m.text, m.color));
    room.onMessage('earn', (m) => {
        floatText('+' + fmt(m.n) + ' 🪙', '#ffe24a', P.pos.clone().add(new V3(0, 6.5, 0)), m.why === 'coin' ? 3.4 : 4.6);
        if (m.why === 'scare') { sfx('haha'); toast('😡 You caught ' + m.who + '! +' + fmt(m.n) + ' Coins', '#ffb0b0'); }
    });
    room.onMessage('broke', (m) => { notEnough(m); sfx('denied'); });
    room.onMessage('goStage', (m) => {
        const cp = cpOf(m.i, m.k) || cpOf(m.i, 0);
        if (!cp) return;
        ensureStage(m.i);
        hideRevive(); hideEscaped(); hideContinue();
        S.run = { s: m.i, cp: cp.k };
        coinState.collected.clear(); keyState.got.clear();
        resetCheckpoints(m.i, cp.k);
        teleport(new V3(cp.x, cp.y + 0.6, cp.z), cp.yaw, true);
        P.shieldT = CFG.spawnShield;
        showStageIntro(m.i, cp.k);
        sfx('stageStart');
    });
    room.onMessage('escaped', (m) => {
        S.run = null;
        showEscaped(m);
        sfx('escape'); rumble(0.8, 600);
        fireworks(P.pos, 14, () => sfx('firework'));
        sparkleColumn(P.pos, 0x46ff5a); confetti(P.pos);
    });
    room.onMessage('revived', () => {
        hideRevive();
        if (!reviveTo) return;
        teleport(reviveTo.pos, reviveTo.yaw, true);
        P.shieldT = CFG.spawnShield;
        sparkleColumn(P.pos, 0x46ff8a);
        toast('💚 Back where you were! The head ran off', '#7dff6b');
        reviveTo = null;
    });
    // the server's keys for this run (it refused the EXIT): any key it never got shows up again
    room.onMessage('keys', (m) => {
        if (!S.run || S.run.s !== m.s) return;
        const had = keyState.got.size;
        keyState.got = new Set(m.ids);
        refreshKeys(); refreshExit(m.s, keyState.got.size);
        if (keyState.got.size < had) toast('🔑 A key slipped away! Grab it again', '#ffe24a');
    });
    room.onMessage('codeResult', (m) => codeResult(m));
    room.onMessage('boards', renderBoards);
    room.onMessage('fx', () => { sparkleColumn(P.pos, 0xffd028); ring(P.pos, 0xffd028, 10, 0.8); confetti(P.pos); sfx('buy'); });
    room.onMessage('boost', (m) => {
        const until = Date.now() + m.secs * 1000;
        if (m.kind === 'jump') { timers.jumpUntil = until; toast('🦘 Jump Higher for 1 minute!', '#9aff7a'); }
        else if (m.kind === 'shield') { timers.noDmgUntil = until; toast('🛡️ No Damage for 1 minute! The heads can\'t catch you', '#7de8ff'); }
        else if (m.kind === 'guide') { timers.guideUntil = until; setGuide(P.area, true); toast('🧭 Follow the glowing arrows to the EXIT!', '#9aff7a'); }
    });
    room.onMessage('potionOn', (m) => { timers.invisUntil = Date.now() + m.secs * 1000; sfx('potion'); poofFx(P.pos); toast('🧪 INVISIBLE! The heads can\'t see you', '#d8b8ff'); setToolCooldown('potion', CFG.potionCooldown); });
    room.onMessage('scared', () => { sparkleColumn(P.pos, 0xff3a4a); });
    // ----- the heads of the maze you're in -----
    room.onMessage('h', (m) => headSnapshot(m, net.now()));
    room.onMessage('hfx', (m) => {
        if (m.s !== P.area) return;
        const hp = headPos(m.k), v = heads.views[m.k];
        if (!hp || !v) return;
        const at = new V3(hp.x, v.r + 1, hp.z);
        if (m.by !== room.sessionId) { const r = remotes.get(m.by); if (r) r.swing = 0.28; }
        slapBurst(at, m.tool === 'scythe' ? 0xc86aff : m.tool === 'rocket' ? 0xff8a2a : 0xffe24a, 1.4);
        comicPop(at, m.tool === 'scythe' ? 'SLASH!' : m.tool === 'rocket' ? 'BOOM!' : 'SLAP!');
        if (camera.position.distanceTo(at) < 90) sfx('stun');
    });
    heads.onEvent = (k, e) => {
        const v = heads.views[k], hp = headPos(k);
        if (!v || !hp) return;
        const near = Math.hypot(hp.x - P.pos.x, hp.z - P.pos.z);
        if (e === 'spot' && near < 70) { sfx(near < 30 ? 'scream' : 'growl'); comicPop(new V3(hp.x, v.r * 2 + 1, hp.z), '❗'); }
        else if (e === 'laugh' && near < 80) sfx('haha');
        else if (e === 'home') poofFx(new V3(hp.x, v.r, hp.z));
    };
    // ----- slaps between players -----
    room.onMessage('slapFx', (m) => {
        const tg = m.t && sessionOf(m.t);
        if (m.s !== room.sessionId) { const rr = remotes.get(m.s); if (rr) rr.swing = 0.28; }
        if (tg && tg.visible) { slapBurst(tg.position, 0xffe24a, 1); if (camera.position.distanceTo(tg.position) < 80) { sfx('slap'); comicPop(tg.position, 'SLAP!'); } }
    });
    room.onMessage('slapped', (m) => {
        if (P.shieldT > 0) return;
        P.kv.set(m.dx * 52, 0, m.dz * 52);
        P.vel.y = 28; P.onGround = false; P.climbing = null;
        flash('#ffffff', 300); sfx('slapped'); addShake(0.5); rumble(0.6, 220);
        toast('🖐️ ' + m.by + ' slapped you!', '#ffd0f0');
    });
    room.onLeave((code, reason) => {
        console.warn('[net] left room', code, reason || '');
        net.room = null;
        if (code !== 1000) $('#offline').hidden = false;
    });
    return room;
}

// =====================================================================================
// Camera & input
// =====================================================================================
const cam = { yaw: SPAWN_YAW + Math.PI, pitch: 0.28, dist: 20, target: new V3(), dragT: -9 };
let camSens = 1;
const keys = {};
const touchMove = { x: 0, y: 0 };
let touchJump = false, running = false, sprintToggle = false;
function pressJump() { P.jumpPress = clockT; }
addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.key === 'Enter') e.target.blur(); return; }
    if (e.code === 'Space' && !e.repeat && running) pressJump();
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyE' && running) { if (activePrompt) usePrompt(); else useTool(true); }
    if (e.code === 'KeyF' && running) useTool(true);
    if (running && /^Digit[1-9]$/.test(e.code)) { const g = hotbarTools()[+e.code.slice(5) - 1]; if (g) actions.equip(g); }
    if (e.code === 'Escape') {
        if (closeTop()) return;
        if (running && BX.isEmbedded()) BX.showPortalMenu();
    }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
const drags = new Map();
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drags.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() }); canvas.focus(); });
canvas.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    const k = (e.pointerType === 'touch' ? 0.009 : 0.005) * camSens;
    cam.yaw -= (e.clientX - d.x) * k;
    cam.pitch = clamp(cam.pitch + (e.clientY - d.y) * k, -0.5, 1.3);
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 0) cam.dragT = clockT;
    d.x = e.clientX; d.y = e.clientY;
});
const endDrag = (e) => {
    const d = drags.get(e.pointerId);
    drags.delete(e.pointerId);
    if (d && e.type === 'pointerup' && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 7 && performance.now() - d.t0 < 350 && running) useTool(false, e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 2.5, 6, 50); e.preventDefault(); }, { passive: false });

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
// the camera swings round behind you as you run (phones and controllers, or on in Settings)
let camFollow = storageGet('eah_follow') !== null ? storageGet('eah_follow') === '1' : isTouch;
actions.setFollow = (on) => { camFollow = !!on; storageSet('eah_follow', on ? '1' : '0'); };
actions.getFollow = () => camFollow;
(function joystick() {
    const stick = $('#stick'), knob = $('#knob');
    let id = null;
    const set = (e) => {
        const r = stick.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2, l = Math.hypot(dx, dy);
        if (l > max) { dx *= max / l; dy *= max / l; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchMove.x = dx / max; touchMove.y = dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); set(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; touchMove.x = touchMove.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const hold = (el, on, off) => {
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); });
        el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    };
    hold($('#jumpBtn'), () => { touchJump = true; pressJump(); }, () => { touchJump = false; });
    $('#useBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); useTool(true); });
})();
actions.toggleSprint = () => { sprintToggle = !sprintToggle; sfx('click'); };

// Ray against the boxes near the player (camera collision)
const AXES = ['x', 'y', 'z'];
function rayHit(o, d, maxT) {
    let best = maxT;
    for (const c of nearBoxes) {
        if (c.off || c.mat === 'glass' || c.climb || c.slime || c.ice || c.lava || (c.max.x - c.min.x < 1.5 && c.max.z - c.min.z < 1.5)) continue;
        let t0 = 0, t1 = best, miss = false;
        for (const a of AXES) {
            if (Math.abs(d[a]) < 1e-9) { if (o[a] < c.min[a] || o[a] > c.max[a]) { miss = true; break; } continue; }
            let ta = (c.min[a] - o[a]) / d[a], tb = (c.max[a] - o[a]) / d[a];
            if (ta > tb) { const q = ta; ta = tb; tb = q; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { miss = true; break; }
        }
        if (!miss && t0 > 0 && t0 < best) best = t0;
    }
    return best;
}
// The sun's shadow camera follows you in steps of one shadow-map texel
const LZD = SUN_DIRECTION.clone().normalize(), LX = new V3(0, 1, 0).cross(LZD).normalize(), LY = LZD.clone().cross(LX), snapV = new V3();
function snapShadow(p) {
    const c = sun.shadow.camera, texel = (c.right - c.left) / sun.shadow.mapSize.x;
    const a = Math.round(p.dot(LX) / texel) * texel, b = Math.round(p.dot(LY) / texel) * texel;
    snapV.copy(LX).multiplyScalar(a).addScaledVector(LY, b).addScaledVector(LZD, p.dot(LZD));
    sun.target.position.copy(snapV);
    sun.position.copy(snapV).addScaledVector(LZD, 160);
}
const camDir = new V3(), camGoal = new V3(), camPos = new V3();
let camD = 20;
let baseFov = camera.fov;
function updateCamera(dt) {
    const t = performance.now() / 1000;
    // follow mode: while you run (and haven't just dragged the view) the camera eases in behind you
    if (camFollow && P.moving && !P.climbing && clockT - cam.dragT > 1.2) {
        const behind = P.facing + Math.PI;
        let d = behind - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        cam.yaw += d * Math.min(1, dt * 2.2);
    }
    cam.target.lerp(camGoal.set(P.pos.x, P.pos.y + 5, P.pos.z), 1 - Math.exp(-dt * 16));
    const cp = Math.cos(cam.pitch);
    camDir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    const camWant = Math.max(2.5, rayHit(cam.target, camDir, cam.dist) - 0.8);
    camD = camWant < camD ? camWant : camD + (camWant - camD) * (1 - Math.exp(-dt * 3.5));
    camPos.copy(cam.target).addScaledVector(camDir, camD);
    camera.position.copy(camPos);
    camera.lookAt(cam.target);
    if (shake > 0.001) {
        const s = shake * shake * 0.9;
        camera.position.x += (Math.random() * 2 - 1) * s;
        camera.position.y += (Math.random() * 2 - 1) * s;
        shake = Math.max(0, shake - dt * 2.2);
    }
    const fovBase = innerWidth < innerHeight ? 85 : 70;
    const fast = tool() === 'speedCoil' || tool() === 'superCoil' || P.sprinting;
    const want = fovBase + (fast && P.moving ? 4 : 0) + (chaseLevel > 0.5 ? 3 : 0);
    baseFov += (want - baseFov) * Math.min(1, dt * 5);
    if (Math.abs(camera.fov - baseFov) > 0.01) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
    snapShadow(P.pos);
    updateSky(camera.position, t, dt);
    updateAmbient(camera.position, t, P.area < 0 ? { color: 0xd8b8ff, dir: 0.3 } : { color: 0xffffff, dir: 0.4 });
}

// Proximity prompts
let activePrompt = null, promptX = -1, promptY = -1;
const projV = new V3();
function updatePrompt() {
    let best = null, bd = Infinity;
    for (const p of nearPrompts) {
        const d = p.pos.distanceTo(P.pos);
        if (d < p.r && d < bd) { bd = d; best = p; }
    }
    activePrompt = best;
    if (!best || anyPopup()) { promptEl.hidden = true; return; }
    projV.copy(best.pos).setY(best.pos.y + 2).project(camera);
    if (projV.z > 1) { promptEl.hidden = true; return; }
    promptEl.hidden = false;
    const px = Math.round((projV.x + 1) / 2 * innerWidth), py = Math.round((1 - projV.y) / 2 * innerHeight);
    if (px !== promptX || py !== promptY) { promptX = px; promptY = py; promptEl.style.transform = `translate(${px}px, ${py}px) translate(-50%, -110%)`; }
    const txt = best.label();
    if (promptTxtEl.textContent !== txt) promptTxtEl.textContent = txt;
}
function usePrompt() { if (activePrompt) activePrompt.act(); }
promptEl.addEventListener('click', usePrompt);

// Controller: popups first, then gameplay
let padJumpWas = false;
function padButtons() {
    if (pad.jump && !padJumpWas && running) pressJump();
    padJumpWas = pad.jump;
    const p = pad.pressed;
    if (!p.size) return;
    if (p.has('B') && closeTop()) return;
    if (!running) return;
    if (p.has('X')) { if (activePrompt) usePrompt(); else useTool(true); }
    if (p.has('Y')) openModal('store');
    if (p.has('LB') || p.has('RB')) {
        const list = hotbarTools();
        if (list.length) {
            const i = list.indexOf(S.tool);
            const n = list[((i < 0 ? (p.has('RB') ? -1 : 0) : i) + (p.has('RB') ? 1 : -1) + list.length) % list.length];
            actions.equip(n);
        }
    }
    if (p.has('BACK')) openModal('teleport');
    if (p.has('START')) openModal('config');
    if (p.has('UP')) cam.dist = clamp(cam.dist - 4, 6, 50);
    if (p.has('DOWN')) cam.dist = clamp(cam.dist + 4, 6, 50);
}
onGamepadConnection((g, on) => { if (running) toast(on ? '🎮 Controller connected' : '🎮 Controller disconnected', on ? '#7dff6b' : '#ffb51c'); if (on) camFollow = true; });

// =====================================================================================
// Main update
// =====================================================================================
const botInput = { f: 0, r: 0, jump: false, sprint: false };
let qaWalk = 0, qaNoHazards = false;
let clockT = 0, hudT = 0, metaT = 20, chaseLevel = 0;
const tmpF = new V3(), tmpR = new V3(), mv = new V3();
function surfaceSound(m) {
    return { wood: 'wood', stone: 'stud', wall: 'stud', floor: 'stud', truss: 'truss', ice: 'ice', glass: 'tile', grass: 'grass', snow: 'snow', carpet: 'carpet', metal: 'metal', tile: 'tile', slime: 'slime', lava: 'stud' }[m] || 'stud';
}
function footStep(g) { surfStep(surfaceSound(g.mat), false); if (g.slime && Math.random() < 0.5) splash(P.pos, 0x8aff4a, 3, 0.6); }
function land(g, hard) {
    surfStep(surfaceSound(g.mat), true);
    dust(P.pos, hard ? 10 : 5, hard ? 1.3 : 0.9);
    if (hard) ring(P.pos, 0xffffff, 4, 0.35);
    P.squashV -= hard ? 8 : 4;
}
function update(dt) {
    clockT += dt;
    const t = clockT;
    let f = botInput.f, r = botInput.r;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    f -= touchMove.y + pad.ly; r += touchMove.x + pad.lx;
    cam.yaw -= pad.rx * 2.8 * dt;
    cam.pitch = clamp(cam.pitch + pad.ry * 1.8 * dt, -0.5, 1.3);
    if (Math.abs(pad.rx) + Math.abs(pad.ry) > 0.1) cam.dragT = clockT;
    tmpF.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    tmpR.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    mv.set(0, 0, 0).addScaledVector(tmpF, f).addScaledVector(tmpR, r);
    if (mv.lengthSq() > 1) mv.normalize();
    if (anyPopup() && !isTouch) mv.set(0, 0, 0);
    if (clockT < frozenUntil) mv.set(0, 0, 0);
    P.moving = mv.lengthSq() > 0.01;
    const jumpHeld = keys.Space || touchJump || pad.jump || botInput.jump;
    const shiftHeld = keys.ShiftLeft || keys.ShiftRight;

    updateWorld(dt, t, P.area, P.pos);
    updateHeads(dt, t, net.now(), P.area >= 0 ? P.pos : null);
    for (const v of heads.views) if (v.thump && v.root.visible && camera.position.distanceToSquared(v.root.position) < 3600) dust(v.root.position, 4, 1.3, 0xd8d0c8);

    const id = tool();
    const wantSprint = P.moving && (shiftHeld || sprintToggle || pad.sprint || botInput.sprint);
    P.sprinting = wantSprint && P.sprint > 0.02;
    P.sprint = clamp(P.sprint + (P.sprinting ? -dt / CFG.sprintSecs : dt / CFG.sprintRecharge), 0, 1);
    if (P.shieldT > 0) P.shieldT = Math.max(0, P.shieldT - dt);
    const ws = walkSpeed();
    const g = gravity();

    // ----- vertical: jump, climb, jetpack, glide -----
    const truss = trussTouching();
    if (truss) {
        const cx = clamp(P.pos.x, truss.min.x, truss.max.x) - P.pos.x, cz = clamp(P.pos.z, truss.min.z, truss.max.z) - P.pos.z;
        const l = Math.hypot(cx, cz) || 1;
        const into = mv.lengthSq() > 0.01 ? (mv.x * cx + mv.z * cz) / l / Math.sqrt(mv.lengthSq()) : 0;
        if (into > 0.25 || (P.climbing && into > -0.4 && !P.onGround)) { if (!P.climbing) P.climbT = 0; P.climbing = truss; }
        else P.climbing = null;
    } else P.climbing = null;
    const pressed = t - P.jumpPress < 0.2;
    if (P.onGround) { P.coyote = 0.1; P.jumps = 0; P.fuel = CFG.jetFuel; } else P.coyote -= dt;
    P.jetting = false; P.gliding = false;
    if (P.climbing) {
        P.climbT += dt;
        P.vel.y = P.moving ? CFG.climb : 0;
        if (pressed) { P.vel.y = jumpV() * 0.85; P.climbing = null; P.jumpPress = -9; sfx('jump'); }
    } else {
        if (pressed && clockT >= frozenUntil && (P.onGround || P.coyote > 0)) {
            P.vel.y = jumpV(); P.onGround = false; P.coyote = 0; P.jumpPress = -9; P.ground = null;
            sfx('jump'); P.squashV += 5;
        } else if (pressed && !P.onGround && P.coyote <= 0 && id === 'wings' && P.jumps < 1) {
            // Angel Wings: a second jump in mid-air
            P.jumps++; P.vel.y = jumpV() * 0.9; P.jumpPress = -9;
            sfx('flap'); ring(P.pos, 0xffffff, 4, 0.35); dust(P.pos, 8, 0.8, 0xffffff);
        }
        P.vel.y -= g * dt;
        // the Jetpack: hold Jump in the air to thrust up (it can't lift you over the maze walls)
        if (id === 'jetpack' && jumpHeld && !P.onGround && P.fuel > 0 && P.pos.y < P.lastGroundY + 13) {
            P.fuel -= dt; P.jetting = true;
            P.vel.y += (CFG.jetLift - P.vel.y) * Math.min(1, dt * 7);
            flame(new V3(P.pos.x - Math.sin(P.facing) * 1.1, P.pos.y + 1.5, P.pos.z - Math.cos(P.facing) * 1.1), 0.4, 1, new V3(0, -14, 0));
        }
        // the Angel Wings: hold Jump while falling to glide
        if (id === 'wings' && jumpHeld && P.vel.y < CFG.wingsFall) { P.vel.y = CFG.wingsFall; P.gliding = true; }
    }
    loopSound('jet', P.jetting ? 1 : 0);

    // ----- horizontal: instant on most floors, slippery on ice, knockback on top -----
    const tx = mv.x * ws, tz = mv.z * ws;
    const ice = P.ground && P.ground.ice;
    if (ice || (P.onIce && !P.onGround)) {
        const k = 1 - Math.exp(-dt * (P.onGround ? 2.6 : 2.2));
        P.hv.x += (tx - P.hv.x) * k; P.hv.z += (tz - P.hv.z) * k;
    } else P.hv.set(tx, 0, tz);
    if (P.onGround) P.onIce = !!ice;
    const vx = P.hv.x + P.kv.x, vz = P.hv.z + P.kv.z;
    P.kv.multiplyScalar(Math.exp(-dt * (P.onGround ? 9 : 1.6)));

    const dist = Math.max(Math.abs(vx), Math.abs(vz), Math.abs(P.vel.y)) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.5));
    const sdt = dt / n;
    const wasOn = P.onGround;
    P.onGround = false; P.ground = null;
    let vy = P.climbing || P.jetting ? P.vel.y : P.vel.y + 0.5 * g * dt;
    for (let i = 0; i < n; i++) {
        moveAxis('x', vx * sdt); moveAxis('z', vz * sdt);
        const before = P.vel.y;
        moveAxis('y', vy * sdt);
        if (P.vel.y !== before) vy = P.vel.y;
    }
    if (!P.onGround && wasOn && P.vel.y <= 0 && !P.climbing) groundProbe(0.7);
    else if (!P.onGround && P.vel.y <= 0 && !P.climbing) groundProbe(0.05);

    // ----- landing and what you're standing on -----
    if (P.onGround) {
        const gr = P.ground;
        if (P.airTime > 0.25 && gr) land(gr, P.airTime > 0.8);
        P.airTime = 0; P.peakY = P.pos.y;
        P.lastGroundY = P.pos.y;
        if (gr && gr.lava && !qaNoHazards && clockT >= frozenUntil && P.shieldT <= 0) burn();
        // the maze walls are electrified on top: you're zapped back down
        if (gr && gr.wall && clockT - P.zapT > 0.4) zap(gr);
    } else {
        P.airTime += dt;
        P.peakY = Math.max(P.peakY, P.pos.y);
    }
    if (P.climbing || P.jetting) { P.airTime = 0; P.peakY = P.pos.y; }

    // facing
    if (P.moving && mv.lengthSq() > 0.01 && !P.climbing) P.facing = lerpAngle(P.facing, Math.atan2(mv.x, mv.z), 1 - Math.exp(-dt * 14));
    else if (P.climbing) {
        const c = P.climbing, cx = clamp(P.pos.x, c.min.x, c.max.x) - P.pos.x, cz = clamp(P.pos.z, c.min.z, c.max.z) - P.pos.z;
        if (Math.hypot(cx, cz) > 0.01) P.facing = lerpAngle(P.facing, Math.atan2(cx, cz), 1 - Math.exp(-dt * 10));
    }

    // ----- where you are -----
    const here = stageAt(P.pos.x, P.pos.y, P.pos.z);
    if (here !== null && here !== P.area) enterArea(here);
    if (P.pos.y < -30) { respawn(true); toast('😵 You fell out of the world!', '#ffd28a'); }
    for (const tr of nearTriggers) {
        const inside = overlapsBox(tr, P.pos);
        if (inside && !tr.inside && tr.enter) tr.enter();
        tr.inside = inside;
    }
    checkPickups();
    checkCaught();
    // standing on the EXIT pad keeps knocking (the server may want a moment longer)
    if (S.run && P.area === S.run.s && clockT - exitT > 2.5) { const m = MAZES[P.area]; if (Math.abs(P.pos.x - m.exitPad.x) < 6 && Math.abs(P.pos.z - m.exitPad.z) < 4.5 && P.pos.y < 6) actions.exit(P.area); }
    // the Guide's arrows run out
    if (timers.guideUntil && Date.now() > timers.guideUntil) { timers.guideUntil = 0; setGuide(-9, false); }

    // ----- being chased: the heartbeat, the red edges, the music -----
    let chased = 0, dirA = 0;
    if (P.area >= 0 && heads.chasing) {
        let bd = Infinity;
        heads.views.forEach((v, k) => {
            if (!(heads.chasing & (1 << k))) return;
            const hp = headPos(k);
            if (!hp) return;
            const d = Math.hypot(hp.x - P.pos.x, hp.z - P.pos.z);
            if (d < bd) { bd = d; dirA = Math.atan2(hp.x - P.pos.x, hp.z - P.pos.z); }
        });
        if (bd < Infinity) chased = clamp(1 - (bd - 8) / 50, 0.15, 1);
    }
    chaseLevel += (chased - chaseLevel) * Math.min(1, dt * 4);
    setHeartbeat(chaseLevel);
    setChase(chaseLevel, dirA - (cam.yaw + Math.PI));
    setMusicIntensity(P.area < 0 ? 0 : chaseLevel > 0.4 ? 3 : chaseLevel > 0.05 ? 2 : 1);

    if (S.name && headLabel) {
        const key = S.name + '|' + !!S.morph;
        if (key !== nameLabelText) { nameLabelText = key; headLabel.userData.set(nameLines(S.name, S.morph)); }
    }
    updateEffects(dt);
    updateFx(dt);
    for (const fn of tickers) fn(dt, t);
    syncRemotes(dt, t);
    friendsT -= dt; friendSyncT -= dt;
    if (friendsT <= 0) { friendsT = 30; friendSyncT = 5; refreshFriends(); }
    else if (friendSyncT <= 0) { friendSyncT = 5; syncFriends(); }

    // ----- the local character -----
    if (rig) {
        const u = rig.userData;
        rig.position.copy(P.pos);
        rig.rotation.y = P.facing;
        setMorph(rig, S.morph);
        setTool(rig, S.morph ? '' : id); setHat(rig, S.morph ? '' : S.hat); setTrail(rig, S.trail);
        const hs = P.moving ? ws : 0;
        P.animPhase += dt * (P.onGround ? Math.min(18, 4 + hs * 0.3) : P.climbing && P.vel.y > 0 ? 9 : 0);
        if (u.morph) { u.morph.root.updateMatrixWorld(); u.morph.animate(dt, t, P.moving ? 1 : 0, hs, null); }
        else {
            if (P.climbing) climbPose(u.body, P.animPhase);
            else if (!P.onGround) airPose(u.body);
            else if (P.moving) animRig(u.body, P.animPhase, 0.85);
            else animRig(u.body, 0, 0);
            const handTool = u.held && u.held.userData.slot === 'hand';
            if (handTool && !P.climbing) holdPose(u.body);
            if (P.slapAnim > 0) P.slapAnim = Math.max(0, P.slapAnim - dt);
            const slapK = P.slapAnim > 0 ? 1 - P.slapAnim / 0.28 : 0;
            if (localAvatar) { localAvatar.update(dt, { moving: P.moving && P.onGround, air: !P.onGround && !P.climbing, vy: P.climbing ? 0 : P.vel.y, speed: hs, t, pose: P.climbing ? 'climb' : undefined, hold: !!handTool, slap: slapK }); followBones(u); }
            if (u.held && u.held.userData.slot === 'back' && id === 'wings') u.held.rotation.z = P.gliding ? 0 : Math.sin(t * 3) * 0.05;
        }
        u.trail.update(trailAt(rig), (P.moving || !P.onGround) && !u.morph, dt, t);
        const stepN = Math.floor(P.animPhase / Math.PI);
        if (P.onGround && P.moving && stepN !== P.lastStepN && P.ground) footStep(P.ground);
        if (P.climbing && stepN !== P.lastStepN && P.vel.y > 0) surfStep('truss', false);
        P.lastStepN = stepN;
        const own = !localAvatar;
        const runBob = own && P.onGround && P.moving && !P.climbing ? Math.abs(Math.sin(P.animPhase)) * 0.18 : 0;
        u.pivot.position.y = PIVOT + runBob;
        const leanTo = P.climbing || !own ? 0 : P.onGround && P.moving ? Math.min(0.2, ws * 0.007) : !P.onGround ? -0.06 : 0;
        P.lean = (P.lean || 0) + (leanTo - (P.lean || 0)) * Math.min(1, dt * 9);
        u.pivot.rotation.set(P.lean, 0, 0);
        P.squashV += (1 - P.squash) * 180 * dt;
        P.squashV *= Math.exp(-12 * dt);
        P.squash = clamp(P.squash + P.squashV * dt, 0.72, 1.28);
        const sq = own ? P.squash : 1;
        rig.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
        setBubble(rig, 'shield', P.shieldT > 0 || timers.noDmgUntil > Date.now());
        setBubble(rig, 'invis', timers.invisUntil > Date.now());
    }
    const fastNow = Math.hypot(P.hv.x + P.kv.x, P.hv.z + P.kv.z);
    setSpeedLines(!reduceMotion && fastNow > 25 && P.moving ? Math.min(0.7, (fastNow - 25) * 0.05 + 0.25) : 0, dt);
    const toolKey = id + '|' + anyPopup();
    if (toolKey !== lastToolKey) {
        lastToolKey = toolKey;
        $('#crosshair').hidden = !(id === 'rocket' && !isTouch && !anyPopup());
        $('#useBtn').hidden = !(isTouch && (HITTERS[id] || id === 'potion'));
        $('#useBtn').textContent = gearById[id] ? gearById[id].ic : '🖐️';
    }
    setSprintMeter(P.sprint, P.sprinting, sprintToggle);
    sendMove(false);
    updatePrompt();
    animateCounters(dt);
    hudT -= dt;
    if (hudT <= 0) {
        hudT = 0.1;
        updateHud(P.area);
        setGuideLine(guideLine());
        setStatusChips({ jump: timers.jumpUntil, shield: timers.noDmgUntil, guide: timers.guideUntil, invis: timers.invisUntil, fuel: id === 'jetpack' ? P.fuel / CFG.jetFuel : -1 });
    }
    metaT -= dt;
    if (metaT <= 0) { metaT = 30; net.send('meta', { touch: isTouch, fps: lastFps }); }
}
let lastToolKey = '', lastFps = 60;
// The line at the top: what to do next
function guideLine() {
    if (S.morph) return P.area < 0 ? '😡 You are the HEAD! Go through a stage door and catch players' : '😡 Catch the players in this maze! (+' + CFG.scareCoins + ' Coins each)';
    if (P.area < 0) {
        const next = STAGES.findIndex((s, i) => i !== BOSS && stageOpen(S, i) && S.cleared[i] === undefined);
        if (next >= 0) return '🚪 Go through the Stage ' + (next + 1) + ' door: ' + STAGES[next].name + '!';
        if (stageOpen(S, BOSS) && S.cleared[BOSS] === undefined) return '👑 The BOSS door is open! Defeat the Angry Queen!';
        return '🏆 You escaped everything! Replay a stage for more Coins';
    }
    const s = STAGES[P.area], need = s.keys;
    if (!S.run) return '🎉 You escaped! Next stage, or back to the lobby?';
    if (need && keyState.got.size < need) return '🔑 Find the key' + (need > 1 ? 's' : '') + ' (' + keyState.got.size + '/' + need + '), then the EXIT!';
    if (chaseLevel > 0.3) return '😱 RUN! A head is after you!';
    return '🏃 Find the EXIT! Don\'t let the heads catch you';
}
// Lava: back to the checkpoint
function burn() {
    if (clockT - P.deathT < 1.5) return;
    P.deathT = clockT;
    flash('#ff6a1a', 600); sfx('burn'); addShake(0.6); rumble(0.7, 250);
    splash(P.pos, 0xff6a1a, 22, 1.4);
    toast('🌋 LAVA! Back to your checkpoint', '#ff8a5a');
    net.send('caught', { lava: 1 });
    respawn(true);
}
// The electrified wall tops: bzzt, and you're knocked back down into the corridor
function zap(w) {
    P.zapT = clockT;
    const cx = (w.min.x + w.max.x) / 2, cz = (w.min.z + w.max.z) / 2;
    const thinX = w.max.x - w.min.x < w.max.z - w.min.z;
    const sx = thinX ? (Math.sign(P.pos.x - cx) || 1) : 0, sz = thinX ? 0 : (Math.sign(P.pos.z - cz) || 1);
    P.kv.set(sx * 34, 0, sz * 34); P.vel.y = 18; P.onGround = false;
    sfx('zap'); flash('#9ae8ff', 300); addShake(0.4);
    zapFx(P.pos.clone().add(new V3(0, 3, 0)), P.pos.clone().add(new V3(sx * 3, 0.5, sz * 3)));
    if (clockT - (P.zapToastT || -9) > 4) { P.zapToastT = clockT; toast('⚡ The wall tops are electrified!', '#9ae8ff'); }
}

// =====================================================================================
// Boot
// =====================================================================================
let frameErrors = 0;
let lastFrame = 0, loadingSignaled = false, fpsAcc = 0, fpsFrames = 0, showFps = false, skipOdd = false, oddFrame = false;
const fpsWatch = { t: 0, low: 0 };
function watchFps(fps) {
    if (!running || document.hidden || !autoQualityAllowed()) return;
    fpsWatch.t += 0.5;
    if (fpsWatch.t < 2) return;
    fpsWatch.low = fps < 40 ? fpsWatch.low + 0.5 : 0;
    if (fpsWatch.low < 2.5) return;
    fpsWatch.low = 0;
    const next = { high: 'medium', medium: 'low' }[getQuality()];
    if (!next) return;
    setQuality(next, true);
    toast('⚙️ Graphics set to ' + (next === 'medium' ? 'Medium' : 'Low') + ' for smoother play', '#7de8ff');
}
function frame(now) {
    requestAnimationFrame(frame);
    // phones with 120 Hz screens: a steady 60 (cooler, no throttling later)
    if (skipOdd) { oddFrame = !oddFrame; if (oddFrame) return; }
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    fpsAcc += (now - (lastFrame || now)) / 1000; fpsFrames++;
    if (fpsAcc >= 0.5) {
        const fps = fpsFrames / fpsAcc;
        lastFps = Math.round(fps);
        if (showFps) $('#fps').textContent = lastFps + ' FPS';
        if (isTouch && !skipOdd && fps > 100) skipOdd = true;
        watchFps(fps); fpsAcc = 0; fpsFrames = 0;
    }
    lastFrame = now;
    if (!loadingSignaled) { loadingSignaled = true; BX.triggerAllSettings(); }
    pollGamepad();
    padButtons();
    if (running) {
        try { update(dt); updateCamera(dt); render(); } catch (e) {
            if (frameErrors++ < 5) console.error('[frame]', e);
        }
    }
}

let joining = false, joinTask = null, worldReady = null;
async function joinServer() {
    const endpointTask = serverEndpoint();
    endpointTask.catch(() => {});
    await waitForLogin(400);
    const saved = (storageGet('eah_name') || '').slice(0, 20);
    for (let attempt = 0; ; attempt++) {
        try { return await connect(BX.identity().loggedIn ? '' : saved, attempt === 0 ? await endpointTask : null); } catch (e) {
            if (attempt >= 4) throw e;
            console.warn('[join] attempt', attempt + 1, 'failed:', e && e.message);
            $('#loading').textContent = 'Waking up a server…';
            await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
        }
    }
}
async function play() {
    if (joining || running) return;
    joining = true;
    const err = $('#connectErr'), retry = $('#playBtn');
    err.hidden = true; retry.hidden = true;
    $('#loading').hidden = false;
    if (!joinTask) joinTask = joinServer();
    initAudio();
    try { await worldReady; } catch (e) { console.error(e); }
    // Straight into the lobby: a server that nobody has played on for a while takes a few seconds to
    // wake up, and you can look round meanwhile (the doors and the shop wait for it: see net.send)
    awaitServer();
    joining = false;
    running = true;
    S.joinedAt = Date.now();
    startMusic();
    $('#start').hidden = true;
    $('#hud').hidden = false;
    $('#touch').hidden = !isTouch;
    if (!rig) buildPlayer(0, 0);
    teleport(SPAWN, SPAWN_YAW);
    P.shieldT = CFG.spawnShield;
    cam.target.set(P.pos.x, P.pos.y + 5, P.pos.z);
    showTips();
    toast('😱 Welcome to ESCAPE ANGRY HEAD! Follow the green arrows to Stage 1', '#ffffff');
    setTimeout(() => { if (audioSuspended()) toast('🔊 Click or tap anywhere for the sound!', '#7de8ff'); }, 3500);
    canvas.focus();
    BX.loadingEnd();
}
async function awaitServer() {
    const chip = $('#chipNet');
    if (!net.room) chip.hidden = false;
    try {
        const room = await joinTask;
        const me = room.state.players && room.state.players.get(room.sessionId);
        S.name = me ? me.name : S.name;
        sendMove(true);
    } catch (e) {
        console.error(e);
        joinTask = null;
        $('#offlineTitle').textContent = 'Could not reach the game server';
        $('#offline').hidden = false;
    }
    chip.hidden = true;
}
// Things that need the server: until it's there, say so instead of silently doing nothing
const NEEDS_SERVER = new Set(['enter', 'buy', 'code', 'gift', 'daily', 'morph', 'hat', 'limited', 'trail', 'revive']);
const sendRaw = net.send.bind(net);
let waitToastT = 0;
net.send = (type, msg) => {
    if (!net.room && NEEDS_SERVER.has(type)) {
        if (performance.now() - waitToastT > 2000) { waitToastT = performance.now(); toast('⏳ Connecting to the game server… one moment!', '#7de8ff'); }
        return;
    }
    sendRaw(type, msg);
};
function waitForLogin(ms) {
    if (!BX.bloxity.ready || BX.identity().loggedIn) return Promise.resolve();
    return new Promise((res) => {
        const t0 = performance.now();
        (function check() { if (BX.identity().loggedIn || performance.now() - t0 > ms) res(); else setTimeout(check, 100); })();
    });
}
function showTips() {
    const el = $('#tips');
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    el.innerHTML = isTouch
        ? '<span>Joystick to move · JUMP · drag to look · walk into trusses to climb · RUN from the heads!</span>'
        : pad.connected
            ? k('L', 'Move') + k('A', 'Jump') + k('X', 'Use') + k('LB/RB', 'Tools') + k('R', 'Camera')
            : k('WASD', 'Move') + k('Space', 'Jump') + k('Shift', 'Sprint') + k('Click / E', 'Use') + k('1-9', 'Tools') + k('Drag', 'Camera');
    el.hidden = false; el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 10000);
    setTimeout(() => { el.hidden = true; }, 10900);
}
function unlockAudioOnGesture() {
    const unlock = () => {
        resumeAudio();
        if (!audioSuspended()) for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) removeEventListener(ev, unlock, true);
    };
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) addEventListener(ev, unlock, true);
}
function wirePortalSettings() {
    const embedded = (fn) => (v) => { if (BX.isEmbedded()) fn(v); };
    const pct = (v) => { const n = parseFloat(String(v)); if (!isFinite(n)) return undefined; return clamp(n > 1 ? n / 100 : n, 0, 1); };
    BX.listenSetting('master_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('master', p); }));
    BX.listenSetting('music_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('music', p); }));
    BX.listenSetting('graphics_quality', embedded((v) => setQuality(v === 'Low' ? 'low' : v === 'Medium' ? 'medium' : 'high', true)));
    BX.listenSetting('camera_sensitivity', embedded((v) => { camSens = clamp(parseFloat(v) || 1, 0.1, 5); }));
    BX.listenSetting('show_fps', (v) => { showFps = v === 'true'; $('#fps').hidden = !showFps; });
}
function wirePortalEvents() {
    BX.onPortalEvent((event, data) => {
        if (event === 'respawn_request') { if (running) respawn(true); }
        else if (event === 'chat_message_sent' && data) net.send('chat', { text: String(data) });
        else if (event === 'play_emote' && data) { playEmoteOn(localAvatar, String(data)); net.send('emote', { id: String(data) }); }
    });
    BX.onAvatarChanged(() => syncMyAvatar());
    BX.onProportionsChanged(() => syncMyAvatar());
}

// ----- build the world and warm up the GPU while the loading screen is up -----
const pause = () => new Promise((r) => setTimeout(r, 0));
async function prepareWorld() {
    const step = (t) => { $('#loading').textContent = t; BX.loadingStep(t); };
    step('Loading fonts…');
    try { await Promise.race([Promise.all([document.fonts.load('700 40px Fredoka'), document.fonts.load('800 40px Montserrat')]), new Promise((r) => setTimeout(r, 1200))]); } catch (e) { /* fallback font */ }
    step('Building the lobby…');
    // the lobby and Stage 1 now; every other maze when you first go into it (see ensureStage)
    await buildWorld(pause, [0]);
    refreshNear(-1);
    step('Preparing graphics…');
    camera.position.set(SPAWN.x, 12, SPAWN.z - 20); camera.lookAt(SPAWN.x, 4, SPAWN.z + 10); camera.updateMatrixWorld();
    // stand-ins for the warm-up: the player model, the bubbles, every tool and hat, one of each
    // head, a rocket and one of each effect. Never disposed (that keeps their shaders alive).
    const extras = [fxWarmGroup(), lazyStandIns()];
    for (const m of [shieldMat, invisMat]) { const b = new T.Mesh(shieldGeo, m); b.position.copy(SPAWN); extras.push(b); }
    const blocky = buildRig({ ...KITS[0], skin: SKINS[0] }); blocky.position.copy(SPAWN); extras.push(blocky);
    for (const gid of Object.keys(gearById)) { const h = heldModel(gid); h.position.copy(SPAWN); extras.push(h); }
    for (const hid of Object.keys(hatById)) { const h = hatModel(hid); h.position.copy(SPAWN); extras.push(h); }
    // every head shares one shader: a plain one and the see-through ghost cover them all (the other
    // types' meshes are built when a maze with them is first entered)
    for (const ht of ['normal', 'ghost']) { const v = new HeadView(ht); v.root.position.copy(SPAWN); extras.push(v.root); }
    const rk = new T.Mesh(rocketGeo, rocketMat); rk.position.copy(SPAWN); extras.push(rk);
    try {
        const base = await Promise.race([loadBase(), new Promise((r) => setTimeout(r, 4000))]);
        const a = base ? await createAvatar(null) : null;
        if (a) {
            a.root.position.copy(SPAWN);
            a.update(1 / 60, { t: 0 });
            extras.push(a.root, avatarVariants(a.root));
        }
    } catch (e) { /* the player model's shaders compile when it first shows instead */ }
    for (const o of extras) scene.add(o);
    fxShowAll(true);
    warmScare();
    await warmUp(renderer, camera, pause, [scareScene]);
    render();
    warmScareDone();
    fxShowAll(false);
    for (const o of extras) scene.remove(o);
    console.info('[prewarm] ready,', renderer.info.programs.length, 'shaders');
}
function avatarVariants(root) {
    const tex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    const g = new T.Group();
    g.position.copy(SPAWN);
    let sk = null;
    root.traverse((c) => { if (!sk && c.isSkinnedMesh) sk = c; });
    if (sk) {
        const s = new T.SkinnedMesh(sk.geometry, new T.MeshLambertMaterial({ map: tex }));
        s.bind(sk.skeleton, sk.bindMatrix);
        s.castShadow = true; s.receiveShadow = true;
        g.add(s);
    }
    const m = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.1), new T.MeshLambertMaterial({ map: tex }));
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return g;
}
async function boot() {
    BX.initBloxity();
    document.documentElement.style.setProperty('--head', `url("${headIconUrl()}")`);
    setOverlay(scareScene, scareActive);
    joinTask = joinServer();
    joinTask.catch(() => {});
    loadBase().catch(() => {});
    worldReady = prepareWorld();
    wirePortalSettings();
    wirePortalEvents();
    BX.onIdentity((id) => {
        if (net.room && id.loggedIn && id.token && !net.bloxity) net.send('auth', { token: id.token });
        if (net.room) { setupLocalAvatar(); syncMyAvatar(); }
    });
    addEventListener('pagehide', () => { try { if (net.room) net.room.leave(true); } catch (e) { /* closing anyway */ } });
    $('#playBtn').addEventListener('click', play);
    $('#reconnectBtn').addEventListener('click', () => location.reload());
    unlockAudioOnGesture();
    requestAnimationFrame(frame);
    play();
}
boot();

// Dev-only hooks for automated QA runs (stripped from production builds)
if (import.meta.env.DEV || import.meta.env.VITE_QA) {
    window.__qa = {
        audio: () => audioDebug(), input: (o) => Object.assign(botInput, o), jump: () => pressJump(), solids, cam, P, S, scene, camera, net, renderer: () => renderer, heads,
        teleport: (x, y, z, yaw) => teleport(new V3(x, y, z), yaw || 0),
        walk: (n) => { qaWalk = n; }, near: () => nearBoxes.length, quality: (q) => setQuality(q),
        noHazards: (on) => { qaNoHazards = !!on; },
        sim: (secs, f, jumpEvery) => { for (let i = 0; i < Math.round(secs * 60); i++) { if (jumpEvery && i % jumpEvery === 0) pressJump(); botInput.f = f || 0; update(1 / 60); } botInput.f = 0; return window.__qa.state(); },
        walkTo: (x, z, secs) => {
            for (let i = 0; i < Math.round((secs || 4) * 60); i++) {
                const dx = x - P.pos.x, dz = z - P.pos.z;
                if (Math.hypot(dx, dz) < 0.8) break;
                cam.yaw = Math.atan2(dx, dz) + Math.PI;
                botInput.f = 1; update(1 / 60);
            }
            botInput.f = 0;
            return window.__qa.state();
        },
        look: (yaw, pitch, dist) => { cam.yaw = yaw; cam.pitch = pitch; cam.dist = dist; cam.dragT = clockT + 999; },
        face: (yaw) => { cam.yaw = yaw + Math.PI; P.facing = yaw; },
        state: () => ({ x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), onGround: P.onGround, ground: P.ground && P.ground.mat, vy: +P.vel.y.toFixed(2), area: P.area, run: S.run, coins: S.coins, climbing: !!P.climbing, tool: S.tool, chase: +chaseLevel.toFixed(2), caughtT: P.deathT }),
        tool: (id) => { S.gear[id] = true; actions.equip(id); },
        frame: () => { updateCamera(1 / 60); render(); },
        step: (n) => { for (let i = 0; i < n; i++) update(1 / 60); return window.__qa.state(); },
        enter: (i, k) => net.send('enter', { i, k: k || 0 }),
        rig: () => rig, avatar: () => setupLocalAvatar(), mazes: MAZES, checkpoints: CHECKPOINTS, keys: KEYS, coins: COINS,
        scare: (type) => { jumpscare(type || 'normal', 1300); showHaha(); },
        // An autopilot that plays the stage you're in, in real time: through the maze to each key,
        // then the EXIT (re-planning from wherever it is, e.g. after being caught)
        autoplay: (on, evade) => { auto.on = !!on; auto.evade = !!evade; auto.log = []; auto.stuck = 0; botInput.f = 0; botInput.sprint = !!on; return auto; },
        auto: () => auto,
        keysGot: () => [...keyState.got].join(','),
    };
}
// ----- the QA autopilot (dev builds only) -----
const auto = { on: false, wp: [], k: 0, planT: 0, stuck: 0, last: new V3(), log: [] };
if (import.meta.env.DEV || import.meta.env.VITE_QA) import('../../shared/maze.js').then((mz) => {
    tickers.push((dt) => {
        if (!auto.on || !running) return;
        const a = P.area;
        if (a < 0) { botInput.f = 0; return; }
        const m = MAZES[a];
        auto.planT -= dt;
        if (auto.planT <= 0 || auto.k >= auto.wp.length) {
            auto.planT = 1;
            // where to: the next key you haven't got, else the exit
            const key = KEYS.find((q) => q.s === a && !keyState.got.has(q.id));
            const goalCell = key ? key.cell : m.exit;
            let here = mz.cellAt(m, P.pos.x, P.pos.z);
            const wp = [];
            const ec = mz.cellCenter(m, m.exit), inExitRoom = here < 0 && P.pos.z > m.z1;
            if (inExitRoom && !key) wp.push([m.exitPad.x, m.exitPad.z]);
            else {
                if (inExitRoom) { wp.push([ec.x, m.z1 + 3]); here = m.exit; }
                else if (here < 0) { const c = mz.cellCenter(m, m.start); wp.push([c.x, m.z0 - 4], [c.x, c.z]); here = m.start; }
                const { prev } = mz.bfs(m, goalCell);
                for (let c = here; c >= 0; c = prev[c]) { const p = mz.cellCenter(m, c); wp.push([p.x, p.z]); if (c === goalCell) break; }
                if (!key) wp.push([ec.x, m.z1 + 3], [m.exitPad.x, m.exitPad.z]);
            }
            auto.wp = wp; auto.k = 0;
        }
        // a head hunting it close by: run to the cell (within a few steps) farthest from the head,
        // a safe room if there's one near, then carry on
        if (auto.evade && heads.chasing) {
            let hp = null, bd = Infinity;
            heads.views.forEach((v, k) => { if (heads.chasing & (1 << k)) { const q = headPos(k); if (q) { const d = Math.hypot(q.x - P.pos.x, q.z - P.pos.z); if (d < bd) { bd = d; hp = q; } } } });
            // only when it's on the stretch of route just ahead (one behind, or beside it through a wall, is outrun)
            let inWay = false;
            if (hp) {
                let ax = P.pos.x, az = P.pos.z;
                for (let j = auto.k; j < Math.min(auto.wp.length, auto.k + 3) && !inWay; j++) {
                    const [bx, bz] = auto.wp[j], vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
                    const u = Math.max(0, Math.min(1, ((hp.x - ax) * vx + (hp.z - az) * vz) / L2));
                    if (Math.hypot(ax + vx * u - hp.x, az + vz * u - hp.z) < 9) inWay = true;
                    ax = bx; az = bz;
                }
            }
            if (hp && inWay && bd < 24 && auto.evadeT <= 0) {
                auto.evadeT = 0.7;
                const here = mz.cellAt(m, P.pos.x, P.pos.z);
                if (here >= 0) {
                    const { dist, prev } = mz.bfs(m, here);
                    let best = here, bs = -1;
                    for (let c = 0; c < dist.length; c++) {
                        if (dist[c] < 0 || dist[c] > 5) continue;
                        const p = mz.cellCenter(m, c), away = Math.hypot(p.x - hp.x, p.z - hp.z), score = away + (m.safe[c] ? 60 : 0) - dist[c] * 2;
                        if (score > bs) { bs = score; best = c; }
                    }
                    const wp = [];
                    for (let c = best; c >= 0 && c !== here; c = prev[c]) { const p = mz.cellCenter(m, c); wp.unshift([p.x, p.z]); }
                    if (wp.length) { auto.wp = wp; auto.k = 0; auto.planT = 1.2; }
                }
            }
        }
        auto.evadeT = (auto.evadeT || 0) - dt;
        // like a player: in a safe room, wait (up to 12 s) while a head is close outside
        if (auto.evade && mz.isSafe(m, P.pos.x, P.pos.z)) {
            let close = false;
            heads.views.forEach((v, k) => { const q = headPos(k), d = q ? Math.hypot(q.x - P.pos.x, q.z - P.pos.z) : 99; if (d < 16 || (d < 36 && mz.lineClear(m, P.pos.x, P.pos.z, q.x, q.z))) close = true; });
            if (!close) auto.waitT = 0;
            else if ((auto.waitT = (auto.waitT || 0) + dt) < 12) { botInput.f = 0; return; }
        } else auto.waitT = 0;
        const t = auto.wp[auto.k];
        if (!t) return;
        const dx = t[0] - P.pos.x, dz = t[1] - P.pos.z;
        if (Math.hypot(dx, dz) < 1.6) { auto.k++; return; }
        cam.yaw = Math.atan2(dx, dz) + Math.PI; cam.dragT = clockT;
        botInput.f = 1;
        // stuck on something: jump, and side-step round it (one way twice, then the other)
        auto.strafeT = (auto.strafeT || 0) - dt;
        botInput.r = auto.strafeT > 0 ? auto.side : 0;
        if (P.pos.distanceTo(auto.last) < 0.05 * dt * 60) {
            auto.stuck += dt;
            if (auto.stuck > 0.5) {
                pressJump(); auto.stuck = 0;
                auto.nStuck = (auto.nStuck || 0) + 1; auto.side = (auto.nStuck >> 1) % 2 ? 1 : -1; auto.strafeT = 0.7;
                auto.log.push('stuck@' + P.pos.x.toFixed(0) + ',' + P.pos.z.toFixed(0));
            }
        } else auto.stuck = 0;
        auto.last.copy(P.pos);
    });
});
