#!/usr/bin/env python3
"""Fail CI unless its Git tag, UI package, Cargo workspace, and Tauri app share one SemVer."""
import json
import os
import pathlib
import re
import sys
import tomllib

SEMVER = re.compile(
    r'^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'
    r'(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?'
    r'(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$'
)


def fail(message):
    print(f'::error::{message}', file=sys.stderr)
    sys.exit(1)


def effective_tauri_version(cargo_version):
    tauri_path = pathlib.Path('src-tauri/tauri.conf.json')
    if not tauri_path.is_file():
        fail('Cannot validate desktop version: missing src-tauri/tauri.conf.json')
    declared = json.loads(tauri_path.read_text('utf-8')).get('version')
    # Tauri falls back to the Cargo version when unset and accepts a path to a package.json.
    if declared is None:
        return cargo_version
    if declared.endswith('.json'):
        package_path = tauri_path.parent / declared
        if not package_path.is_file():
            fail(f'Tauri version points to missing file {declared!r}')
        return json.loads(package_path.read_text('utf-8')).get('version')
    return declared


def main():
    if os.getenv('GITHUB_REF_TYPE') != 'tag':
        fail('Workflow must be run for a git tag, not a branch')
    tag = os.getenv('GITHUB_REF_NAME', '')
    match = SEMVER.fullmatch(tag)
    if not match:
        fail(f'Invalid version tag: {tag!r}; expected vMAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]')
    prerelease = match.group(4)
    if prerelease and any(x.isdigit() and len(x) > 1 and x[0] == '0' for x in prerelease.split('.')):
        fail(f'Invalid SemVer prerelease numeric identifier: {tag!r}')
    version = tag[1:]

    ui = json.loads(pathlib.Path('ui/package.json').read_text('utf-8'))
    if ui.get('version') != version:
        fail(f'ui/package.json version {ui.get("version")!r} does not match {version!r}. Update it before tagging.')

    cargo = tomllib.loads(pathlib.Path('Cargo.toml').read_text('utf-8'))
    cargo_version = cargo.get('workspace', {}).get('package', {}).get('version')
    if cargo_version != version:
        fail(f'Cargo workspace version {cargo_version!r} does not match {version!r}. Update it before tagging.')

    tauri_version = effective_tauri_version(cargo_version)
    if tauri_version != version:
        fail(f'Tauri version {tauri_version!r} does not match {version!r}. Update it before tagging.')

    # Fail early on missing reproducibility inputs.
    for required in ('package-lock.json', 'ui/package-lock.json', 'Cargo.lock', 'ui/scripts/build-wasm.mjs'):
        if not pathlib.Path(required).is_file():
            fail(f'Missing build prerequisite: {required}')

    print(f'Versions agree: {tag} (UI + Cargo + Tauri)')
    output = os.getenv('GITHUB_OUTPUT')
    if output:
        with open(output, 'a', encoding='utf-8') as out:
            out.write(f'tag={tag}\n')
            out.write(f'prerelease={"true" if prerelease else "false"}\n')


if __name__ == '__main__':
    main()
