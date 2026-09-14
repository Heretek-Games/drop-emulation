import type {
  ClientPlugin,
  ClientPluginContext,
  LaunchContext,
} from "@droposs/plugin-sdk";

export interface EmulatorBinding {
  coreId: string;
  romPath: string;
}

/** Expands the ROM placeholder in an emulator launch command. */
export function expandRomArgs(command: string, binding: EmulatorBinding): string {
  return command.replaceAll("{rom_path}", binding.romPath).replaceAll("{core}", binding.coreId);
}

export default class EmulationPlugin implements ClientPlugin {
  metadata = {
    id: "drop-emulation",
    name: "Emulation & ROM Linking",
    version: "0.1.0",
  };

  async init(ctx: ClientPluginContext): Promise<void> {
    ctx.registerLaunchHook({
      stage: "pre-launch:prepare",
      execute: async (context: LaunchContext) => {
        const binding = await ctx.storage.get<EmulatorBinding>(`binding:${context.gameId}`);
        if (!binding) return;
        ctx.logger.debug(
          `ROM binding active for ${context.gameTitle}: ${expandRomArgs("{rom_path}", binding)}`,
        );
      },
    });

    ctx.registerSlot("game-detail:panels", { template: "EmulatorPanel" });
    ctx.logger.info("Emulation plugin initialized");
  }
}
