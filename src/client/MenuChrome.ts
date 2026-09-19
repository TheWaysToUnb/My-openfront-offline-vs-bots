/**
 * The menu-chrome teardown flag, and its inverse.
 *
 * These live together on purpose. Starting a game tears the home chrome down
 * (Main hides the modals and stops the public-lobby socket), and every exit
 * from a STARTED game was a full `window.location.href = "/"` navigation whose
 * reload rebuilt the page. `openInvite()` (OPE-204) became the first exit that
 * leaves in place, and the missing inverse surfaced as a homepage with a frozen
 * lobby list (OPE-255).
 *
 * This module used to own a second pair of halves -- hiding and restoring the
 * Playwire ad slots, plus reopening <homepage-promos>. The ad removal left only
 * the flag, so the pairing that remains is: hideMenuChrome() records the
 * teardown, restoreMenuChrome() clears it. The public-lobby socket belongs to
 * <game-mode-selector>, which owns its own lifecycle (see start()/stop()) and
 * is deliberately not touched here.
 */

/**
 * Has the chrome been torn down and not yet put back?
 *
 * This is the gate for the whole restore, and it is keyed on the teardown
 * ITSELF rather than on any separate signal that happens to correlate with it.
 * That distinction is load-bearing.
 *
 * The first version read the `in-game` body class, which looked equivalent and
 * was not: the teardown runs in `prestart.then(...)`, while setInGameSignal(true)
 * runs later in `join.then(...)`. For multiplayer those are two distinct server
 * messages with a real gap between them while terrain loads -- the
 * "prestart->start window" ClientGameRunner names. A leave inside that window
 * (Back, or a hash change, both reachable because `currentUrl` is also unset
 * until join) found the chrome torn down but the class never set, so nothing
 * restored. That is the bug OPE-255 exists to fix, arriving through a narrower
 * door.
 *
 * Keying on the teardown makes the gate true for exactly as long as there is
 * something to undo, whatever the join lifecycle is doing, and removes any
 * ordering constraint on the caller.
 */
let tornDown = false;

export function menuChromeIsTornDown(): boolean {
  return tornDown;
}

/** Record that the menu chrome has been torn down for a game that is starting. */
export function hideMenuChrome(): void {
  tornDown = true;
}

/** Clear the teardown flag once the home page is back in place. */
export function restoreMenuChrome(): void {
  tornDown = false;
}
