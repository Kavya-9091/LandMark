import { useCallback, useEffect, useMemo, useRef, useState, Component, type ErrorInfo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { ArrowUpRight, Crosshair, ExternalLink, LocateFixed, MapPin, Navigation, RefreshCw, RotateCcw, ScanSearch, X } from 'lucide-react';
import L, { type LatLngBounds, type Map as LeafletMap } from 'leaflet';
import { CircleMarker, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '@/index.css';
import NotFound from '@/pages/not-found';

type Landmark = { pageid: number; title: string; lat: number; lon: number; dist: number };
type Article = { title: string; extract?: string; thumbnail?: { source: string; width: number; height: number }; coordinates?: { lat: number; lon: number }[]; pageid: number };
type LoadState = 'loading' | 'ready' | 'error';
type GeoStatus = 'idle' | 'locating' | 'success' | 'error';

const queryClient = new QueryClient();
const START: [number, number] = [51.5074, -0.1278];
const START_ZOOM = 13;
const WIKI_API = 'https://en.wikipedia.org/w/api.php';

const markerIcon = (selected: boolean) => L.divIcon({
  className: 'landmark-marker',
  html: `<div class="map-pin${selected ? ' map-pin-selected' : ''}"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 20],
});

class MapErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Map failed to load', error, info); }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="map-error" data-testid="status-map-error">
        <div className="error-card motion-in">
          <h2>The map is out of reach.</h2>
          <p>The map library could not initialise in this browser. Check that scripts are enabled, then try loading the field guide again.</p>
          <button className="retry-button" type="button" data-testid="button-map-retry" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> Reload the map
          </button>
        </div>
      </div>
    );
  }
}

function radiusForBounds(bounds: LatLngBounds, center: L.LatLng) {
  const corners = [bounds.getNorthEast(), bounds.getSouthWest(), bounds.getNorthWest(), bounds.getSouthEast()];
  const furthest = Math.max(...corners.map((corner) => center.distanceTo(corner)));
  return Math.max(800, Math.min(10000, Math.round(furthest)));
}

async function getLandmarks(bounds: LatLngBounds, signal: AbortSignal): Promise<Landmark[]> {
  const center = bounds.getCenter();
  const radius = radiusForBounds(bounds, center);
  const params = new URLSearchParams({
    action: 'query',
    list: 'geosearch',
    format: 'json',
    origin: '*',
    gscoord: `${center.lat}|${center.lng}`,
    gsradius: String(radius),
    gslimit: '50',
    gsnamespace: '0',
  });
  const response = await fetch(`${WIKI_API}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Wikipedia returned ${response.status}`);
  const payload = await response.json() as { query?: { geosearch?: { pageid: number; title: string; lat: number; lon: number; dist: number }[] } };
  return (payload.query?.geosearch ?? [])
    .filter(({ lat, lon }) => bounds.contains([lat, lon]))
    .map(({ pageid, title, lat, lon, dist }) => ({ pageid, title, lat, lon, dist }));
}

async function getArticle(pageid: number, signal: AbortSignal): Promise<Article> {
  const params = new URLSearchParams({
    action: 'query',
    pageids: String(pageid),
    prop: 'extracts|pageimages|coordinates',
    exintro: '1',
    explaintext: '1',
    exchars: '460',
    piprop: 'thumbnail',
    pithumbsize: '720',
    coprop: 'type',
    format: 'json',
    origin: '*',
    redirects: '1',
  });
  const response = await fetch(`${WIKI_API}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Wikipedia returned ${response.status}`);
  const payload = await response.json() as { query?: { pages?: Record<string, Article> } };
  const page = payload.query?.pages?.[String(pageid)];
  if (!page) throw new Error('This article could not be found.');
  return { ...page, pageid };
}

function MapViewportWatcher({ onSettled }: { onSettled: (bounds: LatLngBounds, center: L.LatLng) => void }) {
  const map = useMap();
  const callbackRef = useRef(onSettled);
  callbackRef.current = onSettled;
  useEffect(() => {
    const settle = () => callbackRef.current(map.getBounds(), map.getCenter());
    const timer = window.setTimeout(settle, 120);
    map.on('moveend', settle);
    return () => { window.clearTimeout(timer); map.off('moveend', settle); };
  }, [map]);
  return null;
}

function MapBridge({ mapRef }: { mapRef: React.MutableRefObject<LeafletMap | null> }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    return () => { mapRef.current = null; };
  }, [map, mapRef]);
  return null;
}

function MapContent({
  landmarks, selectedId, onSelect, mapRef, onSettled,
}: {
  landmarks: Landmark[]; selectedId: number | null; onSelect: (landmark: Landmark) => void;
  mapRef: React.MutableRefObject<LeafletMap | null>; onSettled: (bounds: LatLngBounds, center: L.LatLng) => void;
}) {
  return (
    <>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapBridge mapRef={mapRef} />
      <MapViewportWatcher onSettled={onSettled} />
      {landmarks.map((landmark) => (
        <Marker
          key={landmark.pageid}
          position={[landmark.lat, landmark.lon]}
          icon={markerIcon(landmark.pageid === selectedId)}
          eventHandlers={{ click: () => onSelect(landmark) }}
          title={landmark.title}
          data-testid={`marker-landmark-${landmark.pageid}`}
        />
      ))}
      {selectedId && landmarks.find((landmark) => landmark.pageid === selectedId) ? (
        <CircleMarker
          center={(() => {
            const landmark = landmarks.find((item) => item.pageid === selectedId)!;
            return [landmark.lat, landmark.lon] as [number, number];
          })()}
          radius={25}
          pathOptions={{ color: '#d29926', weight: 1, fillOpacity: 0.08 }}
          interactive={false}
        />
      ) : null}
    </>
  );
}

function AppHome() {
  const mapRef = useRef<LeafletMap | null>(null);
  const requestId = useRef(0);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [landmarkState, setLandmarkState] = useState<LoadState>('loading');
  const [articleState, setArticleState] = useState<LoadState>('ready');
  const [error, setError] = useState('');
  const [articleError, setArticleError] = useState('');
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle');
  const [viewportLabel, setViewportLabel] = useState('Central London');

  const fetchForBounds = useCallback((bounds: LatLngBounds, center: L.LatLng) => {
    const currentRequest = ++requestId.current;
    setLandmarkState('loading');
    setError('');
    setViewportLabel(`${center.lat.toFixed(2)}° N · ${Math.abs(center.lng).toFixed(2)}° W`);
    const controller = new AbortController();
    getLandmarks(bounds, controller.signal).then((items) => {
      if (currentRequest !== requestId.current) return;
      setLandmarks(items);
      setLandmarkState('ready');
      setSelectedId((current) => current && items.some((item) => item.pageid === current) ? current : null);
    }).catch((reason: unknown) => {
      if ((reason as { name?: string }).name === 'AbortError' || currentRequest !== requestId.current) return;
      setLandmarkState('error');
      setError('Wikipedia could not return landmarks for this view. Check your connection and try again.');
    });
  }, []);

  const selected = useMemo(() => landmarks.find((landmark) => landmark.pageid === selectedId) ?? null, [landmarks, selectedId]);

  useEffect(() => {
    if (!selected) {
      setArticle(null);
      setArticleState('ready');
      return;
    }
    const controller = new AbortController();
    setArticle(null);
    setArticleError('');
    setArticleState('loading');
    getArticle(selected.pageid, controller.signal).then((result) => {
      setArticle(result);
      setArticleState('ready');
    }).catch((reason: unknown) => {
      if ((reason as { name?: string }).name === 'AbortError') return;
      setArticleState('error');
      setArticleError('The article details are unavailable right now.');
    });
    return () => controller.abort();
  }, [selected]);

  const selectLandmark = useCallback((landmark: Landmark) => {
    setSelectedId(landmark.pageid);
    mapRef.current?.flyTo([landmark.lat, landmark.lon], Math.max(mapRef.current.getZoom(), 15), { duration: .75 });
  }, []);

  const resetView = () => {
    setSelectedId(null);
    mapRef.current?.setView(START, START_ZOOM, { animate: true });
  };

  const locateUser = () => {
    if (!navigator.geolocation) {
      setGeoStatus('error');
      setError('Location is not available in this browser. You can still explore by moving the map.');
      return;
    }
    setGeoStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoStatus('success');
        mapRef.current?.flyTo([position.coords.latitude, position.coords.longitude], 14, { duration: 1 });
      },
      () => {
        setGeoStatus('error');
        setError('Location permission was not granted. You can still explore by moving the map.');
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 120000 },
    );
  };

  const mapStatus = landmarkState === 'loading'
    ? 'Reading this corner of the map…'
    : `${landmarks.length} ${landmarks.length === 1 ? 'landmark' : 'landmarks'} in view`;

  const formatCoordinate = (latitude: number, longitude: number) => (
    `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? 'N' : 'S'} · ${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? 'E' : 'W'}`
  );

  return (
    <main className="explorer-app" data-testid="page-landmark-explorer">
      <header className="app-header">
        <div className="brand-lockup" data-testid="text-app-brand">
          <div className="brand-mark"><Navigation size={17} strokeWidth={1.5} /></div>
          <div>
            <div className="brand-name">Landmark Explorer</div>
            <div className="brand-kicker">A field guide to everywhere</div>
          </div>
        </div>
        <div className="header-note"><span className="header-note-rule" /> move the map, change the story <Crosshair size={14} /></div>
      </header>

      <div className="explorer-layout">
        <section className="map-pane" aria-label="Interactive landmark map" data-testid="region-map">
          <div className="map-frame">
            <MapErrorBoundary>
              <MapContainer center={START} zoom={START_ZOOM} scrollWheelZoom zoomControl>
                <MapContent landmarks={landmarks} selectedId={selectedId} onSelect={selectLandmark} mapRef={mapRef} onSettled={fetchForBounds} />
              </MapContainer>
            </MapErrorBoundary>
          </div>
          <div className="map-overlay">
            <div className="map-caption">
              <div className="map-caption-label">You are looking at</div>
              <div className="map-caption-value" data-testid="text-map-viewport">{viewportLabel}</div>
            </div>
            <div className="map-actions">
              <button className="map-action" type="button" title="Use my location" aria-label="Use my location" data-testid="button-use-location" onClick={locateUser} disabled={geoStatus === 'locating'}>
                <LocateFixed size={17} className={geoStatus === 'locating' ? 'animate-pulse' : ''} />
              </button>
              <button className="map-action" type="button" title="Reset to central London" aria-label="Reset to central London" data-testid="button-reset-view" onClick={resetView}>
                <RotateCcw size={17} />
              </button>
            </div>
          </div>
          <div className="map-status" data-testid="status-landmark-count">{mapStatus}</div>
        </section>

        <aside className="results-pane" aria-label="Landmarks in the visible map area">
          <div className="results-head">
            <div className="eyebrow">Dispatch 001 · Live from Wikipedia</div>
            <h1 className="results-title">What is worth<br />a closer look?</h1>
            <p className="results-intro">Pan across the map and the field guide follows. Each pin is a place with a page, a past, and a reason to pause.</p>
            <div className="result-meta">
              <div className="count-label"><span className="count-number" data-testid="text-landmark-count">{landmarks.length}</span> notable places nearby</div>
              <div className="viewport-chip" data-testid="text-data-source">GEOSEARCH / 10 KM</div>
            </div>
          </div>

          <div className="landmark-list" data-testid="list-landmarks">
            {landmarkState === 'loading' ? (
              <div className="list-state" data-testid="status-landmarks-loading">
                {[1, 2, 3, 4].map((item) => <div key={item} className="motion-in"><div className="skeleton-line short" /><div className="skeleton-line" /><div className="skeleton-line short" /></div>)}
              </div>
            ) : landmarkState === 'error' ? (
              <div className="inline-error" data-testid="status-landmarks-error">
                {error}
                <br />
                <button type="button" data-testid="button-retry-landmarks" onClick={() => {
                  const map = mapRef.current;
                  if (map) fetchForBounds(map.getBounds(), map.getCenter());
                }}>Try this view again</button>
              </div>
            ) : landmarks.length === 0 ? (
              <div className="empty-state" data-testid="status-landmarks-empty">
                <div className="empty-compass"><ScanSearch size={22} /></div>
                <h3>Nothing noted here yet.</h3>
                <p>Zoom out or drift the map toward a nearby town. The best finds can sit just beyond the frame.</p>
              </div>
            ) : landmarks.map((landmark, index) => (
              <button
                type="button"
                className={`landmark-card motion-in ${selectedId === landmark.pageid ? 'is-selected' : ''}`}
                key={landmark.pageid}
                data-testid={`button-landmark-${landmark.pageid}`}
                onClick={() => selectLandmark(landmark)}
              >
                <span className="landmark-index">{String(index + 1).padStart(2, '0')}</span>
                <span>
                  <span className="landmark-name" data-testid={`text-landmark-title-${landmark.pageid}`}>{landmark.title}</span>
                  <span className="landmark-coords" data-testid={`text-landmark-coordinates-${landmark.pageid}`}>{formatCoordinate(landmark.lat, landmark.lon)}</span>
                </span>
                <ArrowUpRight size={15} className="landmark-arrow" />
              </button>
            ))}
          </div>

          {selected ? (
            <section className="detail-drawer motion-in" aria-label="Selected landmark details" data-testid={`panel-landmark-detail-${selected.pageid}`}>
              {articleState === 'loading' ? (
                <div className="detail-loading" data-testid="status-detail-loading"><div className="skeleton-line short" /><div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line short" /></div>
              ) : articleState === 'error' ? (
                <div className="detail-inner inline-error" data-testid="status-detail-error">{articleError}<br /><button type="button" data-testid="button-close-detail-error" onClick={() => setSelectedId(null)}>Close detail</button></div>
              ) : article ? (
                <div className="detail-inner">
                  <div className="detail-kicker"><span>Field note · {String(article.pageid).slice(-5)}</span><button className="detail-close" type="button" data-testid="button-close-detail" onClick={() => setSelectedId(null)}><X size={15} /></button></div>
                  <h2 className="detail-title" data-testid={`text-detail-title-${article.pageid}`}>{article.title}</h2>
                  {article.thumbnail?.source ? <img className="detail-image" src={article.thumbnail.source} alt={`View of ${article.title}`} data-testid={`img-detail-thumbnail-${article.pageid}`} /> : null}
                  <p className="detail-extract" data-testid={`text-detail-extract-${article.pageid}`}>{article.extract || 'Wikipedia has not provided an introductory note for this place.'}</p>
                  <div className="detail-coords" data-testid={`text-detail-coordinates-${article.pageid}`}><MapPin size={13} /> {selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}</div>
                  <div className="detail-actions">
                    <a className="wiki-link" href={`https://en.wikipedia.org/?curid=${article.pageid}`} target="_blank" rel="noreferrer" data-testid={`link-wikipedia-${article.pageid}`}>Read on Wikipedia <ExternalLink size={13} /></a>
                    <button className="detail-close" type="button" data-testid="button-dismiss-detail" onClick={() => setSelectedId(null)}>Dismiss</button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
      {geoStatus === 'error' && error ? <div className="sr-only" data-testid="status-location-error">{error}</div> : null}
    </main>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={AppHome} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;