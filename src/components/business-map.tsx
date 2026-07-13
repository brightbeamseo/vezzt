"use client";

import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { Business } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import "leaflet/dist/leaflet.css";

const markerIcon = L.divIcon({
  className: "",
  html: `<div style="background:#3730a3;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const selectedMarkerIcon = L.divIcon({
  className: "",
  html: `<div style="background:#0a0820;width:18px;height:18px;border-radius:50%;border:3px solid #3730a3;box-shadow:0 2px 8px rgba(0,0,0,0.35)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function MapController({
  selected,
  businesses,
}: {
  selected: Business | null;
  businesses: Business[];
}) {
  const map = useMap();

  useEffect(() => {
    if (selected) {
      map.flyTo([selected.lat, selected.lng], 13, { duration: 0.8 });
    } else if (businesses.length > 0) {
      const bounds = L.latLngBounds(
        businesses.map((b) => [b.lat, b.lng] as [number, number]),
      );
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [selected, businesses, map]);

  return null;
}

type BusinessMapProps = {
  businesses: Business[];
  selected: Business | null;
  onSelect: (business: Business) => void;
};

export function BusinessMap({
  businesses,
  selected,
  onSelect,
}: BusinessMapProps) {
  const center: [number, number] = [33.2, -80.5];

  return (
    <MapContainer
      center={center}
      zoom={7}
      className="h-full w-full"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapController selected={selected} businesses={businesses} />
      {businesses.map((business) => (
        <Marker
          key={business.id}
          position={[business.lat, business.lng]}
          icon={
            selected?.id === business.id ? selectedMarkerIcon : markerIcon
          }
          eventHandlers={{
            click: () => onSelect(business),
          }}
        >
          <Popup>
            <div className="min-w-[160px]">
              <p className="business-name-list text-vezzt-950">{business.name}</p>
              <p className="text-xs text-neutral-500">{business.category}</p>
              <p className="mt-1 text-sm font-bold text-vezzt-600">
                Vestimate:{" "}
                {business.vestimate === null
                  ? "Not calculated"
                  : formatCurrency(business.vestimate)}
              </p>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
