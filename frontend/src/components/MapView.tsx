import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  color?: string;
}

interface MapViewProps {
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  className?: string;
}

const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export default function MapView({ center, zoom = 6, markers = [], className }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [center[1], center[0]],
      zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setCenter([center[1], center[0]]);
    map.setZoom(zoom);
  }, [center, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const attach = () => {
      markerRefs.current.forEach((m) => m.remove());
      markerRefs.current = [];
      for (const m of markers) {
        const el = document.createElement("div");
        el.style.background = m.color ?? "#1f7a4d";
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.borderRadius = "50%";
        el.style.border = "2px solid white";
        el.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.2)";
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([m.lng, m.lat])
          .setPopup(new maplibregl.Popup({ offset: 12 }).setText(m.label))
          .addTo(map);
        markerRefs.current.push(marker);
      }
    };

    if (map.isStyleLoaded()) attach();
    else map.once("load", attach);
  }, [markers]);

  return <div ref={containerRef} className={className ?? "w-full h-full"} />;
}
