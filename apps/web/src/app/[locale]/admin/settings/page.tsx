import { redirect } from "next/navigation";

/**
 * /admin/settings is the sidebar's link and has no content of its own — the
 * first tab is what it means. Redirecting here rather than linking the sidebar
 * straight at /settings/payments keeps the nav entry stable if the tab order
 * ever changes.
 */
export default async function AdminSettingsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  redirect(`/${locale}/admin/settings/payments`);
}
