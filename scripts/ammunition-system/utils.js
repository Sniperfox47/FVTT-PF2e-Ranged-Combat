import { Ammunition } from "../types/pf2e-ranged-combat/ammunition.js";
import { CapacityLoadedEffect, LoadedEffect } from "../types/pf2e-ranged-combat/loaded-effect.js";
import { Weapon } from "../types/pf2e-ranged-combat/weapon.js";
import { PF2eConsumable, PF2eConsumableUses } from "../types/pf2e/consumable.js";
import { PF2eWeapon } from "../types/pf2e/weapon.js";
import { ItemSelectDialog } from "../utils/item-select-dialog.js";
import { Updates } from "../utils/updates.js";
import { getEffectFromActor, getFlag, getFlags, showWarning } from "../utils/utils.js";
import { CHAMBER_LOADED_EFFECT_ID, CONJURED_ROUND_EFFECT_ID, CONJURED_ROUND_ITEM_ID, LOADED_EFFECT_ID } from "./constants.js";

const localize = (key) => game.i18n.localize("pf2e-ranged-combat.ammunitionSystem." + key);
const format = (key, data) => game.i18n.format("pf2e-ranged-combat.ammunitionSystem." + key, data);

/**
 * Check if the weapon is fully loaded and, if it is, show a warning
 */
export function checkFullyLoaded(weapon) {
    const weaponFullyLoaded = isFullyLoaded(weapon);
    if (weaponFullyLoaded) {
        if (weapon.capacity) {
            showWarning(format("utils.warningFullyLoaded", { weapon: weapon.name }));
        } else {
            showWarning(format("utils.warningLoaded", { weapon: weapon.name }));
        }
    }
    return weaponFullyLoaded;
}

/**
 * @param {Weapon} weapon 
 */
export function isLoaded(weapon) {
    const loadedEffect = getEffectFromActor(weapon.actor, LOADED_EFFECT_ID, weapon.id);
    const conjuredRoundEffect = getEffectFromActor(weapon.actor, CONJURED_ROUND_EFFECT_ID, weapon.id);

    return !!loadedEffect || !!conjuredRoundEffect;
}

/**
 * Check if the weapon is fully loaded, returning the warning message to display

 * @param {Weapon} weapon
 * @return {boolean}
 */
export function isFullyLoaded(weapon) {
    let roundsLoaded = 0;

    const loadedEffect = getEffectFromActor(weapon.actor, LOADED_EFFECT_ID, weapon.id);
    if (loadedEffect) {
        if (weapon.capacity) {
            roundsLoaded += getFlag(loadedEffect, "loadedChambers");
        } else {
            roundsLoaded++;
        }
    }

    const conjuredRoundEffect = getEffectFromActor(weapon.actor, CONJURED_ROUND_EFFECT_ID, weapon.id);
    if (conjuredRoundEffect) {
        roundsLoaded++;
    }

    if (weapon.capacity) {
        return roundsLoaded >= weapon.capacity;
    } else {
        return !!roundsLoaded;
    }
}

/**
 * Select an ammunition type of the ones loaded into the given weapon.
 * 
 * @param {Weapon} weapon
 * @param {string} action
 * @returns 
 */
export async function getSelectedAmmunition(weapon, action) {
    const loadedAmmunitions = getLoadedAmmunitions(weapon);
    if (loadedAmmunitions.length > 1) {
        return await ItemSelectDialog.getItem(
            localize("ammunitionSelect.title"),
            localize(`ammunitionSelect.action.${action}`),
            new Map([[localize("ammunitionSelect.header.loadedAmmunition"), loadedAmmunitions]])
        );
    } else {
        return loadedAmmunitions[0];
    }
}

/**
 * @param {Weapon} weapon 
 * @returns { Ammunition[] }
 */
export function getLoadedAmmunitions(weapon) {
    const ammunitions = [];

    const loadedEffect = getEffectFromActor(weapon.actor, LOADED_EFFECT_ID, weapon.id);
    if (loadedEffect) {
        const loadedAmmunitions = getFlag(loadedEffect, "ammunition");
        ammunitions.push(...loadedAmmunitions);
    }

    const conjuredRoundEffect = getEffectFromActor(weapon.actor, CONJURED_ROUND_EFFECT_ID, weapon.id);
    if (conjuredRoundEffect) {
        ammunitions.push(
            {
                name: localize("actions.conjureBullet.conjuredRound"),
                img: conjuredRoundEffect.img,
                id: CONJURED_ROUND_ITEM_ID,
                sourceId: CONJURED_ROUND_ITEM_ID,
                quantity: 1
            }
        );
    }

    return ammunitions;
}

/**
 * Remove a piece of ammunition from the weapon.
 * 
 * @param {Weapon} weapon 
 * @param {Updates} updates 
 */
export function removeAmmunition(weapon, updates, ammunitionToRemove = 1) {
    const loadedEffect = getEffectFromActor(weapon.actor, LOADED_EFFECT_ID, weapon.id);
    if (!loadedEffect) {
        return;
    }

    if (weapon.capacity) {
        const loadedChambers = getFlag(loadedEffect, "loadedChambers") - ammunitionToRemove;
        const loadedCapacity = getFlag(loadedEffect, "capacity");
        if (loadedChambers > 0) {
            updates.update(
                loadedEffect,
                {
                    "name": `${getFlag(loadedEffect, "name")} (${loadedChambers}/${loadedCapacity})`,
                    "flags.pf2e-ranged-combat.loadedChambers": loadedChambers,
                }
            );
            updates.floatyText(`${getFlag(loadedEffect, "name")} (${loadedChambers}/${loadedCapacity})`, false);
        } else {
            updates.update(loadedEffect, { "name": `${getFlag(loadedEffect, "name")} (0/${loadedCapacity})` });
            updates.delete(loadedEffect);
            clearLoadedChamber(weapon, null, updates);
        }
    } else {
        updates.delete(loadedEffect);
    }
}

/**
 * @param {Updates} updates 
 * @param {PF2eConsumable | PF2eWeapon} ammunition 
 * @param {number} delta 
 */
export function updateAmmunitionQuantity(updates, ammunition, delta) {
    if (ammunition.type == "consumable") {
        /** @type PF2eConsumableUses */
        const uses = ammunition.system.uses;
        if (uses.autoDestroy) {
            if (uses.max > 1) {
                if (uses.value + delta > 0) {
                    // We're using up some of the magazine, so just reduce the uses by the amount of ammunition
                    updates.update(ammunition, { "system.uses.value": uses.value + delta });
                } else {
                    // We're using up the rest of the magazine, so move onto the next one
                    updates.update(
                        ammunition,
                        {
                            system: {
                                "uses.value": uses.max,
                                "quantity": ammunition.quantity - 1
                            }

                        }
                    );
                }
            } else {
                updates.update(ammunition, { "system.quantity": ammunition.quantity + delta });
            }
        }
    } else {
        updates.update(ammunition, { "system.quantity": ammunition.quantity + delta });
    }
}

export function removeAmmunitionAdvancedCapacity(actor, weapon, ammunition, updates) {
    const loadedEffect = getEffectFromActor(actor, LOADED_EFFECT_ID, weapon.id);
    const loadedFlags = getFlags(loadedEffect);

    loadedFlags.loadedChambers--;

    const loadedAmmunition = loadedFlags.ammunition.find(ammunitionType => ammunitionType.uuid === ammunition.uuid);
    loadedAmmunition.quantity--;
    if (loadedAmmunition.quantity === 0) {
        loadedFlags.ammunition.findSplice(ammunition => ammunition.id === loadedAmmunition.id);
        clearLoadedChamber(weapon, loadedAmmunition, updates);
    }

    updates.floatyText(`${getFlag(loadedEffect, "originalName")} (${loadedFlags.loadedChambers}/${loadedFlags.capacity})`, false);
    
    // If the weapon is still loaded, update the effect, otherwise remove it
    if (loadedFlags.ammunition.length) {
        updates.update(
            loadedEffect,
            {
                "flags.pf2e-ranged-combat": loadedFlags,
                "name": buildLoadedEffectName(loadedEffect),
                "system.description.value": buildLoadedEffectDescription(loadedEffect)
            }
        );
    } else {
        updates.delete(loadedEffect);
    }
}

export function clearLoadedChamber(weapon, ammunition, updates) {
    const chamberLoadedEffect = getEffectFromActor(weapon.actor, CHAMBER_LOADED_EFFECT_ID, weapon.id);
    if (chamberLoadedEffect) {
        if (ammunition) {
            const chamberAmmunition = getFlag(chamberLoadedEffect, "ammunition");
            if (chamberAmmunition.uuid === ammunition.uuid) {
                updates.delete(chamberLoadedEffect);
            }
        } else {
            updates.delete(chamberLoadedEffect);
        }
    }
}

/**
 * For weapons with a capacity of more than one, build the name to give the loaded effect.
 * 
 * @returns {string}
 */
export function buildLoadedEffectName(loadedEffect) {
    /** @type LoadedEffect | CapacityLoadedEffect */
    let flags = getFlags(loadedEffect);

    // We're not tracking specific ammunition, either because it's for a repeating weapon or
    // we're using the simple ammunition system
    if (!flags.ammunition?.length) {
        return loadedEffect.name;
    }

    /** @type CapacityLoadedEffect */
    const capacityLoaded = flags;

    const ammunitions = capacityLoaded.ammunition;
    const capacity = capacityLoaded.capacity;
    const originalName = capacityLoaded.originalName;

    const ammunitionCount = ammunitions.map(ammunition => ammunition.quantity).reduce((current, next) => current + next);
    return `${originalName} (${ammunitionCount}/${capacity})`;
}

/**
 * For weapons with a capacity of more than one, build the description to give the loaded effect.
 * 
 * @returns {string}
 */
export function buildLoadedEffectDescription(loadedEffect) {
    /** @type LoadedEffect | CapacityLoadedEffect */
    let loaded = getFlags(loadedEffect);

    // We're not tracking specific ammunition, either because it's for a repeating weapon or
    // we're using the simple ammunition system
    if (!loaded.ammunition?.length) {
        return loadedEffect.system.description.value;
    }

    /** @type CapacityLoadedEffect */
    const capacityLoaded = loaded;

    return capacityLoaded.ammunition
        .map(ammunition => `<p>@UUID[${ammunition.uuid}] x${ammunition.quantity}</p>`)
        .reduce(
            (previous, current) => previous + current,
            capacityLoaded.originalDescription ?? loadedEffect.system.description.value
        );
}
