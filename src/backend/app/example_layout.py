from __future__ import annotations

import math

TEMPLATE_ID = "three-bedroom-two-bath-v3"
LEGACY_TEMPLATE_IDS = {"three-bedroom-two-bath-v1", "three-bedroom-two-bath-v2"}
TITLE = "示例户型 · 三室一厅两卫（主卧套卫）"
HEIGHT = 2.8
THICKNESS = 0.14
DOOR_HEIGHT = 2.2


def create_example_layout(scene_id: str) -> dict:
    """A fixed metric plan. No scan inference, material recovery or generation jobs."""
    zones = [
        {"id": "living", "name": "客厅", "kind": "living", "rect": [-6, -1.5, 1.5, 5]},
        {"id": "master", "name": "主卧", "kind": "bedroom", "rect": [1.5, 0.5, 6, 5]},
        {"id": "bedroom-2", "name": "次卧", "kind": "bedroom", "rect": [-6, -5, 0, -1.5]},
        {"id": "bedroom-3", "name": "第三卧室", "kind": "bedroom", "rect": [0, -5, 6, -1.5]},
        {"id": "bath-shared", "name": "公共卫生间", "kind": "bathroom", "rect": [1.5, -1.5, 3.75, 0.5]},
        {"id": "bath-ensuite", "name": "主卧卫生间", "kind": "bathroom", "rect": [3.75, -1.5, 6, 0.5]},
    ]
    # Each opening is owned by exactly one structural wall; its clear span is
    # removed from both the visual wall and its matching collision panels.
    walls = [
        ("outer-north", "x", -5, -6.07, 6.07, []),
        ("outer-south", "x", 5, -6.07, 6.07, [("entrance", -3, 1.1, ["outside", "living"])]),
        ("outer-west", "z", -6, -5.07, 5.07, []),
        ("outer-east", "z", 6, -5.07, 5.07, []),
        ("north-rooms", "x", -1.5, -6, 6, [
            ("bedroom-2", -3, 1.0, ["living", "bedroom-2"]),
            ("bedroom-3", 0.75, 1.0, ["living", "bedroom-3"]),
        ]),
        ("bedroom-divider", "z", 0, -5, -1.5, []),
        ("east-rooms", "z", 1.5, -1.5, 5, [
            ("shared-bath", -0.5, 1.0, ["living", "bath-shared"]),
            ("master", 3, 1.0, ["living", "master"]),
        ]),
        ("master-baths", "x", 0.5, 1.5, 6, [("ensuite", 4.875, 1.0, ["master", "bath-ensuite"])]),
        ("bath-divider", "z", 3.75, -1.5, 0.5, []),
    ]
    window_specs = [
        ("bedroom-2", "outer-north", -3, 2.4, 0.9, 2.3, "bedroom-2", False),
        ("bedroom-3", "outer-north", 3, 2.4, 0.9, 2.3, "bedroom-3", False),
        ("living-west", "outer-west", 1.4, 2.8, 0.9, 2.3, "living", False),
        ("living-south", "outer-south", -0.5, 2.4, 0.9, 2.3, "living", False),
        ("master-south", "outer-south", 3.75, 2.3, 0.9, 2.3, "master", False),
        ("master-east", "outer-east", 3, 2.0, 0.9, 2.3, "master", False),
        ("ensuite", "outer-east", -0.5, 0.9, 1.8, 2.4, "bath-ensuite", True),
    ]
    surfaces, colliders, doorways, windows = [], [], [], []
    floor_rotation = [-math.sqrt(0.5), 0, 0, math.sqrt(0.5)]

    for zone in zones:
        x0, z0, x1, z1 = zone["rect"]
        width, depth = x1 - x0, z1 - z0
        center = [(x0 + x1) / 2, 0, (z0 + z1) / 2]
        zone["center"] = list(center)
        zone["area"] = round(width * depth, 3)
        corners = [[-width / 2, -depth / 2, 0], [width / 2, -depth / 2, 0], [width / 2, depth / 2, 0], [-width / 2, depth / 2, 0]]
        for kind, elevation in (("floor", 0), ("ceiling", HEIGHT)):
            surface = {"id": f"example-{zone['id']}-{kind}", "kind": kind, "position": [center[0], elevation, center[2]],
                       "size": [width, depth, 0.08 if kind == "ceiling" else 0.1], "rotation": list(floor_rotation), "polygonCorners": corners,
                       "zoneId": zone["id"], "label": f"{zone['name']} · {'地板' if kind == 'floor' else '顶面'}", "editGroupId": f"example-{zone['id']}-{kind}"}
            if kind == "ceiling":
                surface["heightAlignment"] = "lowest-wall-top"
            surfaces.append(surface)

    for wall_id, axis, fixed, start, end, openings in walls:
        rotation = [0, 0, 0, 1] if axis == "x" else [0, math.sqrt(0.5), 0, math.sqrt(0.5)]
        pieces = []
        cursor = start
        apertures = [(door_id, center, width, 0, DOOR_HEIGHT, connects, None, False) for door_id, center, width, connects in openings]
        apertures.extend((window_id, center, width, bottom, top, None, zone, privacy)
                         for window_id, owner, center, width, bottom, top, zone, privacy in window_specs if owner == wall_id)
        for opening_id, center, width, bottom, top, connects, zone, privacy in sorted(apertures, key=lambda opening: opening[1]):
            left, right = center - width / 2, center + width / 2
            if left < cursor or right > end or not 0 <= bottom < top <= HEIGHT:
                raise ValueError("Example opening overlaps another opening or exceeds its wall")
            if left > cursor:
                pieces.append((cursor, left, 0, HEIGHT))
            if bottom > 0:
                pieces.append((left, right, 0, bottom))
            if top < HEIGHT:
                pieces.append((left, right, top, HEIGHT))
            y = (bottom + top) / 2
            position = [center, y, fixed] if axis == "x" else [fixed, y, center]
            opening = {"id": f"example-{'door' if connects else 'window'}-{opening_id}", "kind": "doorway" if connects else "window",
                       "wallId": f"example-wall-{wall_id}", "position": position, "size": [width, top - bottom, THICKNESS], "rotation": list(rotation)}
            if connects:
                doorways.append({**opening, "connects": connects})
            else:
                windows.append({**opening, "zoneId": zone, "privacy": privacy})
            cursor = right
        if cursor < end:
            pieces.append((cursor, end, 0, HEIGHT))
        boundaries = set()
        for zone in zones:
            x0, z0, x1, z1 = zone["rect"]
            if axis == "x" and (abs(fixed - z0) < 1e-6 or abs(fixed - z1) < 1e-6):
                boundaries.update((x0, x1))
            elif axis == "z" and (abs(fixed - x0) < 1e-6 or abs(fixed - x1) < 1e-6):
                boundaries.update((z0, z1))
        split_pieces = []
        for left, right, bottom, top in pieces:
            cuts = [left, *sorted(value for value in boundaries if left < value < right), right]
            split_pieces.extend((a, b, bottom, top) for a, b in zip(cuts, cuts[1:]))
        pieces = split_pieces
        for index, (left, right, bottom, top) in enumerate(pieces):
            middle, y = (left + right) / 2, (bottom + top) / 2
            panel = {"id": f"example-wall-{wall_id}-{index}", "kind": "wall", "size": [round(right - left, 6), round(top - bottom, 6), THICKNESS],
                     "position": [middle, y, fixed] if axis == "x" else [fixed, y, middle], "rotation": list(rotation)}
            normal_x, normal_z = (0, 1) if axis == "x" else (1, 0)
            owners = {}
            for side, sign in (("positive", 1), ("negative", -1)):
                px, _, pz = panel["position"]
                px += sign * normal_x * THICKNESS
                pz += sign * normal_z * THICKNESS
                owners[side] = next((zone for zone in zones if zone["rect"][0] - 1e-6 <= px <= zone["rect"][2] + 1e-6
                                     and zone["rect"][1] - 1e-6 <= pz <= zone["rect"][3] + 1e-6), None)
            # Exterior faces share their sole room's finish; shared partitions
            # keep separate room-facing materials without duplicating geometry.
            fallback = owners["positive"] or owners["negative"] or min(zones, key=lambda zone:
                max(zone["rect"][0] - panel["position"][0], 0, panel["position"][0] - zone["rect"][2]) ** 2 +
                max(zone["rect"][1] - panel["position"][2], 0, panel["position"][2] - zone["rect"][3]) ** 2)
            if fallback:
                panel["wallFaces"] = {}
                for side in ("positive", "negative"):
                    owner = owners[side] or fallback
                    direction = ("北墙" if fixed < owner["center"][2] else "南墙") if axis == "x" else ("西墙" if fixed < owner["center"][0] else "东墙")
                    panel["wallFaces"][side] = {"zoneId": owner["id"], "editGroupId": f"example-wall-{wall_id}:{owner['id']}",
                                                "label": f"{owner['name']} · {direction}"}
            surfaces.append(panel)
            colliders.append({key: panel[key] for key in ("position", "rotation", "size")})

    # Closed glass blocks walking while allowing direct sunlight through the hole.
    for window in windows:
        colliders.append({"position": window["position"], "rotation": window["rotation"], "size": [window["size"][0], window["size"][1], 0.018]})

    colliders.extend([
        {"position": [0, -0.05, 0], "size": [12, 0.1, 10], "rotation": [0, 0, 0, 1]},
        {"position": [0, HEIGHT + 0.04, 0], "size": [12, 0.08, 10], "rotation": [0, 0, 0, 1]},
    ])
    return {
        "id": scene_id, "title": TITLE, "version": "1.0", "units": "meters", "coordinateSystem": "right-handed-y-up",
        "source": {"kind": "example-layout", "templateId": TEMPLATE_ID, "schemaVersion": "roomcanvas.example.v1", "scanId": scene_id,
                   "worldOffset": [0, 0, 0], "coordinateSystem": "right-handed-y-up", "matrixLayout": "column-major", "orientation": None},
        "room": {"surfaces": surfaces, "colliders": colliders, "min": [-6.07, -0.1, -5.07], "max": [6.07, 2.88, 5.07], "bounds": [12.14, 2.98, 10.14],
                 "layout": {"templateId": TEMPLATE_ID, "zones": zones, "doorways": doorways, "windows": windows, "spawn": [0, 1.5, 0]}},
        "furniture": [], "cameras": [], "warnings": [],
        "pipeline": {"status": "ready", "preparation": "complete", "autoReconstruct": False, "stageMessage": "示例户型已生成",
                     "completed": 0, "total": 0, "failed": 0, "needsReview": 0},
    }
