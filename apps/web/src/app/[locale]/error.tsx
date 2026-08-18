"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/domain";
import { AppNav, PageShell, Shell } from "@/components/layout";
import { Button, LinkButton } from "@/components/ui";
import { routes } from "@/lib/routes";

/* --------------------------------------------------------------------------
   The boundary under every page in the app.

   It exists because the pages now fetch: before the API, a render either
   worked or was a bug, and there was nothing a reader could do about it.
   Now the common failure is the API being briefly unreachable, which is both
   temporary and not the reader's fault — so this offers `retry()` rather than
   an apology, and says nothing about what went wrong.

   Deliberately not shown for a missing book: `notFound()` throws past this
   boundary to not-found.tsx, so "no such title" keeps its own 404 page and its
   own words.
   -------------------------------------------------------------------------- */

export default function CatalogError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { t } = useTranslation();
  const { locale } = useParams<{ locale: string }>();

  useEffect(() => {
    /* The digest is the only handle on the server-side stack, which is not
       sent to the browser. Logging it here is what makes a report from a
       customer traceable to a line. */
    console.error("Page failed to render", error.digest ?? "", error);
  }, [error]);

  return (
    <PageShell header={<AppNav />}>
      <Shell className="py-20">
        <EmptyState
          eyebrow={t("errors.page.eyebrow")}
          title={t("errors.page.title")}
          description={t("errors.page.description")}
          action={
            <>
              <Button onClick={() => retry()}>{t("errors.page.retry")}</Button>
              <LinkButton href={routes(locale).home} variant="secondary">
                {t("errors.page.home")}
              </LinkButton>
            </>
          }
        />
      </Shell>
    </PageShell>
  );
}
