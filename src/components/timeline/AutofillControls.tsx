import { Dices, Eraser } from 'lucide-react';
import { type FC } from 'react';
import { clearUnpinned } from '@/lib/plan';
import { usePlanStore } from '@/store/planStore';

/** Auto-fill, which draws a new random seed on every click and so suggests a different plan. */
const AutofillControls: FC = () => {
  const runAutofill = usePlanStore((state) => state.runAutofill);
  const setPlan = usePlanStore((state) => state.setPlan);
  const freeNights = usePlanStore((state) => state.plan.filter((night) => !night.pinned).length);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => setPlan(clearUnpinned(usePlanStore.getState().plan))}
        disabled={freeNights === 0}
        title="Empty every night that is not pinned"
      >
        <Eraser className="h-4 w-4" />
        <span className="hidden sm:inline">Clear unpinned</span>
      </button>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        onClick={() => runAutofill()}
        disabled={freeNights === 0}
        title="Fill every unpinned night. Click again for a different suggestion."
      >
        <Dices className="h-4 w-4" />
        Auto-fill
      </button>
    </div>
  );
};

export default AutofillControls;
