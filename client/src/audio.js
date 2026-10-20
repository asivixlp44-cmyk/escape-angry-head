// Procedural soundtrack and sound effects (Web Audio, no asset files).
//
// Music, "Angry Head Chase": an original 128 BPM piece in A minor (Am - F - G - E, Am - F - Dm - E).
// It creeps in (a music box picking out the chords, pizzicato bass, a clock ticking, a low drone),
// stalks (a heartbeat kick, a wobbly theremin tune, an organ), then CHASES (four-on-the-floor kick,
// snare, hats, driving staccato strings, a plucky lead), breaks down to a ghostly choir and the
// music box, chases again an octave up and creeps back round; 64 bars. How much of it plays
// follows the game (setMusicIntensity): the lobby is gentle, a maze adds the stalking layers, a
// head after you brings the full chase in whatever section it is. A heartbeat thumps faster the
// closer a hunting head gets (setHeartbeat).
//
// Footsteps on every floor (concrete studs, planks, trusses, ice, grass, snow, carpet, metal grates,
// tiles, slime) and the effects: the heads' scream, their "HA-HA-HA!", growls, the stage sting,
// the creaky doors, keys, rockets and booms, slaps, the escape fanfare... all synthesized.

let ctx = null, master, comp, musicBus, musicOut, duckFilter, sfxBus, asmrBus, reverb, roomVerb, delay;
let noiseBuf = null, meter = null;
let musicOn = false, schedTimer = null, seqStep = 0, nextTime = 0, ducked = false;
const settings = { music: 0.5, sfx: 0.8, asmr: 0.9, master: 1, muted: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('eah_audio') || '{}')); } catch (e) { /* defaults */ }

const BPM = 128, STEP = 60 / BPM / 4;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [
    { root: 45, notes: [57, 60, 64] }, // Am
    { root: 41, notes: [57, 60, 65] }, // F
    { root: 43, notes: [55, 59, 62] }, // G
    { root: 40, notes: [56, 59, 64] }, // E
    { root: 45, notes: [57, 60, 64] }, // Am
    { root: 41, notes: [57, 60, 65] }, // F
    { root: 38, notes: [57, 62, 65] }, // Dm
    { root: 40, notes: [56, 59, 64] }, // E
];
// [step, midi, length] per bar
const THEREMIN = [
    [[0, 69, 6], [6, 72, 2], [8, 71, 4], [12, 69, 4]],
    [[0, 65, 6], [6, 69, 2], [8, 67, 4], [12, 65, 4]],
    [[0, 67, 4], [4, 71, 4], [8, 74, 6], [14, 72, 2]],
    [[0, 71, 8], [8, 68, 4], [12, 64, 4]],
    [[0, 76, 6], [6, 74, 2], [8, 72, 4], [12, 69, 4]],
    [[0, 72, 6], [6, 69, 2], [8, 65, 4], [12, 69, 4]],
    [[0, 74, 4], [4, 72, 4], [8, 69, 4], [12, 65, 4]],
    [[0, 68, 4], [4, 71, 4], [8, 76, 8]],
];
const LEAD = [
    [[0, 69, 2], [2, 72, 2], [4, 76, 2], [6, 72, 2], [8, 69, 2], [10, 72, 2], [12, 76, 1], [13, 77, 1], [14, 76, 2]],
    [[0, 77, 2], [2, 76, 2], [4, 72, 2], [6, 69, 2], [8, 65, 2], [10, 69, 2], [12, 72, 4]],
    [[0, 74, 2], [2, 71, 2], [4, 67, 2], [6, 71, 2], [8, 74, 2], [10, 79, 2], [12, 77, 2], [14, 74, 2]],
    [[0, 76, 4], [4, 71, 2], [6, 68, 2], [8, 64, 4], [12, 68, 2], [14, 71, 2]],
    [[0, 81, 2], [2, 79, 2], [4, 76, 2], [6, 72, 2], [8, 76, 2], [10, 72, 2], [12, 69, 4]],
    [[0, 77, 2], [2, 76, 2], [4, 77, 2], [6, 81, 2], [8, 79, 2], [10, 77, 2], [12, 76, 4]],
    [[0, 74, 2], [2, 77, 2], [4, 81, 2], [6, 77, 2], [8, 74, 2], [10, 72, 2], [12, 69, 2], [14, 72, 2]],
    [[0, 71, 2], [2, 68, 2], [4, 71, 2], [6, 74, 2], [8, 76, 6], [14, 75, 2]],
];
const SECTION = (bar) => {
    const b = bar % 64;
    if (b < 8) return 'creep';
    if (b < 16) return 'stalk';
    if (b < 32) return 'chase';
    if (b < 40) return 'break';
    if (b < 56) return 'chase2';
    return 'outro';
};
let intensity = 0, heart = 0, nextBeat = 0;
// 0 the lobby, 1 a maze, 2 a head after you, 3 a head right behind you
export function setMusicIntensity(k) { intensity = Math.max(0, Math.min(3, k | 0)); }
// 0..1: how close the hunting head is (the heartbeat speeds up)
export function setHeartbeat(k) { heart = Math.max(0, Math.min(1, k || 0)); }

export function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 1.0;
    comp.connect(master).connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 2048; master.connect(meter);
    musicBus = ctx.createGain();
    duckFilter = ctx.createBiquadFilter(); duckFilter.type = 'lowpass'; duckFilter.frequency.value = 20000; duckFilter.Q.value = 0.5;
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 9000; warm.Q.value = 0.3;
    musicOut = ctx.createGain();
    musicBus.connect(warm).connect(duckFilter).connect(musicOut).connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    asmrBus = ctx.createGain(); asmrBus.connect(comp);
    applyVolumes();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ir = (secs, decay) => {
        const len = ctx.sampleRate * secs, b = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const ch = b.getChannelData(c); for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
        return b;
    };
    // a big haunted hall for the music, a small room for the footsteps
    reverb = ctx.createConvolver(); reverb.buffer = ir(3.4, 2.6);
    const revGain = ctx.createGain(); revGain.gain.value = 0.38;
    reverb.connect(revGain).connect(musicBus);
    roomVerb = ctx.createConvolver(); roomVerb.buffer = ir(0.7, 3.5);
    const roomGain = ctx.createGain(); roomGain.gain.value = 0.25;
    roomVerb.connect(roomGain).connect(asmrBus);
    delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const dlf = ctx.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 2400;
    const dlGain = ctx.createGain(); dlGain.gain.value = 0.26;
    delay.connect(dlf).connect(fb).connect(delay);
    dlf.connect(dlGain).connect(musicBus);
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
    });
}
function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = settings.master ?? 1;
    musicOut.gain.setTargetAtTime(settings.muted ? 0 : settings.music * 1.6 * m * (ducked ? 0.6 : 1), t, 0.08);
    sfxBus.gain.setTargetAtTime(settings.sfx * m, t, 0.05);
    asmrBus.gain.setTargetAtTime((settings.asmr ?? 1) * 1.1 * m, t, 0.05);
}
function save() { try { localStorage.setItem('eah_audio', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
export function getVolumes() { return { ...settings }; }
export function setVolume(kind, v) { settings[kind] = Math.max(0, Math.min(1, v)); save(); applyVolumes(); }
export function toggleMusic() { settings.muted = !settings.muted; save(); applyVolumes(); return !settings.muted; }
export const musicMuted = () => !!settings.muted;
// Browsers keep audio off until a click or key press: every gesture retries until it's running
export function resumeAudio() { initAudio(); if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); if (ctx && !musicOn && wantMusic) startMusic(); }
const level = () => { if (!meter) return 0; const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a); let p = 0; for (const v of a) p = Math.max(p, Math.abs(v)); return +p.toFixed(3); };
export const audioDebug = () => ({ peak: level(), state: ctx && ctx.state, musicOn, settings: { ...settings }, intensity, heart });
export const audioSuspended = () => !ctx || ctx.state !== 'running';
// Menus open: the music goes muffled and a little quieter
export function setMusicDuck(on) {
    if (!ctx || on === ducked) return;
    ducked = on;
    duckFilter.frequency.setTargetAtTime(on ? 900 : 20000, ctx.currentTime, 0.12);
    applyVolumes();
}

// ----- building blocks -----
function env(g, t, a, peak, d, sustain, r, end) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    if (end) { g.gain.setValueAtTime(Math.max(0.0001, sustain), end); g.gain.exponentialRampToValueAtTime(0.0001, end + r); }
}
function noise(t, dur, type, freq, q, gain, out, freqEnd, attack) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 1;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || musicBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return { f, g };
}
function tone(t, type, f0, f1, dur, gain, out, attack) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfxBus); o.start(t); o.stop(t + dur + 0.05);
    return o;
}
function sub(t, n, dur, gain) {
    const g = ctx.createGain();
    env(g, t, 0.02, gain, dur * 0.5, gain * 0.6, 0.12, t + dur);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midi(n);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = midi(n); const g2 = ctx.createGain(); g2.gain.value = 0.2;
    o.connect(g); o2.connect(g2).connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + dur + 0.2); o2.start(t); o2.stop(t + dur + 0.2);
}
function kick(t, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.13);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.36);
    noise(t, 0.015, 'lowpass', 1400, 0.7, gain * 0.25, musicBus);
}
function snare(t, gain) {
    noise(t, 0.2, 'bandpass', 2000, 0.8, gain, musicBus, 1200);
    noise(t, 0.4, 'highpass', 4000, 0.5, gain * 0.35, reverb);
    tone(t, 'triangle', 200, 150, 0.08, gain * 0.5, musicBus);
}
function hat(t, gain, open) { noise(t, open ? 0.16 : 0.035, 'highpass', 7500, 0.8, gain, musicBus); }
function clap(t, gain) {
    for (let k = 0; k < 3; k++) noise(t + k * 0.011, 0.02, 'bandpass', 1400, 1.4, gain * (k === 2 ? 1 : 0.7), musicBus);
    noise(t + 0.03, 0.25, 'highpass', 3000, 0.5, gain * 0.25, reverb);
}
function pizz(t, n, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 2; f.frequency.setValueAtTime(2200, t); f.frequency.exponentialRampToValueAtTime(450, t + 0.22);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    f.connect(g); g.connect(musicBus); g.connect(reverb);
    for (const [type, a, k] of [['triangle', 1, 1], ['sawtooth', 0.35, 1.003]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(f); o.start(t); o.stop(t + 0.38);
    }
}
// A music box: a tiny bell with a tinny overtone, into the echo
function musicBox(t, n, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    g.connect(musicBus); g.connect(reverb); g.connect(delay);
    for (const [k, a] of [[1, 1], [3.01, 0.25], [6.2, 0.08]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * k * (1 + (Math.random() - 0.5) * 0.002); og.gain.value = a;
        o.connect(og).connect(g); o.start(t); o.stop(t + 1.15);
    }
}
// The theremin: a pure tone sliding up into each note with a wide, wobbly vibrato
let lastTheremin = 69;
function theremin(t, n, dur, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain(), vib = ctx.createOscillator(), vg = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(midi(lastTheremin), t); o.frequency.exponentialRampToValueAtTime(midi(n), t + 0.09);
    lastTheremin = n;
    vib.frequency.value = 6.2; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(midi(n) * 0.022, t + 0.25);
    vib.connect(vg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.06); g.gain.setValueAtTime(gain, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    o.connect(g); g.connect(musicBus); g.connect(reverb); g.connect(delay);
    o.start(t); o.stop(t + dur + 0.15); vib.start(t); vib.stop(t + dur + 0.15);
}
// A church organ chord, soft and dark
function organ(t, notes, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1500; f.Q.value = 0.6;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.15); g.gain.setValueAtTime(gain, t + dur * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    f.connect(g); g.connect(musicBus); g.connect(reverb);
    for (const n of notes) for (const [type, k, a] of [['square', 1, 0.18], ['sine', 2, 0.35], ['sine', 0.5, 0.4]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.35);
    }
}
// A ghostly choir: saws through two vowel formants ("ooh"), swelling slowly
function choir(t, notes, dur, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(musicBus); g.connect(reverb);
    for (const fq of [420, 820]) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = 6; bp.connect(g);
        for (const n of notes) for (const det of [-6, 6]) {
            const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det;
            o.connect(bp); o.start(t); o.stop(t + dur + 0.05);
        }
    }
}
// Driving staccato strings
function stab(t, n, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 1; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    f.connect(g); g.connect(musicBus);
    for (const det of [-9, 0, 9]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + 0.18); }
}
// A plucky lead: square and triangle an octave up through a snappy filter
function pluck(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(3600, t); f.frequency.exponentialRampToValueAtTime(700, t + Math.min(0.25, dur));
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(musicBus); g.connect(delay);
    for (const [k, type, a] of [[1, 'square', 0.5], [2, 'triangle', 0.6]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
}
function tick(t, hi, gain) { tone(t, 'sine', hi ? 2600 : 1900, null, 0.02, gain, musicBus); noise(t, 0.006, 'highpass', 6000, 1, gain * 0.6, musicBus); }
function tom(t, n, gain) { tone(t, 'sine', midi(n) * 2, midi(n), 0.22, gain, musicBus); noise(t, 0.03, 'lowpass', 1500, 0.8, gain * 0.3, musicBus); }
function riser(t, dur, gain) { noise(t, dur, 'bandpass', 500, 2, gain, musicBus, 6000, dur * 0.9); }

function playStep(s, t) {
    const bar = Math.floor(s / 16), i = s % 16, sec = SECTION(bar), b8 = bar % 8, ch = CHORDS[b8], k = intensity;
    const up = sec === 'chase2' ? 12 : 0;
    const chasing = k >= 2;
    // the drone under everything
    if (i === 0) sub(t, ch.root, STEP * 15, k ? 0.13 : 0.09);
    // the music box picks out the chord (all the time, quieter when the chase is on)
    if (i % 2 === 0 && (sec === 'creep' || sec === 'break' || sec === 'outro' || k <= 1 || i % 4 === 0)) {
        const arp = [0, 1, 2, 1, 2, 0, 1, 2][(i >> 1) % 8];
        musicBox(t, ch.notes[arp] + 24, (chasing ? 0.018 : 0.04) * (sec === 'break' ? 1.3 : 1));
    }
    // a clock ticking
    if ((sec === 'creep' || sec === 'outro' || k === 0) && i % 4 === 0) tick(t, i === 0, 0.03);
    // pizzicato bass on the beats
    if (i % 4 === 0 && sec !== 'break') pizz(t, (i === 8 ? ch.root + 19 : ch.root + 12) + (i === 12 ? 7 : 0), 0.15);
    const stalk = sec === 'stalk' || sec === 'outro' || (k >= 1 && sec !== 'break');
    const chase = chasing || sec === 'chase' || sec === 'chase2';
    if (sec === 'break') {
        if (i === 0) choir(t, ch.notes, STEP * 16, 0.035);
        if (i === 0 && b8 === 7) riser(t, STEP * 16, 0.05);
        return;
    }
    if (stalk && !chase) {
        // the heartbeat kick and the theremin's tune
        if (i === 0 || i === 3) kick(t, i === 0 ? 0.32 : 0.2);
        if (i === 8 || i === 11) kick(t, i === 8 ? 0.28 : 0.18);
        if (k >= 1 && i === 0) organ(t, ch.notes.map((n) => n - 12), STEP * 15, 0.035);
        for (const [at, n, len] of THEREMIN[b8]) if (at === i) theremin(t, n, STEP * len * 0.95, 0.06);
        if (k >= 1 && i % 4 === 2) hat(t, 0.018);
        return;
    }
    if (!chase) return;
    // THE CHASE: kick, snare, hats, strings, the lead
    const full = k >= 1 || sec === 'chase' || sec === 'chase2';
    if (i % 4 === 0) kick(t, 0.42);
    if (i === 4 || i === 12) { snare(t, 0.12); if (k >= 3) clap(t, 0.08); }
    if (i % 2 === 1) hat(t, k >= 2 ? 0.03 : 0.02, i === 7 || i === 15);
    if (full && i % 2 === 0) stab(t, ch.notes[(i >> 1) % 3] + up, k >= 2 ? 0.05 : 0.035);
    if (i === 0) organ(t, ch.notes.map((n) => n - 12), STEP * 15, 0.03);
    for (const [at, n, len] of LEAD[b8]) if (at === i) pluck(t, n + (sec === 'chase2' ? 12 : 0) - (k < 2 && sec !== 'chase2' ? 0 : 0), STEP * len * 0.9, k >= 2 ? 0.05 : 0.04);
    if (b8 === 7 && i >= 12) tom(t, 50 - (i - 12) * 2, 0.14);
    if (bar % 16 === 15 && i === 0) riser(t, STEP * 16, 0.045);
}
// the heartbeat: "lub-dub", faster and louder as the head closes in
function heartbeat(t) {
    const g = 0.3 + heart * 0.4;
    for (const [dt, f, a] of [[0, 62, 1], [0.13, 52, 0.7]]) {
        const o = ctx.createOscillator(), gg = ctx.createGain();
        o.frequency.setValueAtTime(f * 1.6, t + dt); o.frequency.exponentialRampToValueAtTime(f, t + dt + 0.08);
        gg.gain.setValueAtTime(0.0001, t + dt); gg.gain.exponentialRampToValueAtTime(g * a, t + dt + 0.01); gg.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.22);
        o.connect(gg).connect(sfxBus); o.start(t + dt); o.stop(t + dt + 0.25);
    }
}
function scheduler() {
    while (nextTime < ctx.currentTime + 0.2) {
        playStep(seqStep, nextTime);
        nextTime += STEP;
        seqStep++;
    }
    if (heart > 0.08 && settings.sfx > 0) {
        if (nextBeat < ctx.currentTime) nextBeat = ctx.currentTime + 0.05;
        while (nextBeat < ctx.currentTime + 0.2) { heartbeat(nextBeat); nextBeat += 1.05 - heart * 0.62; }
    }
}
let wantMusic = false;
export function startMusic() {
    wantMusic = true;
    if (!ctx || musicOn) return;
    musicOn = true;
    seqStep = 0; nextTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(scheduler, 30);
}
export function stopMusic() { musicOn = false; clearInterval(schedTimer); }

// =====================================================================================
// Footsteps
// =====================================================================================
const R = (a, b) => a + Math.random() * (b - a);
const ASMR = {
    // concrete studs: a crisp scuff with a hollow knock under it
    stud(t, k) {
        const p = R(0.9, 1.12);
        noise(t, 0.014, 'bandpass', 3200 * p, 1.6, 0.15 * k, asmrBus);
        noise(t + 0.004, 0.045, 'bandpass', 800 * p, 2, 0.16 * k, asmrBus);
        tone(t, 'triangle', 220 * p, 130 * p, 0.05, 0.11 * k, asmrBus, 0.003);
    },
    wood(t, k) {
        const p = R(0.9, 1.1);
        tone(t, 'triangle', 220 * p, 140 * p, 0.08, 0.17 * k, asmrBus, 0.002);
        noise(t, 0.03, 'bandpass', 900 * p, 3, 0.16 * k, asmrBus);
        tone(t + 0.004, 'sine', 480 * p, null, 0.05, 0.04 * k, asmrBus, 0.002);
        if (Math.random() < 0.2) { const o = tone(t + 0.03, 'sawtooth', R(300, 420), R(200, 260), 0.18, 0.012 * k, asmrBus, 0.05); void o; }
    },
    truss(t, k) {
        noise(t, 0.012, 'bandpass', R(2600, 3200), 2, 0.16 * k, asmrBus);
        tone(t, 'triangle', R(700, 860), null, 0.04, 0.05 * k, asmrBus);
    },
    ice(t, k) {
        for (let i = 0; i < 3; i++) noise(t + i * 0.012, 0.012, 'highpass', R(4000, 6000), 1, 0.07 * k, asmrBus);
        tone(t, 'sine', R(2300, 2700), null, 0.12, 0.025 * k, asmrBus, 0.002);
        noise(t, 0.04, 'lowpass', 700, 1, 0.1 * k, asmrBus);
    },
    grass(t, k) { noise(t, 0.09, 'highpass', R(3000, 4200), 0.8, 0.07 * k, asmrBus, 0, 0.02); noise(t, 0.05, 'lowpass', 500, 1, 0.14 * k, asmrBus); },
    snow(t, k) { for (let i = 0; i < 5; i++) noise(t + i * R(0.008, 0.016), 0.02, 'bandpass', R(900, 1800), 1.5, R(0.05, 0.09) * k, asmrBus); noise(t, 0.08, 'lowpass', 400, 1, 0.12 * k, asmrBus); },
    carpet(t, k) { noise(t, 0.07, 'lowpass', R(380, 480), 1, 0.26 * k, asmrBus, 0, 0.008); },
    metal(t, k) { noise(t, 0.02, 'bandpass', R(2200, 2800), 6, 0.14 * k, asmrBus); tone(t, 'sine', R(520, 620), null, 0.18, 0.05 * k, asmrBus, 0.002); tone(t, 'sine', R(1300, 1500), null, 0.12, 0.025 * k, asmrBus, 0.002); },
    tile(t, k) { noise(t, 0.022, 'bandpass', R(2300, 2900), 1.2, 0.12 * k, asmrBus); noise(t, 0.04, 'lowpass', 700, 1, 0.1 * k, asmrBus); },
    slime(t, k) {
        const p = R(0.85, 1.2);
        const sq = noise(t, 0.16, 'bandpass', 2400 * p, 3.5, 0.32 * k, asmrBus, 420 * p, 0.006);
        sq.g.connect(roomVerb);
        tone(t, 'sine', 150 * p, 62 * p, 0.1, 0.2 * k, asmrBus, 0.004);
        for (let i = 0; i < 2; i++) { const at = t + R(0.04, 0.2), f = R(650, 1400); tone(at, 'sine', f, f * 1.5, 0.035, R(0.05, 0.09) * k, asmrBus, 0.003); }
    },
};
export function step(surface, landing) {
    if (!ctx || (settings.asmr ?? 1) <= 0) return;
    const f = ASMR[surface] || ASMR.stud;
    f(ctx.currentTime + 0.004, landing ? 1.45 : 0.8);
}

// =====================================================================================
// Sound effects
// =====================================================================================
function springTone(t, f, dur, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * 0.7, t); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + dur * 0.35); o.frequency.exponentialRampToValueAtTime(f, t + dur);
    lfo.frequency.value = 28; lg.gain.value = f * 0.12; lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfxBus); o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
}
// A voice: a buzzy saw at pitch f (gliding to f2) through two vowel formants
function voice(t, f, f2, dur, gain, form1, form2, out) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 7; vg.gain.value = f * 0.03; vib.connect(vg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.setValueAtTime(gain, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [fq, q, a] of [[form1, 5, 1], [form2, 6, 0.7], [2600, 4, 0.25]]) {
        const bp = ctx.createBiquadFilter(), bg = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q; bg.gain.value = a;
        o.connect(bp).connect(bg).connect(g);
    }
    g.connect(out || sfxBus);
    o.start(t); o.stop(t + dur + 0.05); vib.start(t); vib.stop(t + dur + 0.05);
}
const SFX = {
    click(t) { tone(t, 'sine', 720, 1250, 0.05, 0.13); noise(t, 0.01, 'bandpass', 2400, 1, 0.08, sfxBus); },
    clickBuy(t) { tone(t, 'sine', 620, 1100, 0.05, 0.13); tone(t + 0.05, 'sine', 1100, 1650, 0.06, 0.1); },
    jump(t) { tone(t, 'sine', 330, 620, 0.09, 0.08); },
    coin(t) { tone(t, 'square', midi(88), null, 0.07, 0.05); tone(t + 0.07, 'square', midi(93), null, 0.22, 0.05); tone(t, 'sine', midi(100), null, 0.25, 0.05); },
    checkpoint(t) { [76, 79, 84, 88].forEach((n, i) => tone(t + i * 0.07, 'triangle', midi(n), null, 0.32, 0.12)); noise(t, 0.4, 'bandpass', 800, 1, 0.08, sfxBus, 6000, 0.05); },
    teleport(t) { for (let i = 0; i < 9; i++) tone(t + i * 0.028, 'sine', midi(74 + i * 3), null, 0.16, 0.06); noise(t, 0.35, 'bandpass', 600, 1.5, 0.08, sfxBus, 5000, 0.05); },
    buy(t) { [79, 84, 88, 91, 96].forEach((n, i) => tone(t + i * 0.05, 'sine', midi(n), null, 0.3, 0.14)); },
    denied(t) { tone(t, 'square', 220, 160, 0.14, 0.1); tone(t + 0.14, 'square', 180, 120, 0.18, 0.1); },
    whoosh(t) { noise(t, 0.4, 'bandpass', 300, 2, 0.3, sfxBus, 3000, 0.15); },
    slap(t) { noise(t, 0.05, 'bandpass', 1400, 0.8, 0.6, sfxBus); noise(t, 0.12, 'lowpass', 500, 1, 0.4, sfxBus); tone(t, 'sine', 160, 70, 0.12, 0.3); },
    slapped(t) { SFX.slap(t); springTone(t + 0.05, 300, 0.4, 0.12); },
    equip(t) { tone(t, 'triangle', midi(79), midi(84), 0.12, 0.1); noise(t, 0.04, 'bandpass', 3000, 2, 0.08, sfxBus); },
    firework(t) { tone(t, 'sine', 900, 200, 0.35, 0.05); noise(t + 0.35, 0.4, 'lowpass', 2500, 0.8, 0.28, sfxBus); },
    zap(t) { tone(t, 'square', 2200, 300, 0.18, 0.06); tone(t, 'sawtooth', 120, 90, 0.3, 0.08); noise(t, 0.25, 'bandpass', 3000, 2, 0.16, sfxBus, 800); },
    shield(t) { for (let i = 0; i < 6; i++) tone(t + i * 0.04, 'sine', midi(86 + i * 2), null, 0.25, 0.04); },
    pop(t) { tone(t, 'sine', 900, 1800, 0.06, 0.18); noise(t, 0.03, 'highpass', 2000, 1, 0.2, sfxBus); },
    flap(t) { noise(t, 0.12, 'lowpass', 900, 1, 0.3, sfxBus, 300, 0.02); noise(t + 0.13, 0.1, 'lowpass', 800, 1, 0.2, sfxBus, 300, 0.02); },
    // THE HEAD: a horrible scream (a voice shrieking up and wavering down, with a breathy rasp)
    scream(t) {
        voice(t, 380, 760, 0.35, 0.32, 900, 1400);
        voice(t + 0.3, 760, 300, 0.9, 0.3, 850, 1250);
        voice(t, 392, 790, 0.38, 0.12, 1000, 1600);
        noise(t, 1.1, 'bandpass', 2400, 1.2, 0.18, sfxBus, 1100, 0.04);
        tone(t, 'sine', 70, 40, 0.8, 0.4);
    },
    // "HA-HA-HA-HA!": a big mocking laugh, each "HA" a little lower
    haha(t) {
        for (let k = 0; k < 5; k++) {
            const at = t + k * 0.17, f = 260 - k * 14;
            noise(at, 0.05, 'bandpass', 1800, 1.5, 0.12, sfxBus);
            voice(at + 0.02, f * 1.15, f * 0.88, 0.14, 0.26, 780, 1250);
        }
    },
    // a head somewhere down the corridor spots you: a deep angry growl
    growl(t) {
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.8);
        f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 3;
        lfo.frequency.value = 22; lg.gain.value = 0.12; lfo.connect(lg).connect(g.gain);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
        o.connect(f).connect(g).connect(sfxBus); o.start(t); o.stop(t + 0.9); lfo.start(t); lfo.stop(t + 0.9);
        noise(t, 0.6, 'bandpass', 500, 2, 0.12, sfxBus, 250, 0.05);
    },
    // into a maze: a boom and a dissonant string cluster
    stageStart(t) {
        tone(t, 'sine', 80, 35, 1.4, 0.5);
        noise(t, 1.2, 'lowpass', 700, 0.8, 0.3, sfxBus, 90, 0.01);
        for (const n of [57, 58, 63, 64]) { const o = tone(t + 0.05, 'sawtooth', midi(n), midi(n) * 0.98, 1.6, 0.025, sfxBus, 0.25); void o; }
        SFX.growl(t + 0.4);
    },
    // ESCAPED!: a triumphant fanfare and a choir chord
    escape(t) {
        [69, 73, 76, 81, 76, 81, 85].forEach((n, i) => tone(t + i * 0.1, 'square', midi(n), null, 0.28, 0.06));
        [57, 61, 64, 69].forEach((n) => tone(t + 0.7, 'triangle', midi(n), null, 1.6, 0.07));
        noise(t + 0.7, 1.2, 'highpass', 3000, 0.6, 0.08, sfxBus);
        tone(t + 0.7, 'sine', 110, null, 1.4, 0.18);
    },
    // a creaky old door
    door(t) {
        const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter(), am = ctx.createOscillator(), ag = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(140, t); o.frequency.linearRampToValueAtTime(260, t + 0.5); o.frequency.linearRampToValueAtTime(180, t + 0.8);
        bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 5;
        am.frequency.value = 38; ag.gain.value = 0.06; am.connect(ag).connect(g.gain);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
        o.connect(bp).connect(g).connect(sfxBus); o.start(t); o.stop(t + 0.9); am.start(t); am.stop(t + 0.9);
    },
    key(t) { [84, 88, 91, 96, 100].forEach((n, i) => tone(t + i * 0.06, 'sine', midi(n), null, 0.5, 0.1)); tone(t, 'triangle', 600, 2400, 0.3, 0.05); },
    burn(t) { noise(t, 0.8, 'highpass', 2500, 0.6, 0.3, sfxBus, 6000, 0.01); tone(t, 'sawtooth', 200, 60, 0.4, 0.1); SFX.scream(t + 0.05); },
    rocket(t) { noise(t, 0.5, 'bandpass', 800, 1.5, 0.35, sfxBus, 3500, 0.02); tone(t, 'sawtooth', 120, 400, 0.4, 0.06); },
    boom(t) { tone(t, 'sine', 90, 30, 0.9, 0.55); noise(t, 1, 'lowpass', 1400, 0.8, 0.5, sfxBus, 80, 0.005); noise(t, 0.3, 'highpass', 2500, 0.6, 0.15, sfxBus); },
    slash(t) { noise(t, 0.22, 'bandpass', 2600, 4, 0.35, sfxBus, 6000, 0.01); tone(t + 0.05, 'triangle', 2400, 1800, 0.25, 0.05); },
    // a head dazed: a cartoon bonk and twinkling stars
    stun(t) { tone(t, 'triangle', 300, 110, 0.14, 0.25); noise(t, 0.04, 'bandpass', 800, 2, 0.25, sfxBus); for (let i = 0; i < 4; i++) tone(t + 0.15 + i * 0.08, 'sine', midi(96 - i * 3), null, 0.2, 0.05); },
    potion(t) { for (let i = 0; i < 4; i++) tone(t + i * 0.07, 'sine', 300 + i * 60, 200 + i * 40, 0.08, 0.12); for (let i = 0; i < 8; i++) tone(t + 0.3 + i * 0.04, 'sine', midi(84 + i * 2), null, 0.25, 0.04); },
    // turning into a head: a monster roar
    morph(t) { SFX.growl(t); voice(t + 0.1, 150, 110, 0.9, 0.22, 600, 1000); tone(t, 'sine', 60, 30, 1, 0.4); },
    reviveOffer(t) { [76, 81].forEach((n, i) => tone(t + i * 0.1, 'triangle', midi(n), null, 0.3, 0.08)); },
};
export function sfx(name) {
    if (!ctx || !SFX[name] || settings.sfx <= 0) return;
    SFX[name](ctx.currentTime + 0.005);
}

// ----- continuous sounds: the jetpack's thrust -----
const loops = {};
function makeLoop(kind) {
    const g = ctx.createGain(); g.gain.value = 0; g.connect(sfxBus);
    if (kind === 'jet') {
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.8;
        src.connect(f).connect(g); src.start();
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55; const og = ctx.createGain(); og.gain.value = 0.15;
        o.connect(og).connect(f); o.start();
    }
    return g;
}
export function loopSound(kind, lvl) {
    if (!ctx) return;
    if (!loops[kind]) { if (!lvl) return; loops[kind] = makeLoop(kind); }
    const vol = { jet: 0.22 }[kind] || 0.1;
    loops[kind].gain.setTargetAtTime((lvl || 0) * vol, ctx.currentTime, 0.06);
}
