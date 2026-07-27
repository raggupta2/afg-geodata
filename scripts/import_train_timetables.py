#!/usr/bin/env python3
"""Import train timetable JSON files (or the legacy CSV) into PostgreSQL.

JSON input may be a single file or a directory containing ``*.json`` files.
Imports are batched, transactional, and idempotent by source-file SHA-256.
Stations must already exist in ``railway_station``.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
from collections import defaultdict
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any


IMPORT_ERRORS = {
    "stationList_empty": [],
    "source_empty": [],
    "invalid_json": [],
    "missing_station_codes": defaultdict(set),
    "invalid_halt_rows": []
}


try:
    import psycopg
except ImportError:
    print("Missing dependency: install psycopg with 'python -m pip install psycopg[binary]'.", file=sys.stderr)
    raise SystemExit(2)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DAY_FIELDS = (
    ("trainRunsOnMon", 1),
    ("trainRunsOnTue", 2),
    ("trainRunsOnWed", 4),
    ("trainRunsOnThu", 8),
    ("trainRunsOnFri", 16),
    ("trainRunsOnSat", 32),
    ("trainRunsOnSun", 64),
)
CSV_REQUIRED_COLUMNS = {
    "train_number", "train_name", "station_code", "sequence",
    "arrival_time", "departure_time", "day_offset",
}


class SourceScheduleUnavailable(ValueError):
    """The source API returned a valid response that contains no timetable."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_path", type=Path, help="JSON file, JSON directory, or legacy timetable CSV")
    parser.add_argument("--database-url", help="Defaults to DATABASE_URL or the project .env file")
    parser.add_argument("--batch-size", type=int, default=500, help="Schedules per transaction (default: 500)")
    parser.add_argument("--dry-run", action="store_true", help="Validate and execute each batch, then roll it back")
    parser.add_argument("--force", action="store_true", help="Reimport files even when their checksum is unchanged")
    parser.add_argument("--strict-source-errors", action="store_true",
                        help="Fail instead of skipping API error/empty payload files")
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error("--batch-size must be at least 1")
    return args


def database_url(explicit_url: str | None) -> str:
    if explicit_url:
        return explicit_url
    if os.getenv("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env_path = PROJECT_ROOT / ".env"
    if env_path.exists():
        for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
            line = raw_line.strip()
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("DATABASE_URL is not configured")


def required_text(value: Any, field: str, source: str) -> str:
    result = str(value or "").strip()
    if not result:
        raise ValueError(f"{source}: {field} is required")
    return result


def optional_text(value: Any) -> str | None:
    result = str(value or "").strip()
    return result or None


def optional_station_code(value: Any) -> str | None:
    result = optional_text(value)
    return result.upper() if result is not None else None


def integer(value: Any, field: str, source: str, minimum: int) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError) as error:
        raise ValueError(f"{source}: {field} must be an integer") from error
    if parsed < minimum:
        raise ValueError(f"{source}: {field} must be at least {minimum}")
    return parsed


def decimal_text(value: Any, field: str, source: str) -> str | None:
    text = optional_text(value)
    if text is None or text == "--":
        return None
    try:
        if float(text) < 0:
            raise ValueError
    except ValueError as error:
        raise ValueError(f"{source}: {field} must be a non-negative number") from error
    return text


def boolean(value: Any, field: str, source: str) -> bool:
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "y", "yes"}:
        return True
    if normalized in {"false", "0", "n", "no", ""}:
        return False
    raise ValueError(f"{source}: {field} must be a boolean")


def clock_time(value: Any, field: str, source: str) -> tuple[str | None, int | None]:
    text = optional_text(value)
    if text is None or text == "--":
        return None, None
    for pattern in ("%H:%M", "%H:%M:%S"):
        try:
            parsed = datetime.strptime(text, pattern).time()
            return parsed.isoformat(), parsed.hour * 60 + parsed.minute
        except ValueError:
            continue
    raise ValueError(f"{source}: {field} must use HH:MM, HH:MM:SS, or --")


def halt_minutes(value: Any, source: str) -> int | None:
    text = optional_text(value)
    if text is None or text == "--":
        return None
    parts = text.split(":")
    try:
        if len(parts) == 2:  # Source format is MM:SS.
            return int(parts[0]) + (1 if int(parts[1]) >= 30 else 0)
        if len(parts) == 3:
            return int(parts[0]) * 60 + int(parts[1]) + (1 if int(parts[2]) >= 30 else 0)
    except ValueError:
        pass
    raise ValueError(f"{source}: haltTime must use MM:SS, HH:MM:SS, or --")


def timestamp(value: Any, source: str) -> datetime | None:
    text = optional_text(value)
    if text is None:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{source}: timeStamp must be ISO-8601") from error


def runs_mask(document: dict[str, Any], source: str) -> int:
    result = 0
    for field, bit in DAY_FIELDS:
        if boolean(document.get(field), field, source):
            result |= bit
    return result


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def normalize_route_minutes(stops: list[dict[str, Any]]) -> None:
    """Make timetable minutes monotonic across the ordered route.

    Source day counters are a lower bound: some feeds keep the same day count
    for stops immediately after midnight. Absolute minutes therefore require
    the preceding route event and cannot be generated from one database row.
    """
    previous_minute: int | None = None
    for stop in stops:
        for field in ("arrival_minute", "departure_minute"):
            minute = stop[field]
            if minute is None:
                continue
            if previous_minute is not None and minute < previous_minute:
                minute += ((previous_minute - minute + 1439) // 1440) * 1440
            stop[field] = minute
            previous_minute = minute


def parse_json_schedule(path: Path, source_file: str, station_list_override: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    raw = path.read_bytes()
    try:
        document = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{source_file}: invalid JSON: {error}") from error
    if not isinstance(document, dict):
        raise ValueError(f"{source_file}: root value must be an object")

    if document.get("errorMessage"):
        raise SourceScheduleUnavailable(f"{source_file}: {document['errorMessage']}")
    empty_response_fields = {"serverId", "timeStamp", "duration"}
    if not document.get("trainNumber") and not document.get("stationList") and set(document) <= empty_response_fields:
        raise SourceScheduleUnavailable(f"{source_file}: source returned an empty schedule payload")

    train_number = required_text(document.get("trainNumber"), "trainNumber", source_file).upper()
    train_name = required_text(document.get("trainName"), "trainName", source_file)
    station_list = station_list_override if station_list_override is not None else document.get("stationList")
    if not isinstance(station_list, list) or not station_list:
        raise ValueError(f"{source_file}: stationList must be a non-empty array")

    stops: list[dict[str, Any]] = []
    sequences: set[int] = set()
    for index, item in enumerate(station_list, start=1):
        stop_source = f"{source_file}: stationList[{index - 1}]"
        if not isinstance(item, dict):
            raise ValueError(f"{stop_source} must be an object")
        sequence = integer(item.get("stnSerialNumber"), "stnSerialNumber", stop_source, 1)
        if sequence in sequences:
            raise ValueError(f"{source_file}: duplicate stop sequence {sequence}")
        sequences.add(sequence)
        day_offset = integer(item.get("dayCount"), "dayCount", stop_source, 1) - 1
        arrival_time, arrival_clock = clock_time(item.get("arrivalTime"), "arrivalTime", stop_source)
        departure_time, departure_clock = clock_time(item.get("departureTime"), "departureTime", stop_source)
        if arrival_time is None and departure_time is None:
            raise ValueError(f"{stop_source}: arrivalTime or departureTime must be present")
        if arrival_clock is not None and departure_clock is not None:
            # Source haltTime is frequently wrong (e.g. "160:00" instead of "100:00"),
            # so derive halt directly from the two clock times instead of trusting it.
            halt = departure_clock - arrival_clock
            if halt < 0:
                halt += 1440
        else:
            halt = halt_minutes(item.get("haltTime"), stop_source)
        stops.append({
            "station_code": required_text(item.get("stationCode"), "stationCode", stop_source).upper(),
            "sequence": sequence,
            "arrival_time": arrival_time,
            "departure_time": departure_time,
            "day_offset": day_offset,
            "arrival_minute": None if arrival_clock is None else day_offset * 1440 + arrival_clock,
            "departure_minute": None if departure_clock is None else day_offset * 1440 + departure_clock,
            "distance_km": decimal_text(item.get("distance"), "distance", stop_source),
            "halt_minutes": halt,
            "boarding_allowed": not boolean(item.get("boardingDisabled"), "boardingDisabled", stop_source),
            "alighting_allowed": True,
        })
    stops.sort(key=lambda stop: stop["sequence"])
    normalize_route_minutes(stops)

    route_numbers = {optional_text(item.get("routeNumber")) for item in station_list if isinstance(item, dict)}
    route_numbers.discard(None)
    if len(route_numbers) > 1:
        raise ValueError(f"{source_file}: routeNumber is inconsistent between stops")
    return {
        "source_file": source_file,
        "checksum": sha256(raw),
        "train_number": train_number,
        "train_name": train_name,
        "source_station_code": optional_station_code(document.get("stationFrom")),
        "destination_station_code": optional_station_code(station_list[-1].get("stationCode")),
        "owner_code": optional_text(document.get("trainOwner")),
        "route_number": next(iter(route_numbers), "1"),
        "runs_mask": runs_mask(document, source_file),
        "source_updated_at": timestamp(document.get("timeStamp"), source_file),
        "stops": stops,
    }

def parse_json_schedules(path: Path, source_file: str) -> list[dict[str, Any]]:
    """Expand a source file into one service per route variant.

    Some Indian Railways responses contain a primary route followed by a
    branch whose serial numbers restart. The branch inherits the primary
    prefix through its first station and becomes an independent route pattern.
    """
    raw = path.read_bytes()
    try:
        document = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return [parse_json_schedule(path, source_file)]
    station_list = document.get("stationList") if isinstance(document, dict) else None
    if not isinstance(station_list, list):
        return [parse_json_schedule(path, source_file)]

    groups: dict[str, list[dict[str, Any]]] = {}
    for item in station_list:
        if not isinstance(item, dict):
            return [parse_json_schedule(path, source_file)]
        route_number = optional_text(item.get("routeNumber")) or "1"
        groups.setdefault(route_number, []).append(item)
    if len(groups) <= 1:
        return [parse_json_schedule(path, source_file)]

    primary = next(iter(groups.values()))
    result: list[dict[str, Any]] = []
    for route_number, route_stops in groups.items():
        variant = route_stops
        if route_stops is not primary:
            branch_code = optional_text(route_stops[0].get("stationCode"))
            branch_index = next((index for index, stop in enumerate(primary)
                                 if optional_text(stop.get("stationCode")) == branch_code), None)
            if branch_index is not None:
                variant = primary[:branch_index] + route_stops
        normalized = []
        for sequence, stop in enumerate(variant, start=1):
            normalized.append({**stop, "routeNumber": route_number, "stnSerialNumber": str(sequence)})
        result.append(parse_json_schedule(path, source_file, normalized))
    return result


def parse_csv_schedules(path: Path) -> list[dict[str, Any]]:
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(text.splitlines())
    missing = CSV_REQUIRED_COLUMNS - set(reader.fieldnames or [])
    if missing:
        raise ValueError("Missing CSV columns: " + ", ".join(sorted(missing)))
    grouped: dict[str, dict[str, Any]] = {}
    for row_number, row in enumerate(reader, start=2):
        source = f"{path.name}: row {row_number}"
        number = required_text(row["train_number"], "train_number", source).upper()
        schedule = grouped.setdefault(number, {
            "source_file": f"{path.name}#{number}", "checksum": sha256(raw),
            "train_number": number, "train_name": required_text(row["train_name"], "train_name", source),
            "source_station_code": None, "destination_station_code": None, "owner_code": None,
            "route_number": "1", "runs_mask": 127, "source_updated_at": None, "stops": [],
        })
        day_offset = integer(row["day_offset"], "day_offset", source, 0)
        arrival_time, arrival_clock = clock_time(row["arrival_time"], "arrival_time", source)
        departure_time, departure_clock = clock_time(row["departure_time"], "departure_time", source)
        schedule["stops"].append({
            "station_code": required_text(row["station_code"], "station_code", source).upper(),
            "sequence": integer(row["sequence"], "sequence", source, 1),
            "arrival_time": arrival_time, "departure_time": departure_time, "day_offset": day_offset,
            "arrival_minute": None if arrival_clock is None else day_offset * 1440 + arrival_clock,
            "departure_minute": None if departure_clock is None else day_offset * 1440 + departure_clock,
            "distance_km": None, "halt_minutes": None,
            "boarding_allowed": True, "alighting_allowed": True,
        })
    schedules = list(grouped.values())
    for schedule in schedules:
        schedule["stops"].sort(key=lambda stop: stop["sequence"])
        normalize_route_minutes(schedule["stops"])
    return schedules


def schedules(input_path: Path, source_stats: dict[str, int], strict_source_errors: bool) -> Iterator[dict[str, Any]]:
    resolved = input_path.resolve()
    if resolved.is_dir():
        files = sorted(resolved.rglob("*.json"))
        if not files:
            raise ValueError(f"No JSON files found under {resolved}")
        for path in files:
            source_file = path.relative_to(resolved).as_posix()
            try:
                yield from parse_json_schedules(path, source_file)

            except SourceScheduleUnavailable:
                IMPORT_ERRORS["source_empty"].append(source_file)
                source_stats["source_errors"] += 1
                if strict_source_errors:
                    raise
                continue

            except ValueError as error:
                source_stats["source_errors"] += 1

                message = str(error)

                if "stationList must be a non-empty array" in message:
                    IMPORT_ERRORS["stationList_empty"].append(source_file)
                elif "invalid JSON" in message:
                    IMPORT_ERRORS["invalid_json"].append(source_file)
                else:
                    IMPORT_ERRORS["invalid_json"].append(source_file)

                continue
    elif resolved.is_file() and resolved.suffix.lower() == ".json":
        try:
            yield from parse_json_schedules(resolved, resolved.name)
        except SourceScheduleUnavailable:
            source_stats["source_errors"] += 1
            if strict_source_errors:
                raise
            IMPORT_ERRORS["source_empty"].append(resolved.name)
            return
        except ValueError as error:
            source_stats["source_errors"] += 1
            if "stationList must be a non-empty array" in str(error):
                IMPORT_ERRORS["stationList_empty"].append(resolved.name)
            else:
                IMPORT_ERRORS["invalid_json"].append(resolved.name)
            return
    elif resolved.is_file() and resolved.suffix.lower() == ".csv":
        yield from parse_csv_schedules(resolved)
    else:
        raise ValueError(f"Input must be a JSON file, JSON directory, or CSV file: {resolved}")


def preflight(cursor: Any) -> None:
    cursor.execute("""
        SELECT to_regclass('"train"'), to_regclass('train_stops'),
               to_regclass('train_connections'), to_regclass('train_schedule_imports'),
               to_regclass('train_endpoints'),
               to_regclass('railway_station'),
               to_regclass('train_train_number_route_key'),
               to_regclass('train_schedule_imports_source_route_key')
    """)
    if not all(cursor.fetchone()):
        raise RuntimeError("Latest train timetable routing migrations are not applied")


def chunks(items: Iterator[dict[str, Any]], size: int) -> Iterator[list[dict[str, Any]]]:
    batch: list[dict[str, Any]] = []
    for item in items:
        batch.append(item)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def import_batch(cursor: Any, batch: list[dict[str, Any]], force: bool) -> dict[str, int]:
    source_files = [item["source_file"] for item in batch]
    cursor.execute("SELECT source_file, route_number, checksum FROM train_schedule_imports WHERE source_file = ANY(%s)", (source_files,))
    existing = {(source, route): checksum for source, route, checksum in cursor.fetchall()}
    changed = [item for item in batch if force or existing.get((item["source_file"], item["route_number"])) != item["checksum"]]
    if not changed:
        return {"files": len(batch), "skipped": len(batch), "trains": 0, "stops": 0, "connections": 0}

    cursor.execute("""
        CREATE TEMP TABLE stage_train_timetable (
            source_file TEXT NOT NULL, checksum CHAR(64) NOT NULL,
            train_number VARCHAR(20) NOT NULL, train_name VARCHAR(200) NOT NULL,
            source_station_code VARCHAR(20), destination_station_code VARCHAR(20), owner_code VARCHAR(20),
            route_number VARCHAR(20), runs_mask SMALLINT NOT NULL, source_updated_at TIMESTAMP(3),
            station_code TEXT NOT NULL, sequence INTEGER NOT NULL,
            arrival_time TIME(0), departure_time TIME(0), day_offset INTEGER NOT NULL,
            arrival_minute INTEGER, departure_minute INTEGER, distance_km DECIMAL(10,2),
            halt_minutes INTEGER, boarding_allowed BOOLEAN NOT NULL, alighting_allowed BOOLEAN NOT NULL
        ) ON COMMIT DROP
    """)
    with cursor.copy("""
        COPY stage_train_timetable (
            source_file, checksum, train_number, train_name, source_station_code, destination_station_code,
            owner_code, route_number, runs_mask, source_updated_at, station_code, sequence,
            arrival_time, departure_time, day_offset, arrival_minute, departure_minute,
            distance_km, halt_minutes, boarding_allowed, alighting_allowed
        ) FROM STDIN
    """) as copy:
        for item in changed:
            for stop in item["stops"]:
                copy.write_row((
                    item["source_file"], item["checksum"], item["train_number"], item["train_name"],
                    item["source_station_code"], item["destination_station_code"], item["owner_code"], item["route_number"],
                    item["runs_mask"], item["source_updated_at"], stop["station_code"], stop["sequence"],
                    stop["arrival_time"], stop["departure_time"], stop["day_offset"], stop["arrival_minute"],
                    stop["departure_minute"], stop["distance_km"], stop["halt_minutes"],
                    stop["boarding_allowed"], stop["alighting_allowed"],
                ))


    cursor.execute("""
        SELECT
            stage.station_code,
            stage.source_file
        FROM stage_train_timetable stage
        LEFT JOIN railway_station station
        ON station.station_code = stage.station_code
        WHERE station.id IS NULL
        ORDER BY stage.station_code, stage.source_file
    """)

    rows = cursor.fetchall()

    for station_code, filename in rows:
        IMPORT_ERRORS["missing_station_codes"][filename].add(station_code)

    unknown = sorted({row[0] for row in rows})
    unknown_files = sorted({row[1] for row in rows})

    # if unknown:
    #     preview = ", ".join(unknown[:50]) + (f" (+{len(unknown) - 50} more)" if len(unknown) > 50 else "")
    #     raise ValueError("Unknown railway station codes: " + preview)

    if unknown:
        cursor.execute("""
            DELETE FROM stage_train_timetable
            WHERE station_code = ANY(%s)
        """, (unknown,))
        deleted = cursor.rowcount


    cursor.execute("""
        INSERT INTO "train" (
            train_number, train_name, owner_code,
            route_number, runs_mask, source_updated_at, active
        )
        SELECT DISTINCT train_number, train_name, owner_code,
               route_number, runs_mask, source_updated_at, true
        FROM stage_train_timetable
        ON CONFLICT (train_number, route_number) DO UPDATE SET
            train_name = EXCLUDED.train_name,
            owner_code = EXCLUDED.owner_code,
            runs_mask = EXCLUDED.runs_mask,
            source_updated_at = EXCLUDED.source_updated_at,
            active = true,
            updated = CURRENT_TIMESTAMP
    """)

    # A (train_number, route_number) row owns one current ordered stop list.
    cursor.execute("""
        DELETE FROM train_stops
        WHERE train_id IN (
            SELECT service.id
            FROM "train" service
            JOIN (SELECT DISTINCT train_number, route_number FROM stage_train_timetable) stage
              ON stage.train_number = service.train_number
             AND stage.route_number = service.route_number
        )
    """)

    cursor.execute("""
    SELECT
        source_file,
        train_number,
        station_code,
        sequence,
        arrival_time,
        departure_time,
        arrival_minute,
        departure_minute,
        halt_minutes
    FROM stage_train_timetable
    WHERE
        halt_minutes IS NOT NULL
        AND arrival_minute IS NOT NULL
        AND departure_minute IS NOT NULL
        AND halt_minutes <> (departure_minute - arrival_minute)
    LIMIT 20;
    """)

    bad_rows = cursor.fetchall()

    if bad_rows:
        print("\nInvalid halt rows:", file=sys.stderr)
        for row in bad_rows:
            print(row, file=sys.stderr)
            IMPORT_ERRORS["invalid_halt_rows"].append(row[0])

    cursor.execute("""
        INSERT INTO train_stops (
            train_id, station_id, sequence,
            arrival_time, departure_time, day_offset,
            arrival_minute, departure_minute, distance_km, halt_minutes,
            boarding_allowed, alighting_allowed
        )
        SELECT service.id, station.id, stage.sequence,
               stage.arrival_time, stage.departure_time, stage.day_offset,
               stage.arrival_minute, stage.departure_minute, stage.distance_km,
               stage.halt_minutes, stage.boarding_allowed, stage.alighting_allowed
        FROM stage_train_timetable stage
        JOIN "train" service
          ON service.train_number = stage.train_number
         AND service.route_number = stage.route_number
        JOIN railway_station station
          ON station.station_code = stage.station_code
        ORDER BY service.id, stage.sequence
    """)
    stops_inserted = cursor.rowcount

    cursor.execute("""
        INSERT INTO train_endpoints (
            train_id, source_station_id, destination_station_id,
            created, updated
        )
        SELECT service.id, source_stop.station_id, destination_stop.station_id,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM "train" service
        JOIN (SELECT DISTINCT train_number, route_number FROM stage_train_timetable) stage
          ON stage.train_number = service.train_number
         AND stage.route_number = service.route_number
        JOIN LATERAL (
            SELECT stop.station_id
            FROM train_stops stop
            WHERE stop.train_id = service.id
            ORDER BY stop.sequence ASC
            LIMIT 1
        ) source_stop ON true
        JOIN LATERAL (
            SELECT stop.station_id
            FROM train_stops stop
            WHERE stop.train_id = service.id
            ORDER BY stop.sequence DESC
            LIMIT 1
        ) destination_stop ON true
        ON CONFLICT (train_id) DO UPDATE SET
            source_station_id = EXCLUDED.source_station_id,
            destination_station_id = EXCLUDED.destination_station_id,
            updated = CURRENT_TIMESTAMP
    """)
    cursor.execute("""
        INSERT INTO train_connections (
            train_id, from_stop_id, to_stop_id,
            from_station_id, to_station_id, sequence,
            departure_minute, arrival_minute, duration_minutes
        )
        SELECT current_stop.train_id, current_stop.id, next_stop.id,
               current_stop.station_id, next_stop.station_id,
               current_stop.sequence, current_stop.departure_minute,
               next_stop.arrival_minute,
               next_stop.arrival_minute - current_stop.departure_minute
        FROM train_stops current_stop
        JOIN LATERAL (
            SELECT candidate.*
            FROM train_stops candidate
            WHERE candidate.train_id = current_stop.train_id
              AND candidate.sequence > current_stop.sequence
            ORDER BY candidate.sequence
            LIMIT 1
        ) next_stop ON true
        JOIN "train" service ON service.id = current_stop.train_id
        JOIN (SELECT DISTINCT train_number, route_number FROM stage_train_timetable) stage
          ON stage.train_number = service.train_number
         AND stage.route_number = service.route_number
        WHERE current_stop.departure_minute IS NOT NULL
          AND next_stop.arrival_minute IS NOT NULL
          AND next_stop.arrival_minute > current_stop.departure_minute
    """)
    connections_inserted = cursor.rowcount

    cursor.execute("""
        UPDATE railway_station station
        SET train_available = true, updated = CURRENT_TIMESTAMP
        WHERE EXISTS (
            SELECT 1 FROM stage_train_timetable stage
            WHERE station.station_code = stage.station_code
        )
    """)
    cursor.execute("""
        INSERT INTO train_schedule_imports (
            source_file, route_number, checksum, train_number,
            source_updated_at, stop_count, imported_at
        )
        SELECT source_file, route_number, MIN(checksum), train_number,
               MIN(source_updated_at), COUNT(*), CURRENT_TIMESTAMP
        FROM stage_train_timetable
        GROUP BY source_file, route_number, train_number
        ON CONFLICT (source_file, route_number) DO UPDATE SET
            checksum = EXCLUDED.checksum,
            train_number = EXCLUDED.train_number,
            source_updated_at = EXCLUDED.source_updated_at,
            stop_count = EXCLUDED.stop_count,
            imported_at = CURRENT_TIMESTAMP
    """)
    return {
        "files": len(batch), "skipped": len(batch) - len(changed), "trains": len(changed),
        "stops": stops_inserted, "connections": connections_inserted,
    }


def main() -> int:
    args = parse_args()

    seen_trains: dict[tuple[str, str], str] = {}
    totals = {
        "files": 0,
        "skipped": 0,
        "trains": 0,
        "stops": 0,
        "connections": 0,
    }
    source_stats = {"source_errors": 0}

    connection = psycopg.connect(database_url(args.database_url))

    try:
        with connection.cursor() as cursor:
            preflight(cursor)

        connection.rollback()

        schedule_stream = schedules(
            args.input_path,
            source_stats,
            args.strict_source_errors,
        )

        for batch_number, batch in enumerate(
            chunks(schedule_stream, args.batch_size),
            start=1,
        ):

            for item in batch:
                service_key = (
                    item["train_number"],
                    item["route_number"],
                )

                previous = seen_trains.get(service_key)

                if previous is not None:
                    raise ValueError(
                        f"Train route {service_key} appears in both "
                        f"{previous} and {item['source_file']}"
                    )

                seen_trains[service_key] = item["source_file"]

            try:
                with connection.cursor() as cursor:
                    result = import_batch(
                        cursor,
                        batch,
                        args.force,
                    )

                if args.dry_run:
                    connection.rollback()
                else:
                    connection.commit()

            except Exception:
                connection.rollback()

                print(
                    f"Batch {batch_number} failed. Retrying files individually...",
                    file=sys.stderr,
                )

                for item in batch:
                    try:
                        with connection.cursor() as cursor:
                            result = import_batch(
                                cursor,
                                [item],
                                args.force,
                            )

                        if args.dry_run:
                            connection.rollback()
                        else:
                            connection.commit()

                        for key in totals:
                            totals[key] += result[key]

                    except Exception as item_error:
                        connection.rollback()

                        print(
                            f"Skipping {item['source_file']}: {item_error}",
                            file=sys.stderr,
                        )

                continue

            for key in totals:
                totals[key] += result[key]

            print(f"batch {batch_number}: {result}", flush=True)

        if source_stats["source_errors"] > 10:
            print(
                f"Skipped {source_stats['source_errors']} source error/empty payload files.",
                file=sys.stderr,
            )

        if totals["files"] == 0:
            raise ValueError(
                f"Input contains no train schedules "
                f"({source_stats['source_errors']} source responses skipped)"
            )

        totals["source_errors"] = source_stats["source_errors"]
        totals["dry_run"] = int(args.dry_run)

        print_import_summary(totals)

        return 0

    finally:
        connection.close()


def print_import_summary(stats):
    print()
    print("=" * 50)
    print("TRAIN IMPORT ERROR SUMMARY")
    print("=" * 50)

    if IMPORT_ERRORS["stationList_empty"]:
        print(f"\nstationList empty ({len(IMPORT_ERRORS['stationList_empty'])}):")
        print("[" + ", ".join(sorted(IMPORT_ERRORS["stationList_empty"])) + "]")

    if IMPORT_ERRORS["source_empty"]:
        print(f"\nsource empty payload ({len(IMPORT_ERRORS['source_empty'])}):")
        print("[" + ", ".join(sorted(IMPORT_ERRORS["source_empty"])) + "]")

    if IMPORT_ERRORS["invalid_json"]:
        print(f"\ninvalid json ({len(IMPORT_ERRORS['invalid_json'])}):")
        print("[" + ", ".join(sorted(IMPORT_ERRORS["invalid_json"])) + "]")

    if IMPORT_ERRORS["invalid_halt_rows"]:
        files = sorted(set(IMPORT_ERRORS["invalid_halt_rows"]))
        print(f"\ninvalid halt rows ({len(files)}):")
        print("[" + ", ".join(files) + "]")

    if IMPORT_ERRORS["missing_station_codes"]:
        print("\nmissing station codes:")

        for file in sorted(IMPORT_ERRORS["missing_station_codes"]):
            codes = sorted(IMPORT_ERRORS["missing_station_codes"][file])
            print(f"{file}:")
            print(f"  [{', '.join(codes)}]")

    print("\n" + "=" * 50)
    print("Imported:")
    print(f"  trains: {stats['trains']}")
    print(f"  stops: {stats['stops']}")
    print(f"  connections: {stats['connections']}")

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(
            f"Train timetable import failed: {error}",
            file=sys.stderr,
        )
        raise SystemExit(1)
