import { createRoot, type Root } from "react-dom/client";
import OrganismCard from "./OrganismCard";
import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// MapLibre 6 ships a separate module worker. Vite cannot discover the URL
// assembled inside the library; without this asset the SPA serves HTML at the
// worker URL and GeoJSON never becomes renderable, even though imagery works.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  color?: string;
  recordId?: string;
}

export type Basemap = "satellite" | "streets";

/** How mesh cells are coloured: by class, or as a heatmap of one measure. */
export type MeshColorMode = "class" | "similarity" | "change";

/** What a 3D column's height encodes, or "flat" for a draped 2D mesh. */
export type MeshHeightMode = "flat" | "similarity" | "change";

export interface CellProperties {
  cellId?: string;
  status?: string;
  lat?: number;
  lng?: number;
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
  fitRequest?: number;
  selectedCellId?: string;
  /** Which aerial photography epoch to show; see IMAGERY_EPOCHS. */
  imageryEpoch?: string;
  /** 0-1. Below 1 the street map shows through, which is how a viewer compares
   *  what is on the photo against what is mapped. */
  imageryOpacity?: number;
  /** Real terrain relief, tilted view and sky - the Google Earth-like read. */
  terrain3d?: boolean;
  terrainExaggeration?: number;
  meshHeightMode?: MeshHeightMode;
  /** Reports whether the overlay layers exist, so a caller can tell the user
   *  that a missing mesh is a display fault rather than missing analysis. */
  onOverlayStatus?: (ok: boolean) => void;
  /** Renders the earth as a sphere rather than a flat sheet. */
  globe?: boolean;
  /** Zoom, compass and scale controls. Off for card-sized thumbnails, where
   *  the chrome would take up more room than the map it sits on. */
  chrome?: boolean;
  /** Opens on the globe and flies down to the target, the way an atlas hands
   *  you the context before the detail. */
  introFlight?: boolean;
  /** Shows and follows the viewer's own position - the thing a surveyor needs
   *  most while standing in the field. */
  showUserLocation?: boolean;
  /** Reports what the viewer is currently looking at, so an action can act on
   *  the visible area rather than on a coordinate typed in a box. */
  onViewportChange?: (viewport: Viewport) => void;
}

export interface Viewport {
  centerLat: number;
  centerLng: number;
  /** Width and height of the visible map in metres. */
  widthM: number;
  heightM: number;
  zoom: number;
}

/**
 * Imagery epochs. GSI publishes Japan's aerial photography back to the 1940s
 * as plain XYZ tiles with no key, which is what makes "the forest used to be
 * here" something a person can see rather than infer from a number. Coverage
 * thins the further back you go - the older surveys were flown over cities and
 * their surroundings - so each epoch carries a note saying so.
 */
export interface ImageryEpoch {
  id: string;
  label: string;
  period: string;
  /** Style layer ids to show for this epoch, bottom-most first. */
  layers: string[];
  note?: string;
}

export const IMAGERY_EPOCHS: ImageryEpoch[] = [
  { id: "current", label: "最新", period: "現在", layers: ["esri", "gsi"] },
  { id: "ort", label: "2007〜", period: "2007年〜", layers: ["ort"], note: "電子国土基本図オルソ（カラー）" },
  { id: "gazo4", label: "1984-86", period: "1984〜1986年", layers: ["gazo4"], note: "整備範囲は限定的です" },
  { id: "gazo3", label: "1979-83", period: "1979〜1983年", layers: ["gazo3"], note: "整備範囲は限定的です" },
  { id: "gazo2", label: "1974-78", period: "1974〜1978年", layers: ["gazo2"], note: "整備範囲は限定的です" },
  { id: "gazo1", label: "1961-69", period: "1961〜1969年", layers: ["gazo1"], note: "白黒。整備範囲は限定的です" },
  { id: "usa", label: "1945-50", period: "1945〜1950年", layers: ["usa"], note: "米軍撮影の白黒写真。都市部中心" },
];

const GSI_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>';

function gsiPhoto(path: string, maxzoom: number): maplibregl.RasterSourceSpecification {
  return {
    type: "raster",
    tiles: [`https://cyberjapandata.gsi.go.jp/xyz/${path}/{z}/{x}/{y}.jpg`],
    tileSize: 256,
    maxzoom,
    attribution: GSI_ATTRIBUTION,
  };
}

// Esri World Imagery renders under the GSI photo so coverage outside Japan
// still has something to show; Esri alone returned "Map data not yet
// available" placeholders at mesh zoom levels.
const SOURCES: Record<string, maplibregl.RasterSourceSpecification> = {
  streets: {
    type: "raster",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    tileSize: 256,
    maxzoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  esri: {
    type: "raster",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    maxzoom: 18,
    attribution: "Esri, Maxar, Earthstar Geographics",
  },
  gsi: gsiPhoto("seamlessphoto", 18),
  ort: gsiPhoto("ort", 18),
  gazo4: gsiPhoto("gazo4", 17),
  gazo3: gsiPhoto("gazo3", 17),
  gazo2: gsiPhoto("gazo2", 17),
  gazo1: gsiPhoto("gazo1", 17),
  usa: gsiPhoto("ort_USA10", 17),
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

/** Every imagery layer, in draw order; the street map stays underneath them
 *  all so lowering imagery opacity reveals it rather than a blank canvas. */
const IMAGERY_LAYER_IDS = ["esri", "gsi", "ort", "gazo4", "gazo3", "gazo2", "gazo1", "usa"];

const BASE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: SOURCES,
  layers: [
    { id: "streets", type: "raster", source: "streets" },
    ...IMAGERY_LAYER_IDS.map((id) => ({
      id,
      type: "raster" as const,
      source: id,
      layout: { visibility: "none" as const },
    })),
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
  let timer = 0;

  const detach = () => {
    window.clearTimeout(timer);
    map.off("styledata", attempt);
    map.off("style.load", attempt);
    map.off("load", attempt);
  };

  function attempt() {
    if (done) return;
    // `isStyleLoaded()` was the wrong question. MapLibre only reports the style
    // as loaded once EVERY source cache has finished, and this map carries ten
    // raster sources - historical GSI photography that 404s outside its
    // coverage, Esri imagery, elevation tiles. One source that never settles
    // holds the whole predicate false forever, and then none of this runs: the
    // imagery layers keep the `visibility: none` they are declared with, the
    // street map underneath stays visible, and the mesh layers are never even
    // created. That is precisely "the map shows roads instead of satellite and
    // the mesh is missing", with nothing in the console to say so.
    //
    // What these callbacks actually need is that the style's layers can be
    // addressed - which is true as soon as the style object is parsed, long
    // before any tile arrives. Poll for that rather than trusting an event to
    // arrive, so a slow or failing tile server cannot silently disable the map.
    if (!map.getLayer("streets")) {
      timer = window.setTimeout(attempt, 100);
      return;
    }
    done = true;
    detach();
    try {
      fn();
    } catch (err) {
      console.error("map update failed", err);
    }
  }

  attempt();
  if (!done) {
    map.on("styledata", attempt);
    map.on("style.load", attempt);
    map.on("load", attempt);
  }
  return () => {
    done = true;
    detach();
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

  if (!map.getLayer("mesh-selected")) {
    map.addLayer({ id: "mesh-selected", type: "line", source: MESH_SOURCE,
      filter: ["==", ["get", "cellId"], ""],
      paint: { "line-color": "#ffffff", "line-width": 3, "line-opacity": 1 },
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
  return true;
}

export default function MapView({
  center,
  zoom = 6,
  markers = [],
  className,
  basemap = "satellite",
  mesh = null,
  meshVisible = true,
  meshOpacity = 0.55,
  meshColorMode = "class",
  gridVisible = true,
  labelsVisible = true,
  imageryEpoch = "current",
  imageryOpacity = 1,
  onCellClick,
  onMapClick,
  fitBounds = null,
  maxFitZoom = 18,
  fitRequest = 0,
  selectedCellId,
  terrain3d = false,
  terrainExaggeration = 1.5,
  meshHeightMode = "flat",
  onOverlayStatus,
  globe = true,
  introFlight = false,
  showUserLocation = false,
  chrome = true,
  onViewportChange,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const handlersBoundRef = useRef(false);
  // The opening flight owns the camera until it lands; the ordinary centring
  // effect must not yank the view out from under it.
  const introActiveRef = useRef(false);
  const introDoneRef = useRef(false);
  const onCellClickRef = useRef(onCellClick);
  const onMapClickRef = useRef(onMapClick);
  const onOverlayStatusRef = useRef(onOverlayStatus);
  const onViewportChangeRef = useRef(onViewportChange);
  onCellClickRef.current = onCellClick;
  onMapClickRef.current = onMapClick;
  onOverlayStatusRef.current = onOverlayStatus;
  onViewportChangeRef.current = onViewportChange;

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
    if (chrome) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
    }

    if (showUserLocation) {
      const geolocate = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserLocation: true,
        showAccuracyCircle: true,
      });
      map.addControl(geolocate, "top-right");
      // Locate only when the viewer explicitly presses the control.
    }

    mapRef.current = map;

    // DOM diagnostics also let acceptance checks distinguish a mounted layer
    // from cells that the WebGL renderer actually drew.
    const reportRender = () => {
      container.dataset.mapZoom = map.getZoom().toFixed(3);
      container.dataset.meshSourceLoaded = String(Boolean(map.getSource(MESH_SOURCE)) && map.isSourceLoaded(MESH_SOURCE));
      if (map.getLayer("mesh-fill")) {
        container.dataset.meshRendered = String(map.queryRenderedFeatures({ layers: ["mesh-fill"] }).length);
      }
    };
    map.on("idle", reportRender);
    map.on("sourcedata", (event) => {
      if (event.sourceId === MESH_SOURCE && event.isSourceLoaded) {
        onOverlayStatusRef.current?.(true);
      }
    });
    map.on("error", (event) => {
      if ((event as { sourceId?: string }).sourceId === MESH_SOURCE) {
        container.dataset.meshError = event.error.message;
        onOverlayStatusRef.current?.(false);
      }
    });

    map.on("click", (e) => {
      if (onMapClickRef.current) onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
    });

    // What the viewer is looking at, in metres on the ground - so an action can
    // say "analyse this" about the visible area instead of asking for numbers.
    const reportViewport = () => {
      if (!onViewportChangeRef.current) return;
      const c = map.getCenter();
      const b = map.getBounds();
      const mPerDegLat = 111320;
      const mPerDegLng = mPerDegLat * Math.cos((c.lat * Math.PI) / 180);
      onViewportChangeRef.current({
        centerLat: c.lat,
        centerLng: c.lng,
        widthM: Math.abs(b.getEast() - b.getWest()) * mPerDegLng,
        heightM: Math.abs(b.getNorth() - b.getSouth()) * mPerDegLat,
        zoom: map.getZoom(),
      });
    };
    map.on("moveend", reportViewport);
    map.once("idle", reportViewport);

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
      if (!ok) { onOverlayStatusRef.current?.(false); return; }

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
        const selectCell = (e: maplibregl.MapLayerMouseEvent) => {
          const feature = e.features?.[0];
          if (feature && onCellClickRef.current) {
            onCellClickRef.current(feature.properties as unknown as CellProperties);
          }
        };
        map.on("click", "mesh-fill", selectCell);
        if (hasExtrusion) map.on("click", "mesh-extrusion", selectCell);
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
      if (!map.getLayer("mesh-selected")) return;
      map.setFilter("mesh-selected", ["==", ["get", "cellId"], selectedCellId ?? ""]);
      map.setLayoutProperty("mesh-selected", "visibility", meshVisible ? "visible" : "none");
    });
  }, [selectedCellId, meshVisible, mesh]);

  // Globe projection. Flat mercator is fine for a single site, but the product
  // opens on "where on earth is this", and a sphere answers that in a way a
  // stretched rectangle does not.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return whenStyleReady(map, () => {
      try {
        map.setProjection({
          type: globe ? "globe" : "mercator",
        });
        map.setSky({ "sky-color": "#071321", "horizon-color": "#87b8db", "sky-horizon-blend": 0.5, "atmosphere-blend": globe ? 0.85 : 0 });
      } catch (err) {
        // An older renderer just stays flat; nothing else depends on this.
        console.error("projection unavailable", err);
      }
    });
  }, [globe]);

  // The opening flight: start far out, then descend to the target.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !introFlight || introDoneRef.current) return;
    introDoneRef.current = true;
    introActiveRef.current = true;

    map.jumpTo({ center: [center[1], center[0]], zoom: 1.3, pitch: 0, bearing: 0 });
    const timer = setTimeout(() => {
      map.flyTo({
        center: [center[1], center[0]],
        zoom,
        speed: 0.55,
        curve: 1.5,
        essential: true,
      });
      map.once("moveend", () => {
        introActiveRef.current = false;
      });
    }, 700);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introFlight]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return whenStyleReady(map, () => {
      const imagery = basemap === "satellite";
      const epoch = IMAGERY_EPOCHS.find((e) => e.id === imageryEpoch) ?? IMAGERY_EPOCHS[0];
      const active = new Set(imagery ? epoch.layers : []);

      for (const id of IMAGERY_LAYER_IDS) {
        map.setLayoutProperty(id, "visibility", active.has(id) ? "visible" : "none");
        if (active.has(id)) map.setPaintProperty(id, "raster-opacity", imageryOpacity);
      }
      // The street map sits under the photo rather than replacing it, so fading
      // the photo reveals roads and place names - but it is only worth drawing
      // when some of it will actually show through.
      const streetsUseful = !imagery || imageryOpacity < 0.98;
      map.setLayoutProperty("streets", "visibility", streetsUseful ? "visible" : "none");
      // Imagery carries no place names of its own, so labels only earn their
      // place over it - and only while the photo is opaque enough to hide the
      // street map's own labels.
      map.setLayoutProperty(
        "labels",
        "visibility",
        labelsVisible && imagery && imageryOpacity > 0.6 ? "visible" : "none",
      );
    });
  }, [basemap, labelsVisible, imageryEpoch, imageryOpacity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let terrainActive = false;
    const sync = () => {
      // Global DEM tessellation produces seams at globe scale. Use the sphere
      // there and enable terrain only once the user reaches a regional view.
      const enable = terrain3d && map.getZoom() >= 9;
      if (enable !== terrainActive) {
        terrainActive = enable;
        if (enable && ensureTerrainSource(map)) map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: terrainExaggeration });
        else map.setTerrain(null);
      }
      if (globe && map.getZoom() < 6 && map.getPitch() > 0) map.setPitch(0);
    };
    const cancel = whenStyleReady(map, () => {
      map.setTerrain(null);
      sync();
      if (terrain3d && map.getZoom() >= 9 && map.getPitch() < 30) map.easeTo({ pitch: 60, duration: 800 });
      if (!terrain3d && map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
      map.on("zoom", sync);
    });
    return () => { cancel(); map.off("zoom", sync); };
  }, [terrain3d, terrainExaggeration, globe]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || introActiveRef.current) return;
    if (fitBounds) {
      map.fitBounds(fitBounds, { padding: 40, duration: 600, maxZoom: maxFitZoom });
      return;
    }
    map.setCenter([center[1], center[0]]);
    map.setZoom(zoom);
    // Callers pass coordinate arrays inline. Depending on their identity made
    // moveend -> viewport state -> render -> fitBounds loop forever. Compare
    // coordinates instead: panning must not be undone by a React render.
  }, [center[0], center[1], zoom, fitBounds?.[0][0], fitBounds?.[0][1], fitBounds?.[1][0], fitBounds?.[1][1], maxFitZoom, fitRequest]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRefs.current.forEach((m) => m.remove());
    markerRefs.current = [];
    const cleanup: (() => void)[] = [];
    for (const m of markers) {
      const el = document.createElement("div");
      el.style.background = m.color ?? "#1f7a4d";
      el.style.width = "14px";
      el.style.height = "14px";
      el.style.borderRadius = "50%";
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.2)";
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", m.label);
      el.tabIndex = 0;
      const popup = new maplibregl.Popup({ offset: 12, maxWidth: m.recordId ? "340px" : "280px", className: m.recordId ? "organism-popup" : "" });
      let root: Root | null = null;
      if (m.recordId) {
        popup.on("open", () => {
          const content = document.createElement("div");
          popup.setDOMContent(content);
          root = createRoot(content);
          root.render(<OrganismCard recordId={m.recordId!} />);
        });
        popup.on("close", () => { root?.unmount(); root = null; });
      } else popup.setText(m.label);
      cleanup.push(() => { popup.remove(); root?.unmount(); root = null; });
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([m.lng, m.lat])
        .setPopup(popup)
        .addTo(map);
      el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); marker.togglePopup(); } });
      markerRefs.current.push(marker);
    }
    return () => { cleanup.forEach(fn => fn()); markerRefs.current.forEach(m => m.remove()); };
  }, [markers]);

  return <div ref={containerRef} className={className ?? "w-full h-full"} />;
}
