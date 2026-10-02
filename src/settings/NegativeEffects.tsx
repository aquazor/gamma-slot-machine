import { memo } from 'react';

import ChanceSection from './ChanceSection';
import type { NegativeEffect } from './types';

function NegativeEffects() {
  return (
    <ChanceSection<NegativeEffect>
      path="/roulette/negative-effects"
      responseKey="effects"
      title="Negative Effects"
      intro="A negative effect roll picks one of these at random (weighted odds among the ones enabled below)."
      resetConfirm="Restore all negative effects to their default chances and re-enable them all?"
    />
  );
}

export default memo(NegativeEffects);
