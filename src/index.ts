import type {
  ClientPlugin,
  ClientPluginContext,
  LaunchContext,
  ScopedGameFs,
  ClientPluginSystem,
  ClientPluginStorage,
  PluginLogger,
} from "@droposs/plugin-sdk";
import {
  type EmulatorBinding,
  type EmulatorDefinition,
  type RomBindingMetadata,
  DEFAULT_EMULATORS,
  buildLaunchSpec,
  discoverEmulators,
  expandRomArgs,
} from "./emulator.js";

export * from "./emulator.js";

export const BINDING_KEY_PREFIX = "binding:";
export const EMULATORS_KEY = "emulators";

export function bindingKey(gameId: string): string {
  return `${BINDING_KEY_PREFIX}${gameId}`;
}

interface EmulatorPanelThis {
  game?: { id?: string; title?: string };
  binding: EmulatorBinding | null;
  loading: boolean;
  error: string;
}

/**
 * Game-detail panel component. Uses the options API (no `vue` import) so the
 * plugin bundle stays framework-agnostic; the host renders `template` inside
 * the `game-detail:panels` slot.
 */
export function createEmulatorPanel(ctx: Pick<ClientPluginContext, "storage">) {
  return {
    name: "EmulatorPanel",
    props: { game: { type: Object, required: false } },
    data(): {
      binding: EmulatorBinding | null;
      loading: boolean;
      error: string;
    } {
      return { binding: null, loading: true, error: "" };
    },
    async mounted(this: EmulatorPanelThis) {
      const gameId = this.game?.id;
      if (!gameId) {
        this.loading = false;
        return;
      }
      try {
        this.binding = await ctx.storage.get<EmulatorBinding>(
          bindingKey(gameId),
        );
      } catch (error) {
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },
    template: `
      <div class="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h4 class="text-xs font-semibold text-zinc-200">Emulator</h4>
        <p v-if="loading" class="text-xs text-zinc-400 mt-1">Checking ROM binding&hellip;</p>
        <p v-else-if="error" class="text-xs text-red-400 mt-1">{{ error }}</p>
        <template v-else-if="binding">
          <p class="text-xs text-zinc-400 mt-1">
            Emulator: <span class="font-mono text-zinc-200">{{ binding.emulatorId }}</span>
          </p>
          <p v-if="binding.coreId" class="text-xs text-zinc-400 mt-1">
            Core: <span class="font-mono text-zinc-200">{{ binding.coreId }}</span>
          </p>
          <p class="text-xs text-zinc-400 mt-1">
            ROM: <span class="font-mono text-zinc-200">{{ binding.romPath }}</span>
          </p>
        </template>
        <p v-else class="text-xs text-zinc-400 mt-1">No ROM binding configured for this game.</p>
      </div>
    `,
  };
}

export interface ResolveLaunchDeps {
  gameFs: ScopedGameFs;
  system: ClientPluginSystem;
  storage: ClientPluginStorage;
  logger: PluginLogger;
}

/**
 * Validates the game's ROM binding, discovers an installed/allowlisted
 * emulator, and publishes the rewritten launch command on
 * `context.metadata.launchCommand` (plus `context.metadata.emulation`).
 * Throws to abort the launch pipeline when the binding is broken.
 */
export async function resolveLaunch(
  context: LaunchContext,
  deps: ResolveLaunchDeps,
): Promise<RomBindingMetadata | null> {
  const binding = await deps.storage.get<EmulatorBinding>(
    bindingKey(context.gameId),
  );
  if (!binding) return null;

  const romExists = await deps.gameFs.fileExists(
    context.gameId,
    binding.romPath,
  );
  if (!romExists) {
    throw new Error(
      `ROM '${binding.romPath}' was not found in the game directory`,
    );
  }

  const definitions =
    (await deps.storage.get<EmulatorDefinition[]>(EMULATORS_KEY)) ??
    DEFAULT_EMULATORS;
  const available = await discoverEmulators(definitions, deps.system);
  const definition = available.find(
    (entry) => entry.id === binding.emulatorId,
  );
  if (!definition) {
    throw new Error(
      `Emulator '${binding.emulatorId}' is not installed or allowlisted`,
    );
  }

  const spec = buildLaunchSpec(definition, binding);
  const metadata: RomBindingMetadata = {
    ...spec,
    romPath: binding.romPath,
    coreId: binding.coreId,
  };
  context.metadata = {
    ...(context.metadata ?? {}),
    launchCommand: spec.commandLine,
    emulation: metadata,
  };
  deps.logger.debug(
    `ROM binding ready for ${context.gameTitle}: ${spec.commandLine}`,
  );
  return metadata;
}

export default class EmulationPlugin implements ClientPlugin {
  metadata = {
    id: "drop-emulation",
    name: "Emulation & ROM Linking",
    version: "0.1.0",
    apiVersion: 2,
    capabilities: [
      "ui:slot" as const,
      "game:launch-hook" as const,
      "system:command" as const,
      "game:fs" as const,
      "client:storage" as const,
    ],
  };

  async init(ctx: ClientPluginContext): Promise<void> {
    ctx.registerLaunchHook({
      stage: "pre-launch:prepare",
      execute: async (context: LaunchContext) => {
        await resolveLaunch(context, {
          gameFs: ctx.gameFs,
          system: ctx.system,
          storage: ctx.storage,
          logger: ctx.logger,
        });
      },
    });

    ctx.registerSlot("game-detail:panels", createEmulatorPanel(ctx), {
      order: 40,
      label: "Emulator",
    });
    ctx.logger.info("Emulation plugin initialized");
  }
}
