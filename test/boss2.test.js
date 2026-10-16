const test = require('node:test');
const assert = require('node:assert/strict');

const createBoss2Manager = require('../src/managers/boss2');
const { normalizeBoss2Settings, parseRaidMessage } = createBoss2Manager;

const ENDS_AT = Math.floor(Date.now() / 1000) + 600;
const NEXT_SPAWN = Math.floor(Date.now() / 1000) + 3600;

const appearComponents = ({ disabled = false } = {}) => [{
    type: 17,
    components: [
        { type: 10, content: '## <:lucy_think:1550898966130852032> Guild Boss Telah Muncul!' },
        { type: 14, spacing: 1, divider: true },
        { type: 10, content: `⏳ Berakhir <t:${ENDS_AT}:R>\n⚔ **0** fighter • ☠ **0** damage diberikan\n-# Fight kamu: 0/3 • Damage kamu: 0` },
        { type: 1, components: [{ type: 2, custom_id: 'raid:fight', label: 'Fight!', style: 4, disabled }] }
    ]
}];

const defeatedComponents = () => [{
    type: 17,
    components: [
        { type: 10, content: '## Boss Telah Dikalahkan!' },
        { type: 10, content: `⏳ Boss baru <t:${NEXT_SPAWN}:R>` },
        { type: 1, components: [{ type: 2, custom_id: 'raid:fight', label: 'Fight!', style: 4, disabled: true }] }
    ]
}];

function setup(settings = {}) {
    const state = { config: { settings: { boss2: { enabled: true, delayMinMs: 0, delayMaxMs: 0, ...settings } } } };
    const manager = createBoss2Manager(state, { getBoss2Settings: () => normalizeBoss2Settings(state.config.settings.boss2) });
    return { state, manager };
}

function createMessage(components, overrides = {}) {
    const clicks = [];
    const msg = {
        id: 'raid-msg-1',
        guildId: 'guild-1',
        channel: { id: 'channel-1' },
        author: { id: 'boss-bot' },
        content: '',
        embeds: [],
        components,
        clickButton: async (id) => { clicks.push(id); },
        ...overrides
    };
    return { msg, clicks };
}

test('normalizeBoss2Settings fills defaults and clamps values', () => {
    const settings = normalizeBoss2Settings({ enabled: true, allowedGuilds: 'a, b', fightsPerBoss: '9', delayMinMs: '500', delayMaxMs: '100' });
    assert.equal(settings.enabled, true);
    assert.deepEqual(settings.allowedGuilds, ['a', 'b']);
    assert.equal(settings.buttonId, 'raid:fight');
    assert.equal(settings.appearText, 'Guild Boss Telah Muncul');
    assert.equal(settings.fightsPerBoss, 3);
    assert.equal(settings.delayMaxMs, 500);
    assert.equal(normalizeBoss2Settings(undefined).enabled, false);
});

test('parseRaidMessage reads appear trigger, active button, end timestamp and fight count', () => {
    const info = parseRaidMessage({ content: '', embeds: [], components: appearComponents() }, normalizeBoss2Settings({}));
    assert.equal(info.isAppear, true);
    assert.equal(info.isDefeated, false);
    assert.equal(info.buttonActive, true);
    assert.equal(info.endsAt, ENDS_AT * 1000);
    assert.equal(info.nextSpawnAt, null);
    assert.equal(info.fightsUsed, 0);
    assert.equal(info.fightsMax, 3);
});

test('Auto Boss2 fights when the boss appears and records the end time', async () => {
    const { manager, state } = setup();
    const { msg, clicks } = createMessage(appearComponents());

    assert.equal(await manager.handle(msg), 'fought');
    assert.deepEqual(clicks, ['raid:fight']);
    const raid = manager.getRaidState('guild-1');
    assert.equal(raid.status, 'active');
    assert.equal(raid.endsAt, ENDS_AT * 1000);

    await manager.handle(msg);
    assert.deepEqual(clicks, ['raid:fight']);
    manager.stop();
    assert.equal(state.boss2Timers.size, 0);
});

test('Auto Boss2 uses the configured number of fights per boss', async () => {
    const { manager } = setup({ fightsPerBoss: 3 });
    const { msg, clicks } = createMessage(appearComponents());
    await manager.handle(msg);
    assert.equal(clicks.length, 3);
    manager.stop();
});

test('Auto Boss2 stops on defeat and records the next boss timestamp', async () => {
    const { manager } = setup();
    const appear = createMessage(appearComponents());
    await manager.handle(appear.msg);

    const defeated = createMessage(defeatedComponents());
    assert.equal(await manager.handle(defeated.msg), 'ended');
    assert.deepEqual(defeated.clicks, []);
    const raid = manager.getRaidState('guild-1');
    assert.equal(raid.status, 'ended');
    assert.equal(raid.nextSpawnAt, NEXT_SPAWN * 1000);

    const nextAppear = createMessage(appearComponents(), { id: 'raid-msg-2' });
    assert.equal(await manager.handle(nextAppear.msg), 'fought');
    assert.deepEqual(nextAppear.clicks, ['raid:fight']);
    assert.equal(manager.getRaidState('guild-1').nextSpawnAt, null);
    manager.stop();
});

test('Auto Boss2 does not fight when disabled, filtered out, or button is disabled', async () => {
    const disabled = setup({ enabled: false });
    const a = createMessage(appearComponents());
    assert.equal(await disabled.manager.handle(a.msg), null);

    const filtered = setup({ botIds: ['other-bot'] });
    const b = createMessage(appearComponents());
    assert.equal(await filtered.manager.handle(b.msg), null);

    const enabled = setup();
    const c = createMessage(appearComponents({ disabled: true }));
    assert.equal(await enabled.manager.handle(c.msg), 'ended');

    assert.deepEqual([...a.clicks, ...b.clicks, ...c.clicks], []);
});
