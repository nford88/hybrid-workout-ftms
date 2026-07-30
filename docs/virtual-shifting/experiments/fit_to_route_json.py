#!/usr/bin/env python3
"""Convert a FIT ride recording into the Garmin route JSON shape this app's route
importer accepts: {"name": str, "geoPoints": [{"latitude", "longitude", "elevation"}, ...]}.

Built for the eventual Zwift-comparison ride (see
docs/virtual-shifting/experiments/10-offline-fit-physics-analysis.md and the
virtual-shifting-calibration handoff, "Next steps" #2). Works in either direction:

  - Import a real outdoor FIT ride here, to replay its exact grade profile in SIM mode.
  - Import a FIT recording exported from Zwift, to get an exact grade-profile match for a
    direct trainer-vs-Zwift comparison ride.

Usage:
    python3 fit_to_route_json.py <fit_file.fit> [--name "My Route"] [--out route.json]
                                  [--min-move-m 2.0]

Prints the route JSON to stdout by default (pipe into `pbcopy` to paste directly into the
app's "Import Garmin Route" textarea, src/components/route/RouteImport.tsx), or write it
to a file with --out.

Privacy note: unlike offline_fit_physics_analysis.py (which reads a FIT file's raw
per-second streams but only ever emits aggregate physics numbers), this script's entire
purpose is to emit per-point GPS coordinates -- that is the point of a route file, not an
oversight. Never commit the raw .fit input or the generated route JSON output to the repo
(both are ignored via .gitignore) -- they're personal ride data, kept local.
"""

import sys
import os
import json
import math
import argparse
import fitparse

SEMICIRCLE_TO_DEG = 180.0 / (2 ** 31)
EARTH_RADIUS_M = 6371e3  # matches src/utils/geo.ts's haversineDistance


def haversine_m(lat1, lon1, lat2, lon2):
    """Same formula/Earth-radius constant as src/utils/geo.ts, so the min-move-m filter
    below uses the same notion of distance the app itself will compute after import."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return EARTH_RADIUS_M * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def parse_fit_geopoints(path):
    """Extract (latitude, longitude, elevation) for every FIT 'record' message that has
    both a GPS fix and an altitude reading. position_lat/position_long are raw FIT
    semicircles (sint32), not degrees -- fitparse does not auto-convert this field, so we
    do it here (degrees = semicircles * 180 / 2^31)."""
    fit = fitparse.FitFile(path)
    points = []
    start_ts = None
    for rec in fit.get_messages("record"):
        d = {f.name: f.value for f in rec}
        ts = d.get("timestamp")
        if ts is not None and start_ts is None:
            start_ts = ts
        lat_semi = d.get("position_lat")
        lon_semi = d.get("position_long")
        alt = d.get("enhanced_altitude", d.get("altitude"))
        if lat_semi is None or lon_semi is None or alt is None:
            continue
        points.append({
            "latitude": lat_semi * SEMICIRCLE_TO_DEG,
            "longitude": lon_semi * SEMICIRCLE_TO_DEG,
            "elevation": float(alt),
        })
    return points, start_ts


def filter_min_movement(points, min_move_m):
    """Drop points that haven't moved at least min_move_m from the last kept point (e.g.
    stopped at a light, or a paused recording) -- keeps the exported route file from
    bloating with redundant near-duplicate points without lossy-simplifying real terrain
    detail. Always keeps the first and last point."""
    if not points or min_move_m <= 0:
        return points
    kept = [points[0]]
    for p in points[1:-1]:
        last = kept[-1]
        if haversine_m(last["latitude"], last["longitude"], p["latitude"], p["longitude"]) >= min_move_m:
            kept.append(p)
    if len(points) > 1:
        kept.append(points[-1])
    return kept


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("fit_file")
    parser.add_argument("--name", default=None, help="Route name (default: FIT file's start date, or filename)")
    parser.add_argument("--out", default=None, help="Write JSON to this path instead of stdout")
    parser.add_argument("--min-move-m", type=float, default=2.0,
                         help="Drop points closer together than this (metres); 0 disables filtering (default: 2.0)")
    args = parser.parse_args()

    points, start_ts = parse_fit_geopoints(args.fit_file)
    if not points:
        sys.exit(
            f"No usable GPS+altitude samples found in {args.fit_file} -- this FIT file "
            "may be an indoor/trainer recording with no position data."
        )

    n_before = len(points)
    points = filter_min_movement(points, args.min_move_m)

    name = args.name
    if name is None:
        name = start_ts.strftime("%Y-%m-%d %H:%M") if start_ts else os.path.splitext(os.path.basename(args.fit_file))[0]

    route = {"name": name, "geoPoints": points}
    output = json.dumps(route, indent=2)

    if args.out:
        with open(args.out, "w") as f:
            f.write(output)
        print(f"Wrote {len(points)} points (from {n_before} raw GPS+altitude samples) to {args.out}", file=sys.stderr)
    else:
        print(output)
        print(f"\n{len(points)} points (from {n_before} raw GPS+altitude samples)", file=sys.stderr)


if __name__ == "__main__":
    main()
