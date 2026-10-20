import { schema, t } from '@colyseus/schema';

// Public, synced to every client. Private progress (Coins history, gear, hats...) is sent only to
// its owner with the "profile" message. The heads aren't in here: each maze's heads go only to the
// players in that maze (the 'h' message, 20 times a second).
export const PlayerState = schema({
    name: t.string().default(''),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    ry: t.angle(),
    anim: t.uint8().default(0),     // 0 idle, 1 run, 2 air, 3 climb, 4 jetpack / glide
    area: t.int8().default(-1),     // -1 the lobby, else the stage they're in
    tool: t.string().default(''),   // the gear in hand
    hat: t.string().default(''),
    trail: t.string().default(''),
    morph: t.boolean().default(false), // playing as an Angry Head
    st: t.string().default(''),     // status everyone sees: n no damage (shield), i invisible
    escapes: t.uint16().default(0),
    friends: t.uint8().default(0),  // Friend Boost: Bloxity friends in this server
    kit: t.uint8().default(0),
    skin: t.uint8().default(0),
    av: t.string().default(''),     // packed Bloxity avatar (equipped ids + proportions)
}, 'PlayerState');

export const GameState = schema({
    players: t.map(PlayerState),
}, 'GameState');
