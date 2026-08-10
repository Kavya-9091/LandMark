import { useCallback, useEffect, useMemo, useRef, useState, Component, type ErrorInfo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { ArrowUpRight, Crosshair, ExternalLink, LocateFixed, MapPin, Navigation, RefreshCw, RotateCcw, ScanSearch, Search, X } from 'lucide-react';
import L, { type LatLngBounds, type Map as LeafletMap } from 'leaflet';
import { CircleMarker, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '@/index.css';
import NotFound from '@/pages/not-found';

type Landmark = {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
  dist: number;
  isTourist: boolean;
  description?: string;
  thumbnail?: { source: string; width: number; height: number };
};
type Article = { title: string; extract?: string; thumbnail?: { source: string; width: number; height: number }; coordinates?: { lat: number; lon: number }[]; pageid: number };
type PlaceSuggestion = { display_name: string; lat: string; lon: string; type: string };
type LoadState = 'loading' | 'ready' | 'error';
type GeoStatus = 'idle' | 'locating' | 'success' | 'error';

const queryClient = new QueryClient();
const START: [number, number] = [51.5074, -0.1278];
const START_ZOOM = 13;
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const GEOCODER_API = 'https://nominatim.openstreetmap.org/search';

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
  const nearby = (payload.query?.geosearch ?? [])
    .filter(({ lat, lon }) => bounds.contains([lat, lon]))
    .map(({ pageid, title, lat, lon, dist }) => ({ pageid, title, lat, lon, dist, isTourist: false }));

  if (!nearby.length) return nearby;

  const metadataParams = new URLSearchParams({
    action: 'query',
    pageids: nearby.map(({ pageid }) => String(pageid)).join('|'),
    prop: 'categories|description|pageimages|extracts',
    exintro: '1',
    explaintext: '1',
    exchars: '180',
    piprop: 'thumbnail',
    pithumbsize: '320',
    cllimit: 'max',
    clshow: '!hidden',
    format: 'json',
    origin: '*',
  });
  try {
    const metadataResponse = await fetch(`${WIKI_API}?${metadataParams.toString()}`, { signal });
    if (!metadataResponse.ok) return nearby.map((place) => ({ ...place, isTourist: isLikelyTourist(place.title) }));
    const metadata = await metadataResponse.json() as {
      query?: {
        pages?: Record<string, {
          description?: string;
          extract?: string;
          thumbnail?: { source: string; width: number; height: number };
          categories?: { title: string }[];
        }>;
      };
    };
    return nearby.map((place) => {
      const page = metadata.query?.pages?.[String(place.pageid)];
      const signals = [
        place.title,
        page?.description ?? '',
        page?.extract ?? '',
        ...(page?.categories ?? []).map(({ title }) => title),
      ].join(' ');
      return {
        ...place,
        description: page?.description || page?.extract,
        thumbnail: page?.thumbnail,
        isTourist: isLikelyTourist(signals),
      };
    });
  } catch (reason: unknown) {
    if ((reason as { name?: string }).name === 'AbortError') throw reason;
    return nearby.map((place) => ({ ...place, isTourist: isLikelyTourist(place.title) }));
  }
}

function isLikelyTourist(value: string) {
  return /\b(attraction|landmark|monument|museum|castle|palace|church|cathedral|temple|tower|bridge|park|garden|gallery|theatre|theater|stadium|zoo|aquarium|memorial|historic|heritage|archaeological|observatory|square|beach|waterfall|viewpoint|fort|ruins|abbey|chapel|mosque|synagogue|opera|lighthouse)\b/i.test(value);
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

async function searchPlace(query: string, signal: AbortSignal): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '5',
    addressdetails: '1',
    'accept-language': 'en',
  });
  const response = await fetch(`${GEOCODER_API}?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Place search returned ${response.status}`);
  return await response.json() as PlaceSuggestion[];
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
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeState, setPlaceState] = useState<LoadState>('ready');
  const [placeError, setPlaceError] = useState('');
  const [touristOnly, setTouristOnly] = useState(false);

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
  const visibleLandmarks = useMemo(
    () => touristOnly ? landmarks.filter((landmark) => landmark.isTourist) : landmarks,
    [landmarks, touristOnly],
  );
  const touristCount = useMemo(() => landmarks.filter((landmark) => landmark.isTourist).length, [landmarks]);

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
    setGeoStatus('idle');
    setError('');
    mapRef.current?.setView(START, START_ZOOM, { animate: true });
  };

  const handlePlaceSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = placeQuery.trim();
    if (!query || !mapRef.current) return;

    const controller = new AbortController();
    setPlaceState('loading');
    setPlaceError('');
    searchPlace(query, controller.signal).then((places) => {
      const place = places[0];
      if (!place) {
        setPlaceState('error');
        setPlaceError(`No place found for “${query}”. Try a city, town, or landmark.`);
        return;
      }
      setPlaceState('ready');
      setGeoStatus('idle');
      setError('');
      setSelectedId(null);
      mapRef.current?.setView([Number(place.lat), Number(place.lon)], 13, { animate: true });
    }).catch((reason: unknown) => {
      if ((reason as { name?: string }).name === 'AbortError') return;
      setPlaceState('error');
      setPlaceError('Place search is unavailable right now. Check your connection and try again.');
    });
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
        setError('');
        mapRef.current?.flyTo([position.coords.latitude, position.coords.longitude], 14, { duration: 1 });
      },
      (positionError) => {
        setGeoStatus('error');
        const message = positionError.code === 1
          ? 'Location permission was blocked. Allow location access for this site, then try again.'
          : positionError.code === 2
            ? 'Your location could not be determined. Check device location services and try again.'
            : 'Location took too long to respond. Check your connection and try again.';
        setError(message);
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 120000 },
    );
  };

  const mapStatus = landmarkState === 'loading'
    ? 'Reading this corner of the map…'
    : touristOnly
      ? `${visibleLandmarks.length} tourist ${visibleLandmarks.length === 1 ? 'place' : 'places'} in view`
      : `${landmarks.length} places in view · ${touristCount} tourist picks`;

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
        <div className="header-actions">
          <div className="header-note"><span className="header-note-rule" /> move the map, change the story <Crosshair size={14} /></div>
          <button className="header-location" type="button" onClick={locateUser} disabled={geoStatus === 'locating'} data-testid="button-header-location">
            <LocateFixed size={14} /> {geoStatus === 'locating' ? 'Finding you…' : 'Use my location'}
          </button>
        </div>
      </header>

      <div className="explorer-layout">
        <section className="map-pane" aria-label="Interactive landmark map" data-testid="region-map">
          <div className="map-frame">
            <MapErrorBoundary>
              <MapContainer center={START} zoom={START_ZOOM} scrollWheelZoom zoomControl>
               <MapContent landmarks={visibleLandmarks} selectedId={selectedId} onSelect={selectLandmark} mapRef={mapRef} onSettled={fetchForBounds} />
              </MapContainer>
            </MapErrorBoundary>
          </div>
          <div className="map-overlay">
            <div className="map-caption">
              <div className="map-caption-label">You are looking at</div>
              <div className="map-caption-value" data-testid="text-map-viewport">{viewportLabel}</div>
            </div>
            <div className="map-actions">
              <button className={`map-action ${geoStatus === 'error' ? 'has-error' : ''}`} type="button" title="Use my location" aria-label="Use my location" data-testid="button-use-location" onClick={locateUser} disabled={geoStatus === 'locating'}>
                <LocateFixed size={17} className={geoStatus === 'locating' ? 'animate-pulse' : ''} />
              </button>
              <button className="map-action" type="button" title="Reset to central London" aria-label="Reset to central London" data-testid="button-reset-view" onClick={resetView}>
                <RotateCcw size={17} />
              </button>
            </div>
          </div>
          {geoStatus === 'error' && error ? (
            <div className="map-notice" role="alert" data-testid="status-location-error">
              <div><strong>Location unavailable</strong><span>{error}</span></div>
              <button type="button" onClick={locateUser}>Try again</button>
            </div>
          ) : null}
          <div className="map-status" data-testid="status-landmark-count">{mapStatus}</div>
          {selected ? (
            <section className="detail-drawer motion-in" aria-label="Selected landmark details" data-testid={`panel-landmark-detail-${selected.pageid}`}>
              {articleState === 'loading' ? (
                <div className="detail-loading" data-testid="status-detail-loading"><div className="skeleton-line short" /><div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line short" /></div>
              ) : articleState === 'error' ? (
                <div className="detail-inner inline-error" data-testid="status-detail-error">{articleError}<br /><button type="button" data-testid="button-close-detail-error" onClick={() => setSelectedId(null)}>Close detail</button></div>
              ) : article ? (
                <div className="detail-inner">
                  <div className="detail-kicker"><span>From Wikipedia · {String(article.pageid).slice(-5)}</span><button className="detail-close" type="button" data-testid="button-close-detail" onClick={() => setSelectedId(null)}><X size={15} /></button></div>
                  <h2 className="detail-title" data-testid={`text-detail-title-${article.pageid}`}>{article.title}</h2>
                  {article.thumbnail?.source ? <img className="detail-image" src={article.thumbnail.source} alt={`View of ${article.title}`} data-testid={`img-detail-thumbnail-${article.pageid}`} /> : null}
                  <p className="detail-extract" data-testid={`text-detail-extract-${article.pageid}`}>{article.extract || 'Wikipedia has not provided an introductory note for this place.'}</p>
                  <div className="detail-coords" data-testid={`text-detail-coordinates-${article.pageid}`}><MapPin size={13} /> {selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}</div>
                  <div className="detail-actions">
                    <a className="wiki-link" href={`https://en.wikipedia.org/?curid=${article.pageid}`} target="_blank" rel="noreferrer" data-testid={`link-wikipedia-${article.pageid}`}>Read the entry <ExternalLink size={13} /></a>
                    <a className="maps-link" href={`https://www.openstreetmap.org/?mlat=${selected.lat}&mlon=${selected.lon}#map=16/${selected.lat}/${selected.lon}`} target="_blank" rel="noreferrer" data-testid={`link-map-${article.pageid}`}>Open in Maps <ArrowUpRight size={13} /></a>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </section>

        <aside className="results-pane" aria-label="Landmarks in the visible map area">
          <div className="results-head">
            <div className="eyebrow">Dispatch 001 · Live from Wikipedia</div>
            <h1 className="results-title">What is worth<br />a closer look?</h1>
            <p className="results-intro">Search a city or pan the map. Each result is a nearby place with a Wikipedia page—not a paid or curated tourist ranking.</p>
            <form className="place-search" onSubmit={handlePlaceSearch} role="search">
              <Search size={16} aria-hidden="true" />
              <input
                value={placeQuery}
                onChange={(event) => setPlaceQuery(event.target.value)}
                placeholder="Search a city or place"
                aria-label="Search a city or place"
                data-testid="input-place-search"
              />
              <button type="submit" disabled={placeState === 'loading'} data-testid="button-place-search">
                {placeState === 'loading' ? 'Finding…' : 'Go'}
              </button>
            </form>
            {placeState === 'error' ? <div className="search-error" role="alert" data-testid="status-place-search-error">{placeError}</div> : null}
            <div className="result-meta">
              <div className="count-label"><span className="count-number" data-testid="text-landmark-count">{visibleLandmarks.length}</span> {touristOnly ? 'tourist places' : 'places'} nearby</div>
              <div className="viewport-chip" data-testid="text-data-source">WIKIPEDIA / MAP AREA</div>
            </div>
            <div className="result-filters" role="tablist" aria-label="Place type filter">
              <button type="button" role="tab" aria-selected={!touristOnly} className={!touristOnly ? 'is-active' : ''} onClick={() => setTouristOnly(false)} data-testid="button-filter-all">All places <span>{landmarks.length}</span></button>
              <button type="button" role="tab" aria-selected={touristOnly} className={touristOnly ? 'is-active' : ''} onClick={() => setTouristOnly(true)} data-testid="button-filter-tourist">Tourist places <span>{touristCount}</span></button>
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
            ) : visibleLandmarks.length === 0 ? (
              <div className="empty-state" data-testid="status-landmarks-empty">
                <div className="empty-compass"><ScanSearch size={22} /></div>
                <h3>{touristOnly ? 'No tourist places found here yet.' : 'Nothing noted here yet.'}</h3>
                <p>{touristOnly ? 'Try another city, zoom out, or switch to all nearby Wikipedia places.' : 'Zoom out or drift the map toward a nearby town. The best finds can sit just beyond the frame.'}</p>
              </div>
            ) : visibleLandmarks.map((landmark, index) => (
              <button
                type="button"
                className={`landmark-card motion-in ${selectedId === landmark.pageid ? 'is-selected' : ''}`}
                key={landmark.pageid}
                data-testid={`button-landmark-${landmark.pageid}`}
                onClick={() => selectLandmark(landmark)}
                >
                  <span className="landmark-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="landmark-card-content">
                    {landmark.thumbnail?.source ? (
                      <img className="landmark-thumb" src={landmark.thumbnail.source} alt="" loading="lazy" />
                    ) : (
                      <span className="landmark-thumb landmark-thumb-empty" aria-hidden="true"><MapPin size={17} /></span>
                    )}
                    <span className="landmark-card-copy">
                      <span className="landmark-name" data-testid={`text-landmark-title-${landmark.pageid}`}>{landmark.title}</span>
                      <span className={`landmark-tag ${landmark.isTourist ? 'is-tourist' : ''}`}>{landmark.isTourist ? 'Tourist place' : 'Nearby Wikipedia place'}</span>
                      {landmark.description ? <span className="landmark-description">{landmark.description}</span> : null}
                      <span className="landmark-coords" data-testid={`text-landmark-coordinates-${landmark.pageid}`}>{formatCoordinate(landmark.lat, landmark.lon)}</span>
                    </span>
                  </span>
                <ArrowUpRight size={15} className="landmark-arrow" />
              </button>
            ))}
          </div>

        </aside>
      </div>
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