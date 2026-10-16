import classesSpecs from '../../../../crates/openlogs-gamedata/data/classes_specs.json';
import { MARKER_SYMBOLS, type MarkerSymbol, markerColorVar } from './worldMarkers';

export interface StageColors {
  plot: string;
  text: string;
  muted: string;
  panelRaised: string;
  line: string;
  accent: string;
  iconRing: string;
  dead: string;
  boss: string;
  add: string;
  fontText: string;
  fontLabel: string;
  /** By lower-case class token, e.g. `priest`. */
  classes: Record<string, string>;
  markers: Record<MarkerSymbol, string>;
}

/** The stage's colours from the `tokens.css` variables now on `root`; read again after the theme or mode changes. */
export function readStageColors(root: HTMLElement): StageColors {
  const style = getComputedStyle(root);
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
  const classes: Record<string, string> = {};
  for (const { token: classToken } of classesSpecs.classes) {
    const key = classToken.toLowerCase();
    classes[key] = token(`class-${key}`);
  }
  const markers = Object.fromEntries(MARKER_SYMBOLS.map((symbol) => [symbol, style.getPropertyValue(markerColorVar(symbol)).trim()])) as Record<MarkerSymbol, string>;
  return {
    plot: token('plot'),
    text: token('text'),
    muted: token('muted'),
    panelRaised: token('panel-raised'),
    line: token('line'),
    accent: token('accent'),
    iconRing: token('icon-ring'),
    dead: token('dash'),
    boss: token('death'),
    add: token('wipe'),
    fontText: token('font-text'),
    fontLabel: token('font-label'),
    classes,
    markers,
  };
}
