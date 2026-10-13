// Builds the engine (crates/openlogs-wasm) into src/engine/pkg.
// Needs the wasm32-unknown-unknown target and wasm-bindgen-cli in the version Cargo.toml pins.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });

run('cargo', ['build', '--release', '--lib', '-p', 'openlogs-wasm', '--target', 'wasm32-unknown-unknown']);
run('wasm-bindgen', [
  '--target',
  'web',
  '--out-dir',
  'ui/src/engine/pkg',
  'target/wasm32-unknown-unknown/release/openlogs_wasm.wasm',
]);
