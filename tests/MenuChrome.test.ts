import { afterEach, describe, expect, it } from "vitest";
import {
  hideMenuChrome,
  menuChromeIsTornDown,
  restoreMenuChrome,
} from "../src/client/MenuChrome";

// OPE-255. Starting a game tears the home chrome down. Every exit from a
// STARTED game used to be a full `window.location.href = "/"` navigation, and
// it was the reload -- not any code -- that undid the teardown. openInvite()
// leaves in place instead, so the teardown needed a real inverse. What remains
// after the ad removal is the teardown flag itself, which is what decides
// whether the inverse runs at all.

afterEach(() => {
  document.body.innerHTML = "";
  document.body.classList.remove("in-game");
  // Module-level teardown flag: reset so state cannot leak between tests.
  restoreMenuChrome();
});

describe("hideMenuChrome", () => {
  it("marks the chrome as torn down", () => {
    hideMenuChrome();

    expect(menuChromeIsTornDown()).toBe(true);
  });

  it("is idempotent when hide runs twice on one join", () => {
    hideMenuChrome();
    hideMenuChrome();

    expect(menuChromeIsTornDown()).toBe(true);
  });
});

describe("restoreMenuChrome", () => {
  it("clears the teardown flag", () => {
    hideMenuChrome();

    restoreMenuChrome();

    expect(menuChromeIsTornDown()).toBe(false);
  });

  it("is a no-op when nothing was torn down", () => {
    expect(() => restoreMenuChrome()).not.toThrow();

    expect(menuChromeIsTornDown()).toBe(false);
  });
});

// The gate that decides whether the inverse runs.
//
// It is keyed on "did we tear the chrome down?" rather than on any separate
// signal that happens to correlate. The first version of this gate read the
// `in-game` body class, and that was subtly wrong: the teardown runs in
// `prestart.then(...)` while setInGameSignal(true) runs later in
// `join.then(...)`. For multiplayer those are two distinct server messages
// with a real window between them while terrain loads -- the "prestart->start
// window" ClientGameRunner names. A leave inside that window found the chrome
// torn down but the class unset, so nothing restored: the exact bug this PR
// exists to fix, arriving through a narrower door.
describe("menuChromeIsTornDown", () => {
  it("is false at the menu, so a pre-start leave restores nothing", () => {
    expect(menuChromeIsTornDown()).toBe(false);
  });

  it("is true as soon as the chrome is hidden", () => {
    hideMenuChrome();

    expect(menuChromeIsTornDown()).toBe(true);
  });

  // The regression. The teardown has happened; the in-game signal has not
  // been set and will not be until the join resolves. Restore must still fire.
  it("is true during the prestart->start window, before any in-game signal", () => {
    hideMenuChrome();
    expect(document.body.classList.contains("in-game")).toBe(false);

    expect(menuChromeIsTornDown()).toBe(true);
  });

  it("is false again once the chrome has been restored", () => {
    hideMenuChrome();
    restoreMenuChrome();

    expect(menuChromeIsTornDown()).toBe(false);
  });

  // Deliberately independent of the body class, so the two cannot drift.
  it("does not consult the in-game class", () => {
    document.body.classList.add("in-game");

    expect(menuChromeIsTornDown()).toBe(false);
  });
});
