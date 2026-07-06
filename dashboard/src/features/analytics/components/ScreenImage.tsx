import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import { useScreenImageBlob } from '../api';

/**
 * Renders a screen's screenshot (§18) fetched through the authed transport (see `useScreenImageBlob`)
 * and turned into an object URL, with a graceful "no screenshot yet" fallback tile whenever the image
 * is missing, still loading, or errored. Optional `children` are layered absolutely over the image box
 * (the click-heatmap overlay uses this); `aspectRatio` sizes the fallback board so an overlay still
 * maps onto a stable box when no screenshot exists.
 */
export function ScreenImage({
  projectId,
  screenName,
  alt,
  enabled = true,
  cacheKey,
  className,
  aspectRatio,
  objectFit = 'cover',
  children,
}: {
  projectId: string;
  screenName: string;
  alt: string;
  enabled?: boolean;
  /** The screen's latest `image_hash` — content-addresses the fetch so a retake busts the cache. */
  cacheKey?: string;
  className?: string;
  /** CSS `aspect-ratio` for the box (e.g. `"9 / 19.5"`) — keeps the overlay aligned without an image. */
  aspectRatio?: string;
  objectFit?: 'cover' | 'contain';
  children?: ReactNode;
}) {
  const query = useScreenImageBlob(projectId, screenName, enabled, cacheKey);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = query.data;
    if (!blob) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [query.data]);

  const hasImage = Boolean(objectUrl) && !query.isError;

  return (
    <div
      className={cn('relative overflow-hidden bg-chart-surface', className)}
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      {hasImage ? (
        <img
          src={objectUrl ?? undefined}
          alt={alt}
          loading="lazy"
          className={cn(
            'h-full w-full',
            objectFit === 'contain' ? 'object-contain' : 'object-cover',
          )}
        />
      ) : (
        <div className="flex h-full min-h-16 w-full flex-col items-center justify-center gap-1 p-2 text-center text-text-muted">
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 15l5-4 4 3 3-2 6 5" />
            <circle cx="8.5" cy="9" r="1.5" />
          </svg>
          <span className="text-xs">
            {query.isPending && enabled ? 'Loading…' : 'No screenshot yet'}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
