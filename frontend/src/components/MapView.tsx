import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  color?: string;
}

export type Basemap = "satellite" | "streets";

export interface CellProperties {
  cellClass: string;
  label: string;
  color: string;
  similarity: number | null;
  change: number | null;
  fieldRecords: number;
  hotspotId: string | null;
}

interface MapViewProps {
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  className?: string;
  basemap?: Basemap;
  /** FeatureCollection of mesh cells; each feature carries a `color` property. */
  mesh?: GeoJSON.FeatureCollection | null;
  meshVisible?: boolean;
  meshOpacity?: number;
  /** Draws the cell borders that make the 10m grid readable as a grid. */
  gridVisible?: boolean;
  labelsVisible?: boolean;
  onCellClick?: (props: CellProperties) => void;
  fitBounds?: [[number, number], [number, number]] | null;
}

// Raster basemaps, both keyless. Imagery is what makes the 10m mesh legible as
// ground rather than as abstract squares, so it is the default for mesh views.
const SOURCES: Record<string, maplibregl.RasterSourceSpecification> = {
  satellite: {
    type: "raster",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    maxzoom: 19,
    attribution: "Esri, Maxar, Earthstar Geographics",
  },
  streets: {
    type: "raster",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    tileSize: 256,
    maxzoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  // Place names and boundaries drawn over imagery; transparent elsewhere.
  labels: {
    type: "raster",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    ],
    tileSize: 256,
    maxzoom: 19,
    attribution: "Esri",
  },
};

const BASE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: SOURCES,
  layers: [
    { id: "streets", type: "raster", source: "streets", layout: { visibility: "none" } },
    { id: "satellite", type: "raster", source: "satellite" },
    { id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.9 } },
  ],
};

const MESH_SOURCE = "mesh";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export default function MapView({
  center,
  zoom = 6,
  markers = [],
  className,
  basemap = "streets",
  mesh = null,
  meshVisible = true,
  meshOpacity = 0.55,
  gridVisible = true,
  labelsVisible = true,
  onCellClick,
  fitBounds = null,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const readyRef = useRef(false);
  const onCellClickRef = useRef(onCellClick);
  onCellClickRef.current = onCellClick;

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: BASE_STYLE,
      center: [center[1], center[0]],
      zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource(MESH_SOURCE, { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "mesh-fill",
        type: "fill",
        source: MESH_SOURCE,
        paint: { "fill-color": ["get", "color"], "fill-opacity": meshOpacity },
      });
      map.addLayer({
        id: "mesh-outline",
        type: "line",
        source: MESH_SOURCE,
        paint: { "line-color": "#ffffff", "line-width": 0.4, "line-opacity": 0.5 },
      });
      readyRef.current = true;
      map.resize();

      map.on("click", "mesh-fill", (e) => {
        const feature = e.features?.[0];
        if (feature && onCellClickRef.current) {
          onCellClickRef.current(feature.properties as unknown as CellProperties);
        }
      });
      map.on("mouseenter", "mesh-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "mesh-fill", () => (map.getCanvas().style.cursor = ""));
    });

    // A container laid out (or resized) after init otherwise leaves the canvas
    // at a stale size and paints blank.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setLayoutProperty("satellite", "visibility", basemap === "satellite" ? "visible" : "none");
      map.setLayoutProperty("streets", "visibility", basemap === "streets" ? "visible" : "none");
      // Imagery has no place names of its own, so the label layer only earns
      // its place over satellite.
      map.setLayoutProperty(
        "labels",
        "visibility",
        labelsVisible && basemap === "satellite" ? "visible" : "none",
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [basemap, labelsVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource(MESH_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      source.setData(mesh ?? EMPTY);
      map.setLayoutProperty("mesh-fill", "visibility", meshVisible ? "visible" : "none");
      map.setLayoutProperty("mesh-outline", "visibility", meshVisible && gridVisible ? "visible" : "none");
      map.setPaintProperty("mesh-fill", "fill-opacity", meshOpacity);
    };
    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [mesh, meshVisible, meshOpacity, gridVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (fitBounds) {
      map.fitBounds(fitBounds, { padding: 40, duration: 600, maxZoom: 18 });
      return;
    }
    map.setCenter([center[1], center[0]]);
    map.setZoom(zoom);
  }, [center, zoom, fitBounds]);

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
