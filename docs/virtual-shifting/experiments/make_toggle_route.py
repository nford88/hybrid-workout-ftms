#!/usr/bin/env python3
"""Generate the experiment-18 route: one long dead-flat stretch.

Experiment 17 gave one lap per condition and could not separate "the trainer honoured the byte"
from "the rider pedalled harder that lap" — per-bin scatter reached ±190 W against an ~85 W
effect. 18 fixes that by toggling the condition every 90 s **inside a single continuous effort**,
so each A/B pair is minutes apart instead of laps apart and slow drift (fatigue, thermal) cancels
in the pairing rather than having to be modelled.

That needs a route with no features at all: 8 km at exactly 0%. At 0% the grade term vanishes and
resistance is Crr + Cw ALONE, which is the cleanest possible discriminator, and 8 km is longer
than the rider can cover in the session so the route never completes and never auto-advances.

Origin is (0,0) — synthetic, no personal location. Only point spacing reaches haversineDistance.

Usage: python3 make_toggle_route.py > 18-flat-8km-route.json
"""

import json
import math

LENGTH_M = 8000
STEP_M = 200  # dead flat needs no resolution; 40 points keeps the paste small
ELEV = 100.0
R = 6371e3
M_PER_DEG_LAT = R * math.pi / 180.0


def main() -> None:
    points = []
    lat = 0.0
    for i in range(LENGTH_M // STEP_M + 1):
        points.append(
            {
                "latitude": round(lat, 10),
                "longitude": 0.0,
                "elevation": ELEV,  # constant ⇒ every segment is exactly 0%
                "distance": round(i * STEP_M / 1000.0, 6),
                "timestamp": 1785000000000 + i * 30000,
            }
        )
        lat += STEP_M / M_PER_DEG_LAT
    print(
        json.dumps(
            {
                "name": "Flat 8km (Crr/Cw toggle)",
                "geoPoints": points,
                "totalDistance": float(LENGTH_M),
                "averageGrade": 0.0,
            },
            indent=1,
        )
    )


if __name__ == "__main__":
    main()
