#!/usr/bin/env python3
"""Post a published release to the Discord #announcements webhook and ping the Release Ping role."""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

EMBED_DESCRIPTION_LIMIT = 4096
ACCENT = 0xE8913A


def release_notes(body, url):
    notes = re.sub(r'<!--.*?-->', '', body or '', flags=re.DOTALL).strip()
    if len(notes) <= EMBED_DESCRIPTION_LIMIT:
        return notes
    more = f'\n\n[Full release notes on GitHub]({url})'
    return notes[:EMBED_DESCRIPTION_LIMIT - len(more) - 1].rstrip() + '…' + more


def build_message(tag, url, body, prerelease, role_id):
    embed = {'title': f'OpenLogs {tag}', 'url': url, 'color': ACCENT}
    notes = release_notes(body, url)
    if notes:
        embed['description'] = notes
    as_prerelease = ' as a pre-release' if prerelease else ''
    ping = f'<@&{role_id}> ' if role_id else ''
    return {
        'content': f'{ping}**OpenLogs {tag}** is out{as_prerelease}. Web app and download: <https://openlogs.gg>',
        'allowed_mentions': {'roles': [role_id] if role_id else []},
        'embeds': [embed],
    }


def main():
    webhook = os.getenv('DISCORD_RELEASE_WEBHOOK', '')
    if not webhook:
        print('::notice::DISCORD_RELEASE_WEBHOOK is not set, so the release is not announced on Discord.')
        return
    tag = os.environ['RELEASE_TAG']
    release = json.loads(subprocess.run(
        ['gh', 'release', 'view', tag, '--repo', os.environ['GH_REPO'], '--json', 'body,url'],
        check=True, capture_output=True, text=True,
    ).stdout)
    message = build_message(tag, release['url'], release['body'], os.getenv('PRERELEASE') == 'true', os.getenv('DISCORD_ROLE_ID', ''))
    request = urllib.request.Request(
        webhook,
        data=json.dumps(message).encode('utf-8'),
        # Discord's edge rejects urllib's default User-Agent.
        headers={'Content-Type': 'application/json', 'User-Agent': 'OpenLogs release announcer'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=30):
            pass
    except urllib.error.HTTPError as error:
        print(f'::error::Discord rejected the announcement with {error.code}: {error.read().decode("utf-8", "replace")}', file=sys.stderr)
        sys.exit(1)
    print(f'Announced {tag} on Discord')


if __name__ == '__main__':
    main()
