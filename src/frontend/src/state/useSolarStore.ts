import { create } from 'zustand'
import { daysInYear, SHANGHAI, validateSite, wrap } from '../solar/ephemeris'
import type { SolarSite, SolarStatus } from '../types/solar'

interface SolarState {
  year: number
  day: number
  minute: number
  site: SolarSite
  north: number
  showPath: boolean
  status: SolarStatus
  animateDayNight: boolean
  animateSeasons: boolean
  setClock: (clock: Partial<Pick<SolarState, 'year' | 'day' | 'minute'>>) => void
  setSite: (site: SolarSite) => void
  setNorth: (north: number) => void
  setShowPath: (show: boolean) => void
  setStatus: (status: SolarStatus) => void
  setAnimateDayNight: (enabled: boolean) => void
  setAnimateSeasons: (enabled: boolean) => void
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
  animateDayNight: false,
  animateSeasons: false,
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
  setAnimateDayNight: (animateDayNight) => set({ animateDayNight }),
  setAnimateSeasons: (animateSeasons) => set({ animateSeasons }),
  advanceSolar: (seconds) => set((state) => {
    if ((!state.animateDayNight && !state.animateSeasons) || !Number.isFinite(seconds) || seconds <= 0) return state
    let day = state.day + (state.animateSeasons ? seconds * daysInYear(state.year) / 40 : 0)
    const minute = state.animateDayNight ? wrap(state.minute + seconds * 240, 1440) : state.minute
    let year = state.year
    let days = daysInYear(year)
    while (day >= days) { day -= days; year = year === 2100 ? 1900 : year + 1; days = daysInYear(year) }
    return { year, day, minute }
  }),
}))
