// Local mirror of this player's progress. The server owns the real values:
// public stats arrive through the room state, private ones in "profile" messages.
export const S = {
    coins: 0, totalCoins: 0, escapes: 0, caught: 0, scares: 0, bossWins: 0, playtime: 0,
    cleared: {}, stage: -1, cp: 0, run: null,
    trails: { starter: true }, trail: 'starter', gear: {}, tool: '', hats: {}, hat: '', passes: {}, morph: false,
    boostUntil: 0, daily: null, codes: {},
    firstPlay: Date.now(), giftClaimed: {}, sessionSecs: 0, joinedAt: Date.now(), name: '', friends: 0,
    profileAt: Date.now(),
};

// Game actions that world objects (pads, doors, boards) trigger; filled in by main.js / ui.js
export const actions = {};

export const net = {
    room: null,
    offset: 0,
    send(type, msg) { if (this.room) this.room.send(type, msg || {}); },
    // Server clock in ms, so timers line up for everyone (QA runs can pin it)
    fixedNow: null,
    now() { return this.fixedNow ?? Date.now() + this.offset; },
};
