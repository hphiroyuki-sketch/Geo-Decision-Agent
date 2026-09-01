import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  color?: string;
}

export type Basemap = "satellite" | "streets";

/** How mesh cells are coloured: by class, or as a heatmap of one measure. */
export type MeshColorMode = "class" | "similarity" | "change";

/** What a 3D column's height encodes, or "flat" for a draped 2D mesh. */
export type MeshHeightMode = "flat" | "similarity" | "change";

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
  mesh?: GeoJSON.FeatureCollection | null;
  meshVisible?: boolean;
  meshOpacity?: number;
  meshColorMode?: MeshColorMode;
  gridVisible?: boolean;
  labelsVisible?: boolean;
  onCellClick?: (props: CellProperties) => void;
  /** Emits the clicked point when picking a location rather than reading one. */
  onMapClick?: (lat: number, lng: number) => void;
  fitBounds?: [[number, number], [number, number]] | null;
  maxFitZoom?: number;
  /** Real terrain relief, tilted view and sky - the Google Earth-like read. */
  terrain3d?: boolean;
  terrainExaggeration?: number;
  meshHeightMode?: MeshHeightMode;
  /** Reports whether the overlay layers exist, so a caller can tell the user
   *  that a missing mesh is a display fault rather than missing analysis. */
  onOverlayStatus?: (ok: boolean) => void;
}

// Imagery: GSI (Geospatial Information Authority of Japan) seamless photo is
// the sharpest keyless source over Japan and is the product's home ground, so
// it sits on top; Esri World Imagery renders underneath it and shows through
// anywhere GSI has no coverage. Esri alone returned "Map data not yet
// available" placeholder tiles at mesh zoom levels.
const SOURCES: Record<string, maplibregl.RasterSourceSpecification> = {
  esri: {
    type: "raster",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    maxzoom: 18,
    attribution: "Esri, Maxar, Earthstar Geographics",
  },
  gsi: {
    type: "raster",
    tiles: ["https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg"],
    tileSize: 256,
    maxzoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
  },
  streets: {
    type: "raster",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    tileSize: 256,
    maxzoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  labels: {
    type: "raster",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    ],
    tileSize: 256,
    maxzoom: 18,
    attribution: "Esri",
  },
};

const BASE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: SOURCES,
  layers: [
    { id: "streets", type: "raster", source: "streets", layout: { visibility: "none" } },
    { id: "esri", type: "raster", source: "esri" },
    { id: "gsi", type: "raster", source: "gsi" },
    { id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.85 } },
  ],
};

// Elevation tiles for 3D terrain. Terrarium encoding, no API key, global
// coverage to z15 - coarser than the imagery, so relief reads while an
// individual 10m cell does not get its own landform.
const DEM_SOURCE: maplibregl.RasterDEMSourceSpecification = {
  type: "raster-dem",
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 15,
  attribution: "Elevation: Mapzen / AWS Terrain Tiles",
};

const MESH_SOURCE = "mesh";
const DEM_SOURCE_ID = "dem";

/** Column height in metres for a full-range value. */
const MAX_COLUMN_M = 120;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// Ramps read `simValue` / `chgValue`, the numeric twins the API emits, and
// treat anything below 0 as "no value" so it renders grey rather than as an end
// of the ramp. They must never compare against null: a null in a style
// expression throws when the layer is added.
const SIMILARITY_RAMP = [
  "case",
  ["<", ["to-number", ["get", "simValue"], -1], 0],
  "#9ca3af",
  [
    "interpolate",
    ["linear"],
    ["to-number", ["get", "simValue"], 0],
    0,
    "#f1f8f4",
    0.5,
    "#96ccae",
    0.85,
    "#2f9e63",
    1,
    "#0f5132",
  ],
] as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>;

const CHANGE_RAMP = [
  "case",
  ["<", ["to-number", ["get", "chgValue"], -1], 0],
  "#9ca3af",
  [
    "interpolate",
    ["linear"],
    ["to-number", ["get", "chgValue"], 0],
    0,
    "#fdf5f3",
    0.05,
    "#f0b8a8",
    0.15,
    "#d4623f",
    0.3,
    "#8c2c14",
  ],
] as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>;

function fillColor(mode: MeshColorMode): maplibregl.DataDrivenPropertyValueSpecification<string> {
  if (mode === "similarity") return SIMILARITY_RAMP;
  if (mode === "change") return CHANGE_RAMP;
  return ["get", "color"] as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>;
}

function extrusionHeight(mode: MeshHeightMode): maplibregl.DataDrivenPropertyValueSpecification<number> {
  const field = mode === "change" ? "chgValue" : "simValue";
  // Change spans a far smaller range than similarity, so it needs its own scale
  // to stand up visibly against 10m cells.
  const scale = mode === "change" ? MAX_COLUMN_M * 3 : MAX_COLUMN_M;
  return [
    "case",
    ["<", ["to-number", ["get", field], -1], 0],
    0,
    ["*", ["max", ["to-number", ["get", field], 0], 0], scale],
  ] as unknown as maplibregl.DataDrivenPropertyValueSpecification<number>;
}

/**
 * Runs `fn` as soon as the style can take layer edits, and keeps running it on
 * later style events until it succeeds.
 *
 * This replaces waiting on the map's `load` event. Everything that depended on
 * `load` - creating the mesh layers, switching basemap, applying terrain -
 * silently did nothing when that event did not arrive, while `fitBounds`, which
 * needs no event, kept working. That combination is exactly what a user sees as
 * "the mesh doesn't show and the toggles do nothing", so nothing depends on a
 * single event any more.
 */
function whenStyleReady(map: maplibregl.Map, fn: () => void): () => void {
  let done = false;
  const attempt = () => {
    if (done) return;
    if (!map.isStyleLoaded()) return;
    done = true;
    map.off("styledata", attempt);
    map.off("idle", attempt);
    try {
      fn();
    } catch (err) {
      console.error("map update failed", err);
    }
  };

  attempt();
  if (!done) {
    map.on("styledata", attempt);
    map.on("idle", attempt);
  }
  return () => {
    done = true;
    map.off("styledata", attempt);
    map.off("idle", attempt);
  };
}

/**
 * Creates the overlay layers if they are not there yet. Idempotent, and called
 * from every effect that needs them rather than once at startup, so a map that
 * finishes initialising late still ends up with a working overlay.
 */
function ensureOverlays(map: maplibregl.Map, colorMode: MeshColorMode, opacity: number): boolean {
  if (!map.getSource(MESH_SOURCE)) {
    map.addSource(MESH_SOURCE, { type: "geojson", data: EMPTY });
  }
  if (!map.getLayer("mesh-fill")) {
    map.addLayer({
      id: "mesh-fill",
      type: "fill",
      source: MESH_SOURCE,
      paint: { "fill-color": fillColor(colorMode), "fill-opacity": opacity },
    });
  }
  if (!map.getLayer("mesh-outline")) {
    map.addLayer({
      id: "mesh-outline",
      type: "line",
      source: MESH_SOURCE,
      paint: { "line-color": "#ffffff", "line-width": 0.4, "line-opacity": 0.5 },
    });
  }

  // Extrusions and sky are the fragile ones; losing them must not cost the flat
  // mesh, which is what the analysis is actually read from.
  if (!map.getLayer("mesh-extrusion")) {
    try {
      map.addLayer({
        id: "mesh-extrusion",
        type: "fill-extrusion",
        source: MESH_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": fillColor(colorMode),
          "fill-extrusion-height": extrusionHeight("similarity"),
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.85,
        },
      });
    } catch (err) {
      console.error("extrusion layer unavailable", err);
    }
  }

  return Boolean(map.getLayer("mesh-fill"));
}

/** Adds the elevation source on demand; terrain cannot be set without it. */
function ensureTerrainSource(map: maplibregl.Map): boolean {
  if (!map.getSource(DEM_SOURCE_ID)) {
    try {
      map.addSource(DEM_SOURCE_ID, DEM_SOURCE);
    } catch (err) {
      console.error("elevation source unavailable", err);
      return false;
    }
  }
  if (!map.getLayer("sky")) {
    try {
      // Added once and never toggled: a sky layer has no layout properties, and
      // setLayoutProperty on one throws.
      map.addLayer({
        id: "sky",
        type: "sky",
        paint: {
          "sky-color": "#8fb8de",
          "sky-horizon-blend": 0.5,
          "horizon-color": "#dfeaf5",
          "horizon-fog-blend": 0.6,
        },
      } as unknown as maplibregl.LayerSpecification);
    } catch {
      // A renderer without sky support still gets terrain relief.
    }
  }
  return true;
}

export default function MapView({
  center,
  zoom = 6,
  markers = [],
  className,
  basemap = "streets",
  mesh = null,
  meshVisible = true,
  meshOpacity = 0.55,
  meshColorMode = "class",
  gridVisible = true,
  labelsVisible = true,
  onCellClick,
  onMapClick,
  fitBounds = null,
  maxFitZoom = 18,
  terrain3d = false,
  terrainExaggeration = 1.5,
  meshHeightMode = "flat",
  onOverlayStatus,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const handlersBoundRef = useRef(false);
  const onCellClickRef = useRef(onCellClick);
  const onMapClickRef = useRef(onMapClick);
  const onOverlayStatusRef = useRef(onOverlayStatus);
  onCellClickRef.current = onCellClick;
  onMapClickRef.current = onMapClick;
  onOverlayStatusRef.current = onOverlayStatus;

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: BASE_STYLE,
      center: [center[1], center[0]],
      zoom,
      // Imagery tops out at z18; more just scales tiles up and invites requests
      // for levels the providers do not serve.
      maxZoom: 19,
      attributionControl: { compact: true },
    });
    // The compass earns its place once the view can be tilted and rotated.
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
    mapRef.current = map;

    map.on("click", (e) => {
      if (onMapClickRef.current) onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
    });

    // A container laid out (or resized) after init otherwise leaves the canvas
    // at a stale size and paints blank.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      handlersBoundRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Overlay layers, their data, and every visibility rule that depends on them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return whenStyleReady(map, () => {
      const ok = ensureOverlays(map, meshColorMode, meshOpacity);
      onOverlayStatusRef.current?.(ok);
      if (!ok) return;

      (map.getSource(MESH_SOURCE) as maplibregl.GeoJSONSource).setData(mesh ?? EMPTY);

      const hasExtrusion = Boolean(map.getLayer("mesh-extrusion"));
      // Flat and extruded are two readings of the same cells; drawing both
      // stacks two colours on one square and reads as neither.
      const extruded = hasExtrusion && meshVisible && meshHeightMode !== "flat";
      map.setLayoutProperty("mesh-fill", "visibility", meshVisible && !extruded ? "visible" : "none");
      map.setLayoutProperty("mesh-outline", "visibility", meshVisible && gridVisible && !extruded ? "visible" : "none");
      map.setPaintProperty("mesh-fill", "fill-opacity", meshOpacity);
      map.setPaintProperty("mesh-fill", "fill-color", fillColor(meshColorMode));

      if (hasExtrusion) {
        map.setLayoutProperty("mesh-extrusion", "visibility", extruded ? "visible" : "none");
        map.setPaintProperty("mesh-extrusion", "fill-extrusion-color", fillColor(meshColorMode));
        map.setPaintProperty("mesh-extrusion", "fill-extrusion-height", extrusionHeight(meshHeightMode));
      }

      if (!handlersBoundRef.current) {
        handlersBoundRef.current = true;
        map.on("click", "mesh-fill", (e) => {
          const feature = e.features?.[0];
          if (feature && onCellClickRef.current) {
            onCellClickRef.current(feature.properties as unknown as CellProperties);
          }
        });
        map.on("mouseenter", "mesh-fill", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "mesh-fill", () => (map.getCanvas().style.cursor = ""));
        map.resize();
      }
    });
  }, [mesh, meshVisible, meshOpacity, gridVisible, meshColorMode, meshHeightMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return whenStyleReady(map, () => {
      const imagery = basemap === "satellite";
      map.setLayoutProperty("esri", "visibility", imagery ? "visible" : "none");
      map.setLayoutProperty("gsi", "visibility", imagery ? "visible" : "none");
      map.setLayoutProperty("streets", "visibility", imagery ? "none" : "visible");
      // Imagery carries no place names of its own, so labels only earn their
      // place over it.
      map.setLayoutProperty("labels", "visibility", labelsVisible && imagery ? "visible" : "none");
    });
  }, [basemap, labelsVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return whenStyleReady(map, () => {
      if (terrain3d) {
        if (!ensureTerrainSource(map)) return;
        map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: terrainExaggeration });
        if (map.getPitch() < 30) map.easeTo({ pitch: 60, duration: 800 });
      } else {
        map.setTerrain(null);
        if (map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
      }
    });
  }, [terrain3d, terrainExaggeration]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (fitBounds) {
      map.fitBounds(fitBounds, { padding: 40, duration: 600, maxZoom: maxFitZoom });
      return;
    }
    map.setCenter([center[1], center[0]]);
    map.setZoom(zoom);
  }, [center, zoom, fitBounds, maxFitZoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
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
  }, [markers]);

  return <div ref={containerRef} className={className ?? "w-full h-full"} />;
}
