#!/usr/bin/env python3
"""Generate a rolling hairpin route that actually exercises the virtual drivetrain.

"Leap Lane Hills" is unusable as a shifting test: it reaches 22.7%, 16.4% and 12%, and the
rider's own mapping is that anything past ~5% pins them in gear 1. A route that spends its time
above 6% therefore measures nothing — there is no gear left to choose. The 2026-08-07 workout log
shows exactly that: long stretches at gear 1-3 with the grade still climbing.

The rider's gear map, which this route is built backwards from:

    flat or downhill   -> above gear 12
    1-3%               -> gear 8-12
    4-5%               -> gear 4-7
    more than ~5%      -> gear 1

So the productive band is about **-4% to +6%** and nothing outside it is worth riding. This
profile stays inside that band and crosses it repeatedly, which is what makes shifting a
continuous decision rather than a single downshift at the bottom of a wall.

**Hairpins are the point.** On a real switchback road the gradient eases sharply at each apex and
steepens again on the straight between. That is a genuine 3-4% swing every ~150 m, which is the
shape that forces a rider up and down the block instead of settling. Three of them are marked ★
below. The descents matter just as much: they are the only thing that exercises gears 12-24.

Transitions are linear between anchors rather than steps, because `calculateRealisticGrade`
ramps at most 1.5% per 10 m travelled. A step change outstrips that and the smoothed grade lags
metres behind the road, which is half of why the old route's telemetry read strangely.

Usage: python3 make_hairpin_route.py > hairpin-6km-route.json
"""

import json
import math

STEP_M = 50  # 120 segments; fine enough that no single segment jumps more than ~0.5%
ELEV_START = 100.0
R = 6371e3
M_PER_DEG_LAT = R * math.pi / 180.0

# (distance_m, grade_pct) — linearly interpolated between anchors.
ANCHORS = [
    (0, 0.0),
    (250, 0.0),  # settle, gear 12+
    (500, 1.5),  # gentle drag -> gear 8-12
    (850, 3.0),  # top of the gentle band -> gear 8
    (1100, 4.5),  # moderate -> gear 4-7
    (1300, 5.8),  # pinch -> gear 1-3
    (1450, 1.8),  # ★ hairpin apex — big ease, shift back up
    (1600, 1.8),
    (1800, 5.2),  # straight again -> gear 4-7
    (1950, 1.5),  # ★ hairpin
    (2100, 1.5),
    (2300, 5.5),
    (2450, 2.0),  # ★ hairpin
    (2600, 2.0),
    (2850, 4.2),
    (3050, 0.5),  # summit false flat -> gear 12+
    (3250, 0.5),
    (3500, -2.8),  # descent -> gears 12-24
    (3800, -3.5),
    (4050, -1.0),
    (4250, 0.0),  # valley flat
    (4450, 0.0),
    (4700, 2.5),  # second lap of the bands
    (4950, 4.5),
    (5100, 1.5),  # ★ hairpin
    (5250, 1.5),
    (5450, 5.0),
    (5650, 2.0),
    (5850, -3.0),  # run-in descent
    (6000, 0.0),
]

LENGTH_M = ANCHORS[-1][0]


def grade_at(d: float) -> float:
    """Linear interpolation across the anchor table."""
    if d <= ANCHORS[0][0]:
        return ANCHORS[0][1]
    if d >= ANCHORS[-1][0]:
        return ANCHORS[-1][1]
    for i in range(len(ANCHORS) - 1):
        d0, g0 = ANCHORS[i]
        d1, g1 = ANCHORS[i + 1]
        if d0 <= d < d1:
            t = (d - d0) / (d1 - d0)
            return g0 + t * (g1 - g0)
    return 0.0


def main() -> None:
    points = []
    elev = ELEV_START
    n = LENGTH_M // STEP_M

    for i in range(n + 1):
        d = i * STEP_M
        if i > 0:
            # Trapezoidal integration of the gradient over the segment just travelled.
            g_mid = 0.5 * (grade_at(d - STEP_M) + grade_at(d))
            elev += (g_mid / 100.0) * STEP_M
        points.append(
            {
                "latitude": round((d / M_PER_DEG_LAT), 10),
                "longitude": 0.0,
                "elevation": round(elev, 3),
                "distance": round(d / 1000.0, 4),
                "timestamp": 1785000000000 + i * 15000,
            }
        )

    gain = sum(
        max(0.0, points[i + 1]["elevation"] - points[i]["elevation"]) for i in range(len(points) - 1)
    )
    loss = sum(
        max(0.0, points[i]["elevation"] - points[i + 1]["elevation"]) for i in range(len(points) - 1)
    )

    route = {
        "name": "Rolling Hairpins 6km",
        "geoPoints": points,
        "totalDistance": LENGTH_M / 1000.0,
        "averageGrade": round(
            ((points[-1]["elevation"] - points[0]["elevation"]) / LENGTH_M) * 100, 3
        ),
    }
    print(json.dumps(route, indent=1))

    # Coverage report to stderr, so `> route.json` stays clean.
    import sys

    bands = {"descent (>gear 12)": 0, "flat (>gear 12)": 0, "1-3% (gear 8-12)": 0,
             "4-5% (gear 4-7)": 0, "over 5% (gear 1-3)": 0}
    for i in range(len(points) - 1):
        seg = points[i + 1]["distance"] - points[i]["distance"]
        g = ((points[i + 1]["elevation"] - points[i]["elevation"]) / (seg * 1000)) * 100
        if g < -0.5:
            bands["descent (>gear 12)"] += seg
        elif g < 1.0:
            bands["flat (>gear 12)"] += seg
        elif g < 3.5:
            bands["1-3% (gear 8-12)"] += seg
        elif g <= 5.0:
            bands["4-5% (gear 4-7)"] += seg
        else:
            bands["over 5% (gear 1-3)"] += seg

    print(f"\n{route['name']}: {LENGTH_M/1000:.1f} km, +{gain:.0f} m / -{loss:.0f} m", file=sys.stderr)
    print(f"gradient range: {min(grade_at(d) for d,_ in ANCHORS):+.1f}% to "
          f"{max(g for _,g in ANCHORS):+.1f}%", file=sys.stderr)
    for k, v in bands.items():
        print(f"  {k:<22} {v:5.2f} km  ({v/(LENGTH_M/1000)*100:4.1f}%)", file=sys.stderr)


if __name__ == "__main__":
    main()
