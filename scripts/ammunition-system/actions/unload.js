import { Ammunition } from "../../types/pf2e-ranged-combat/ammunition.js";
import { Weapon } from "../../types/pf2e-ranged-combat/weapon.js";
import { PF2eActor } from "../../types/pf2e/actor.js";
import { PF2eToken } from "../../types/pf2e/token.js";
import { Updates } from "../../utils/updates.js";
import { getControlledActorAndToken, getEffectFromActor, getFlag, getItem, postInteractToChat, showWarning, useAdvancedAmmunitionSystem } from "../../utils/utils.js";
import { getWeapon } from "../../utils/weapon-utils.js";
import { CONJURED_ROUND_EFFECT_ID, CONJURED_ROUND_ITEM_ID, LOADED_EFFECT_ID, MAGAZINE_LOADED_EFFECT_ID } from "../constants.js";
import { clearLoadedChamber, getSelectedAmmunition, isLoaded, removeAmmunition, removeAmmunitionAdvancedCapacity, updateAmmunitionQuantity } from "../utils.js";

const localize = (key) => game.i18n.localize("pf2e-ranged-combat.ammunitionSystem.actions.unload." + key);
const format = (key, data) => game.i18n.format("pf2e-ranged-combat.ammunitionSystem.actions.unload." + key, data);

export async function unload() {
    const { actor, token } = getControlledActorAndToken();
    if (!actor) {
        return;
    }

    const weapon = await getLoadedWeapon(actor);
    if (!weapon) {
        return;
    }

    performUnload(actor, token, weapon);
}

/**
 * @param {PF2eActor} actor 
 * @param {PF2eToken} token 
 * @param {Weapon} weapon 
 */
export async function performUnload(actor, token, weapon) {
    const updates = new Updates(actor);

    const loadedEffect = getEffectFromActor(actor, LOADED_EFFECT_ID, weapon.id);
    const conjuredRoundEffect = getEffectFromActor(actor, CONJURED_ROUND_EFFECT_ID, weapon.id);
    const magazineLoadedEffect = getEffectFromActor(actor, MAGAZINE_LOADED_EFFECT_ID, weapon.id);
    if (!loadedEffect && !conjuredRoundEffect && !magazineLoadedEffect) {
        showWarning(format("warningNotLoaded", { weapon: weapon.name }));
        return;
    }

    if (useAdvancedAmmunitionSystem(actor)) {
        if (weapon.isRepeating) {
            if (loadedEffect) {
                updates.delete(loadedEffect);
            }
            if (magazineLoadedEffect) {
                await unloadMagazine(actor, magazineLoadedEffect, updates);
                postInteractToChat(
                    actor,
                    magazineLoadedEffect.img,
                    format("tokenUnloadsAmmunitionFromWeapon", { token: token.name, ammunition: getFlag(magazineLoadedEffect, "ammunitionName"), weapon: weapon.name }),
                    "1"
                );
            }
        } else if (weapon.capacity) {
            const ammunition = await getSelectedAmmunition(weapon, "unload");
            if (!ammunition) {
                return;
            }

            if (ammunition.uuid === CONJURED_ROUND_ITEM_ID) {
                const conjuredRoundEffect = getEffectFromActor(actor, CONJURED_ROUND_EFFECT_ID, weapon.id);
                updates.delete(conjuredRoundEffect);
                clearLoadedChamber(weapon, ammunition, updates);
            } else {
                moveAmmunitionToInventory(actor, ammunition, updates);
                removeAmmunitionAdvancedCapacity(actor, weapon, ammunition, updates);
            }
            postInteractToChat(
                actor,
                ammunition.img,
                format("tokenUnloadsAmmunitionFromWeapon", { token: token.name, ammunition: ammunition.name, weapon: weapon.name }),
                "1"
            );
        } else {
            if (conjuredRoundEffect) {
                updates.delete(conjuredRoundEffect);
                postInteractToChat(
                    actor,
                    conjuredRoundEffect.img,
                    format(
                        "tokenUnloadsAmmunitionFromWeapon",
                        {
                            token: token.name,
                            ammunition: game.i18n.localize("pf2e-ranged-combat.ammunitionSystem.actions.conjureBullet.conjuredRound"),
                            weapon: weapon.name
                        }
                    ),
                    "1"
                );
            } else if (loadedEffect) {
                unloadAmmunition(actor, weapon, loadedEffect, updates);
                postInteractToChat(
                    actor,
                    loadedEffect.img,
                    format("tokenUnloadsAmmunitionFromWeapon", { token: token.name, ammunition: getFlag(loadedEffect, "ammunition").name, weapon: weapon.name }),
                    "1"
                );
            }
        }
    } else {
        removeAmmunition(weapon, updates);
        postInteractToChat(
            actor,
            loadedEffect.img,
            format("tokenUnloadsWeapon", { token: token.name, weapon: weapon.name }),
            "1"
        );
    }

    updates.handleUpdates();
    Hooks.callAll("pf2eRangedCombatUnload", actor, token, weapon);
}

/**
 * @param {PF2eActor} actor 
 * @returns {Promise<Weapon | null>}
 */
function getLoadedWeapon(actor) {
    return getWeapon(
        actor,
        isWeaponLoaded,
        localize("noLoadedWeapons")
    );
}

/**
 * @param {Weapon} weapon 
 */
export function isWeaponLoaded(weapon) {
    if (useAdvancedAmmunitionSystem(weapon.actor) && weapon.isRepeating) {
        return !!getEffectFromActor(weapon.actor, MAGAZINE_LOADED_EFFECT_ID, weapon.id);
    } else if (weapon.requiresLoading) {
        return isLoaded(weapon);
    }
    return false;
}

/**
 * Remove the magazine effect and add the remaining ammunition back to the actor
 */
export async function unloadMagazine(actor, magazineLoadedEffect, updates) {
    const ammunitionCapacity = getFlag(magazineLoadedEffect, "capacity");
    const ammunitionRemaining = getFlag(magazineLoadedEffect, "remaining");

    const ammunitionItemId = getFlag(magazineLoadedEffect, "ammunitionItemId");
    const ammunitionItem = actor.items.find(item => item.id === ammunitionItemId && !item.isStowed);

    if (ammunitionRemaining === ammunitionCapacity && ammunitionItem) {
        // We found the original stack of ammunition this
        updates.update(ammunitionItem, { "system.quantity": ammunitionItem.quantity + 1 });
    } else if (ammunitionRemaining > 0) {
        // The magazine still has some ammunition left, create a new item with the remaining ammunition
        const itemuuid = getFlag(magazineLoadedEffect, "ammunitionuuid");
        const ammunitionSource = await getItem(itemuuid);
        ammunitionSource.system.uses.value = ammunitionRemaining;
        updates.create(ammunitionSource);
    }

    // Finally, remove the existing effect
    updates.delete(magazineLoadedEffect);

    // If the weapon was loaded, then remove the loaded status as well
    const weaponId = getFlag(magazineLoadedEffect, "targetId");
    const loadedEffect = getEffectFromActor(actor, LOADED_EFFECT_ID, weaponId);
    if (loadedEffect) {
        updates.delete(loadedEffect);
    }
}

export async function unloadAmmunition(actor, weapon, loadedEffect, updates) {
    const loadedAmmunition = getFlag(loadedEffect, "ammunition");

    if (loadedAmmunition) {
        moveAmmunitionToInventory(actor, loadedAmmunition, updates);
    }

    removeAmmunition(weapon, updates);
}

/**
 * @param {PF2eActor} actor 
 * @param {Ammunition} ammunition 
 * @param {Updates} updates 
 */
async function moveAmmunitionToInventory(actor, ammunition, updates) {
    // Try to find either the stack the loaded ammunition came from, or another stack of the same ammunition
    const ammunitionItem = actor.items.find(item => item.id === ammunition.id && !item.isStowed)
        || actor.items.find(item => item.uuid === ammunition.uuid && !item.isStowed);

    if (ammunitionItem) {
        // We still have the stack the ammunition originally came from, or another that's the same.
        // Add the currently loaded ammunition to the stack
        updateAmmunitionQuantity(updates, ammunitionItem, +1);
    } else {
        // Create a new stack with one piece of ammunition in it
        const ammunitionSource = await getItem(ammunition.uuid);
        ammunitionSource.system.quantity = 1;
        updates.create(ammunitionSource);
    }
}
