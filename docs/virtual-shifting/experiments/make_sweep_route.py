#!/usr/bin/env python3
"""Generate the Crr/Cw sweep test route (experiments/17).

Why synthesised rather than a shortened Leap Lane Hills: `preprocessRouteData` turns each
consecutive geoPoint pair into ONE constant-grade segment, `getGradeForDistance` is a step
function over those segments, and `setSimGrade` only rewrites the trainer on a 3 s timer with a
0.3 % deadband. A recorded outdoor route's grade therefore wanders faster than the app can send
it, and no sample can be attributed to a known grade. Constant-grade plateaus long enough to
outlast the throttle are what make per-condition regression possible.

Geometry: points march due north along a fixed meridian, so haversine distance is exactly the
spacing we ask for and the grade is exactly rise/run. Elevation is accumulated, never assumed.

Usage: python3 make_sweep_route.py > 17-crr-cw-sweep-route.json
"""

import json
import math

# Plateaus: (grade %, length m). 60 s at ~20 kph is 333 m, so 350 m+ blocks guarantee at least
# a full throttle period of steady state even if the rider is slower than planned.
#
# 0 % is the money block: with no grade term, resistance is Crr + Cw ALONE, and those two
# separate by their speed dependence (m*g*Crr*v vs cw*v^3). The climbs exist to keep the lap
# honest cycling and to check the grade term is not interacting; the descent exercises the
# coasting/negative-grade path that the old gradient-multiplier model got backwards.
#
# The 3% climb comes FIRST on purpose. Each lap boundary is when the rider changes the tyre and
# position presets and clicks Apply, and `startSimStep` also ramps into the lap's first grade —
# so the opening block cannot be a measurement block. Leading with the climb gives ~90 s of
# don't-care riding to make the change and settle, and puts both 0% blocks clear of the boundary.
PLATEAUS = [
    (3.0, 350),   # transition: change presets here, settle, absorb the ramp-in
    (0.0, 400),   # measurement block A — Crr/Cw discriminator
    (6.0, 250),   # steep, deliberately short
    (-2.0, 300),  # descent / coasting path
    (0.0, 400),   # measurement block B — repeat of A within the same lap
]

# Deliberately the null island, NOT a real ride's start point. `.gitignore` keeps
# `*-route.json` out of the repo because recorded routes are personal GPS data; this route is
# synthetic and carries none, which is what makes it safe to commit and share. Only the SPACING
# of the points matters to haversine, so the origin is free — spending any privacy on a
# familiar-looking map view would be a bad trade.
START_LAT = 0.0
START_LON = 0.0
START_ELEV = 100.0

# Metres per degree of latitude along a meridian for the haversine in src/utils/geo.ts.
R = 6371e3
M_PER_DEG_LAT = R * math.pi / 180.0

# One point every 50 m: fine enough that a plateau boundary lands within 50 m of plan, coarse
# enough to keep the pasted JSON small.
STEP_M = 50


def main() -> None:
    points = []
    lat = START_LAT
    elev = START_ELEV
    dist_km = 0.0

    points.append(
        {
            "latitude": lat,
            "longitude": START_LON,
            "elevation": round(elev, 4),
            "distance": 0.0,
            "timestamp": 1785000000000,
        }
    )

    for grade_pct, length_m in PLATEAUS:
        n = round(length_m / STEP_M)
        for _ in range(n):
            lat += STEP_M / M_PER_DEG_LAT
            elev += STEP_M * grade_pct / 100.0
            dist_km += STEP_M / 1000.0
            points.append(
                {
                    "latitude": round(lat, 10),
                    "longitude": START_LON,
                    "elevation": round(elev, 4),
                    # Ignored by preprocessRouteData (it recomputes from lat/lon), but kept so
                    # the file matches the shape of a real Garmin export.
                    "distance": round(dist_km, 6),
                    "timestamp": 1785000000000 + int(dist_km * 1000 * 180),
                }
            )

    total_m = sum(length for _, length in PLATEAUS)
    print(
        json.dumps(
            {
                "name": "Crr/Cw Sweep Lap",
                "geoPoints": points,
                "totalDistance": float(total_m),
                "averageGrade": round(
                    (points[-1]["elevation"] - START_ELEV) / total_m * 100, 4
                ),
            },
            indent=1,
        )
    )


if __name__ == "__main__":
    main()
