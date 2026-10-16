const CONSTANTS = require('../constants');
const log = require('../../logger');
const { safeJsonStringify, removeInvisibleChars, accountPrefix, randomInt } = require('../utils');

const MAX_TRACKED_MESSAGES = 500;

const findButton = (obj, targetId) => {
    if (!obj || typeof obj !== 'object') return null;

    const id = obj.custom_id || obj.customId;
    if (id === targetId) return obj;

    const children = Array.isArray(obj) ? obj : Object.keys(obj)
        .filter(key => !['client', 'guild', 'channel', 'member'].includes(key))
        .map(key => obj[key]);

    for (const child of children) {
        const found = findButton(child, targetId);
        if (found) return found;
    }
    return null;
};

const collectSearchText = (msg) => removeInvisibleChars([
    msg.content || '',
    msg.embeds?.length ? safeJsonStringify(msg.embeds) : '',
    msg.components?.length ? safeJsonStringify(msg.components) : ''
].filter(Boolean).join(' ')).toLowerCase();

const toIdList = (value) => (Array.isArray(value) ? value : String(value || '').split(','))
    .map(item => String(item).trim())
    .filter(Boolean);

const toNonNegativeInt = (value, fallback) => {
    const num = parseInt(value, 10);
    return Number.isFinite(num) && num >= 0 ? num : fallback;
};

const normalizeBoss2Settings = (raw = {}) => {
    const defaults = CONSTANTS.BOSS2_DEFAULTS;
    const delayMinMs = toNonNegativeInt(raw.delayMinMs, defaults.delayMinMs);
    return {
        enabled: raw.enabled === true,
        allowedGuilds: toIdList(raw.allowedGuilds),
        channelIds: toIdList(raw.channelIds),
        triggerText: typeof raw.triggerText === 'string' ? raw.triggerText.trim() : defaults.triggerText,
        buttonId: String(raw.buttonId || '').trim() || defaults.buttonId,
        delayMinMs,
        delayMaxMs: Math.max(delayMinMs, toNonNegativeInt(raw.delayMaxMs, defaults.delayMaxMs)),
        cooldownMs: toNonNegativeInt(raw.cooldownMs, defaults.cooldownMs)
    };
};

const createBoss2Manager = (state, configManager) => {
    state.boss2FoughtMessages = state.boss2FoughtMessages || new Set();
    state.boss2Cooldowns = state.boss2Cooldowns || new Map();
    state.boss2Timers = state.boss2Timers || new Set();

    return {
        canFight(msg, settings) {
            if (state.hasActiveCaptcha) return false;
            if (!msg.components?.length) return false;
            if (state.boss2FoughtMessages.has(msg.id)) return false;
            if (state.foughtBosses?.has(msg.id)) return false;

            if (settings.allowedGuilds.length > 0 && !settings.allowedGuilds.includes(msg.guildId)) return false;
            if (settings.channelIds.length > 0 && !settings.channelIds.includes(msg.channel?.id)) return false;

            const lastFight = msg.guildId ? state.boss2Cooldowns.get(msg.guildId) : null;
            if (lastFight && Date.now() - lastFight < settings.cooldownMs) return false;

            return true;
        },

        async handle(msg) {
            const settings = configManager.getBoss2Settings();
            if (!settings.enabled) return false;
            if (!this.canFight(msg, settings)) return false;

            const searchText = collectSearchText(msg);
            if (settings.triggerText && !searchText.includes(settings.triggerText.toLowerCase())) return false;

            const button = findButton(msg.components, settings.buttonId);
            if (!button || button.disabled === true) return false;

            state.boss2FoughtMessages.add(msg.id);
            if (state.boss2FoughtMessages.size > MAX_TRACKED_MESSAGES) {
                state.boss2FoughtMessages.delete(state.boss2FoughtMessages.values().next().value);
            }

            const delayMs = randomInt(settings.delayMinMs, settings.delayMaxMs);
            if (delayMs > 0) {
                log.info(`${accountPrefix(state)}🐲 Auto Boss2: klik '${settings.buttonId}' dalam ${delayMs}ms...`);
                await new Promise(resolve => {
                    const timer = setTimeout(() => {
                        state.boss2Timers.delete(timer);
                        resolve();
                    }, delayMs);
                    state.boss2Timers.add(timer);
                });
            }

            if (state.hasActiveCaptcha || !configManager.getBoss2Settings().enabled) return false;

            try {
                await msg.clickButton(button.custom_id || button.customId);
                if (msg.guildId) state.boss2Cooldowns.set(msg.guildId, Date.now());
                log.success(`${accountPrefix(state)}🐲 Auto Boss2: Fight!`);
                return true;
            } catch (error) {
                log.error(`${accountPrefix(state)}❌ Auto Boss2 gagal klik: ${error.message || error}`);
                return false;
            }
        },

        stop() {
            for (const timer of state.boss2Timers) clearTimeout(timer);
            state.boss2Timers.clear();
        }
    };
};

createBoss2Manager.normalizeBoss2Settings = normalizeBoss2Settings;
module.exports = createBoss2Manager;
