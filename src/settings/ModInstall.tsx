import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { API, type ModStatus } from './types';

const STATUS_LABEL: Record<ModStatus['installed'], string> = {
  installed: 'Installed',
  partial: 'Partially installed',
  'not-installed': 'Not installed',
  unknown: 'Anomaly not found',
};

const STATUS_BADGE_CLASS: Record<ModStatus['installed'], string> = {
  installed: 'set-badge--ok',
  partial: 'set-badge--warn',
  'not-installed': 'set-badge--off',
  unknown: 'set-badge--off',
};

function ModInstall() {
  const [status, setStatus] = useState<ModStatus | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPaths, setEditingPaths] = useState<boolean>(false);
  const [gammaInput, setGammaInput] = useState<string>('');
  const [anomalyInput, setAnomalyInput] = useState<string>('');
  const [browsing, setBrowsing] = useState<'gamma' | 'anomaly' | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(true);
  // Falls back to a plain editable field for whichever one the native
  // picker just failed on (e.g. PowerShell missing/blocked) — otherwise a
  // failed picker would leave the read-only field with no way to set it.
  const [manualEntry, setManualEntry] = useState<{ gamma: boolean; anomaly: boolean }>({
    gamma: false,
    anomaly: false,
  });

  const seqRef = useRef(0);
  const bumpSeq = useCallback(() => ++seqRef.current, []);
  const isStaleSeq = useCallback((seq: number) => seq !== seqRef.current, []);

  const load = useCallback(async (): Promise<void> => {
    const seq = bumpSeq();

    try {
      const data: ModStatus = await fetch(`${API}/mod/status`).then((res) => res.json());

      if (isStaleSeq(seq)) {
        return;
      }

      setStatus(data);
      setGammaInput(data.overrides.gammaPath || data.gammaPath || '');
      setAnomalyInput(data.overrides.anomalyPath || data.anomalyPath || '');
    } catch {
      // leave the last known status in place
    }
  }, [bumpSeq, isStaleSeq]);

  useEffect(() => {
    load();
  }, [load]);

  const install = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`${API}/mod/install`, { method: 'POST' }).then((r) =>
        r.json(),
      );

      if (res.error) {
        setError(res.error);
      }
    } finally {
      setBusy(false);
      load();
    }
  }, [load]);

  const uninstall = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`${API}/mod/uninstall`, { method: 'POST' }).then((r) =>
        r.json(),
      );

      if (res.error) {
        setError(res.error);
      }
    } finally {
      setBusy(false);
      load();
    }
  }, [load]);

  const savePaths = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`${API}/mod/paths`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gammaPath: gammaInput.trim(),
          anomalyPath: anomalyInput.trim(),
        }),
      }).then((r) => r.json());

      if (res.error) {
        setError(res.error);

        return;
      }

      setEditingPaths(false);
    } finally {
      setBusy(false);
      load();
    }
  }, [gammaInput, anomalyInput, load]);

  const browseFolder = useCallback(async (kind: 'gamma' | 'anomaly'): Promise<void> => {
    setBrowsing(kind);
    setError(null);

    try {
      const res = await fetch(`${API}/mod/browse-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      }).then((r) => r.json());

      if (res.error) {
        // Couldn't launch the native picker (e.g. no PowerShell) — fall
        // back to letting the streamer type the path in for this field.
        setError(`${res.error} — you can type the path in below instead`);
        setManualEntry((prev) => ({ ...prev, [kind]: true }));

        return;
      }

      if (res.path) {
        if (kind === 'gamma') {
          setGammaInput(res.path);
        } else {
          setAnomalyInput(res.path);
        }
      }
    } catch {
      setError('Failed to reach the server — you can type the path in below instead');
      setManualEntry((prev) => ({ ...prev, [kind]: true }));
    } finally {
      setBrowsing(null);
    }
  }, []);

  const resetPaths = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await fetch(`${API}/mod/paths/reset`, { method: 'POST' });
      setEditingPaths(false);
    } finally {
      setBusy(false);
      load();
    }
  }, [load]);

  if (!status) {
    return null;
  }

  // Anomaly is the only one installMod()/uninstallMod() actually need —
  // GAMMA only matters for the legacy GAMMA\mods fallback and as a
  // shortcut for re-finding Anomaly. Still, showing a healthy green
  // "Installed" badge while one of the two is missing reads as "nothing's
  // wrong" when something clearly is — so the badge (and Install itself)
  // require both to be found, even though only Anomaly is technically
  // load-bearing.
  const foldersReady = Boolean(status.gammaPath) && Boolean(status.anomalyPath);
  const badgeIsWarn = status.installed !== 'unknown' && !foldersReady;
  const topBadgeClass = badgeIsWarn ? 'set-badge--warn' : STATUS_BADGE_CLASS[status.installed];
  const topHeadingCountClass = badgeIsWarn
    ? 'set-heading-count--warn'
    : status.installed === 'installed'
      ? 'set-heading-count--ok'
      : 'set-heading-count--off';
  const topLabel = badgeIsWarn ? 'Folder missing' : STATUS_LABEL[status.installed];

  return (
    <section className="set-section">
      <button
        className="set-heading set-heading--toggle"
        onClick={() => setCollapsed((prev) => !prev)}
      >
        <span className={`set-chevron ${collapsed ? '' : 'is-open'}`}>▸</span>
        Mod install
        <span className={`set-heading-count ${topHeadingCountClass}`}>{topLabel}</span>
      </button>

      {!collapsed && (
        <>
          <p className="set-muted">
            Installs the mod straight into Anomaly's <code>gamedata</code> folder, so it
            loads whether you launch through the GAMMA launcher or the game exe directly.
            Manual installs into <code>GAMMA\mods</code> keep working too.
          </p>

          <div className="set-row">
            <span className={`set-badge ${topBadgeClass}`}>{topLabel}</span>

            {status.installed === 'not-installed' || status.installed === 'partial' ? (
              <button
                className="set-btn set-btn--primary"
                onClick={install}
                disabled={busy || !foldersReady}
              >
                {busy
                  ? 'Working…'
                  : status.installed === 'partial'
                    ? 'Repair install'
                    : 'Install'}
              </button>
            ) : status.installed === 'installed' ? (
              <>
                <button className="set-btn" onClick={uninstall} disabled={busy}>
                  Uninstall
                </button>
              </>
            ) : null}
          </div>

          {(status.installed === 'not-installed' || status.installed === 'partial') &&
            !foldersReady && (
              <p className="set-muted">
                Find both the GAMMA and Anomaly folders below before installing.
              </p>
            )}

          {error && <p className="set-reward-error">{error}</p>}

          <div className="set-integration">
            <h3 className="set-subheading">Detected paths</h3>

            {!editingPaths ? (
              <>
                <div className="set-row">
                  <span className="set-muted">GAMMA</span>
                  {status.gammaPath ? (
                    <code>{status.gammaPath}</code>
                  ) : (
                    <span className="set-badge set-badge--warn">Not found</span>
                  )}
                </div>
                <div className="set-row">
                  <span className="set-muted">Anomaly</span>
                  {status.anomalyPath ? (
                    <code>{status.anomalyPath}</code>
                  ) : (
                    <span className="set-badge set-badge--off">Not found</span>
                  )}
                </div>

                {!status.anomalyPath && (
                  <p className="set-muted">
                    Without the Anomaly folder, install/uninstall can&apos;t run — set it
                    manually below.
                  </p>
                )}

                {status.anomalyPath && !status.gammaPath && (
                  <p className="set-muted">
                    {status.installed === 'installed'
                      ? "GAMMA folder not found — doesn't affect the mod that's already installed, but set it below before reinstalling."
                      : 'GAMMA folder not found — set it below before you can install.'}
                  </p>
                )}

                <div className="set-row">
                  <button className="set-btn" onClick={() => setEditingPaths(true)}>
                    Set manually…
                  </button>
                </div>
              </>
            ) : (
              <div className="set-path-fields">
                <label className="set-reward-field">
                  GAMMA folder
                  <div className="set-path-row">
                    <input
                      className="set-reward-input set-path-input"
                      value={gammaInput}
                      readOnly={!manualEntry.gamma}
                      onChange={(event) => setGammaInput(event.target.value)}
                      placeholder="e.g. D:\G.A.M.M.A\GAMMA"
                    />
                    <button
                      className="set-btn"
                      onClick={() => browseFolder('gamma')}
                      disabled={busy || browsing !== null}
                    >
                      {browsing === 'gamma' ? 'Waiting…' : 'Browse…'}
                    </button>
                  </div>
                </label>
                <label className="set-reward-field">
                  Anomaly folder
                  <div className="set-path-row">
                    <input
                      className="set-reward-input set-path-input"
                      value={anomalyInput}
                      readOnly={!manualEntry.anomaly}
                      onChange={(event) => setAnomalyInput(event.target.value)}
                      placeholder="e.g. D:\G.A.M.M.A\Anomaly"
                    />
                    <button
                      className="set-btn"
                      onClick={() => browseFolder('anomaly')}
                      disabled={busy || browsing !== null}
                    >
                      {browsing === 'anomaly' ? 'Waiting…' : 'Browse…'}
                    </button>
                  </div>
                </label>
                <div className="set-row">
                  <button
                    className="set-btn set-btn--primary"
                    onClick={savePaths}
                    disabled={busy || browsing !== null}
                  >
                    Save
                  </button>
                  <button
                    className="set-btn"
                    onClick={resetPaths}
                    disabled={busy || browsing !== null}
                  >
                    Reset to auto-detect
                  </button>
                  <button
                    className="set-btn"
                    onClick={() => setEditingPaths(false)}
                    disabled={busy || browsing !== null}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default memo(ModInstall);
