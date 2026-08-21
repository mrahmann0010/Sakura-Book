import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MongoClient, type Collection, type Document } from "mongodb";
import {
  paymentProviders,
  type MatchedPayment,
  type PaymentProvider,
} from "./payment-verification.types";

/* --------------------------------------------------------------------------
   The read side of the SMS payment gateway.

   A separate service forwards bKash/Nagad/Rocket payment SMS from an Android
   handset into MongoDB, one collection per wallet, deduplicated on `trxId`.
   This class only ever reads those collections. It must never write to them:
   the gateway owns that data, `trxId` is its idempotency key, and a second
   writer would quietly break the guarantee the unique index exists to give.
   -------------------------------------------------------------------------- */

/**
 * A payment document, as the gateway's Mongoose schema writes it.
 *
 * Only the four fields we actually depend on are named. The documents carry
 * more — `fee`, `balance`, `sender`, `rawMessage`, `simNumber`, and `ref` on
 * Nagad — and every one of them is either irrelevant to "was this paid" or is
 * a customer's phone number and the full text of their payment SMS. Those are
 * deliberately not projected: the amount and the ID are the whole question,
 * and pulling a stranger's SMS into this API's logs and error payloads to
 * answer it would be a needless second copy of personal data.
 */
type PaymentDocument = {
  trxId?: unknown;
  /** Taka, as a float. The gateway stores what the SMS said. */
  amount?: unknown;
  dateReceived?: unknown;
};

const PROJECTION = { trxId: 1, amount: 1, dateReceived: 1, _id: 0 } as const;

/** How long to wait for a server before giving up and calling it UNAVAILABLE. */
const SERVER_SELECTION_TIMEOUT_MS = 5000;

@Injectable()
export class MongoPaymentsClient implements OnModuleDestroy {
  private readonly logger = new Logger(MongoPaymentsClient.name);

  /**
   * Connected lazily and once.
   *
   * The promise itself is cached rather than the client, so that two requests
   * arriving before the first connection completes await the same handshake
   * instead of opening two pools. A rejected promise is cleared, so a Mongo
   * that was down at first contact is retried rather than being remembered as
   * broken for the life of the process.
   */
  private connection?: Promise<MongoClient>;

  constructor(private readonly config: ConfigService) {}

  /** Whether a cross-check is even possible in this environment. */
  get configured(): boolean {
    return Boolean(this.uri);
  }

  private get uri(): string | undefined {
    return this.config.get<string>("MONGO_URI");
  }

  /**
   * The first payment matching this transaction ID, across every wallet.
   *
   * Searching all three collections rather than requiring the caller to name
   * one is a deliberate design decision, and it is safe because `trxId` is a
   * *provider-issued* identifier under a unique index in each collection: two
   * wallets independently minting the same string is not something the data
   * makes possible in practice, and the collections' ID formats do not even
   * share a length. What it buys is that the customer never has to be trusted
   * to tell us which app they paid from — the collection that holds the
   * receipt is the answer, and it is a fact rather than a claim.
   *
   * Callers that *do* know the wallet may still narrow it, which turns three
   * indexed point-lookups into one.
   */
  async findByTrxId(
    transactionId: string,
    provider?: PaymentProvider,
  ): Promise<MatchedPayment | null> {
    const client = await this.connect();
    const db = client.db();
    const search = provider ? [provider] : paymentProviders;

    for (const wallet of search) {
      const collection: Collection<Document> = db.collection(wallet);
      const document = (await collection.findOne(
        { trxId: transactionId },
        { projection: PROJECTION },
      )) as PaymentDocument | null;

      if (!document) continue;

      const paidCents = toCents(document.amount);

      /**
       * A document whose amount will not parse is treated as no match at all,
       * matching the sibling backend's "unverifiable → stays pending". The
       * alternative — matching on the ID and assuming the amount is fine — is
       * how a malformed SMS becomes free books.
       */
      if (paidCents === null) {
        this.logger.warn(
          `Payment ${transactionId} found in "${wallet}" with an unreadable amount; treating as unmatched.`,
        );
        continue;
      }

      return {
        provider: wallet,
        transactionId,
        paidCents,
        receivedAt: document.dateReceived instanceof Date ? document.dateReceived : null,
      };
    }

    return null;
  }

  private async connect(): Promise<MongoClient> {
    const uri = this.uri;
    if (!uri) throw new Error("MONGO_URI is not configured.");

    this.connection ??= (async () => {
      const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
      });

      await client.connect();
      // Proves we can actually talk to a server, rather than merely having
      // constructed a client — `connect()` alone is lazy about some failures.
      await client.db().command({ ping: 1 });

      this.logger.log(`Connected to the payment gateway database "${client.db().databaseName}".`);

      return client;
    })().catch((error: unknown) => {
      this.connection = undefined;
      throw error;
    });

    return this.connection;
  }

  async onModuleDestroy(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;

    // Swallowed: a failure to hang up cleanly on shutdown is not worth
    // turning a graceful stop into a crash.
    await connection?.then((client) => client.close()).catch(() => undefined);
  }
}

/**
 * Taka → minor units.
 *
 * `Math.round` rather than a truncating cast because the gateway's amounts are
 * floats parsed out of SMS text, and 12.34 arrives from JSON as 12.339999…;
 * truncating turns that into ৳12.33 and a payment that is one poisha short of
 * what was owed. Rounding to the nearest integer cent is also what makes the
 * later `paid >= expected` comparison exact, so no epsilon fudge is needed.
 */
function toCents(amount: unknown): number | null {
  const value = typeof amount === "number" ? amount : Number(amount);

  if (!Number.isFinite(value) || value < 0) return null;

  return Math.round(value * 100);
}
