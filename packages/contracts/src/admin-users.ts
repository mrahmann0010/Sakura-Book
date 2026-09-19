import { z } from "zod";
import { adminRoleSchema, adminUserSchema } from "./admin-auth";

/* --------------------------------------------------------------------------
   Staff accounts, as the owner manages them from Settings → User Management.

   ADMIN only, end to end. Everything here either grants access to the panel
   or takes it away, which is the sharpest instance of the line ADMIN_ROLES
   draws.
   -------------------------------------------------------------------------- */

/**
 * One account on the staff list.
 *
 * The signed-in shape plus the two facts the list needs and `/me` does not:
 * whether the account is switched off, and whether it is the viewer's own
 * row — the three things you cannot do to yourself (change your role,
 * disable yourself, reset your own password from here) hang off that flag,
 * and deriving it on the server keeps the client from having to fetch `/me`
 * just to grey out a button.
 */
export const adminStaffMemberSchema = adminUserSchema.extend({
  disabledAt: z.string().datetime().nullable(),
  isSelf: z.boolean(),
});

export type AdminStaffMember = z.infer<typeof adminStaffMemberSchema>;

export const adminStaffListSchema = z.object({
  items: z.array(adminStaffMemberSchema),
});

export type AdminStaffList = z.infer<typeof adminStaffListSchema>;

const staffNameSchema = z
  .string()
  .trim()
  .min(1, "Enter the person's name.")
  .max(80, "Names must be at most 80 characters.");

/**
 * A new account.
 *
 * No password field, deliberately. The server generates one and returns it
 * exactly once (below), so there is no form where the owner types a password
 * they will reuse for everyone, and no request body that carries a password
 * someone chose.
 */
export const adminCreateStaffRequestSchema = z.object({
  name: staffNameSchema,
  // Lowercased here, as at login, so "the same address" means one thing.
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: adminRoleSchema,
});

export type AdminCreateStaffRequest = z.infer<typeof adminCreateStaffRequestSchema>;

/**
 * Change a name or a role. At least one, so an empty PATCH is a 400 rather
 * than an audit entry that records nothing happening.
 */
export const adminUpdateStaffRequestSchema = z
  .object({
    name: staffNameSchema.optional(),
    role: adminRoleSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.role !== undefined, {
    message: "Change the name, the role, or both.",
  });

export type AdminUpdateStaffRequest = z.infer<typeof adminUpdateStaffRequestSchema>;

/**
 * What creating an account or resetting its password returns: the account,
 * and the password — the only time it ever leaves the server in the clear.
 * Nothing stores it; if it is lost, the answer is another reset.
 */
export const adminStaffCredentialResultSchema = z.object({
  user: adminStaffMemberSchema,
  temporaryPassword: z.string(),
});

export type AdminStaffCredentialResult = z.infer<typeof adminStaffCredentialResultSchema>;
