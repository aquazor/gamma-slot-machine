import { memo } from 'react';

import ChanceSection from './ChanceSection';
import type { SpawnBonus } from './types';

interface Props {
  // Count Roll (labs) has its own independent bonus chances/enable state
  // (see enemies-labs.cjs) — same UI, different endpoints.
  labs?: boolean;
}

function SpawnBonuses({ labs = false }: Props) {
  return (
    <ChanceSection<SpawnBonus>
      path={labs ? '/roulette/labs/bonuses' : '/roulette/bonuses'}
      responseKey="bonuses"
      title={`Spawn bonuses${labs ? ' (Labs)' : ''}`}
      intro="Chance of a bonus on a spawn roll."
      resetConfirm="Restore all spawn bonuses to their default chances and re-enable them all?"
      footer={(bonuses) => {
        const totalPercent =
          Math.round(
            bonuses.filter((b) => b.enabled).reduce((sum, b) => sum + b.chance, 0) * 1000,
          ) / 10;

        return (
          <p className={`set-muted ${totalPercent > 100 ? 'set-bonus-total--over' : ''}`}>
            Total enabled chance: {totalPercent}%
            {totalPercent > 100 &&
              ' — over 100%, so a bonus always lands and each one splits the pie by its own share instead of by no-bonus odds'}
          </p>
        );
      }}
    />
  );
}

export default memo(SpawnBonuses);
