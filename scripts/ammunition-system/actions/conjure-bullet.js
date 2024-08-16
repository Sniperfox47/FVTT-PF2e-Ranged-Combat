import { PF2eActor } from "../../types/pf2e/actor.js";
import { PF2eToken } from "../../types/pf2e/token.js";
import { HookManager } from "../../utils/hook-manager.js";
import { Updates } from "../../utils/updates.js";
import { getControlledActorAndToken, getEffectFromActor, getItem, getItemFromActor, postToChat, setEffectTarget, showWarning } from "../../utils/utils.js";
import { getWeapon } from "../../utils/weapon-utils.js";
import { CONJURED_ROUND_EFFECT_ID, CONJURED_ROUND_ITEM_ID, CONJURE_BULLET_ACTION_ID, CONJURE_BULLET_IMG } from "../constants.js";
import { checkFullyLoaded, isFullyLoaded } from "../utils.js";
import { setLoadedChamber } from "./next-chamber.js";

const localize = (key) => game.i18n.localize("pf2e-ranged-combat.ammunitionSystem.actions.conjureBullet." + key);
const format = (key, data) => game.i18n.format("pf2e-ranged-combat.ammunitionSystem.actions.conjureBullet." + key, data);

export async function conjureBullet() {
    const { actor, token } = getControlledActorAndToken();
    if (!actor) {
        return;
    }

    const conjureBulletAction = getItemFromActor(actor, CONJURE_BULLET_ACTION_ID);
    if (!conjureBulletAction) {
        showWarning(format("warningNoAction", { token: token.name }));
        return;
    }

    const weapon = await getWeapon(actor, weapon => weapon.requiresLoading && !weapon.isRepeating, localize("noReloadableWeapons"), weapon => !isFullyLoaded(weapon));
    if (!weapon) {
        return;
    }

    const conjuredRoundEffect = getEffectFromActor(actor, CONJURED_ROUND_EFFECT_ID, weapon.id);
    if (conjuredRoundEffect) {
        showWarning(format("warningSingleRound", { weapon: weapon.name }));
        return;
    }

    // We can't conjure a bullet if the weapon is already (fully) loaded
    if (checkFullyLoaded(weapon)) {
        return;
    }

    performConjureBullet(actor, token, weapon);
}

/**
 * @param {PF2eActor} actor 
 * @param {PF2eToken} token
 * @param {Weapon} weapon
 */
export async function performConjureBullet(actor, token, weapon) {
    const updates = new Updates(actor);

    const conjuredRoundSource = await getItem(CONJURED_ROUND_EFFECT_ID);
    setEffectTarget(conjuredRoundSource, weapon);
    updates.create(conjuredRoundSource);

    if (weapon.isCapacity) {
        await setLoadedChamber(
            actor,
            weapon,
            {
                name: conjuredRoundSource.name,
                img: CONJURE_BULLET_IMG,
                id: CONJURED_ROUND_ITEM_ID,
                uuid: CONJURED_ROUND_ITEM_ID
            },
            updates
        );
    }

    // If we're not in combat, set the duration to one round so it doesn't expire immediately
    if (!token.inCombat) {
        conjuredRoundSource.system.duration.value = 1;
    }

    await postToChat(
        token.actor,
        CONJURE_BULLET_IMG,
        format("chatMessage", { token: token.name, weapon: weapon.name }),
        {
            actionName: localize("chatActionName"),
            numActions: 1,
            traits: ["magical", "manipulate"]
        }
    );

    HookManager.call("reload", { weapon, updates });

    updates.handleUpdates();

    Hooks.callAll("pf2eRangedCombatConjureBullet", actor, token, weapon);
}
