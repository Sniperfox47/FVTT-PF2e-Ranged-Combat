import { PF2eConsumable } from "../../types/pf2e/consumable.js";
import { Updates } from "../../utils/updates.js";
import { getControlledActorAndToken, getItem, postInteractToChat } from "../../utils/utils.js";

const localize = (key) => game.i18n.localize("pf2e-ranged-combat.ammunitionSystem.actions.consolidateAmmunition." + key)
const format = (key, data) => game.i18n.format("pf2e-ranged-combat.ammunitionSystem.actions.consolidateAmmunition." + key, data)

export async function consolidateRepeatingWeaponAmmunition() {
    const { actor, token } = getControlledActorAndToken();
    if (!actor) {
        return;
    }

    // Find all the repeating ammunition stacks
    const ammunitionStacks = actor.itemTypes.consumable.filter(consumable => consumable.isAmmo && consumable.system.uses.max > 1);
    const ammunitionStacksByuuid = ammunitionStacks.reduce(
        /**
         * @param {Map<string, { stacks: PF2eConsumable[], totalCharges: number}>} map
         * @param {PF2eConsumable} stack
         * 
         * @returns {Map<string, { stacks: PF2eConsumable[], totalCharges: number}>}
         */
        function (map, stack) {
            const mapEntry = map.get(stack.uuid);
            if (!mapEntry) {
                map.set(
                    stack.uuid,
                    {
                        stacks: [stack],
                        totalCharges: getTotalChargesForStack(stack)
                    }
                );
            } else {
                mapEntry.stacks.push(stack);
                mapEntry.totalCharges += getTotalChargesForStack(stack);
            }
            return map;
        },
        new Map(),
    );

    const updates = new Updates(actor);

    for (const [uuid, stackEntry] of ammunitionStacksByuuid) {
        const stacks = stackEntry.stacks;

        const maxChargesPerItem = stacks[0].system.uses.max;

        // Work out if we need to consolidate:
        // - We have one stack with zero quantity
        // - OR we have:
        //   - Optionally, one stack fully-charge with non-zero quantity
        //   - Optionally, one stack with quantity 1 and not fully-charged
        // - AND
        //   - We have no other stacks
        const haveEmptyStack = stacks.some(stack => stack.quantity == 0);
        const haveFullStack = stacks.some(stack => stack.quantity > 0 && stack.system.uses.value == stack.system.uses.max);
        const haveNonFullStack = stacks.some(stack => stack.quantity > 0 && stack.system.uses.value != stack.system.uses.max);
        if ((haveEmptyStack && stacks.length == 1) || stacks.length == haveFullStack + haveNonFullStack) {
            continue;
        }

        const remainingCharges = stackEntry.totalCharges % maxChargesPerItem;
        const quantityFullCharges = (stackEntry.totalCharges - remainingCharges) / maxChargesPerItem;

        let index = 0;

        // Make one stack of fully-charged items
        if (quantityFullCharges) {
            const indexNow = index;
            updates.update(
                stacks[indexNow],
                {
                    system: {
                        quantity: quantityFullCharges,
                        uses: {
                            value: maxChargesPerItem
                        }
                    }
                }
            );
            index++;
        }

        // Make one stack of one item with the remaining charges
        if (remainingCharges) {
            if (index >= stacks.length) {
                const newStackSource = await getItem(uuid);
                newStackSource.system.quantity = 1;
                newStackSource.system.uses.value = remainingCharges;
                updates.create(newStackSource);
            } else {
                const indexNow = index;
                updates.update(
                    stacks[indexNow],
                    {
                        system: {
                            quantity: 1,
                            uses: {
                                value: remainingCharges
                            }
                        }
                    }
                );
                index++;
            }
        }

        // Remove the rest of the stacks
        while (index < stacks.length) {
            updates.delete(stacks[index]);
            index++;
        }
    }

    if (updates.hasChanges()) {
        postInteractToChat(
            actor,
            ammunitionStacks[0].img,
            format("chatMessage", { token: token.name }),
        );
        await updates.handleUpdates();
    } else {
        ui.notifications.info(localize("infoAlreadyConsolidated"));
    }
}

/**
 * Calculte the total number of uses remaining for this stack.
 * 
 * @param {PF2eConsumable} stack
 * @returns {number} The total number of uses remaining in the stack
 */
function getTotalChargesForStack(stack) {
    return stack.quantity > 0 ? stack.system.uses.value + (stack.quantity - 1) * stack.system.uses.max : 0;
}
