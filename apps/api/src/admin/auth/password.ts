import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * `promisify` cannot be used here. `crypto.scrypt` is overloaded — with and
 * without an options object — and promisify resolves to the first overload,
 * which takes no options. Since the options are where the cost parameters and
 * the raised `maxmem` live, that silently loses every tuning decision in this
 * file. Wrapped by hand instead.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/**
 * Password hashing and verification.
 *
 * ## Why scrypt, and not bcrypt or argon2
 *
 * Both of the usual answers are native modules that need a C toolchain to
 * install. This API ships in a Docker image whose size was already halved once
 * on purpose, and adding a compiled dependency means either a build stage with
 * python3 and make in it or a prebuilt binary that has to match the base
 * image's libc — `node:alpine` uses musl, and the "it works locally, the
 * container segfaults" failure that follows is a bad afternoon.
 *
 * scrypt is in Node core, is memory-hard, and is on OWASP's list of acceptable
 * password KDFs. bcrypt would additionally have brought its 72-byte silent
 * truncation, which turns a long passphrase into a shorter one without telling
 * anybody. Argon2id is the better algorithm on paper; it is not enough better
 * to be worth a native dependency for a table with a dozen rows in it.
 *
 * ## Parameters
 *
 * N = 2^16, r = 8, p = 1 — OWASP's current scrypt recommendation, costing
 * roughly 64 MB and ~100ms per hash. That cost is the entire point: it is
 * charged to an attacker per guess, and to us once per login.
 *
 * `maxmem` has to be raised explicitly. Node's default cap is 32 MB and these
 * parameters need twice that, so without it every call throws
 * `Invalid scrypt params` — at N=2^16 specifically, which is why the default
 * parameters in most examples are lower than the recommendation.
 *
 * ## The encoding
 *
 * `scrypt$N$r$p$salt$hash`, both fields base64. The parameters travel *with*
 * the hash rather than being read from a constant at verification time, which
 * is what makes raising them later a non-event: `needsRehash` reports the old
 * rows, they are upgraded on next login, and nobody is locked out in between.
 */

const ALGORITHM = "scrypt";
const COST = 2 ** 16;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 32;

/**
 * Node caps scrypt memory at 32 MB by default; these parameters need ~64 MB.
 *
 * The formula is `128 * N * r`, and the headroom factor is not decoration:
 * OpenSSL allocates slightly more than the formula and rejects the call with
 * `memory limit exceeded` when `maxmem` is set to the exact figure. Passing
 * `128 * COST * BLOCK_SIZE` on the nose fails every hash — which is worth
 * knowing, because the error names a *parameter* problem and sends you looking
 * at N and r rather than at the ceiling.
 */
const MAX_MEMORY = 2 * 128 * COST * BLOCK_SIZE;

export type ScryptParams = {
  cost: number;
  blockSize: number;
  parallelism: number;
};

export const CURRENT_PARAMS: Readonly<ScryptParams> = Object.freeze({
  cost: COST,
  blockSize: BLOCK_SIZE,
  parallelism: PARALLELISM,
});

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await deriveKey(password, salt, CURRENT_PARAMS);

  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Check a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed or unrecognised hash. A
 * row whose hash cannot be parsed is a broken row, and the safe reading of
 * "I cannot tell whether this password is right" is "no" — throwing would turn
 * one corrupt row into a 500 that distinguishes it from every other account,
 * which is a membership oracle built out of an error handler.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;

  const derived = await deriveKey(password, parsed.salt, parsed.params);

  // Lengths must match before timingSafeEqual, which throws on a mismatch
  // rather than returning false — and the throw would itself leak the length.
  if (derived.length !== parsed.hash.length) return false;

  return timingSafeEqual(derived, parsed.hash);
}

/**
 * Whether a stored hash was produced with weaker parameters than we now use.
 *
 * Called on *successful* login, which is the only moment the plaintext is in
 * hand and re-hashing is possible. Cost parameters are meant to rise with
 * hardware, and a codebase that raises them without this leaves every existing
 * account permanently on the old ones — the upgrade silently applies to new
 * hires only.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;

  return (
    parsed.params.cost < COST ||
    parsed.params.blockSize < BLOCK_SIZE ||
    parsed.params.parallelism < PARALLELISM
  );
}

async function deriveKey(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: params.cost,
    r: params.blockSize,
    p: params.parallelism,
    maxmem: MAX_MEMORY,
  });
}

type ParsedHash = { params: ScryptParams; salt: Buffer; hash: Buffer };

function parseHash(stored: string): ParsedHash | undefined {
  const parts = stored.split("$");
  if (parts.length !== 6) return undefined;

  const [algorithm, cost, blockSize, parallelism, salt, hash] = parts;
  if (algorithm !== ALGORITHM) return undefined;

  const params = {
    cost: Number(cost),
    blockSize: Number(blockSize),
    parallelism: Number(parallelism),
  };

  // A non-numeric or absurd cost would either throw inside scrypt or, worse,
  // be coerced to something cheap. Bounded so a tampered row cannot turn
  // verification into a trivially fast — or a denial-of-service slow — call.
  if (!Number.isInteger(params.cost) || params.cost < 2 ** 12 || params.cost > 2 ** 20) {
    return undefined;
  }
  if (!Number.isInteger(params.blockSize) || params.blockSize < 1 || params.blockSize > 32) {
    return undefined;
  }
  if (!Number.isInteger(params.parallelism) || params.parallelism < 1 || params.parallelism > 16) {
    return undefined;
  }

  return {
    params,
    salt: Buffer.from(salt, "base64"),
    hash: Buffer.from(hash, "base64"),
  };
}
