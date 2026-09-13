import { createRoot } from 'react-dom/client';

const path = window.location.pathname.replace(/\/+$/, '');

const root = createRoot(document.getElementById('root')!);

/*
 * Lightweight path-based routing — no react-router dependency
 * so the SEA bundle stays small.
 *
 *   /            -> manual slot machine (unchanged)
 *   /overlay     -> OBS Browser Source, event-driven roll
 *   /settings    -> Twitch connection + roulette settings
 *   /bits-guide  -> Custom Power-ups setup walkthrough
 */
if (path === '/overlay') {
  import('./Overlay.tsx').then(({ default: Overlay }) => {
    root.render(<Overlay />);
  });
} else if (path === '/settings') {
  import('./Settings.tsx').then(({ default: Settings }) => {
    root.render(<Settings />);
  });
} else if (path === '/bits-guide') {
  import('./BitsGuide.tsx').then(({ default: BitsGuide }) => {
    root.render(<BitsGuide />);
  });
} else {
  import('./App.tsx').then(({ default: App }) => {
    root.render(<App />);
  });
}
