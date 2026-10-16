const test = require('node:test');
const assert = require('node:assert/strict');

const createBoss2Manager = require('../src/managers/boss2');
const { normalizeBoss2Settings } = createBoss2Manager;

const bossComponents = (disabled = false) => [{
    type: 1,
    components: [
        { type: 10, content: 'A Guild Boss Appeared!' },
        { type: 2, custom_id: 'guildboss_fight', label: 'Fight', disabled }
    ]
}];

function setup(settings) {
    const state = { config: { settings: { boss2: settings } }, foughtBosses: new Set() };
    const manager = createBoss2Manager(state, { getBoss2Settings: () => normalizeBoss2Settings(state.config.settings.boss2) });
    return { state, manager };
}

function createMessage(overrides = {}) {
    const clicks = [];
    return {
        clicks,
        msg: {
            id: 'msg-1',
            guildId: 'guild-1',
            channel: { id: 'channel-1' },
            content: '',
            embeds: [],
            components: bossComponents(),
            clickButton: async (id) => { clicks.push(id); },
            ...overrides
        }
    };
}

test('normalizeBoss2Settings fills defaults and keeps delay max >= min', () => {
    const settings = normalizeBoss2Settings({ enabled: true, allowedGuilds: 'a, b', delayMinMs: '500', delayMaxMs: '100' });
    assert.equal(settings.enabled, true);
    assert.deepEqual(settings.allowedGuilds, ['a', 'b']);
    assert.equal(settings.buttonId, 'guildboss_fight');
    assert.equal(settings.delayMinMs, 500);
    assert.equal(settings.delayMaxMs, 500);
    assert.equal(normalizeBoss2Settings(undefined).enabled, false);
});

test('Auto Boss2 clicks the configured button once and respects cooldown', async () => {
    const { manager } = setup({ enabled: true });
    const first = createMessage();
    assert.equal(await manager.handle(first.msg), true);
    assert.deepEqual(first.clicks, ['guildboss_fight']);

    assert.equal(await manager.handle(first.msg), false);
    const second = createMessage({ id: 'msg-2' });
    assert.equal(await manager.handle(second.msg), false);
    assert.deepEqual(second.clicks, []);
});

test('Auto Boss2 does nothing when disabled, filtered out, or button disabled', async () => {
    const disabled = setup({ enabled: false });
    const a = createMessage();
    assert.equal(await disabled.manager.handle(a.msg), false);

    const filtered = setup({ enabled: true, allowedGuilds: ['other-guild'] });
    const b = createMessage();
    assert.equal(await filtered.manager.handle(b.msg), false);

    const enabled = setup({ enabled: true });
    const c = createMessage({ components: bossComponents(true) });
    assert.equal(await enabled.manager.handle(c.msg), false);

    assert.deepEqual([...a.clicks, ...b.clicks, ...c.clicks], []);
});
