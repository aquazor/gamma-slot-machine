import { useEffect, useRef, useState } from 'react';
import './Navbar.css';

const API = 'http://localhost:7770';

const LINKS = [
  { href: '/', label: 'Slot Machine' },
  { href: '/settings', label: 'Settings' },
];

interface TwitchStatus {
  connected: boolean;
  login: string | null;
}

export default function Navbar() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  const [twitch, setTwitch] = useState<TwitchStatus | null>(null);
  const warnedRef = useRef(false);

  useEffect(() => {
    const load = (): void => {
      fetch(`${API}/twitch/status`)
        .then((res) => res.json())
        .then((status: TwitchStatus) => {
          setTwitch(status);

          if (!status.connected && !warnedRef.current) {
            warnedRef.current = true;

            console.warn(
              'Twitch is not connected — subs, gift subs and bits will not trigger the roulette. ' +
                'Open /settings and click "Connect Twitch".',
            );
          }
        })
        .catch(() => {
          // server not up
        });
    };

    load();

    const interval = window.setInterval(load, 10000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <nav className="navbar">
      <a className="navbar-brand" href="/">
        <span className="navbar-brand-icon">🎰</span>
        GAMMA Loot Roulette
      </a>

      <div className="navbar-links">
        {LINKS.map((link) => (
          <a
            key={link.href}
            className={`navbar-link ${path === link.href ? 'is-active' : ''}`}
            href={link.href}
          >
            {link.label}
          </a>
        ))}
      </div>

      <a className="navbar-twitch" href="/settings" title="Twitch connection">
        <span
          className={`navbar-dot ${
            twitch == null ? 'is-loading' : twitch.connected ? 'is-on' : 'is-off'
          }`}
        />
        {twitch == null ? 'Twitch…' : twitch.connected ? twitch.login : 'Twitch'}
      </a>
    </nav>
  );
}
