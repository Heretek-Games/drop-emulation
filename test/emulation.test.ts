import test from "node:test";
import assert from "node:assert/strict";
import { MockClientPluginContext } from "@droposs/plugin-sdk";
import Plugin, { expandRomArgs } from "../src/index.js";

test("drop-emulation registers a launch hook and panel", async () => {
  const ctx = new MockClientPluginContext("drop-emulation", ["ui:slot", "game:launch-hook", "system:command", "game:fs", "client:storage"]);
  await new Plugin().init(ctx);
  assert.equal(ctx.launchHooks.length, 1);
});

test("expandRomArgs substitutes placeholders", () => {
  const command = "retroarch -L {core} {rom_path}";
  const expanded = expandRomArgs(command, { coreId: "snes9x", romPath: "/roms/game.sfc" });
  assert.equal(expanded, "retroarch -L snes9x /roms/game.sfc");
});
