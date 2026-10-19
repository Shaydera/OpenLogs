#!/usr/bin/env python3
"""Expose the wasm-bindgen version pinned in Cargo.lock so CI installs the matching CLI."""
import os
import sys
import tomllib


def fail(message):
    print(f'::error::{message}', file=sys.stderr)
    sys.exit(1)


def main():
    with open('Cargo.lock', 'rb') as file:
        versions = {p['version'] for p in tomllib.load(file)['package'] if p['name'] == 'wasm-bindgen'}
    if len(versions) != 1:
        fail(f'Expected exactly one wasm-bindgen version in Cargo.lock, got {sorted(versions)}')
    version = versions.pop()

    print(f'wasm-bindgen {version}')
    output = os.getenv('GITHUB_OUTPUT')
    if output:
        with open(output, 'a', encoding='utf-8') as out:
            out.write(f'version={version}\n')


if __name__ == '__main__':
    main()
