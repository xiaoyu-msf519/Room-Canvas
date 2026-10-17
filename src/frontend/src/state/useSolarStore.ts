import { create } from 'zustand'
import { daysInYear, SHANGHAI, validateSite, wrap } from '../solar/ephemeris'
import type { SolarSite, SolarStatus } from '../types/solar'

export type SolarAnimationMode = 'none' | 'day-night' | 'seasons'

interface SolarState {
  year: number
  day: number
  minute: number
  site: SolarSite
  north: number
  showPath: boolean
  status: SolarStatus
  animationMode: SolarAnimationMode
  setClock: (clock: Partial<Pick<SolarState, 'year' | 'day' | 'minute'>>) => void
  setSite: (site: SolarSite) => void
  setNorth: (north: number) => void
  setShowPath: (show: boolean) => void
  setStatus: (status: SolarStatus) => void
  setAnimationMode: (mode: SolarAnimationMode) => void
  advanceSolar: (seconds: number) => void
}

const local = new Date(Date.now() + 8 * 3600000)
const year = local.getUTCFullYear()
export const useSolarStore = create<SolarState>((set) => ({
  year,
  day: Math.floor((Date.UTC(year, local.getUTCMonth(), local.getUTCDate()) - Date.UTC(year, 0, 1)) / 86400000),
  minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
  site: SHANGHAI,
  north: 0,
  showPath: true,
  status: 'computing',
  animationMode: 'none',
  setClock: (clock) => set((state) => {
    const nextYear = clock.year ?? state.year
    if (!Number.isInteger(nextYear) || nextYear < 1900 || nextYear > 2100) return state
    if ((clock.day !== undefined && !Number.isFinite(clock.day)) || (clock.minute !== undefined && !Number.isFinite(clock.minute))) return state
    return { year: nextYear, day: wrap(clock.day ?? state.day, daysInYear(nextYear)), minute: wrap(clock.minute ?? state.minute, 1440) }
  }),
  setSite: (site) => { validateSite(site); set({ site }) },
  setNorth: (north) => { if (Number.isFinite(north)) set({ north: wrap(north, 360) }) },
  setShowPath: (showPath) => set({ showPath }),
  setStatus: (status) => set({ status }),
  setAnimationMode: (animationMode) => set({ animationMode }),
  advanceSolar: (seconds) => set((state) => {
    if (state.animationMode === 'none' || !Number.isFinite(seconds) || seconds <= 0) return state
    const daysPerSecond = state.animationMode === 'day-night' ? 1 / 6 : daysInYear(state.year) / 40
    let day = state.day
    let minute = state.minute
    if (state.animationMode === 'day-night') {
      const elapsedMinutes = minute + seconds * daysPerSecond * 1440
      day += Math.floor(elapsedMinutes / 1440)
      minute = wrap(elapsedMinutes, 1440)
    } else {
      day += seconds * daysPerSecond
    }
    let year = state.year
    let days = daysInYear(year)
    while (day >= days) { day -= days; year += 1; days = daysInYear(year) }
    return { year, day, minute }
  }),
}))
