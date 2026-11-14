"use client";

import { useEffect, useState, type FormEvent } from "react";
import type {
  AdminCoupon,
  AdminCouponCounts,
  AdminCouponCreateRequest,
  AdminCouponState,
  CouponDiscountType,
} from "@sakura/contracts";

import { AdminTableRows } from "@/components/admin/skeletons";
import { Badge, Button, Checkbox, CopyButton, Input, Modal, Notice, Select } from "@/components/ui";
import {
  AdminApiError,
  createAdminCoupon,
  deleteAdminCoupon,
  listAdminCoupons,
  updateAdminCoupon,
} from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";

/* --------------------------------------------------------------------------
   Coupons — issue discount codes and manage the ones already out there.

   Tabs are the coupon's state *now* (derived on the server the same way a
   customer's code is checked), so "Active" here means "works if typed today".

   Money is entered in taka and sent in paisa; dates are entered as calendar
   days in Bangladesh time — a code "valid until 31 Dec" works until 23:59 on
   the 31st in Dhaka, not in UTC.
   -------------------------------------------------------------------------- */

type Tab = AdminCouponState | "ALL";

const TABS: { key: Tab; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "EXPIRED", label: "Expired" },
  { key: "USED_UP", label: "Used up" },
  { key: "DISABLED", label: "Switched off" },
];

const STATE_LABEL: Record<AdminCouponState, string> = {
  ACTIVE: "Active",
  SCHEDULED: "Scheduled",
  EXPIRED: "Expired",
  USED_UP: "Used up",
  DISABLED: "Switched off",
};

const EMPTY_COUNTS: AdminCouponCounts = {
  ACTIVE: 0,
  SCHEDULED: 0,
  EXPIRED: 0,
  USED_UP: 0,
  DISABLED: 0,
};

const DHAKA_OFFSET = "+06:00";

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof AdminApiError ? cause.message : fallback;
}

/** "2026-12-31" in Dhaka, for a date input. */
function toDhakaDay(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date(iso));
}

function formatDhakaDay(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

function describeDiscount(coupon: AdminCoupon): string {
  if (coupon.discountType === "PERCENTAGE") {
    const cap = coupon.maxDiscountCents ? ` · up to ${formatMoney(coupon.maxDiscountCents)}` : "";
    return `${coupon.discountValue}% off${cap}`;
  }
  return `${formatMoney(coupon.discountValue)} off`;
}

function describeWindow(coupon: AdminCoupon): string {
  if (coupon.startsAt && coupon.expiresAt) {
    return `${formatDhakaDay(coupon.startsAt)} – ${formatDhakaDay(coupon.expiresAt)}`;
  }
  if (coupon.startsAt) return `From ${formatDhakaDay(coupon.startsAt)}`;
  if (coupon.expiresAt) return `Until ${formatDhakaDay(coupon.expiresAt)}`;
  return "No end date";
}

export default function AdminCouponsPage() {
  const [tab, setTab] = useState<Tab>("ALL");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AdminCoupon[]>([]);
  const [counts, setCounts] = useState<AdminCouponCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** `null` closed, `"new"` creating, or the coupon being edited. */
  const [editing, setEditing] = useState<AdminCoupon | "new" | null>(null);

  useEffect(() => {
    void load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function load(activeTab: Tab = tab) {
    setError(null);
    setLoading(true);
    try {
      const list = await listAdminCoupons({
        state: activeTab === "ALL" ? undefined : activeTab,
        q: q.trim() || undefined,
      });
      setItems(list.items);
      setCounts(list.counts);
    } catch (cause) {
      setError(messageOf(cause, "Could not load the coupons."));
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(coupon: AdminCoupon) {
    setBusyId(coupon.id);
    setError(null);
    setNotice(null);
    try {
      await updateAdminCoupon(coupon.id, { isActive: !coupon.isActive });
      setNotice(`${coupon.code} ${coupon.isActive ? "switched off" : "switched on"}.`);
      await load();
    } catch (cause) {
      setError(messageOf(cause, "Could not update that coupon."));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(coupon: AdminCoupon) {
    if (!window.confirm(`Delete ${coupon.code}? It has never been used, so nothing else changes.`)) {
      return;
    }
    setBusyId(coupon.id);
    setError(null);
    setNotice(null);
    try {
      await deleteAdminCoupon(coupon.id);
      setNotice(`${coupon.code} deleted.`);
      await load();
    } catch (cause) {
      setError(messageOf(cause, "Could not delete that coupon."));
    } finally {
      setBusyId(null);
    }
  }

  const allCount = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 text-ink font-serif">Coupons</h1>
          <p className="text-13.5 text-secondary mt-2">
            Discount codes customers can enter at checkout. The discount comes off the books, never
            delivery.
          </p>
        </div>
        <Button type="button" onClick={() => setEditing("new")}>
          New coupon
        </Button>
      </div>

      <div className="border-rule flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`text-13.5 -mb-px shrink-0 border-b-2 px-4 py-2 transition-colors ${
              tab === t.key
                ? "border-clay text-ink font-medium"
                : "text-secondary hover:text-ink border-transparent"
            }`}
          >
            {t.label}
            <span className="text-muted ml-2">{t.key === "ALL" ? allCount : counts[t.key]}</span>
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search by code…"
          className="rounded-control border-rule bg-surface text-13.5 text-ink w-full max-w-sm border px-3 py-2"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <p className="text-13.5 text-secondary">{notice}</p> : null}

      <div className="rounded-container border-rule bg-surface overflow-x-auto border">
        <table className="text-13.5 w-full min-w-[960px] text-left">
          <thead>
            <tr className="border-rule-strong text-caption text-muted border-b uppercase">
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Discount</th>
              <th className="px-4 py-3 font-medium">Min. order</th>
              <th className="px-4 py-3 font-medium">Valid</th>
              <th className="px-4 py-3 font-medium">Used</th>
              <th className="px-4 py-3 font-medium">Given away</th>
              <th className="px-4 py-3 font-medium">State</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? <AdminTableRows columns={8} /> : null}
            {!loading &&
              items.map((coupon) => (
                <tr key={coupon.id} className="border-rule border-b align-top last:border-0">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span className="text-ink font-mono font-medium">{coupon.code}</span>
                      <CopyButton value={coupon.code} />
                    </span>
                  </td>
                  <td className="text-ink px-4 py-3">{describeDiscount(coupon)}</td>
                  <td className="text-secondary px-4 py-3">
                    {coupon.minOrderCents ? formatMoney(coupon.minOrderCents) : "—"}
                  </td>
                  <td className="text-secondary px-4 py-3">{describeWindow(coupon)}</td>
                  <td className="text-secondary px-4 py-3">
                    {coupon.timesUsed}
                    {coupon.maxUses !== null ? ` / ${coupon.maxUses}` : ""}
                  </td>
                  <td className="text-secondary px-4 py-3">
                    {coupon.totalDiscountCents > 0 ? formatMoney(coupon.totalDiscountCents) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={coupon.state === "ACTIVE" ? "accent" : "neutral"}>
                      {STATE_LABEL[coupon.state]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => setEditing(coupon)}
                      className="text-clay hover:text-clay-deep"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => void toggleActive(coupon)}
                      className="text-muted hover:text-ink ml-3"
                    >
                      {coupon.isActive ? "Switch off" : "Switch on"}
                    </button>
                    {coupon.timesUsed === 0 ? (
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => void remove(coupon)}
                        className="text-muted hover:text-clay-deep ml-3"
                      >
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-muted px-4 py-6 text-center">
                  {allCount === 0 && !q ? "No coupons yet. Issue one with New coupon." : "Nothing in this view."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {editing ? (
        <CouponDialog
          coupon={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            setNotice(created ? `${saved.code} issued.` : `${saved.code} saved.`);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Create / edit dialog.
   -------------------------------------------------------------------------- */

/** Taka typed in a text box → paisa, or null when left blank. */
function takaToPaisa(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Math.round(Number(trimmed) * 100);
}

function paisaToTaka(value: number | null): string {
  return value === null ? "" : String(value / 100);
}

function CouponDialog({
  coupon,
  onClose,
  onSaved,
}: {
  coupon: AdminCoupon | null;
  onClose: () => void;
  onSaved: (coupon: AdminCoupon, created: boolean) => void;
}) {
  const isNew = coupon === null;

  const [code, setCode] = useState(coupon?.code ?? "");
  const [discountType, setDiscountType] = useState<CouponDiscountType>(
    coupon?.discountType ?? "PERCENTAGE",
  );
  const [value, setValue] = useState(
    coupon
      ? coupon.discountType === "PERCENTAGE"
        ? String(coupon.discountValue)
        : paisaToTaka(coupon.discountValue)
      : "",
  );
  const [maxDiscount, setMaxDiscount] = useState(paisaToTaka(coupon?.maxDiscountCents ?? null));
  const [minOrder, setMinOrder] = useState(paisaToTaka(coupon?.minOrderCents ?? null));
  const [maxUses, setMaxUses] = useState(coupon?.maxUses ? String(coupon.maxUses) : "");
  const [startsOn, setStartsOn] = useState(toDhakaDay(coupon?.startsAt ?? null));
  const [endsOn, setEndsOn] = useState(toDhakaDay(coupon?.expiresAt ?? null));
  const [isActive, setIsActive] = useState(coupon?.isActive ?? true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const terms: Omit<AdminCouponCreateRequest, "code"> = {
      discountType,
      discountValue:
        discountType === "PERCENTAGE" ? Math.round(Number(value)) : (takaToPaisa(value) ?? 0),
      maxDiscountCents: discountType === "PERCENTAGE" ? takaToPaisa(maxDiscount) : null,
      minOrderCents: takaToPaisa(minOrder),
      maxUses: maxUses.trim() ? Math.round(Number(maxUses)) : null,
      startsAt: startsOn ? `${startsOn}T00:00:00${DHAKA_OFFSET}` : null,
      expiresAt: endsOn ? `${endsOn}T23:59:59${DHAKA_OFFSET}` : null,
      isActive,
    };

    try {
      const saved = isNew
        ? await createAdminCoupon({ code, ...terms })
        : await updateAdminCoupon(coupon.id, terms);
      onSaved(saved, isNew);
    } catch (cause) {
      if (cause instanceof AdminApiError && cause.fields.length > 0) {
        setFieldErrors(
          Object.fromEntries(cause.fields.map((field) => [field.path, field.message])),
        );
      }
      setError(messageOf(cause, "Could not save that coupon."));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="md"
      onClose={onClose}
      title={isNew ? "New coupon" : `Edit ${coupon.code}`}
      description={
        isNew
          ? "Customers type the code at checkout. It can't be renamed later."
          : "Orders already placed keep the discount they got."
      }
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
        <Input
          label="Code"
          hint={isNew ? "Letters, numbers, dashes. Saved in capitals, e.g. EID2026." : undefined}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          disabled={!isNew}
          autoComplete="off"
          required
          error={fieldErrors.code}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Discount type"
            value={discountType}
            onChange={(event) => setDiscountType(event.target.value as CouponDiscountType)}
            options={[
              { value: "PERCENTAGE", label: "Percentage (%)" },
              { value: "FIXED_AMOUNT", label: "Fixed amount (৳)" },
            ]}
          />
          <Input
            label={discountType === "PERCENTAGE" ? "Percent off" : "Taka off"}
            type="number"
            inputMode="decimal"
            min={1}
            max={discountType === "PERCENTAGE" ? 100 : undefined}
            step={discountType === "PERCENTAGE" ? 1 : "any"}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
            error={fieldErrors.discountValue}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {discountType === "PERCENTAGE" ? (
            <Input
              label="Maximum discount (৳)"
              hint="Optional cap, so 10% of a big order stays reasonable."
              type="number"
              inputMode="decimal"
              min={1}
              step="any"
              value={maxDiscount}
              onChange={(event) => setMaxDiscount(event.target.value)}
              error={fieldErrors.maxDiscountCents}
            />
          ) : null}
          <Input
            label="Minimum order (৳)"
            hint="Optional. Books subtotal, before delivery."
            type="number"
            inputMode="decimal"
            min={1}
            step="any"
            value={minOrder}
            onChange={(event) => setMinOrder(event.target.value)}
            error={fieldErrors.minOrderCents}
          />
        </div>

        <Input
          label="Usage limit"
          hint={
            coupon && coupon.timesUsed > 0
              ? `Optional. Already used ${coupon.timesUsed} times.`
              : "Optional. Total orders that can use this code. Blank means unlimited."
          }
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={maxUses}
          onChange={(event) => setMaxUses(event.target.value)}
          error={fieldErrors.maxUses}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Starts on"
            hint="Optional. From 12:00 am, Bangladesh time."
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
            error={fieldErrors.startsAt}
          />
          <Input
            label="Ends on"
            hint="Optional. Until 11:59 pm, Bangladesh time."
            type="date"
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
            error={fieldErrors.expiresAt}
          />
        </div>

        <Checkbox
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          description="Switch it off any time to stop new orders using it."
        >
          Switched on
        </Checkbox>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>
            {isNew ? "Issue coupon" : "Save changes"}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
