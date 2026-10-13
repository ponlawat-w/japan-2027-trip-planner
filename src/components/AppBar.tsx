import { Check, Link2, Redo2, Snowflake, Undo2 } from 'lucide-react';
import { useEffect, useState, type FC } from 'react';
import { shareUrl } from '@/lib/shareLink';
import { usePlanStore } from '@/store/planStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import SegmentedControl from '@/ui/SegmentedControl';

const COPIED_FEEDBACK_MS = 2000;

const AppBar: FC = () => {
  const undo = usePlanStore((state) => state.undo);
  const redo = usePlanStore((state) => state.redo);
  const canUndo = usePlanStore((state) => state.past.length > 0);
  const canRedo = usePlanStore((state) => state.future.length > 0);
  const units = usePreferencesStore((state) => state.units);
  const setUnits = usePreferencesStore((state) => state.setUnits);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyLink = async () => {
    const { plan, homeMode, rental } = usePlanStore.getState();
    const url = shareUrl({ plan, homeMode, rental });
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-base-300 bg-mist-950/90 px-3 backdrop-blur md:px-4">
      <Snowflake className="h-5 w-5 shrink-0 text-sky-300" />
      <h1 className="grow truncate text-base font-semibold">
        Japan 2027{' '}
        <span className="hidden font-normal text-base-content/60 sm:inline">· 2–15 Feb</span>
      </h1>
      <SegmentedControl
        className="mr-1"
        label="Units"
        value={units}
        onChange={setUnits}
        options={[
          { value: 'metric', label: 'km', title: 'Kilometres and metres' },
          { value: 'imperial', label: 'mi', title: 'Miles and feet' },
        ]}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-square"
        onClick={undo}
        disabled={!canUndo}
        title="Undo"
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-square"
        onClick={redo}
        disabled={!canRedo}
        title="Redo"
      >
        <Redo2 className="h-4 w-4" />
      </button>
      <button type="button" className="btn btn-sm btn-soft btn-info" onClick={copyLink}>
        {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
        <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy link'}</span>
      </button>
    </header>
  );
};

export default AppBar;
