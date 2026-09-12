import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { API, type EnemyFaction } from './types';

function EnemyFactions() {
  const [factions, setFactions] = useState<EnemyFaction[]>([]);

  // Guards against this component's own concurrent requests only — the
  // initial load racing a quick toggle right after mount.
  const seqRef = useRef(0);
  const bumpSeq = useCallback(() => ++seqRef.current, []);
  const isStaleSeq = useCallback((seq: number) => seq !== seqRef.current, []);

  useEffect(() => {
    const seq = bumpSeq();

    fetch(`${API}/roulette/enemies`)
      .then((res) => res.json())
      .then((data) => {
        if (isStaleSeq(seq)) {
          return;
        }

        setFactions(Array.isArray(data.factions) ? data.factions : []);
      })
      .catch(() => {
        // leave the list empty — section just won't render
      });
  }, [bumpSeq, isStaleSeq]);

  const toggleFaction = async (key: string, enabled: boolean): Promise<void> => {
    const seq = bumpSeq();

    setFactions((prev) => prev.map((f) => (f.key === key ? { ...f, enabled } : f)));

    const res = await fetch(`${API}/roulette/enemies/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: key, enabled }),
    }).then((r) => r.json());

    if (Array.isArray(res.factions) && !isStaleSeq(seq)) {
      setFactions(res.factions);
    }
  };

  if (factions.length === 0) {
    return null;
  }

  return (
    <section className="set-section">
      <h2 className="set-heading">Enemy factions</h2>

      <p className="set-muted">
        Turn off any faction you don't want spawned as a hostile squad — applies to every
        tier.
      </p>

      <div className="set-factions">
        {factions.map((faction) => (
          <label className="set-faction" key={faction.key}>
            <input
              type="checkbox"
              checked={faction.enabled}
              onChange={(event) => toggleFaction(faction.key, event.target.checked)}
            />
            {faction.icon && <img src={faction.icon} alt="" />}
            <span>{faction.label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

export default memo(EnemyFactions);
