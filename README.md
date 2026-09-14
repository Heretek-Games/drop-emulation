# Drop Emulation

Emulator and ROM linking plugin for Drop (#10, #189).

## How it works

Per-game bindings are stored under the client storage key
`binding:<gameId>` as `{ emulatorId, coreId, romPath, command? }`. Emulator
definitions live under the `emulators` key (falling back to the built-in list
in `src/emulator.ts`).

During the `pre-launch:prepare` stage the plugin:

1. Looks up the game's binding (no-op when unset).
2. Validates the ROM exists through the scoped `game:fs` API.
3. Probes configured emulators through the allowlisted `system:command` runner
   and drops anything missing or failing (`--version` probe).
4. Rewrites the launch command, expanding `{core}` and `{rom_path}` in the
   template, and publishes `metadata.launchCommand` plus
   `metadata.emulation` on the launch context.

A `game-detail:panels` slot (`EmulatorPanel`) shows the configured binding.

## Build

```sh
npm ci
npm run build
npm test
npm run typecheck
```
