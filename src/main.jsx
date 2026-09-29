import { render } from 'preact';
import './styles/app.css';
import './render/renderer.css';
import './viewer/viewer.css';
import manifest from './generated/font-manifest.json';
import { setFontRegistry, registerRegistryFaces } from './render/fonts.js';
import { App } from './app/App.jsx';
import { applyColorScheme } from './app/settings.js';

setFontRegistry(manifest.families, { base: './' });
registerRegistryFaces();
applyColorScheme();

render(<App />, document.getElementById('app'));
