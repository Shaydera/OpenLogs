import { describe, expect, it } from 'vitest';
import { iconUrl } from './icons';

describe('iconUrl', () => {
  it('uses the http form Tauri needs on Windows and the custom scheme elsewhere', () => {
    expect(iconUrl('spell/44425', true)).toBe('http://wowicon.localhost/spell/44425');
    expect(iconUrl('class/8', false)).toBe('wowicon://localhost/class/8');
  });
});
