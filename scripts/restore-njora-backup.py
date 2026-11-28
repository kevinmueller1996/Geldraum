#!/usr/bin/env python3
"""Verify a Njora JSON export by restoring it into an empty SQLite database."""
import argparse
import contextlib
import json
import os
import sqlite3
import sys
from pathlib import Path

COLUMNS = {
    "users": ("id", "display_name", "created_at", "updated_at"),
    "finance_plans": ("user_id", "plan_json", "schema_version", "revision", "created_at", "updated_at"),
    "user_activity": ("user_id", "email_mask", "first_seen_at", "last_seen_at", "access_count", "source"),
    "auth_credentials": (
        "user_id", "email_mask", "email_address", "email_verified_at", "password_salt",
        "password_hash", "password_iterations", "created_at", "updated_at",
    ),
}


def restore(source, destination):
    stream = contextlib.nullcontext(sys.stdin.buffer) if source == Path("-") else source.open(encoding="utf-8")
    with stream as file:
        backup = json.load(file)
    if not isinstance(backup, dict) or backup.get("format") != "njora-database-backup" or backup.get("version") not in (1, 2, 3, 4, 5):
        raise ValueError("Unbekanntes Sicherungsformat")
    tables = backup["tables"]
    columns_by_table = dict(COLUMNS)
    if backup["version"] >= 2:
        columns_by_table["njora_subscribers"] = ("user_id", "account_token", "stripe_customer", "apple_original", "apple_environment")
    if backup["version"] >= 4:
        columns_by_table["njora_business_subscribers"] = columns_by_table["njora_subscribers"]
    if backup["version"] >= 3:
        columns_by_table["business_plans"] = COLUMNS["finance_plans"]
    if backup["version"] >= 5:
        columns_by_table["auth_apple_identities"] = ("subject", "user_id", "client_id", "encrypted_refresh_token", "authorized_at")
        columns_by_table["auth_email_aliases"] = ("email_id", "user_id", "email_address", "verified_at")
    if not isinstance(tables, dict) or set(tables) != set(columns_by_table):
        raise ValueError("Die Sicherung enthält nicht die erwarteten Tabellen")

    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with sqlite3.connect(destination) as db:
            db.execute("PRAGMA foreign_keys = ON")
            migrations = Path(__file__).resolve().parents[1] / "drizzle"
            for migration in sorted(migrations.glob("*.sql")):
                db.executescript(migration.read_text(encoding="utf-8"))
            for table, columns in columns_by_table.items():
                rows = tables[table]
                if not isinstance(rows, list) or any(not isinstance(row, dict) or set(row) != set(columns) for row in rows):
                    raise ValueError(f"Unerwartete Spalten in {table}")
                if table in ("finance_plans", "business_plans"):
                    for row in rows:
                        plan = json.loads(row["plan_json"])
                        required_lists = ("incomes", "expenses", "annualCosts", "commitments", "accounts", "goals", "snapshots")
                        if (not isinstance(plan, dict) or not isinstance(plan.get("name"), str)
                                or not all(isinstance(plan.get(key), list) for key in required_lists)
                                or not isinstance(plan.get("savings", []), list)
                                or type(row["revision"]) is not int or row["revision"] < 1):
                            raise ValueError("Ungültiger Finanzplan oder Revisionsstand")
                placeholders = ", ".join("?" for _ in columns)
                sql = f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})"
                db.executemany(sql, (tuple(row[column] for column in columns) for row in rows))
            for table in ("njora_subscribers", "njora_business_subscribers"):
                if table in tables and db.execute(
                    f"SELECT 1 FROM {table} s LEFT JOIN users u ON u.id=s.user_id WHERE u.id IS NULL LIMIT 1"
                ).fetchone():
                    raise ValueError("Abonnement ohne zugehöriges Nutzerkonto")
            if db.execute("PRAGMA foreign_key_check").fetchone():
                raise ValueError("Die Sicherung enthält ungültige Verknüpfungen")
            if db.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise ValueError("Die wiederhergestellte Datenbank ist beschädigt")
    except BaseException:
        destination.unlink()
        raise
    return {table: len(tables[table]) for table in columns_by_table}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("output", type=Path, help="Eine neue, noch nicht vorhandene SQLite-Datei")
    args = parser.parse_args()
    try:
        counts = restore(args.backup, args.output)
    except (OSError, ValueError, TypeError, KeyError, sqlite3.DatabaseError) as error:
        # SQLite errors may contain data values. Keep the console free of backup contents.
        parser.exit(1, f"Wiederherstellung fehlgeschlagen ({type(error).__name__}).\n")
    for table, count in counts.items():
        print(f"{table}: {count}")


if __name__ == "__main__":
    main()
