import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const financePlans = sqliteTable("finance_plans", {
  userId: text("user_id").primaryKey().references(() => users.id),
  planJson: text("plan_json").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const userActivity = sqliteTable("user_activity", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  emailMask: text("email_mask").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  accessCount: integer("access_count").notNull().default(1),
  source: text("source").notNull(),
});

export const authCredentials = sqliteTable("auth_credentials", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  emailMask: text("email_mask").notNull(),
  emailAddress: text("email_address"),
  emailVerifiedAt: text("email_verified_at"),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("auth_sessions_user_id_idx").on(table.userId),
  index("auth_sessions_expires_at_idx").on(table.expiresAt),
]);

export const authAttempts = sqliteTable("auth_attempts", {
  emailHash: text("email_hash").primaryKey(),
  failedCount: integer("failed_count").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull(),
  lockedUntil: text("locked_until"),
});

export const authActionTokens = sqliteTable("auth_action_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose", { enum: ["verify_email", "password_reset"] }).notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
}, (table) => [
  index("auth_action_tokens_user_purpose_idx").on(table.userId, table.purpose),
  index("auth_action_tokens_expires_at_idx").on(table.expiresAt),
]);
