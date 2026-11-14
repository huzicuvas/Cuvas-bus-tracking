export type RouteStop = {
  name: string
  lat?: number
  lng?: number
}

export type Route = {
  id: string
  name: string
  start_point: string | null
  end_point: string | null
  stops: RouteStop[]
  created_at: string
}

export type Driver = {
  id: string
  name: string
  phone: string | null
  route_id: string | null
  bus_id: string | null
  status: string
  created_at: string
  routes: { name: string } | null
  buses: { plate_number: string } | null
}

export type Bus = {
  id: string
  plate_number: string
  route_id: string | null
  driver_id: string | null
  current_lat: number | null
  current_lng: number | null
  last_updated: string | null
  status: string
  routes: { name: string } | null
  drivers: { name: string } | null
}
