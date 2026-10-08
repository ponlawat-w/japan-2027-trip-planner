import { Images } from 'lucide-react';
import { type FC } from 'react';
import type { Destination } from '@/types/data';
import { cn } from '@/utils/cn';

/**
 * Google Images for a destination, in a new tab, searched by its Japanese name: Japanese pages
 * photograph a 温泉地 far more than English ones do, and the Japanese name is unambiguous where an
 * English one ("Gora", "Kawazu") is not.
 */
const imageSearchUrl = (destination: Destination): string =>
  `https://www.google.com/search?${new URLSearchParams({ tbm: 'isch', q: destination.nameJa })}`;

const ImageSearchLink: FC<{ destination: Destination; className?: string }> = ({
  destination,
  className,
}) => (
  <a
    href={imageSearchUrl(destination)}
    target="_blank"
    rel="noopener noreferrer"
    className={cn(
      'btn btn-ghost btn-sm btn-square text-base-content/60 hover:text-info',
      className,
    )}
    title={`Photos of ${destination.nameJa} on Google Images`}
    aria-label={`Photos of ${destination.name} on Google Images (opens in a new tab)`}
  >
    <Images className="h-4 w-4" />
  </a>
);

export default ImageSearchLink;
