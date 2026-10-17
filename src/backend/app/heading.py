"""Offline magnetic-to-true north correction; WMM does not correct indoor interference."""
from datetime import datetime
import math

from pygeomag import BlackoutZoneException, CautionZoneException, GeoMag, decimal_year_from_date
from pygeomag.wmm.wmm_2025 import WMM_2025


def correct_magnetic_north(orientation: dict, captured_at: str | None) -> None:
    location = orientation.get("location")
    if not location or not captured_at:
        return
    try:
        instant = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
        decimal_year = decimal_year_from_date(instant)
        if not 2025 <= decimal_year < 2030:
            return
        field = GeoMag(coefficients_data=WMM_2025).calculate(
            glat=location["latitude"], glon=location["longitude"], alt=0,
            time=decimal_year, raise_in_warning_zone=True,
        )
        declination = field.d
        uncertainty = field.calculate_uncertainty().d
    except (ValueError, TypeError, AttributeError, BlackoutZoneException, CautionZoneException):
        return
    if not math.isfinite(declination):
        return
    north = orientation["northInWorld"]
    angle = math.radians(declination)
    cos, sin = math.cos(angle), math.sin(angle)
    # Positive declination means magnetic north is east of true north:
    # world true-north bearing = world magnetic-north bearing - declination.
    orientation.update(
        reference="true-north", sourceReference="magnetic-north",
        magneticNorthInWorld=list(north),
        northInWorld=[north[0] * cos + north[2] * sin, 0, -north[0] * sin + north[2] * cos],
        correction={"model": "WMM2025", "declinationDegrees": declination,
                    "uncertaintyDegrees": uncertainty, "capturedAt": captured_at,
                    "altitudeMeters": 0},
    )
