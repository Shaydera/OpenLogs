import { afterEach, describe, expect, it } from 'vitest';
import tokensCss from '../../styles/tokens.css?raw';
import { readStageColors } from './stageColors';

const root = document.documentElement;
const style = document.createElement('style');

afterEach(() => {
  style.remove();
  delete root.dataset.theme;
  delete root.dataset.mode;
});

describe('stage colours', () => {
  it('re-reads tokens when theme or mode changes', () => {
    style.textContent = tokensCss;
    document.head.append(style);
    root.dataset.theme = 'slate';
    root.dataset.mode = 'dark';
    const slateDark = readStageColors(root);

    root.dataset.mode = 'light';
    const slateLight = readStageColors(root);
    expect(slateLight.plot).not.toBe(slateDark.plot);

    root.dataset.theme = 'bark';
    expect(readStageColors(root).plot).not.toBe(slateLight.plot);
  });
});
