import { memo } from 'react';

import ChanceSection from './ChanceSection';
import type { Perk } from './types';

function PositiveEffects() {
  return (
    <ChanceSection<Perk>
      path="/roulette/perks"
      responseKey="perks"
      title="Positive Effects"
      intro="A positive effect roll picks one of these at random (weighted odds among the ones enabled below)."
      resetConfirm="Restore all positive effects to their default chances and re-enable them all?"
    />
  );
}

export default memo(PositiveEffects);
