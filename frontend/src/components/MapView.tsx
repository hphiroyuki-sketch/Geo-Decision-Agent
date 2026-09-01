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
  ndvi?: number | null;
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
}

// Imagery: GSI (Geospatial Information Authority of Japan) seamless photo is
// the sharpest keyless source over Japan and is the product's home ground, so
// it sits on top; Esri World Imagery renders underneath it and shows through
// anywhere GSI has no coverage (i.e. outside Japan). Esri alone was returning
// "Map data not yet available" placeholder tiles at mesh zoom levels, which is
// what painted the mesh screen grey.
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
// coverage to z15 - coarser than the imagery, so relief stays readable while
// individual 10m cells do not get their own landform.
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

/** Column height in metres. Scaled so a full-range value reads clearly against
 *  10m cells without turning the mesh into a wall. */
const MAX_COLUMN_M = 120;

function extrusionHeight(mode: MeshHeightMode): maplibregl.DataDrivenPropertyValueSpecification<number> {
  if (mode === "similarity") {
    return [
      "case",
      ["==", ["get", "similarity"], null],
      0,
      ["*", ["max", ["to-number", ["get", "similarity"], 0], 0], MAX_COLUMN_M],
    ] as unknown as maplibregl.DataDrivenPropertyValueSpecification<number>;
  }
  // Change is a much smaller number, so it needs its own scale to be visible.
  return [
    "case",
    ["==", ["get", "change"], null],
    0,
    ["*", ["max", ["to-number", ["get", "change"], 0], 0], MAX_COLUMN_M * 3],
  ] as unknown as maplibregl.DataDrivenPropertyValueSpecification<number>;
}
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// Heatmap ramps. Similarity runs pale→green (more like confirmed habitat is
// better); change runs pale→red (more change needs more attention). A missing
// value falls back to grey rather than to an end of the ramp, so "no data"
// never reads as "zero".
const SIMILARITY_RAMP: maplibregl.DataDrivenPropertyValueSpecification<string> = [
  "case",
  ["==", ["get", "similarity"], null],
  "#9ca3af",
  ["interpolate", ["linear"], ["to-number", ["get", "similarity"], -1], 0, "#f1f8f4", 0.5, "#96ccae", 0.85, "#2f9e63", 1, "#0f5132"],
] as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>;

const CHANGE_RAMP: maplibregl.DataDrivenPropertyValueSpecification<string> = [
  "case",
  ["==", ["get", "change"], null],
  "#9ca3af",
  ["interpolate", ["linear"], ["to-number", ["get", "change"], -1], 0, "#fdf5f3", 0.05, "#f0b8a8", 0.15, "#d4623f", 0.3, "#8c2c14"],
] as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>;

function fillColor(mode: MeshColorMode): maplibregl.DataDrivenPropertyValueSpecification<string> {
  if (mode === "similarity") return SIMILARITY_RAMP;
  if (mode === "change") return CHANGE_RAMP;
  return ["get", "color"] as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>;
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
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const readyRef = useRef(false);
  const onCellClickRef = useRef(onCellClick);
  const onMapClickRef = useRef(onMapClick);
  onCellClickRef.current = onCellClick;
  onMapClickRef.current = onMapClick;

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: BASE_STYLE,
      center: [center[1], center[0]],
      zoom,
      // Imagery tops out at z18; allowing more just scales tiles up and invites
      // requests for levels the providers do not serve.
      maxZoom: 19,
      attributionControl: { compact: true },
    });
    // The compass earns its place once the view can be tilted and rotated.
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource(MESH_SOURCE, { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "mesh-fill",
        type: "fill",
        source: MESH_SOURCE,
        paint: { "fill-color": fillColor(meshColorMode), "fill-opacity": meshOpacity },
      });
      map.addLayer({
        id: "mesh-outline",
        type: "line",
        source: MESH_SOURCE,
        paint: { "line-color": "#ffffff", "line-width": 0.4, "line-opacity": 0.5 },
      });
      // Columns for the 3D read; hidden until a height measure is chosen.
      map.addLayer({
        id: "mesh-extrusion",
        type: "fill-extrusion",
        source: MESH_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": fillColor(meshColorMode),
          "fill-extrusion-height": extrusionHeight("similarity"),
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.85,
        },
      });
      map.addSource(DEM_SOURCE_ID, DEM_SOURCE);
      map.addLayer({
        id: "sky",
        type: "sky",
        paint: { "sky-color": "#8fb8de", "sky-horizon-blend": 0.5, "horizon-color": "#dfeaf5", "horizon-fog-blend": 0.6 },
      } as unknown as maplibregl.LayerSpecification);
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

    map.on("click", (e) => {
      if (onMapClickRef.current) onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
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
      const imagery = basemap === "satellite";
      map.setLayoutProperty("esri", "visibility", imagery ? "visible" : "none");
      map.setLayoutProperty("gsi", "visibility", imagery ? "visible" : "none");
      map.setLayoutProperty("streets", "visibility", imagery ? "none" : "visible");
      // Imagery carries no place names of its own, so labels only earn their
      // place over it.
      map.setLayoutProperty("labels", "visibility", labelsVisible && imagery ? "visible" : "none");
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
      map.setPaintProperty("mesh-fill", "fill-color", fillColor(meshColorMode));

      // Flat and extruded are mutually exclusive readings of the same cells:
      // showing both stacks two colours on one square and reads as neither.
      const extruded = meshVisible && meshHeightMode !== "flat";
      map.setLayoutProperty("mesh-extrusion", "visibility", extruded ? "visible" : "none");
      map.setLayoutProperty("mesh-fill", "visibility", meshVisible && !extruded ? "visible" : "none");
      map.setLayoutProperty("mesh-outline", "visibility", meshVisible && gridVisible && !extruded ? "visible" : "none");
      if (extruded) {
        map.setPaintProperty("mesh-extrusion", "fill-extrusion-color", fillColor(meshColorMode));
        map.setPaintProperty("mesh-extrusion", "fill-extrusion-height", extrusionHeight(meshHeightMode));
      }
    };
    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [mesh, meshVisible, meshOpacity, gridVisible, meshColorMode, meshHeightMode]);

  // Terrain relief plus a tilted camera. Turning it off restores the flat,
  // straight-down view rather than leaving the camera pitched.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (terrain3d) {
        map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: terrainExaggeration });
        map.setLayoutProperty("sky", "visibility", "visible");
        if (map.getPitch() < 30) map.easeTo({ pitch: 60, duration: 800 });
      } else {
        map.setTerrain(null);
        map.setLayoutProperty("sky", "visibility", "none");
        if (map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
      }
    };
    if (readyRef.current) apply();
    else map.once("load", apply);
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
