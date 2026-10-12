import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/barlow-semi-condensed/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/start.css';
import './styles/fight.css';
import './styles/overview.css';
import './styles/shared.css';
import './styles/compare.css';
import './styles/runs.css';
import './styles/settings.css';
import './styles/reports.css';
import './styles/details.css';
import './styles/tabs.css';
import './styles/breakdown.css';
import './styles/theme.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, readTheme, readThemeMode } from './theme';

// Before the first render, so the stored theme paints from the start.
applyTheme(readTheme(), readThemeMode());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
