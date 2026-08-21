"use client";

import { useEffect, useState } from "react";

import {
  AdminApiError,
  decideAdminPreOrderPayment,
  getAdminPreOrder,
  listAdminPreOrders,
  recheckAdminPreOrderPayment,
  setAdminPreOrderNote,
  transitionAdminPreOrderFulfillment,
} from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";
import { useAdminGate } from "@/lib/use-admin-gate";
import type {
  AdminPreOrderDetail,
  AdminPreOrderSummary,
  PaymentVerificationRecord,
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
  /* The gateway's own words about the last re-check, kept apart from `error`:
     "no payment matching X has reached the gateway yet" is a perfectly normal
     answer, and colouring it red would train staff to ignore real failures. */
  const [verdict, setVerdict] = useState<string | null>(null);

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
    setVerdict(null);
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
    setVerdict(null);
    try {
      setSelected(await run());
      await loadQueue(preset);
    } catch (err) {
      setError(messageOf(err, "That action did not go through."));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The re-check, which is `act` plus a sentence.
   *
   * Separate because its response is not just a pre-order: the verdict
   * explains *why* nothing changed, and "nothing changed" is the common case —
   * payment SMS arrive late, so most re-checks legitimately find nothing yet.
   * Silently refreshing the row would look like a broken button.
   */
  async function recheck(orderNumber: string) {
    setBusy(true);
    setError(null);
    setVerdict(null);
    try {
      const result = await recheckAdminPreOrderPayment(orderNumber);
      setSelected(result.preOrder);
      setVerdict(result.summary);
      if (result.accepted) await loadQueue(preset);
    } catch (err) {
      setError(messageOf(err, "Could not reach the payment gateway."));
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
            <th style={cell}>Gateway</th>
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
              <td style={{ ...cell, color: outcomeColour(row.verificationOutcome) }}>
                {row.verificationOutcome ?? "—"}
              </td>
              <td style={cell}>{row.fulfillmentStatus}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td style={{ ...cell, color: "#777" }} colSpan={7}>
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
          verdict={verdict}
          onClose={() => setSelected(null)}
          onRecheck={() => void recheck(selected.orderNumber)}
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
  verdict,
  onClose,
  onRecheck,
  onDecidePayment,
  onTransitionFulfillment,
  onSaveNote,
}: {
  preOrder: AdminPreOrderDetail;
  busy: boolean;
  verdict: string | null;
  onClose: () => void;
  onRecheck: () => void;
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

          {/* The gateway's answer sits between the claim and the buttons on
              purpose: it is the evidence the accept/reject decision is made
              against, and it is only ever advisory — a member of staff can
              still accept an UNDERPAID pre-order because the customer sent
              the balance separately, or reject a MATCHED one for a reason no
              database knows about. */}
          <GatewayVerdict record={preOrder.paymentVerification} />

          <button
            type="button"
            onClick={onRecheck}
            disabled={busy || !preOrder.transactionId}
            style={{
              cursor: busy || !preOrder.transactionId ? "default" : "pointer",
              padding: "5px 10px",
              marginBottom: 12,
              border: "1px solid #ccc",
              borderRadius: 4,
              background: "#fff",
            }}
          >
            {busy ? "Checking…" : "Re-check against gateway"}
          </button>

          {verdict ? (
            <p style={{ fontSize: 13, color: "#333", background: "#f4f4f4", padding: 8 }}>
              {verdict}
            </p>
          ) : null}

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

/**
 * The last cross-check, spelled out.
 *
 * Shows the two numbers that were compared rather than only the verdict,
 * because the verdict is the machine's opinion and the numbers are the fact.
 * A member of staff overriding an UNDERPAID needs to see how short it was;
 * one accepting a MATCHED wants to confirm the amount is the one they expect
 * before they take responsibility for it.
 */
function GatewayVerdict({ record }: { record: PaymentVerificationRecord | null }) {
  if (!record) {
    return (
      <p style={{ fontSize: 13, color: "#777", margin: "0 0 12px" }}>
        Not yet checked against the payment gateway.
      </p>
    );
  }

  return (
    <div
      style={{
        fontSize: 13,
        border: "1px solid #ddd",
        borderLeft: `3px solid ${outcomeColour(record.outcome)}`,
        padding: "8px 10px",
        margin: "0 0 12px",
      }}
    >
      <strong style={{ color: outcomeColour(record.outcome) }}>{record.outcome}</strong>
      {record.provider ? ` · ${record.provider}` : null}
      <br />
      {record.paidCents === undefined ? null : (
        <>
          Received {formatMoney(record.paidCents)} against {formatMoney(record.expectedCents ?? 0)}{" "}
          owed
          <br />
        </>
      )}
      {record.reason ? (
        <>
          {record.reason}
          <br />
        </>
      ) : null}
      <span style={{ color: "#777" }}>
        Checked {new Date(record.checkedAt).toLocaleString()}
        {record.receivedAt ? ` · paid ${new Date(record.receivedAt).toLocaleString()}` : null}
      </span>
    </div>
  );
}

/**
 * Three colours, not four. MATCHED is the only one that is unambiguously
 * good and NOT_FOUND the only one that is routine — UNDERPAID and UNAVAILABLE
 * are both "a person has to look at this", so they read the same.
 */
function outcomeColour(outcome: PaymentVerificationRecord["outcome"] | null): string {
  switch (outcome) {
    case "MATCHED":
      return "#1a7f37";
    case "UNDERPAID":
    case "UNAVAILABLE":
      return "#a04000";
    default:
      return "#777";
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof AdminApiError ? error.message : fallback;
}

const cell = { padding: "8px 10px", verticalAlign: "top" as const };
const heading = { fontSize: 14, margin: 0, borderBottom: "1px solid #ddd", paddingBottom: 6 };
const term = { fontWeight: 600, color: "#555" };
const def = { margin: "0 0 6px" };
