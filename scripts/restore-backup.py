#!/usr/bin/env python3
"""Restore an owner export to a new SQLite database for migration."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any, Dict

LEGACY_TABLES = (
    "plans",
    "saved_foods",
    "entries",
    "cgm_readings",
    "dexcom_events",
    "dexcom_connections",
    "care_audit",
)
TABLES_WITH_ILLNESS = LEGACY_TABLES + ("illness_windows",)
TABLES_WITH_PROFILES = TABLES_WITH_ILLNESS + ("profiles",)
TABLES = TABLES_WITH_PROFILES + ("appointments",)
SCHEMA_DIR = Path(__file__).resolve().parent / "legacy-schema"


def restore(source: Path, destination: Path) -> Dict[str, int]:
    """Restore an export after checking its version, row shapes, and footer.

    Args:
        source: Complete owner backup downloaded from the app.
        destination: New SQLite database path; existing files are refused.

    Returns:
        The number of restored rows per table.

    Raises:
        ValueError: The export is incomplete, invalid, or from another schema.
    """
    if destination.exists():
        raise ValueError("destination already exists")
    connection = sqlite3.connect(str(destination))
    counts = {table: 0 for table in TABLES}
    try:
        for migration in sorted(SCHEMA_DIR.glob("[0-9][0-9][0-9][0-9]_*.sql")):
            connection.executescript(migration.read_text(encoding="utf-8"))
        if not any(SCHEMA_DIR.glob("[0-9][0-9][0-9][0-9]_*.sql")):
            raise ValueError("schema migrations are missing")
        columns = {
            table: {row[1] for row in connection.execute("PRAGMA table_info(\"" + table + "\")")}
            for table in TABLES
        }
        connection.execute("BEGIN")
        header_seen = False
        footer_seen = False
        owner = None
        declared_tables = ()
        with source.open("r", encoding="utf-8") as backup:
            for line_number, line in enumerate(backup, start=1):
                item: Dict[str, Any] = json.loads(line)
                kind = item.get("kind")
                if kind == "header" and line_number == 1:
                    if item.get("format") != "carby-d1-ndjson" or item.get("version") != 1 or tuple(item.get("tables", ())) not in (LEGACY_TABLES, TABLES_WITH_ILLNESS, TABLES_WITH_PROFILES, TABLES):
                        raise ValueError("unsupported backup format or table order")
                    declared_tables = tuple(item["tables"])
                    header_seen = True
                elif kind == "row" and header_seen and not footer_seen:
                    table = item.get("table")
                    row = item.get("row")
                    if table not in declared_tables or not isinstance(row, dict) or set(row) != columns[table]:
                        raise ValueError("invalid backup row at line " + str(line_number))
                    if owner is None:
                        owner = row["owner"]
                    if row["owner"] != owner:
                        raise ValueError("multiple owners in one export")
                    keys = tuple(row)
                    quoted = ",".join('"' + key + '"' for key in keys)
                    placeholders = ",".join("?" for _ in keys)
                    connection.execute(
                        "INSERT INTO \"" + table + "\" (" + quoted + ") VALUES (" + placeholders + ")",
                        tuple(row[key] for key in keys),
                    )
                    counts[table] += 1
                elif kind == "footer" and header_seen and not footer_seen:
                    if item.get("counts") != {table: counts[table] for table in declared_tables}:
                        raise ValueError("backup footer counts do not match rows")
                    footer_seen = True
                else:
                    raise ValueError("unexpected backup line " + str(line_number))
        if not footer_seen:
            raise ValueError("backup is incomplete; missing footer")
        connection.commit()
        return counts
    except Exception:
        connection.rollback()
        connection.close()
        destination.unlink(missing_ok=True)
        raise
    finally:
        try:
            connection.close()
        except sqlite3.Error:
            pass


def main() -> None:
    """Parse paths and restore the downloaded backup."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Downloaded .ndjson backup")
    parser.add_argument("destination", type=Path, help="New .sqlite3 database path")
    args = parser.parse_args()
    counts = restore(args.source, args.destination)
    print("Restored " + str(sum(counts.values())) + " rows to " + str(args.destination))


if __name__ == "__main__":
    main()
