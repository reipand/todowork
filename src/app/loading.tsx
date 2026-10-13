import { Skeleton } from '@/components/ui/states';

/**
 * Route-level loading state.
 *
 * Shown while a route's segment is being prepared. It deliberately mirrors the shape every
 * dashboard route settles into — a header block and a list — rather than being a centred spinner,
 * so the transition into real content does not move anything on screen.
 *
 * The wait is announced through `aria-busy` on the container plus a visually hidden status line,
 * because a skeleton is invisible to a screen reader: without the announcement a screen reader
 * user would hear nothing at all during the load.
 */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col">
      <div className="flex flex-col gap-4 border-b border-line px-4 py-5 sm:px-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-start gap-3 border-b border-line pb-3">
              <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <p role="status" className="sr-only">
        Loading
      </p>
    </div>
  );
}
