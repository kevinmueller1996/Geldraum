#!/usr/bin/env python3
"""Verify a Njora JSON export by restoring it into an empty SQLite database."""
import argparse
import json
import os
import sqlite3
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
    with source.open(encoding="utf-8") as file:
        backup = json.load(file)
    if backup.get("format") != "njora-database-backup" or backup.get("version") != 1:
        raise ValueError("Unbekanntes Sicherungsformat")
    tables = backup["tables"]
    if set(tables) != set(COLUMNS):
        raise ValueError("Die Sicherung enthält nicht die erwarteten Tabellen")

    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with sqlite3.connect(destination) as db:
            db.execute("PRAGMA foreign_keys = ON")
            migrations = Path(__file__).resolve().parents[1] / "drizzle"
            for migration in sorted(migrations.glob("*.sql")):
                db.executescript(migration.read_text(encoding="utf-8"))
            for table, columns in COLUMNS.items():
                rows = tables[table]
                if not isinstance(rows, list) or any(set(row) != set(columns) for row in rows):
                    raise ValueError(f"Unerwartete Spalten in {table}")
                if table == "finance_plans":
                    for row in rows:
                        if not isinstance(json.loads(row["plan_json"]), dict):
                            raise ValueError("Ungültiger Finanzplan")
                placeholders = ", ".join("?" for _ in columns)
                sql = f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})"
                db.executemany(sql, (tuple(row[column] for column in columns) for row in rows))
            if db.execute("PRAGMA foreign_key_check").fetchone():
                raise ValueError("Die Sicherung enthält ungültige Verknüpfungen")
            if db.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise ValueError("Die wiederhergestellte Datenbank ist beschädigt")
    except BaseException:
        destination.unlink()
        raise
    return {table: len(tables[table]) for table in COLUMNS}


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
