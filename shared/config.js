// Game data shared by the client and the Colyseus server.
// Escape Angry Head: run through twelve haunted mazes (and the BOSS's throne room) while giant
// screaming heads hunt you down. Reach the EXIT to escape a stage and unlock the next one. Get
// caught and it's a "HAHA!" jumpscare and back to your checkpoint. Coins buy gear (coils, jetpack,
// wings, slaps...), hats, the Angry Head morph and boosts. There are no in-app purchases: every
// price is in Coins.

export const CFG = {
    // Roblox defaults: jump power 50, gravity 196.2 (a jump rises about 6.4 studs)
    grav: 196.2,
    jumpV: 50,
    walk: 18,
    maxPlayers: 24,
    climb: 14,                 // truss climbing speed
    // Sprint: faster for a few seconds, then it recharges
    sprint: 1.38,
    sprintSecs: 4,
    sprintRecharge: 3,
    spawnShield: 3,            // after a respawn the heads can't catch you for a moment
    reviveSecs: 8,             // how long the "Keep going?" card stays up after you're caught
    friendBoost: 0.1,
    friendMax: 5,
    boostMinutes: 15,
    // A stage clear only pays when the run took at least this share of the stage's par time
    // (stops a teleporting cheat, never a fast player)
    minRunShare: 0.12,
    firstClearMult: 2,         // the first escape of each stage pays double
    pickupCoins: 1,            // every coin lying in a maze
    keyCoins: 5,               // picking up a stage's key
    // Gear
    speedCoil: 1.35,
    gravityCoil: 0.55,
    superSpeed: 1.25,
    superGrav: 0.68,
    jetFuel: 1.5,              // seconds of thrust, refills on the ground
    jetLift: 30,               // studs/s up while thrusting
    wingsFall: -10,            // the slowest you fall while gliding (studs/s)
    scytheSpeed: 1.12,
    stunSecs: 3.2,             // a slapped / rocketed / slashed head is dazed
    slapRange: 11,
    slapCooldown: 5,
    rocketRange: 70,
    rocketCooldown: 7,
    scytheRange: 12,
    scytheCooldown: 4,
    potionSecs: 8,
    potionCooldown: 40,
    // Products
    jumpBoost: 1.6,
    jumpBoostSecs: 60,
    noDamageSecs: 60,
    guideSecs: 45,
    // Morph: catching someone as the Angry Head pays this (once per victim every scareGap seconds)
    scareCoins: 5,
    scareGap: 20,
    // Limited items unlock for free after this much total playtime (or buy them now)
    scytheMinutes: 20,
    potionMinutes: 35,
};

// ----- the heads -----
// r: radius (studs). Speeds are multiples of the stage's chase speed; sight: how far they see down
// a corridor (line of sight); hear: how close you can be before they notice you anyway.
export const HEAD_TYPES = {
    normal: { name: 'Angry Head', r: 4.2, chase: 1, wander: 8.5, sight: 46, hear: 15, skin: 0xf2c4a0, hair: 0xf0d27a, hairDark: 0xc8a050 },
    fast: { name: 'Furious Head', r: 3.7, chase: 1.28, wander: 10, sight: 40, hear: 13, burst: 3.6, rest: 1.8, skin: 0xff9a7a, hair: 0x3a2418, hairDark: 0x1a0e08 },
    giant: { name: 'Giant Head', r: 5.6, chase: 0.86, wander: 7, sight: 64, hear: 20, skin: 0xe8b890, hair: 0xb8b8c0, hairDark: 0x7a7a88 },
    ghost: { name: 'Ghost Head', r: 4.2, chase: 0.4, wander: 6, sight: 70, hear: 70, ghost: true, skin: 0x9ad8ff, hair: 0xd8f4ff, hairDark: 0x7ab8e8 },
    boss: { name: 'THE ANGRY QUEEN', r: 6.4, chase: 0.95, wander: 9, sight: 999, hear: 999, boss: true, skin: 0xf2b494, hair: 0xffd848, hairDark: 0xd09a18 },
};

// ----- the stages -----
// cols x rows: maze size in cells. speed: the heads' chase speed (you walk at 18). heads: who
// hunts this maze. coins: what escaping pays (x2 the first time). par: seconds a good run takes.
// key: the EXIT is locked until you find the golden key(s). hazard: the floor trap this maze adds.
export const THEMES = {
    basement: { name: 'Basement', wall: 'concrete', wallC: 0xc6c9d2, floor: 'stud', floorC: 0x9ea2ad, trim: 0x55585f, accent: 0xb4232e, mood: 'basement' },
    storage: { name: 'Storage', wall: 'planks', wallC: 0xd2a26a, floor: 'concrete', floorC: 0xa8a49a, trim: 0x6a4a2a, accent: 0x3a7ad8, mood: 'storage' },
    sewer: { name: 'Sewers', wall: 'brick', wallC: 0x8aa088, floor: 'stud', floorC: 0x6c7e6a, trim: 0x3a4a38, accent: 0x7aff4a, mood: 'sewer' },
    boiler: { name: 'Boiler Room', wall: 'metal', wallC: 0xc8865a, floor: 'grate', floorC: 0x8a8a92, trim: 0x4a3020, accent: 0xff5a1a, mood: 'boiler' },
    library: { name: 'Library', wall: 'books', wallC: 0xffffff, floor: 'carpet', floorC: 0xb03a3a, trim: 0x5a3018, accent: 0xffc848, mood: 'library' },
    hospital: { name: 'Hospital', wall: 'tiles', wallC: 0xe2f2ea, floor: 'tiles', floorC: 0xc8dcd4, trim: 0x3a8a6a, accent: 0x3affb0, mood: 'hospital' },
    kitchen: { name: 'Kitchen', wall: 'subway', wallC: 0xe8f0ff, floor: 'checker', floorC: 0xffffff, trim: 0x2a4a8a, accent: 0xff4a6a, mood: 'kitchen' },
    playroom: { name: 'Playroom', wall: 'toys', wallC: 0xffffff, floor: 'stud', floorC: 0x6ad0ff, trim: 0xff4ab0, accent: 0xffd028, mood: 'playroom' },
    graveyard: { name: 'Graveyard', wall: 'hedge', wallC: 0x62a650, floor: 'grass', floorC: 0x6e9c5a, trim: 0x2a3a22, accent: 0xb08aff, mood: 'graveyard' },
    ice: { name: 'Ice Cave', wall: 'ice', wallC: 0xb8e6ff, floor: 'snow', floorC: 0xe8f6ff, trim: 0x4a8ac8, accent: 0x6ae8ff, mood: 'ice' },
    lava: { name: 'Lava Dungeon', wall: 'stone', wallC: 0x6a5a5a, floor: 'stone', floorC: 0x5a4a48, trim: 0x2a1a18, accent: 0xff6a1a, mood: 'lava' },
    attic: { name: 'Attic', wall: 'wallpaper', wallC: 0xd8c8b0, floor: 'planks', floorC: 0xb08a5a, trim: 0x4a3018, accent: 0xff8a2a, mood: 'attic' },
    throne: { name: 'Throne Room', wall: 'stone', wallC: 0x8a6ab8, floor: 'marble', floorC: 0xe8e0f0, trim: 0x3a1a5a, accent: 0xffd028, mood: 'throne' },
};
const STAGE_LIST = [
    // name, theme, icon, cols, rows, speed, heads, coins, par, extras
    ['Basement', 'basement', '🧱', 8, 8, 12.5, ['normal', 'normal'], 15, 70, {}],
    ['Storage Rooms', 'storage', '📦', 9, 9, 13, ['normal', 'normal', 'normal'], 20, 90, { bridge: true }],
    ['The Sewers', 'sewer', '🧪', 9, 10, 13.5, ['normal', 'normal', 'normal'], 30, 100, { hazard: 'slime', bridge: true }],
    ['Boiler Room', 'boiler', '🔥', 10, 10, 14, ['normal', 'normal', 'fast'], 40, 115, { bridge: true }],
    ['Haunted Library', 'library', '📚', 10, 11, 14.5, ['normal', 'normal', 'normal', 'fast'], 55, 130, { bridge: true }],
    ['Abandoned Hospital', 'hospital', '🏥', 11, 11, 15, ['normal', 'normal', 'fast', 'ghost'], 70, 145, { bridge: true, key: true }],
    ['Creepy Kitchen', 'kitchen', '🍳', 11, 12, 15.25, ['normal', 'normal', 'fast', 'fast'], 90, 160, { hazard: 'slime', bridge: true }],
    ['Toy Playroom', 'playroom', '🧸', 12, 12, 15.5, ['normal', 'normal', 'fast', 'giant'], 110, 175, { bridge: true, key: true }],
    ['Midnight Graveyard', 'graveyard', '🪦', 12, 13, 15.75, ['normal', 'normal', 'fast', 'ghost', 'giant'], 135, 190, { bridge: true }],
    ['Frozen Ice Cave', 'ice', '🧊', 13, 13, 16, ['normal', 'normal', 'normal', 'fast', 'giant'], 160, 205, { hazard: 'ice', bridge: true, key: true }],
    ['Lava Dungeon', 'lava', '🌋', 13, 14, 16.25, ['normal', 'normal', 'fast', 'fast', 'giant', 'ghost'], 190, 220, { hazard: 'lava', bridge: true }],
    ['The Attic', 'attic', '🕯️', 14, 14, 16.5, ['normal', 'normal', 'normal', 'fast', 'fast', 'giant', 'ghost'], 230, 240, { bridge: true, key: true }],
    ['BOSS: The Throne', 'throne', '👑', 11, 11, 16, ['boss', 'normal', 'fast', 'ghost'], 400, 160, { key: true, keys: 3, open: 0.3, boss: true }],
];
export const BOSS = STAGE_LIST.length - 1;
// The BOSS door opens once you've escaped this many stages
export const BOSS_UNLOCK = 6;
export const STAGES = STAGE_LIST.map(([name, theme, ic, cols, rows, speed, heads, coins, par, x], i) => ({
    i, name, theme, ic, cols, rows, speed, heads, coins, par,
    bridge: !!x.bridge, key: !!x.key, keys: x.keys || (x.key ? 1 : 0), hazard: x.hazard || null, open: x.open || 0.1, boss: !!x.boss,
    diff: i === BOSS ? 'BOSS' : i < 2 ? 'EASY' : i < 5 ? 'MEDIUM' : i < 8 ? 'HARD' : i < 11 ? 'EXTREME' : 'INSANE',
}));
export const DIFFS = {
    EASY: { label: 'EASY', color: '#46e85a' },
    MEDIUM: { label: 'MEDIUM', color: '#ffc828' },
    HARD: { label: 'HARD', color: '#ff8a2a' },
    EXTREME: { label: 'EXTREME', color: '#ff3a4a' },
    INSANE: { label: 'INSANE', color: '#c84aff' },
    BOSS: { label: 'BOSS', color: '#ff2a6a' },
};
export const clearedCount = (p) => Object.keys((p && p.cleared) || {}).filter((k) => +k < BOSS).length;
// Can this player go into stage i? (Stage 1 always; the next after each escape; the BOSS after BOSS_UNLOCK escapes)
export function stageOpen(p, i) {
    if (i === 0) return true;
    if (i === BOSS) return clearedCount(p) >= BOSS_UNLOCK;
    return !!(p && p.cleared && p.cleared[i - 1]);
}

// ----- tools: one in your hand at a time (the hotbar shows what you own) -----
export const GEAR = [
    { id: 'speedCoil', name: 'Speed Coil', desc: 'Run 35% faster: outrun the heads!', ic: '🌀', color: 0xff3a4a, price: 25 },
    { id: 'gravityCoil', name: 'Gravity Coil', desc: 'Floaty, high jumps', ic: '🪐', color: 0x3a8aff, price: 60 },
    { id: 'slap', name: 'Troll Slap', desc: 'Slap a head away (it\'s dazed for 3s) or slap players', ic: '🖐️', color: 0xffe0c8, price: 120 },
    { id: 'jetpack', name: 'Jetpack', desc: 'Hold Jump to fly up! Refills on the ground', ic: '🚀', color: 0xff5a2a, price: 200 },
    { id: 'wings', name: 'Angel Wings', desc: 'Glide down slowly and jump again in mid-air', ic: '🪽', color: 0xf0f6ff, price: 350 },
    { id: 'superCoil', name: 'Super Coil', desc: 'Run faster AND jump higher', ic: '💫', color: 0xa84aff, price: 700 },
    { id: 'rocket', name: 'Rocket Launcher', desc: 'Blast a head from far away (dazed for 3s)', ic: '🎯', color: 0x4ac83a, price: 1200 },
    { id: 'scythe', name: 'Scythe', desc: 'LIMITED: slash heads away and run a little faster', ic: '⚔️', color: 0xa84aff, price: 2500, limited: 'scytheMinutes' },
    { id: 'potion', name: 'Invisibility Potion', desc: 'LIMITED: drink it and the heads can\'t see you for 8s', ic: '🧪', color: 0x6a4aff, price: 3000, limited: 'potionMinutes' },
];
export const gearById = Object.fromEntries(GEAR.map((d) => [d.id, d]));
export const TOOLS = GEAR.map((g) => g.id);
// Tools that hit heads: range, cooldown
export const HITTERS = {
    slap: { range: CFG.slapRange, cooldown: CFG.slapCooldown },
    rocket: { range: CFG.rocketRange, cooldown: CFG.rocketCooldown },
    scythe: { range: CFG.scytheRange, cooldown: CFG.scytheCooldown },
};

// ----- hats: wear one; each multiplies the Coins you earn -----
export const HATS = [
    { id: 'pumpkin', name: 'Pumpkin Hat', desc: 'x1.1 Coins', mult: 1.1, price: 100, ic: '🎃', color: 0xff8a1a },
    { id: 'mask', name: 'Angry Mask', desc: 'x1.25 Coins (and you look like THEM)', mult: 1.25, price: 400, ic: '😡', color: 0xf2c4a0 },
    { id: 'valkyrie', name: 'Valkyrie Helm', desc: 'x1.5 Coins', mult: 1.5, price: 1000, ic: '🪖', color: 0xd8dce8 },
    { id: 'dominus', name: 'Dominus', desc: 'x2 Coins', mult: 2, price: 2500, ic: '🎩', color: 0x2a2a3a },
];
export const hatById = Object.fromEntries(HATS.map((d) => [d.id, d]));

// ----- the Coins shop -----
// Passes are owned forever; products can be bought again. Every price is in Coins.
export const PASSES = {
    Morph: { name: 'Become the Angry Head', price: 100, ic: '😡', desc: 'Turn into a giant Angry Head and catch other players (+' + CFG.scareCoins + ' Coins each)!' },
    DoubleCoins: { name: 'x2 Coins', price: 5000, ic: '💰', desc: 'Double Coins forever' },
};
for (const g of GEAR) PASSES['G_' + g.id] = { name: g.name, price: g.price, ic: g.ic, desc: g.desc, tool: g.id };
for (const h of HATS) PASSES['H_' + h.id] = { name: h.name, price: h.price, ic: h.ic, desc: h.desc, hat: h.id };
export const PRODUCTS = {
    JumpBoost: { name: 'Jump Higher [1 min]', price: 15, ic: '🦘', desc: 'Jump 60% higher for a minute' },
    NoDamage: { name: 'No Damage [1 min]', price: 40, ic: '🛡️', desc: 'The heads can\'t catch you for a minute' },
    Guide: { name: 'Guide Arrows [45s]', price: 20, ic: '🧭', desc: 'Glowing arrows show the way to the EXIT' },
    CoinBoost: { name: 'x2 Coins [15 min]', price: 150, ic: '⏱️', desc: 'Double Coins for 15 minutes' },
};
export const passForTool = (toolId) => 'G_' + toolId;
export const passForHat = (hatId) => 'H_' + hatId;
export const priceOf = (kind, key) => ((kind === 'pass' ? PASSES : PRODUCTS)[key] || {}).price;
// Revive ("Keep going?"): back to where you were caught, for a few Coins
export const revivePrice = (stage) => Math.max(3, Math.round(3 + Math.max(0, stage ?? 0) * 2.5));

// ----- trails (Coins) -----
export const TRAILS = [
    { id: 'starter', name: 'Sparkle', price: 0, color: 0xf0f6ff },
    { id: 'slime', name: 'Slime', price: 40, color: 0x7aff4a },
    { id: 'blood', name: 'Blood Moon', price: 120, color: 0xff2a3a },
    { id: 'pumpkin', name: 'Pumpkin', price: 300, color: 0xff8a1a },
    { id: 'ghost', name: 'Ghostly', price: 700, color: 0x9ad8ff },
    { id: 'spooky', name: 'Spooky Purple', price: 1500, color: 0xa84aff },
    { id: 'gold', name: 'Golden', price: 4000, color: 0xffd028 },
    { id: 'rainbow', name: 'Rainbow', price: 9000, color: 0xff5ad8, rainbow: true },
];
export const trailById = Object.fromEntries(TRAILS.map((d) => [d.id, d]));

// ----- playtime gifts (minutes played this session) -----
export const GIFTS = [
    { min: 1, coins: 5 }, { min: 3, coins: 10 }, { min: 5, coins: 15 }, { min: 8, coins: 20 }, { min: 12, coins: 30 },
    { min: 15, boost: true }, { min: 20, coins: 50 }, { min: 25, coins: 60 }, { min: 30, coins: 80 }, { min: 45, coins: 120 }, { min: 60, coins: 200 },
];
// ----- daily rewards (7-day streak) -----
export const DAILY = [
    { coins: 10 }, { coins: 20 }, { coins: 30 }, { boost: true }, { coins: 60 }, { coins: 100 }, { coins: 200, hat: 'pumpkin' },
];
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export function dailyStatus(d, now) {
    const today = dayKey(now), yest = dayKey(now - 86400000);
    if (!d || !d.last) return { can: true, day: 0, streak: 0 };
    if (d.last === today) return { can: false, day: d.streak % 7, streak: d.streak };
    const streak = d.last === yest ? d.streak : 0;
    return { can: true, day: streak % 7, streak };
}
export const rewardText = (r) => [
    r.coins ? '+' + fmt(r.coins) + ' Coins' : '',
    r.boost ? '15 min x2 Coins' : '',
    r.hat ? 'the ' + hatById[r.hat].name : '',
].filter(Boolean).join(' + ');

export const CODES = {
    ANGRY: { coins: 25 },
    HEAD: { coins: 40 },
    ESCAPE: { coins: 50 },
    LEGION: { coins: 100 },
    BLOXITY: { coins: 30 },
    RELEASE: { boost: true },
};

// Coins multiplier: x2 Coins pass, x2 boost, the hat you wear, Friend Boost
export function coinMult(p, now, friends) {
    let m = 1;
    if (p.passes && p.passes.DoubleCoins) m *= 2;
    if ((p.boostUntil || 0) > now) m *= 2;
    const h = hatById[p.hat];
    if (h && p.hats && p.hats[h.id]) m *= h.mult;
    m *= 1 + CFG.friendBoost * Math.min(CFG.friendMax, friends || 0);
    return m;
}
// Limited items: free once you've played long enough in total
export const limitedFree = (g, playtime) => !!(g && g.limited && (playtime || 0) >= CFG[g.limited] * 60 - 5);

// Player outfits for the blocky fallback body (cycle by join order); the reference's black suit first
export const KITS = [
    { shirt: 0x1c1c22, shorts: 0x24242c, socks: 0xffffff, hair: 0x8a4a1a },
    { shirt: 0x3ac8ff, shorts: 0x2a2a4a, socks: 0xffffff, hair: 0xffd028 },
    { shirt: 0xff7ab0, shorts: 0x3a3a5a, socks: 0xffffff, hair: 0x3a2618 },
    { shirt: 0x6aff5a, shorts: 0x2a3a2a, socks: 0xffffff, hair: 0x3a2618 },
    { shirt: 0xffd028, shorts: 0x3a2a1a, socks: 0xffffff, hair: 0xb8541c },
    { shirt: 0xc45aff, shorts: 0x2a1a3a, socks: 0xffffff, hair: 0xff8ad8 },
];
export const SKINS = [0xf2c9a0, 0xe1af87, 0xc88c5f, 0x8c5a3c, 0xf0c8a0];

// ----- formatting -----
export function fmt(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    const u = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
    let i = 0, x = v;
    while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
    return (x >= 100 ? Math.floor(x) : Math.floor(x * 10) / 10) + u[i];
}
export const fmtComma = (v) => Math.floor(v || 0).toLocaleString('en-US');
export function clock(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}
export function playtimeText(s) {
    s = Math.floor(s || 0);
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
    return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function rngFrom(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
