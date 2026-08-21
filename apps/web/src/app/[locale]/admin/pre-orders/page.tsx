"use client";

import { useEffect, useState } from "react";

import {
  AdminApiError,
  decideAdminPreOrderPayment,
  getAdminPreOrder,
  listAdminPreOrders,
  setAdminPreOrderNote,
  transitionAdminPreOrderFulfillment,
} from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";
import { useAdminGate } from "@/lib/use-admin-gate";
import type {
  AdminPreOrderDetail,
  AdminPreOrderSummary,
  PreOrderFulfillmentStatus,
  PreOrderPaymentStatus,
} from "@sakura/contracts";

/* --------------------------------------------------------------------------
   The pre-order desk.

   Deliberately plain, like the pre-order-book form next door: this is a staff
   tool behind a login, not a storefront page, and giving it the design system
   would imply it belongs to the same surface.

   The screen is organised around the two tracks rather than around the order,
   because that is how the work actually arrives: one person opens the "awaiting
   payment" list on a weekday morning with a bank app in the other window, and
   — months later, when the print run lands — someone else opens "paid, not
   dispatched" and works through it with a stack of parcels. Those are the two
   presets, and they are the reason this page is not a single flat table.

   Which buttons exist is never decided here. `allowedPaymentTransitions` and
   `allowedFulfillmentTransitions` come off the two state machines on every
   response, so the panel cannot offer a move the API will refuse, and adding a
   status to either lifecycle needs no change on this page.
   -------------------------------------------------------------------------- */

/** The two lists the desk actually works from, plus an unfiltered escape hatch. */
const presets = {
  "to-verify": {
    label: "Awaiting payment check",
    query: { paymentStatus: ["PENDING"] },
  },
  "to-dispatch": {
    label: "Paid, not dispatched",
    query: { paymentStatus: ["ACCEPTED"], fulfillmentStatus: ["NOT_STARTED", "PROCESSING"] },
  },
  all: { label: "All pre-orders", query: {} },
} as const;

type PresetKey = keyof typeof presets;

export default function AdminPreOrdersPage() {
  const { checking } = useAdminGate();

  const [preset, setPreset] = useState<PresetKey>("to-verify");
  const [rows, setRows] = useState<AdminPreOrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<AdminPreOrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!checking) void loadQueue(preset);
  }, [checking, preset]);

  async function loadQueue(key: PresetKey) {
    setError(null);
    try {
      const list = await listAdminPreOrders(presets[key].query);
      setRows(list.items);
      setTotal(list.total);
    } catch (err) {
      setError(messageOf(err, "Could not load the pre-order queue."));
    }
  }

  async function open(orderNumber: string) {
    setError(null);
    try {
      setSelected(await getAdminPreOrder(orderNumber));
    } catch (err) {
      setError(messageOf(err, "Could not open that pre-order."));
    }
  }

  /**
   * Every action funnels through here because they share a shape: the API
   * answers with the whole pre-order, so the panel replaces what it is showing
   * rather than patching a field and hoping the two agree. The queue is
   * refetched alongside, since most moves change which preset the row belongs
   * to — accepting a payment takes it out of "awaiting payment check", and a
   * row that lingers there afterwards is one a second person will pick up.
   */
  async function act(run: () => Promise<AdminPreOrderDetail>) {
    setBusy(true);
    setError(null);
    try {
      setSelected(await run());
      await loadQueue(preset);
    } catch (err) {
      setError(messageOf(err, "That action did not go through."));
    } finally {
      setBusy(false);
    }
  }

  if (checking) return <p style={{ padding: 40 }}>Checking session…</p>;

  return (
    <main
      style={{
        maxWidth: 1080,
        margin: "40px auto",
        padding: "0 20px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Pre-orders</h1>
      <p style={{ color: "#555", marginBottom: 20 }}>
        Payment and delivery are tracked separately — a pre-order can be paid for months before
        there is anything to ship.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {(Object.keys(presets) as PresetKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPreset(key)}
            style={{
              padding: "6px 12px",
              cursor: "pointer",
              border: "1px solid #ccc",
              borderRadius: 4,
              background: preset === key ? "#222" : "#fff",
              color: preset === key ? "#fff" : "#222",
            }}
          >
            {presets[key].label}
          </button>
        ))}
      </div>

      {error ? (
        <p style={{ color: "#a00", border: "1px solid #a00", padding: 10, marginBottom: 16 }}>
          {error}
        </p>
      ) : null}

      <p style={{ color: "#555", marginBottom: 8, fontSize: 13 }}>
        {total} {total === 1 ? "pre-order" : "pre-orders"}
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={cell}>Order</th>
            <th style={cell}>Customer</th>
            <th style={cell}>Book</th>
            <th style={cell}>Total</th>
            <th style={cell}>Payment</th>
            <th style={cell}>Delivery</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.orderNumber}
              onClick={() => void open(row.orderNumber)}
              style={{
                borderBottom: "1px solid #eee",
                cursor: "pointer",
                background: selected?.orderNumber === row.orderNumber ? "#f4f4f4" : undefined,
              }}
            >
              <td style={cell}>
                <code>{row.orderNumber}</code>
                {/* A marker, not the reference — the digits are on the detail
                    panel, because a table of transaction IDs is a screenshot
                    waiting to happen. */}
                {row.hasPaymentReference ? " ✓" : ""}
                {row.hasInternalNote ? " ✱" : ""}
              </td>
              <td style={cell}>
                {row.customerName}
                <br />
                <span style={{ color: "#777", fontSize: 12 }}>{row.customerPhone}</span>
              </td>
              <td style={cell}>
                {row.bookTitle} × {row.quantity}
              </td>
              <td style={cell}>{formatMoney(row.totalCents)}</td>
              <td style={cell}>{row.paymentStatus}</td>
              <td style={cell}>{row.fulfillmentStatus}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td style={{ ...cell, color: "#777" }} colSpan={6}>
                Nothing in this list.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {selected ? (
        <PreOrderPanel
          /* Per order number, so opening a different pre-order starts with
             empty note fields rather than the last one's text. */
          key={selected.orderNumber}
          preOrder={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onDecidePayment={(status, note) =>
            act(() => decideAdminPreOrderPayment(selected.orderNumber, { status, note }))
          }
          onTransitionFulfillment={(status, note) =>
            act(() => transitionAdminPreOrderFulfillment(selected.orderNumber, { status, note }))
          }
          onSaveNote={(note) => act(() => setAdminPreOrderNote(selected.orderNumber, note))}
        />
      ) : null}
    </main>
  );
}

/**
 * One pre-order, opened.
 *
 * The payment evidence sits directly above the accept/reject buttons on
 * purpose: the decision is "does this transaction ID appear on the statement",
 * and putting the answer and the question on the same screen is the whole job.
 */
function PreOrderPanel({
  preOrder,
  busy,
  onClose,
  onDecidePayment,
  onTransitionFulfillment,
  onSaveNote,
}: {
  preOrder: AdminPreOrderDetail;
  busy: boolean;
  onClose: () => void;
  onDecidePayment: (status: PreOrderPaymentStatus, note?: string) => void;
  onTransitionFulfillment: (status: PreOrderFulfillmentStatus, note?: string) => void;
  onSaveNote: (note: string | null) => void;
}) {
  /* Both boxes are plain initial state, and the panel is remounted per order
     number by its `key` — see the call site. Resetting them in an effect
     instead would also clobber whatever the operator had typed every time an
     action refreshed the pre-order. */
  const [note, setNote] = useState("");
  const [internalNote, setInternalNote] = useState(preOrder.internalNote ?? "");

  const canFulfil = preOrder.paymentStatus === "ACCEPTED";

  return (
    <section style={{ border: "1px solid #ccc", padding: 20, marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ fontSize: 17, margin: 0 }}>
          <code>{preOrder.orderNumber}</code> — {preOrder.customerName}
        </h2>
        <button type="button" onClick={onClose} style={{ cursor: "pointer" }}>
          Close
        </button>
      </div>

      <p style={{ color: "#555", fontSize: 13, marginTop: 6 }}>
        {preOrder.bookTitle} × {preOrder.quantity} — {formatMoney(preOrder.totalCents)} ·{" "}
        {preOrder.customerPhone} · {preOrder.customerEmail}
        <br />
        {preOrder.shipping.address}, {preOrder.shipping.city}, {preOrder.shipping.region}
        {preOrder.note ? (
          <>
            <br />
            Customer note: {preOrder.note}
          </>
        ) : null}
      </p>

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1fr 1fr", marginTop: 20 }}>
        <div>
          <h3 style={heading}>Payment — {preOrder.paymentStatus}</h3>
          <dl style={{ fontSize: 13, margin: "8px 0 12px" }}>
            <dt style={term}>Method</dt>
            <dd style={def}>{preOrder.paymentMethod}</dd>
            <dt style={term}>Sender number</dt>
            <dd style={def}>{preOrder.senderNumber ?? "—"}</dd>
            <dt style={term}>Transaction ID</dt>
            <dd style={def}>
              <code>{preOrder.transactionId ?? "—"}</code>
            </dd>
          </dl>

          <Actions
            busy={busy}
            options={preOrder.allowedPaymentTransitions}
            onPick={(status) => onDecidePayment(status, note.trim() || undefined)}
            emptyLabel="This payment is settled — no further decisions."
          />
        </div>

        <div>
          <h3 style={heading}>Delivery — {preOrder.fulfillmentStatus}</h3>
          <p style={{ fontSize: 13, color: "#555", margin: "8px 0 12px" }}>
            {canFulfil
              ? "Payment is accepted, so this can move."
              : "Nothing ships until the payment is accepted. Cancelling is still available."}
          </p>

          <Actions
            busy={busy}
            options={preOrder.allowedFulfillmentTransitions}
            onPick={(status) => onTransitionFulfillment(status, note.trim() || undefined)}
            emptyLabel="This delivery is finished — no further moves."
          />
        </div>
      </div>

      <label style={{ display: "block", marginTop: 20, fontSize: 13 }}>
        Reason / note for the next action (optional, goes to the audit log)
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={280}
          style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
        />
      </label>

      <label style={{ display: "block", marginTop: 16, fontSize: 13 }}>
        Internal note (staff only — never shown to the customer)
        <textarea
          rows={3}
          value={internalNote}
          onChange={(event) => setInternalNote(event.target.value)}
          maxLength={2000}
          style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => onSaveNote(internalNote.trim() || null)}
        style={{ marginTop: 8, padding: "6px 12px", cursor: busy ? "wait" : "pointer" }}
      >
        Save internal note
      </button>
    </section>
  );
}

/**
 * The buttons for one track, drawn from what the server says is allowed.
 *
 * An empty list means terminal, and it renders as a sentence rather than a row
 * of disabled buttons — a greyed-out "Mark shipped" on a delivered order
 * invites a click and explains nothing.
 */
function Actions<T extends string>({
  options,
  busy,
  onPick,
  emptyLabel,
}: {
  options: readonly T[];
  busy: boolean;
  onPick: (option: T) => void;
  emptyLabel: string;
}) {
  if (options.length === 0) {
    return <p style={{ fontSize: 13, color: "#777" }}>{emptyLabel}</p>;
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={busy}
          onClick={() => onPick(option)}
          style={{ padding: "6px 12px", cursor: busy ? "wait" : "pointer" }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof AdminApiError ? error.message : fallback;
}

const cell = { padding: "8px 10px", verticalAlign: "top" as const };
const heading = { fontSize: 14, margin: 0, borderBottom: "1px solid #ddd", paddingBottom: 6 };
const term = { fontWeight: 600, color: "#555" };
const def = { margin: "0 0 6px" };
