"use client";

import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import Link from "next/link";
import type { DashboardBusiness } from "@/lib/dashboard-types";
import { formatNullable } from "@/lib/format";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

const markerIcon = L.divIcon({
  className: "",
  html: `<div style="background:#3730a3;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function FitBounds({ businesses }: { businesses: DashboardBusiness[] }) {
  const map = useMap();

  useEffect(() => {
    const withCoords = businesses.filter(
      (b) => b.latitude !== null && b.longitude !== null,
    );
    if (withCoords.length === 0) return;
    const bounds = L.latLngBounds(
      withCoords.map(
        (b) => [b.latitude as number, b.longitude as number] as [number, number],
      ),
    );
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 12 });
  }, [businesses, map]);

  return null;
}

type Props = {
  businesses: DashboardBusiness[];
  onSelect: (business: DashboardBusiness) => void;
  selectedId: string | null;
};

export function DashboardMap({ businesses, onSelect, selectedId }: Props) {
  const mappable = businesses.filter(
    (b) => b.latitude !== null && b.longitude !== null,
  );
  const center: [number, number] = [43.615, -116.202];

  return (
    <MapContainer
      center={center}
      zoom={11}
      className="h-full w-full rounded-xl"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds businesses={mappable} />
      <MarkerClusterGroup chunkedLoading showCoverageOnHover={false}>
        {mappable.map((business) => (
          <Marker
            key={business.id}
            position={[business.latitude as number, business.longitude as number]}
            icon={markerIcon}
            eventHandlers={{
              click: () => onSelect(business),
            }}
            opacity={selectedId === business.id ? 1 : 0.9}
          >
            <Popup>
              <div className="min-w-[180px] space-y-1 text-sm">
                <p className="font-semibold text-vezzt-950">{business.name}</p>
                <p className="text-xs text-neutral-500">
                  {business.primaryCategory ?? "Uncategorized"}
                  {business.city ? ` · ${business.city}` : ""}
                </p>
                <p className="text-xs text-neutral-600">
                  Rating:{" "}
                  {formatNullable(business.averageRating, { kind: "rating" })} ·
                  Reviews:{" "}
                  {business.reviewCount === null
                    ? "—"
                    : business.reviewCount.toLocaleString("en-US")}
                </p>
                <p className="text-xs text-neutral-600">
                  Status: {business.qualificationStatus.replace("_", " ")}
                </p>
                <p className="text-xs font-medium text-vezzt-700">
                  Vestimate:{" "}
                  {formatNullable(business.vestimateMid, { kind: "currency" })}
                </p>
                <Link
                  href={`/businesses/${business.id}`}
                  className="mt-1 inline-block text-xs font-medium text-vezzt-600 underline"
                  onClick={() => onSelect(business)}
                >
                  Open detail →
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
