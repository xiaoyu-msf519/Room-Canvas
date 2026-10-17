import { getPosition } from 'suncalc'
import type { SolarSite, SolarTable } from '../types/solar'

export const MINUTES_PER_DAY = 1440
export const MINUTES_PER_STEP = 5
const DAY_MS = 86400000
const RAD = Math.PI / 180
export const SHANGHAI: SolarSite = { name: '上海', latitude: 31.2304, longitude: 121.4737, utcOffset: 8 }
export const wrap = (value: number, period: number) => ((value % period) + period) % period
export const daysInYear = (year: number) => (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS
export const solarKey = (year: number, site: SolarSite) => `${year}:${site.latitude}:${site.longitude}:${site.utcOffset}`

export function validateSite(site: SolarSite) {
  if (!Number.isFinite(site.latitude) || Math.abs(site.latitude) > 90 ||
      !Number.isFinite(site.longitude) || Math.abs(site.longitude) > 180 ||
      !Number.isFinite(site.utcOffset) || site.utcOffset < -12 || site.utcOffset > 14) {
    throw new Error('经纬度或时区超出有效范围')
  }
}

export function clockDate(year: number, day: number, minute: number, utcOffset: number) {
  return new Date(Date.UTC(year, 0, 1) + day * DAY_MS + (minute - utcOffset * 60) * 60000)
}

interface Direction { x: number; y: number; z: number }

export function directSolarDirection<T extends Direction>(year: number, day: number, minute: number, site: SolarSite, out: T): T {
  const { altitude, azimuth } = getPosition(clockDate(year, day, minute, site.utcOffset), site.latitude, site.longitude)
  const horizontal = Math.cos(altitude * RAD)
  // SunCalc v2: degrees, clockwise from true north. Scene: +X east, -Z north.
  out.x = Math.sin(azimuth * RAD) * horizontal
  out.y = Math.sin(altitude * RAD)
  out.z = -Math.cos(azimuth * RAD) * horizontal
  return out
}

export function buildSolarTable(year: number, site: SolarSite): SolarTable {
  validateSite(site)
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new Error('年份范围为 1900–2100')
  const days = daysInYear(year)
  const steps = MINUTES_PER_DAY / MINUTES_PER_STEP + 1
  const vectors = new Float32Array((days + 1) * steps * 3)
  const date = clockDate(year, 0, 0, site.utcOffset)
  const start = date.getTime()
  for (let day = 0; day < days; day++) {
    for (let step = 0; step < steps - 1; step++) {
      date.setTime(start + (day * MINUTES_PER_DAY + step * MINUTES_PER_STEP) * 60000)
      const { altitude, azimuth } = getPosition(date, site.latitude, site.longitude)
      const index = (day * steps + step) * 3
      const horizontal = Math.cos(altitude * RAD)
      vectors[index] = Math.sin(azimuth * RAD) * horizontal
      vectors[index + 1] = Math.sin(altitude * RAD)
      vectors[index + 2] = -Math.cos(azimuth * RAD) * horizontal
    }
    // Both controls are closed cycles; duplicate their first samples at the seams.
    const row = day * steps * 3
    vectors.set(vectors.subarray(row, row + 3), row + (steps - 1) * 3)
  }
  vectors.set(vectors.subarray(0, steps * 3), days * steps * 3)
  return { key: solarKey(year, site), year, days, steps, minutesPerStep: MINUTES_PER_STEP, vectors }
}

/** Bilinear interpolation of Cartesian directions avoids the azimuth's 359/0 seam. */
export function sampleSolarDirection<T extends Direction>(table: SolarTable, day: number, minute: number, north: number, out: T): T {
  const d = wrap(day, table.days)
  const t = wrap(minute, MINUTES_PER_DAY) / table.minutesPerStep
  const d0 = Math.floor(d), t0 = Math.floor(t)
  const a = (d0 * table.steps + t0) * 3
  const b = a + table.steps * 3
  const df = d - d0, tf = t - t0
  for (let axis = 0; axis < 3; axis++) {
    const first = table.vectors[a + axis] + (table.vectors[a + 3 + axis] - table.vectors[a + axis]) * tf
    const second = table.vectors[b + axis] + (table.vectors[b + 3 + axis] - table.vectors[b + axis]) * tf
    const value = first + (second - first) * df
    if (axis === 0) out.x = value
    else if (axis === 1) out.y = value
    else out.z = value
  }
  const cos = Math.cos(north * RAD), sin = Math.sin(north * RAD)
  const x = out.x * cos - out.z * sin
  out.z = out.x * sin + out.z * cos
  out.x = x
  const inverse = 1 / Math.hypot(out.x, out.y, out.z)
  out.x *= inverse; out.y *= inverse; out.z *= inverse
  return out
}

export function daylightAt(sunHeight: number) {
  const smooth = (low: number, high: number) => {
    const t = Math.max(0, Math.min(1, (sunHeight - low) / (high - low)))
    return t * t * (3 - 2 * t)
  }
  return { sky: smooth(-0.2, 0.15), sun: smooth(0, 0.08) * (0.25 + 0.75 * Math.sqrt(Math.max(0, sunHeight))) }
}
