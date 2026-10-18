from __future__ import annotations

from collections import defaultdict
import math

TEMPLATE_ID = "three-bedroom-two-bath-v4"
LEGACY_TEMPLATE_IDS = {f"three-bedroom-two-bath-v{version}" for version in (1, 2, 3)}
TITLE = "示例户型 · 三室一厅两卫（主卧套卫）"
HEIGHT = 2.8
THICKNESS = 0.14
DOOR_HEIGHT = 2.2
EPSILON = 1e-7


def _boundary_runs(zones: list[dict]) -> list[dict]:
    """Deduplicate shared room boundaries before constructing physical walls."""
    lines = defaultdict(list)
    for zone in zones:
        x0, z0, x1, z1 = zone["rect"]
        for axis, fixed, start, end, positive, negative in (
            ("x", z0, x0, x1, zone["id"], None),
            ("x", z1, x0, x1, None, zone["id"]),
            ("z", x0, z0, z1, zone["id"], None),
            ("z", x1, z0, z1, None, zone["id"]),
        ):
            lines[axis, fixed].append((start, end, positive, negative))
    runs = []
    for (axis, fixed), segments in sorted(lines.items()):
        cuts = sorted({value for segment in segments for value in segment[:2]})
        for start, end in zip(cuts, cuts[1:]):
            middle = (start + end) / 2
            covered = [segment for segment in segments if segment[0] < middle < segment[1]]
            if not covered:
                continue
            positive = {segment[2] for segment in covered if segment[2]}
            negative = {segment[3] for segment in covered if segment[3]}
            if len(positive) > 1 or len(negative) > 1:
                raise ValueError("Example rooms have overlapping interiors")
            owners = (next(iter(positive), None), next(iter(negative), None))
            if runs and (runs[-1]["axis"], runs[-1]["fixed"], runs[-1]["end"], runs[-1]["positive"], runs[-1]["negative"]) == (axis, fixed, start, *owners):
                runs[-1]["end"] = end
            else:
                runs.append({"axis": axis, "fixed": fixed, "start": start, "end": end, "positive": owners[0], "negative": owners[1]})
    for index, run in enumerate(runs):
        run["outside"] = not (run["positive"] and run["negative"])
        run["id"] = f"example-wall-{'outer' if run['outside'] else 'shared'}-{index:03d}"
        run["apertures"] = []
    return runs


def _outline(runs: list[dict]) -> list[list[float]]:
    edges = defaultdict(list)
    for run in runs:
        if not run["outside"]:
            continue
        a, b = ((run["start"], run["fixed"]), (run["end"], run["fixed"])) if run["axis"] == "x" else ((run["fixed"], run["start"]), (run["fixed"], run["end"]))
        edges[a].append(b)
        edges[b].append(a)
    if any(len(neighbors) != 2 for neighbors in edges.values()):
        raise ValueError("Example footprint is not a closed connected outline")
    start = min(edges)
    points, previous, current = [], None, start
    while True:
        points.append(current)
        following = next(point for point in sorted(edges[current]) if point != previous)
        previous, current = current, following
        if current == start:
            break
        if current in points or len(points) > len(edges):
            raise ValueError("Example outline self-intersects")
    if len(points) != len(edges):
        raise ValueError("Example footprint contains a detached room or courtyard")
    corners = []
    for index, point in enumerate(points):
        before, after = points[index - 1], points[(index + 1) % len(points)]
        if abs((point[0] - before[0]) * (after[1] - point[1]) - (point[1] - before[1]) * (after[0] - point[0])) > EPSILON:
            corners.append([point[0], 0, point[1]])
    return corners


def _subtract_interval(intervals: list[tuple[float, float]], left: float, right: float) -> list[tuple[float, float]]:
    result = []
    for start, end in intervals:
        if right <= start + EPSILON or left >= end - EPSILON:
            result.append((start, end))
            continue
        if left > start + EPSILON:
            result.append((start, left))
        if right < end - EPSILON:
            result.append((right, end))
    return result


def create_example_layout(scene_id: str) -> dict:
    """A fixed stepped residential plan, with no inference or generation jobs."""
    zones = [
        {"id": "living", "name": "客厅", "kind": "living", "rect": [-3.5, -1, 2, 4]},
        {"id": "master", "name": "主卧", "kind": "bedroom", "rect": [2, 0.5, 6, 4.5]},
        {"id": "bedroom-2", "name": "次卧", "kind": "bedroom", "rect": [-6, -4.5, -2, -1]},
        {"id": "bedroom-3", "name": "第三卧室", "kind": "bedroom", "rect": [-2, -5, 2, -1]},
        {"id": "bath-shared", "name": "公共卫生间", "kind": "bathroom", "rect": [2, -2, 4, 0.5]},
        {"id": "bath-ensuite", "name": "主卧卫生间", "kind": "bathroom", "rect": [4, -2, 6, 0.5]},
        {"id": "kitchen", "name": "厨房", "kind": "kitchen", "rect": [-6, -1, -3.5, 1.2]},
        {"id": "foyer", "name": "玄关", "kind": "foyer", "rect": [-3, 4, -1, 5.8]},
        {"id": "balcony", "name": "封闭阳台", "kind": "balcony", "rect": [-5.3, 2, -3.5, 4]},
    ]
    zone_by_id = {zone["id"]: zone for zone in zones}
    runs = _boundary_runs(zones)
    for run in runs:
        run["id"] = f"{scene_id}-{run['id']}"
    surfaces, colliders, doorways, windows = [], [], [], []
    floor_rotation = [-math.sqrt(0.5), 0, 0, math.sqrt(0.5)]

    for zone in zones:
        x0, z0, x1, z1 = zone["rect"]
        width, depth = x1 - x0, z1 - z0
        zone.update(center=[(x0 + x1) / 2, 0, (z0 + z1) / 2], area=round(width * depth, 4), wallSurfaceIds=[], wallGroupIds=[])
        corners = [[-width / 2, -depth / 2, 0], [width / 2, -depth / 2, 0], [width / 2, depth / 2, 0], [-width / 2, depth / 2, 0]]
        for kind, elevation in (("floor", 0), ("ceiling", HEIGHT)):
            surface_id = f"{scene_id}-example-{zone['id']}-{kind}"
            zone[f"{kind}SurfaceId"] = surface_id
            surface = {"id": surface_id, "kind": kind, "position": [zone["center"][0], elevation, zone["center"][2]],
                       "size": [width, depth, 0.08 if kind == "ceiling" else 0.1], "rotation": list(floor_rotation), "polygonCorners": corners,
                       "zoneId": zone["id"], "label": f"{zone['name']} · {'地板' if kind == 'floor' else '顶面'}", "editGroupId": surface_id}
            if kind == "ceiling":
                surface["heightAlignment"] = "lowest-wall-top"
            surfaces.append(surface)
            colliders.append({"position": [zone["center"][0], -0.05 if kind == "floor" else HEIGHT + 0.04, zone["center"][2]],
                              "size": [width, 0.1 if kind == "floor" else 0.08, depth], "rotation": [0, 0, 0, 1]})

    def add_opening(opening_id, axis, fixed, center, width, bottom, top, *, connects=None, zone_id=None, privacy=False, enclosure=False):
        owners = set(connects or [zone_id]) - {"outside"}
        candidates = [run for run in runs if run["axis"] == axis and run["fixed"] == fixed
                      and {value for value in (run["positive"], run["negative"]) if value} == owners
                      and center - width / 2 >= run["start"] + THICKNESS / 2 - EPSILON
                      and center + width / 2 <= run["end"] - THICKNESS / 2 + EPSILON]
        if len(candidates) != 1 or not 0 <= bottom < top <= HEIGHT:
            raise ValueError(f"Opening {opening_id} has no valid room boundary")
        run = candidates[0]
        if (zone_id or "outside" in (connects or [])) and not run["outside"]:
            raise ValueError("Exterior opening is on an interior partition")
        for prior in run["apertures"]:
            if abs(center - prior["center"]) < (width + prior["width"]) / 2 - EPSILON:
                raise ValueError("Example openings overlap")
        rotation = [0, 0, 0, 1] if axis == "x" else [0, math.sqrt(0.5), 0, math.sqrt(0.5)]
        y = (bottom + top) / 2
        record = {"id": f"{scene_id}-example-{'door' if connects else 'window'}-{opening_id}", "kind": "doorway" if connects else "window", "wallId": run["id"],
                  "position": [center, y, fixed] if axis == "x" else [fixed, y, center], "size": [width, top - bottom, THICKNESS], "rotation": rotation}
        if connects:
            doorways.append({**record, "connects": connects})
        else:
            if zone_id == "foyer":
                raise ValueError("The entrance foyer must have no windows")
            windows.append({**record, "zoneId": zone_id, "privacy": privacy, "enclosure": enclosure})
        run["apertures"].append({"center": center, "width": width, "bottom": bottom, "top": top})

    for opening_id, axis, fixed, center, width, connects in [
        ("entrance", "x", 5.8, -2, 1.0, ["outside", "foyer"]),
        ("foyer", "x", 4, -2, 1.1, ["foyer", "living"]),
        ("bedroom-2", "x", -1, -2.75, 1.0, ["living", "bedroom-2"]),
        ("bedroom-3", "x", -1, 0, 1.0, ["living", "bedroom-3"]),
        ("master", "z", 2, 2.5, 1.0, ["living", "master"]),
        ("shared-bath", "z", 2, -0.25, 1.0, ["living", "bath-shared"]),
        ("ensuite", "x", 0.5, 5, 1.0, ["master", "bath-ensuite"]),
        ("kitchen", "z", -3.5, 0.25, 1.0, ["living", "kitchen"]),
        ("balcony", "z", -3.5, 2.9, 1.4, ["living", "balcony"]),
    ]:
        add_opening(opening_id, axis, fixed, center, width, 0, DOOR_HEIGHT, connects=connects)

    for opening_id, axis, fixed, center, width, bottom, top, zone_id, privacy in [
        ("bedroom-2", "x", -4.5, -4, 2.0, 0.9, 2.35, "bedroom-2", False),
        ("bedroom-3", "x", -5, 0, 2.0, 0.9, 2.35, "bedroom-3", False),
        ("living-south", "x", 4, 0.5, 1.8, 0.9, 2.35, "living", False),
        ("master-south", "x", 4.5, 4, 1.8, 0.9, 2.35, "master", False),
        ("master-east", "z", 6, 2.5, 2.0, 0.9, 2.35, "master", False),
        ("kitchen", "z", -6, 0.25, 1.2, 1.0, 2.35, "kitchen", False),
        ("shared-bath", "x", -2, 3, 0.9, 1.8, 2.4, "bath-shared", True),
        ("ensuite", "z", 6, -0.75, 0.9, 1.8, 2.4, "bath-ensuite", True),
    ]:
        add_opening(opening_id, axis, fixed, center, width, bottom, top, zone_id=zone_id, privacy=privacy)
    for index, run in enumerate(run for run in runs if run["outside"] and "balcony" in (run["positive"], run["negative"])):
        add_opening(f"balcony-{index}", run["axis"], run["fixed"], (run["start"] + run["end"]) / 2,
                    run["end"] - run["start"] - 0.16, 0.08, 2.72, zone_id="balcony", enclosure=True)

    # Horizontal walls own junction volumes. Vertical walls terminate at their
    # faces, so corners and T-junctions touch without overlapping wall solids.
    horizontal = []
    for run in runs:
        if run["axis"] != "x":
            continue
        left_neighbor = any(other["axis"] == "x" and other["fixed"] == run["fixed"] and other["end"] == run["start"] for other in runs)
        right_neighbor = any(other["axis"] == "x" and other["fixed"] == run["fixed"] and other["start"] == run["end"] for other in runs)
        run["physicalStart"] = run["start"] - (0 if left_neighbor else THICKNESS / 2)
        run["physicalEnd"] = run["end"] + (0 if right_neighbor else THICKNESS / 2)
        horizontal.append((run["physicalStart"], run["physicalEnd"], run["fixed"] - THICKNESS / 2, run["fixed"] + THICKNESS / 2))

    for run in runs:
        if run["axis"] == "x":
            intervals = [(run["physicalStart"], run["physicalEnd"])]
        else:
            intervals = [(run["start"], run["end"])]
            for x0, x1, z0, z1 in horizontal:
                if min(run["fixed"] + THICKNESS / 2, x1) - max(run["fixed"] - THICKNESS / 2, x0) > EPSILON:
                    intervals = _subtract_interval(intervals, z0, z1)
        pieces = []
        for start, end in intervals:
            cursor = start
            for opening in sorted(run["apertures"], key=lambda value: value["center"]):
                left, right = opening["center"] - opening["width"] / 2, opening["center"] + opening["width"] / 2
                if right <= start or left >= end:
                    continue
                if left < start - EPSILON or right > end + EPSILON:
                    raise ValueError("An opening intersects a structural junction")
                if left > cursor + EPSILON:
                    pieces.append((cursor, left, 0, HEIGHT))
                if opening["bottom"] > 0:
                    pieces.append((left, right, 0, opening["bottom"]))
                if opening["top"] < HEIGHT:
                    pieces.append((left, right, opening["top"], HEIGHT))
                cursor = right
            if cursor < end - EPSILON:
                pieces.append((cursor, end, 0, HEIGHT))
        rotation = [0, 0, 0, 1] if run["axis"] == "x" else [0, math.sqrt(0.5), 0, math.sqrt(0.5)]
        for index, (start, end, bottom, top) in enumerate(pieces):
            center, y = (start + end) / 2, (bottom + top) / 2
            panel = {"id": f"{run['id']}-{index}", "kind": "wall", "size": [round(end - start, 8), round(top - bottom, 8), THICKNESS],
                     "position": [center, y, run["fixed"]] if run["axis"] == "x" else [run["fixed"], y, center], "rotation": list(rotation), "wallFaces": {}}
            fallback = run["positive"] or run["negative"]
            for side in ("positive", "negative"):
                owner_id = run[side] or fallback
                owner = zone_by_id[owner_id]
                direction = ("north" if run["fixed"] < owner["center"][2] else "south") if run["axis"] == "x" else ("west" if run["fixed"] < owner["center"][0] else "east")
                label = {"north": "北墙", "south": "南墙", "west": "西墙", "east": "东墙"}[direction]
                face = {"id": f"{panel['id']}:{side}", "zoneId": owner_id, "editGroupId": f"example-{owner_id}-wall-{direction}", "label": f"{owner['name']} · {label}"}
                panel["wallFaces"][side] = face
                if run[side]:
                    owner["wallSurfaceIds"].append(face["id"])
                    if face["editGroupId"] not in owner["wallGroupIds"]:
                        owner["wallGroupIds"].append(face["editGroupId"])
            surfaces.append(panel)
            colliders.append({key: panel[key] for key in ("position", "rotation", "size")})

    for window in windows:
        colliders.append({"position": window["position"], "rotation": window["rotation"], "size": [window["size"][0], window["size"][1], 0.018]})
    boundary = _outline(runs)
    minimum = [min(point[0] for point in boundary) - THICKNESS / 2, -0.1, min(point[2] for point in boundary) - THICKNESS / 2]
    maximum = [max(point[0] for point in boundary) + THICKNESS / 2, HEIGHT + 0.08, max(point[2] for point in boundary) + THICKNESS / 2]
    return {
        "id": scene_id, "title": TITLE, "version": "1.0", "units": "meters", "coordinateSystem": "right-handed-y-up",
        "source": {"kind": "example-layout", "templateId": TEMPLATE_ID, "schemaVersion": "roomcanvas.example.v1", "scanId": scene_id,
                   "worldOffset": [0, 0, 0], "coordinateSystem": "right-handed-y-up", "matrixLayout": "column-major", "orientation": None},
        "room": {"surfaces": surfaces, "colliders": colliders, "min": minimum, "max": maximum, "bounds": [maximum[axis] - minimum[axis] for axis in range(3)],
                 "layout": {"templateId": TEMPLATE_ID, "zones": zones, "doorways": doorways, "windows": windows, "boundary": boundary, "spawn": [0, 1.5, 0]}},
        "furniture": [], "cameras": [], "warnings": [],
        "pipeline": {"status": "ready", "preparation": "complete", "autoReconstruct": False, "stageMessage": "示例户型已生成",
                     "completed": 0, "total": 0, "failed": 0, "needsReview": 0},
    }
