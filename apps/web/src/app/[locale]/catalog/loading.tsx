import { BookGridSkeleton } from "@/components/domain";
import { PageShell, Shell } from "@/components/layout";
import { Skeleton } from "@/components/ui";

/* Wireframe 1b: the chrome lands first and the grid fills in. Skeletons hold
   the exact shape of what is coming, so nothing shifts (§9). */

export default function CatalogLoading() {
  return (
    <PageShell>
      <Shell className="py-14 lg:py-20">
        <Skeleton className="h-11 w-72 max-w-full" />
        <Skeleton className="mt-4 h-3 w-40" />

        {/* Search */}
        <Skeleton className="rounded-control mt-8 h-11 w-full" />

        {/* Genre chips */}
        <div className="mt-4.5 flex flex-wrap gap-2.5">
          {["w-22", "w-18", "w-25", "w-16", "w-23"].map((width, index) => (
            <Skeleton key={width} index={index} className={`rounded-pill h-7 ${width}`} />
          ))}
        </div>

        {/* Applied · sort */}
        <div className="mt-4.5 flex items-center justify-between gap-6">
          <Skeleton className="rounded-pill h-6 w-36" />
          <Skeleton className="rounded-control h-8 w-40" />
        </div>

        <BookGridSkeleton className="mt-10" columns={3} count={6} />
      </Shell>
    </PageShell>
  );
}
