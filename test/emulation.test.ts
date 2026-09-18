import test from "node:test";
import assert from "node:assert/strict";
import { MockClientPluginContext } from "@droposs/plugin-sdk";
import type { LaunchContext } from "@droposs/plugin-sdk";
import Plugin, {
  type EmulatorBinding,
  type ResolveLaunchDeps,
  buildLaunchSpec,
  createEmulatorPanel,
  discoverEmulators,
  expandRomArgs,
  resolveLaunchOverrides,
  tokenizeCommand,
} from "../src/index.js";

const CAPABILITIES = [
  "ui:slot",
  "game:runner",
  "system:command",
  "game:fs",
  "client:storage",
] as const;

const BINDING: EmulatorBinding = {
  emulatorId: "retroarch",
  coreId: "snes9x",
  romPath: "roms/chrono-trigger.sfc",
};

const LAUNCH: LaunchContext = {
  gameId: "g1",
  gameTitle: "Chrono Trigger",
  gameDir: "/games/ct",
};

function deps(ctx: MockClientPluginContext): ResolveLaunchDeps {
  return {
    gameFs: ctx.gameFs,
    system: ctx.system,
    storage: ctx.storage,
    logger: ctx.logger,
  };
}

test("drop-emulation registers a runner provider and a game-detail panel", async () => {
  const ctx = new MockClientPluginContext("drop-emulation", [
    ...CAPABILITIES,
  ]);
  await new Plugin().init(ctx);
  assert.equal(ctx.launchHooks.length, 0);
  assert.equal(ctx.runnerProviders.length, 1);
  assert.equal(ctx.runnerProviders[0].id, "drop-emulation");
  const panels = ctx.registeredSlots.get("game-detail:panels");
  assert.equal(panels?.length, 1);
  assert.equal((panels?.[0].component as { name?: string }).name, "EmulatorPanel");
  assert.equal(panels?.[0].label, "Emulator");
});

test("expandRomArgs substitutes placeholders", () => {
  const command = "retroarch -L {core} {rom_path}";
  const expanded = expandRomArgs(command, {
    emulatorId: "retroarch",
    coreId: "snes9x",
    romPath: "/roms/game.sfc",
  });
  assert.equal(expanded, "retroarch -L snes9x /roms/game.sfc");
});

test("tokenizeCommand respects quotes and escapes", () => {
  assert.deepEqual(tokenizeCommand('retroarch -L "{core}" "{rom_path}"'), [
    "retroarch",
    "-L",
    "{core}",
    "{rom_path}",
  ]);
  assert.deepEqual(
    tokenizeCommand('"C:\\Program Files\\emu.exe" --rom "my rom.sfc" --flag'),
    ["C:\\Program Files\\emu.exe", "--rom", "my rom.sfc", "--flag"],
  );
  assert.deepEqual(tokenizeCommand('emu ""'), ["emu", ""]);
  assert.throws(() => tokenizeCommand('emu "unterminated'));
});

test("buildLaunchSpec produces the rewritten command line", () => {
  const spec = buildLaunchSpec(
    {
      id: "retroarch",
      name: "RetroArch",
      command: 'retroarch -L "{core}" "{rom_path}"',
      args: ["--verbose"],
    },
    {
      emulatorId: "retroarch",
      coreId: "snes9x",
      romPath: "/roms/Chrono Trigger.sfc",
    },
  );
  assert.equal(spec.command, "retroarch");
  assert.deepEqual(spec.args, [
    "-L",
    "snes9x",
    "/roms/Chrono Trigger.sfc",
    "--verbose",
  ]);
  assert.equal(
    spec.commandLine,
    "retroarch -L snes9x /roms/Chrono Trigger.sfc --verbose",
  );
});

test("discoverEmulators keeps only allowlisted, working binaries", async () => {
  const ctx = new MockClientPluginContext("drop-emulation", [
    ...CAPABILITIES,
  ]);
  ctx.systemCommand.fallback = { code: 1, stdout: "", stderr: "not found" };
  ctx.systemCommand.setResponse("retroarch", ["--version"], {
    code: 0,
    stdout: "RetroArch 1.19",
    stderr: "",
  });
  const available = await discoverEmulators(
    [
      { id: "retroarch", name: "RetroArch", command: "retroarch {rom_path}" },
      { id: "dolphin-emu", name: "Dolphin", command: "dolphin-emu {rom_path}" },
    ],
    ctx.system,
  );
  assert.deepEqual(available.map((entry) => entry.id), ["retroarch"]);
});

test("resolveLaunchOverrides validates the ROM and returns launch overrides", async () => {
  const ctx = new MockClientPluginContext("drop-emulation", [
    ...CAPABILITIES,
  ]);
  await ctx.storage.set("binding:g1", BINDING);
  await ctx.gameFs.writeFile("g1", BINDING.romPath, "rom-bytes");

  const overrides = await resolveLaunchOverrides(
    structuredClone(LAUNCH),
    deps(ctx),
  );
  assert.ok(overrides);
  assert.equal(overrides.executable, "retroarch");
  assert.deepEqual(overrides.arguments, [
    "-L",
    "snes9x",
    "roms/chrono-trigger.sfc",
  ]);
  assert.deepEqual(ctx.systemCommand.calls[0].args, ["--version"]);
});

test("EmulationRunnerProvider contributes overrides through the runner SPI", async () => {
  const ctx = new MockClientPluginContext("drop-emulation", [
    ...CAPABILITIES,
  ]);
  await new Plugin().init(ctx);
  await ctx.storage.set("binding:g1", BINDING);
  await ctx.gameFs.writeFile("g1", BINDING.romPath, "rom-bytes");

  const provider = ctx.runnerProviders[0];
  assert.deepEqual(await provider.detect(), { available: true });
  const overrides = await provider.resolveLaunch(structuredClone(LAUNCH));
  assert.equal(overrides.executable, "retroarch");
  assert.deepEqual(overrides.arguments, [
    "-L",
    "snes9x",
    "roms/chrono-trigger.sfc",
  ]);
});

test("resolveLaunchOverrides is a no-op without a binding and aborts on a missing ROM", async () => {
  const ctx = new MockClientPluginContext("drop-emulation", [
    ...CAPABILITIES,
  ]);
  const context = structuredClone(LAUNCH);
  assert.equal(await resolveLaunchOverrides(context, deps(ctx)), null);
  assert.equal(context.metadata, undefined);

  await ctx.storage.set("binding:g1", BINDING);
  await assert.rejects(
    () => resolveLaunchOverrides(structuredClone(LAUNCH), deps(ctx)),
    /was not found in the game directory/,
  );
});

test("resolveLaunchOverrides rejects emulators that are not installed or allowlisted", async () => {
  const ctx = new MockClientPluginContext("drop-emulation", [
    ...CAPABILITIES,
  ]);
  await ctx.storage.set("binding:g1", BINDING);
  await ctx.gameFs.writeFile("g1", BINDING.romPath, "rom-bytes");
  ctx.systemCommand.setResponse("retroarch", ["--version"], {
    code: 1,
    stdout: "",
    stderr: "command not allowlisted",
  });
  await assert.rejects(
    () => resolveLaunchOverrides(structuredClone(LAUNCH), deps(ctx)),
    /not installed or allowlisted/,
  );
});

test("the EmulatorPanel component reads the binding from storage", async () => {
  const ctx = new MockClientPluginContext("drop-emulation", [
    ...CAPABILITIES,
  ]);
  await ctx.storage.set("binding:g1", BINDING);
  const panel = createEmulatorPanel(ctx);
  assert.equal(panel.name, "EmulatorPanel");
  assert.match(panel.template, /game-detail|Emulator/);
  assert.match(panel.template, /binding\.romPath/);

  const state = panel.data();
  const self = { ...state, game: { id: "g1" } } as typeof state & {
    game: { id: string };
  };
  await panel.mounted.call(self as never);
  assert.equal(self.loading, false);
  assert.equal(self.error, "");
  assert.equal(self.binding?.romPath, BINDING.romPath);
});
