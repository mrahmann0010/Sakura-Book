import { DetailLayout, PageShell, Shell } from "@/components/layout";
import { Skeleton, SkeletonText } from "@/components/ui";

/* The chrome lands first and the detail fills in, holding the exact shape of
   what is coming so nothing shifts (§9). */

export default function BookLoading() {
  return (
    <PageShell>
      <Shell className="py-10 lg:py-14">
        <Skeleton className="h-4 w-64 max-w-full" />

        <DetailLayout
          className="mt-8 lg:mt-10"
          cover={<Skeleton className="rounded-control aspect-[2/3] w-full" />}
          rail={<Skeleton className="rounded-container h-52 w-full" />}
        >
          <Skeleton className="h-10 w-4/5" />
          <Skeleton className="mt-4 h-3 w-40" />
          <SkeletonText className="mt-8" lines={5} />
        </DetailLayout>
      </Shell>
    </PageShell>
  );
}
