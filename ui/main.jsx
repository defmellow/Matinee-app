import { render } from 'preact';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import App, { Guard } from './app.jsx';
import { cachedTheme, cachedMotion } from './shell.js';
import { installErrorReporting } from './debug/report.js';
import { installMacMouseButtons } from './platform.js';

// Record every uncaught error and failed core call from the very first moment.
installErrorReporting();
installMacMouseButtons();

// Apply the remembered theme before the first paint (the saved setting arrives later with the core).
try { const t = cachedTheme(localStorage); if (t) document.documentElement.dataset.theme = t; } catch { /* no storage */ }
try { if (cachedMotion(localStorage)) document.documentElement.dataset.motion = 'less'; } catch { /* no storage */ }

// Guard here too: if the shell itself (not just one screen) crashes, say so instead of showing a blank window.
render(<Guard name="Matinee"><App /></Guard>, document.getElementById('app'));
