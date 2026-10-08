import { type FC } from 'react';
import { DIFFICULTY_COLORS, DIFFICULTY_LABELS } from '@/lib/styles';
import type { Difficulty } from '@/types/data';
import { cn } from '@/utils/cn';

interface DifficultyBadgeProps {
  difficulty: Difficulty;
  /** Only the number, for tight spaces; the label is still in the tooltip. */
  compact?: boolean;
  estimated?: boolean;
  className?: string;
}

const DifficultyBadge: FC<DifficultyBadgeProps> = ({
  difficulty,
  compact,
  estimated,
  className,
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full border px-1.5 text-xs font-medium leading-5 whitespace-nowrap',
      estimated && 'border-dashed opacity-70',
      className,
    )}
    style={{
      borderColor: DIFFICULTY_COLORS[difficulty],
      color: DIFFICULTY_COLORS[difficulty],
    }}
    title={`Difficulty ${difficulty}/5: ${DIFFICULTY_LABELS[difficulty]}${estimated ? ' (not computed yet)' : ''}`}
  >
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ backgroundColor: DIFFICULTY_COLORS[difficulty] }}
    />
    {compact ? difficulty : `${difficulty} · ${DIFFICULTY_LABELS[difficulty]}`}
  </span>
);

export default DifficultyBadge;
