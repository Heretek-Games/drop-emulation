import type { ClientPluginSystem } from "@droposs/plugin-sdk";

export interface EmulatorDefinition {
  /** Bare executable name; must be allowlisted in `client.commands`. */
  id: string;
  name: string;
  /** Command template, e.g. `retroarch -L {core} {rom_path}`. */
  command: string;
  /** Extra argument templates appended after the command template. */
  args?: string[];
  /** Probe arguments used to detect an installed emulator. */
  probeArgs?: string[];
}

export interface EmulatorBinding {
  /** Emulator definition id to launch. */
  emulatorId: string;
  /** Libretro core id (used by RetroArch-style `{core}` templates). */
  coreId: string;
  /** ROM path relative to the game directory. */
  romPath: string;
  /** Optional per-binding command template override. */
  command?: string;
}

export interface LaunchSpec {
  emulatorId: string;
  /** Resolved executable name. */
  command: string;
  /** Expanded argument list. */
  args: string[];
  /** Display form of the full command line. */
  commandLine: string;
}

export interface RomBindingMetadata extends LaunchSpec {
  romPath: string;
  coreId: string;
}

export const DEFAULT_PROBE_ARGS = ["--version"];

/** Emulators registered out of the box; keep in sync with `client.commands`. */
export const DEFAULT_EMULATORS: EmulatorDefinition[] = [
  { id: "retroarch", name: "RetroArch", command: "retroarch -L {core} {rom_path}" },
  { id: "dolphin-emu", name: "Dolphin", command: "dolphin-emu -e {rom_path}" },
  { id: "duckstation-qt", name: "DuckStation", command: "duckstation-qt {rom_path}" },
  { id: "pcsx2-qt", name: "PCSX2", command: "pcsx2-qt {rom_path}" },
  { id: "melonds", name: "melonDS", command: "melonds {rom_path}" },
  { id: "mgba-qt", name: "mGBA", command: "mgba-qt {rom_path}" },
  { id: "snes9x-gtk", name: "Snes9x", command: "snes9x-gtk {rom_path}" },
  { id: "mupen64plus", name: "Mupen64Plus", command: "mupen64plus {rom_path}" },
  { id: "flycast", name: "Flycast", command: "flycast {rom_path}" },
  { id: "ppsspp-qt", name: "PPSSPP", command: "ppsspp-qt {rom_path}" },
];

/** Expands the ROM placeholders in an emulator launch command. */
export function expandRomArgs(command: string, binding: EmulatorBinding): string {
  return command
    .replaceAll("{rom_path}", binding.romPath)
    .replaceAll("{core}", binding.coreId);
}

/**
 * Splits a command template into tokens. Supports single/double quotes and
 * backslash escapes so paths containing spaces survive the rewrite.
 */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let quoted = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (
        char === "\\" &&
        index + 1 < command.length &&
        (command[index + 1] === quote || command[index + 1] === "\\")
      ) {
        index += 1;
        current += command[index];
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      quoted = true;
    } else if (/\s/.test(char)) {
      if (current.length > 0 || quoted) {
        tokens.push(current);
        current = "";
        quoted = false;
      }
    } else {
      current += char;
    }
  }
  if (quote) throw new Error("Unterminated quote in emulator command");
  if (current.length > 0 || quoted) tokens.push(current);
  return tokens;
}

/**
 * Rewrites a binding into a concrete launch spec: expands placeholders in the
 * template (and any extra args) and splits the result into command + argv.
 */
export function buildLaunchSpec(
  definition: EmulatorDefinition,
  binding: EmulatorBinding,
): LaunchSpec {
  const template = binding.command ?? definition.command;
  const expanded = expandRomArgs(template, binding);
  const tokens = tokenizeCommand(expanded);
  const [command, ...args] = tokens;
  if (!command) {
    throw new Error(`Emulator '${definition.id}' has an empty command template`);
  }
  const extraArgs = (definition.args ?? []).map((arg) =>
    expandRomArgs(arg, binding),
  );
  return {
    emulatorId: definition.id,
    command,
    args: [...args, ...extraArgs],
    commandLine: [command, ...args, ...extraArgs].join(" "),
  };
}

/**
 * Probes configured emulators through the client host's allowlisted command
 * runner. Emulators that are missing, not allowlisted, or exit non-zero are
 * omitted so a broken binding fails before launch.
 */
export async function discoverEmulators(
  definitions: EmulatorDefinition[],
  system: ClientPluginSystem,
): Promise<EmulatorDefinition[]> {
  const available: EmulatorDefinition[] = [];
  for (const definition of definitions) {
    try {
      const result = await system.run(
        definition.id,
        definition.probeArgs ?? DEFAULT_PROBE_ARGS,
        { timeoutMs: 5_000 },
      );
      if (result.code === 0) available.push(definition);
    } catch {
      // Not installed or not allowlisted: skip.
    }
  }
  return available;
}
