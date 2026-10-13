import { type ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  title: string;
}

interface SegmentedControlProps<T extends string | number> {
  /** What the choice is about, for screen readers. */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/**
 * A segmented switch: the chosen option is filled, the others dimmed, so the current state reads at
 * a glance on a dark background.
 */
const SegmentedControl = <T extends string | number>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedControlProps<T>) => (
  <div
    className={cn('flex rounded-full border border-base-content/20 bg-base-200 p-0.5', className)}
    role="radiogroup"
    aria-label={label}
  >
    {options.map((option) => {
      const selected = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={selected}
          className={cn(
            'flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
            selected
              ? 'bg-info text-info-content shadow-sm'
              : 'text-base-content/50 hover:text-base-content',
          )}
          onClick={() => onChange(option.value)}
          title={option.title}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

export default SegmentedControl;
