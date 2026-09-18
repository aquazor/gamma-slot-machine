import { memo } from 'react';

import { API, type DeviceFlow, type EventSubStatus, type TwitchStatus } from './types';

interface Props {
  twitch: TwitchStatus;
  eventSub: EventSubStatus | null;
  overlayPresent: boolean;
  busy: boolean;
  flow: DeviceFlow | null;
  authState: string;
  copied: boolean;
  connect: () => void;
  disconnect: () => void;
  copyOverlayUrl: () => void;
}

function IntegrationsSection({
  twitch,
  eventSub,
  overlayPresent,
  busy,
  flow,
  authState,
  copied,
  connect,
  disconnect,
  copyOverlayUrl,
}: Props) {
  return (
    <section className="set-section">
      <h2 className="set-heading">Integrations</h2>

      <div className="set-integration">
        <h3 className="set-subheading">Twitch</h3>

        {twitch.connected ? (
          <>
            <div className="set-row">
              <span className="set-badge set-badge--ok">Connected</span>
              <span className="set-muted">as {twitch.login}</span>
              <button className="set-btn" onClick={disconnect}>
                Disconnect
              </button>
            </div>

            <div className="set-row">
              <span
                className={`set-badge ${
                  eventSub?.connected ? 'set-badge--ok' : 'set-badge--off'
                }`}
              >
                {eventSub?.connected ? 'Listening' : 'Not listening'}
              </span>
              <span className="set-muted">
                subs · resubs · gift subs · bits · channel points
              </span>
            </div>
          </>
        ) : (
          <div className="set-row">
            <span className="set-badge set-badge--off">Not connected</span>
            <button className="set-btn set-btn--primary" onClick={connect} disabled={busy}>
              {busy ? 'Starting…' : 'Connect Twitch'}
            </button>
          </div>
        )}

        {flow && (
          <div className="set-flow">
            <p>
              Open <strong>{flow.verificationUri}</strong> and enter this code:
            </p>
            <div className="set-code">{flow.userCode}</div>
            <p className="set-muted">
              {authState === 'pending' ? 'Waiting for you to approve on Twitch…' : authState}
            </p>
          </div>
        )}
      </div>

      <div className="set-integration">
        <h3 className="set-subheading">OBS overlay</h3>

        <div className="set-row">
          <span className={`set-badge ${overlayPresent ? 'set-badge--ok' : 'set-badge--off'}`}>
            {overlayPresent ? 'Connected' : 'Not open'}
          </span>
        </div>

        <div className="set-obs">
          <span className="set-muted">Browser Source URL</span>
          <code>{API}/overlay</code>
          <button className="set-btn set-obs-copy" onClick={copyOverlayUrl}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    </section>
  );
}

export default memo(IntegrationsSection);
