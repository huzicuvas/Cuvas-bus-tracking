'use client'

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Bus } from '@/lib/types'

// Inline SVG pin (no image files needed — keeps the repo text-only)
const busIcon = L.divIcon({
  className: 'bus-marker',
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42"><path d="M15 0C7 0 0 7 0 15c0 11 15 27 15 27s15-16 15-27C30 7 23 0 15 0z" fill="#247bff" stroke="#ffffff" stroke-width="1.5"/><circle cx="15" cy="15" r="6" fill="#ffffff"/></svg>`,
  iconSize: [30, 42],
  iconAnchor: [15, 42],
  popupAnchor: [0, -40],
})

// Centre on Bahawalpur
const BAHAWALPUR: [number, number] = [29.39, 71.69]

export default function BusMap({ buses }: { buses: Bus[] }) {
  const located = buses.filter((b) => b.current_lat != null && b.current_lng != null)

  return (
    <MapContainer
      center={BAHAWALPUR}
      zoom={12}
      style={{ height: '500px', width: '100%' }}
      className="z-0 rounded-xl"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
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
