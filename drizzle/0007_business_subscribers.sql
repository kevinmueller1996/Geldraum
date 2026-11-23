CREATE TABLE IF NOT EXISTS njora_business_subscribers (
    user_id TEXT PRIMARY KEY, account_token TEXT NOT NULL UNIQUE, stripe_customer TEXT UNIQUE,
    apple_original TEXT UNIQUE, apple_environment TEXT);
