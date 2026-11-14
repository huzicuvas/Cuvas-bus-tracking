'use client'

import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Bus, RouteStop } from '@/lib/types'

// Inline SVG pin (no image files needed — keeps the repo text-only)
const busIcon = L.divIcon({
  className: 'bus-marker',
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42"><path d="M15 0C7 0 0 7 0 15c0 11 15 27 15 27s15-16 15-27C30 7 23 0 15 0z" fill="#247bff" stroke="#ffffff" stroke-width="1.5"/><circle cx="15" cy="15" r="6" fill="#ffffff"/></svg>`,
  iconSize: [30, 42],
  iconAnchor: [15, 42],
  popupAnchor: [0, -40],
})

// Numbered stop marker: white circle, blue number, in stop order
function stopIcon(n: number) {
  return L.divIcon({
    className: 'stop-marker',
    html: `<div style="width:24px;height:24px;border-radius:9999px;background:#ffffff;border:2px solid #247bff;color:#247bff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;">${n}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

// Centre on Bahawalpur
const BAHAWALPUR: [number, number] = [29.39, 71.69]

export default function BusMap({ buses, stops }: { buses: Bus[]; stops: RouteStop[] }) {
  const located = buses.filter((b) => b.current_lat != null && b.current_lng != null)
  const locatedStops = stops.filter((s) => s.lat != null && s.lng != null)

  // Centre on the live bus if there is one, else the first stop, else Bahawalpur
  const center: [number, number] =
    located.length > 0
      ? [located[0].current_lat!, located[0].current_lng!]
      : locatedStops.length > 0
        ? [locatedStops[0].lat!, locatedStops[0].lng!]
        : BAHAWALPUR

  const line: [number, number][] = locatedStops.map((s) => [s.lat!, s.lng!])

  return (
    <MapContainer center={center} zoom={13} style={{ height: '500px', width: '100%' }} className="z-0 rounded-xl">
      {/* Esri World Street Map: clean light map, free, no API key needed.
          Temporary stand-in for Google Maps (final version).
          Note the {z}/{y}/{x} order — Esri puts y before x. */}
      <TileLayer
        attribution="Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
      />
      {line.length >= 2 && <Polyline positions={line} color="#22c55e" weight={4} />}
      {stops.map((s, i) =>
        s.lat != null && s.lng != null ? (
          <Marker key={`${s.name}-${i}`} position={[s.lat, s.lng]} icon={stopIcon(i + 1)}>
            <Tooltip direction="top" offset={[0, -14]}>
              {i + 1}. {s.name}
            </Tooltip>
          </Marker>
        ) : null,
      )}
      {located.map((bus) => (
        <Marker key={bus.id} position={[bus.current_lat!, bus.current_lng!]} icon={busIcon}>
          <Popup>
            <strong>{bus.plate_number}</strong>
            <br />
            {bus.drivers?.name ?? 'No driver'} — {bus.routes?.name ?? 'No route'}
            <br />
            {bus.status}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
