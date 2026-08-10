import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Pause, Play, RotateCcw, MousePointer2 } from 'lucide-react';

const queryClient = new QueryClient();
const BEST_SCORE_KEY = 'signal-drift-best-score';
const BEST_COMBO_KEY = 'signal-drift-best-combo';
type Point = { x: number; y: number };
type Shard = Point & { id: number; phase: number };
type Hazard = Point & { id: number; radius: number; speed: number; phase: number; axis: 'x' | 'y' };
type Spark = Point & { id: number; life: number; size: number; color: string; vx: number; vy: number };
type Callout = { id: number; text: string; x: number; y: number; life: number; color: string };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function readStored(key: string) {
  try { return Number(localStorage.getItem(key) ?? 0) || 0; } catch { return 0; }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function useSynthAudio(muted: boolean) {
  const contextRef = useRef<AudioContext | null>(null);
  const play = useCallback((kind: 'shard' | 'near' | 'crash' | 'start') => {
    if (muted || typeof window === 'undefined' || !window.AudioContext) return;
    try {
      const context = contextRef.current ?? new AudioContext();
      contextRef.current = context;
      if (context.state === 'suspended') void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const tones = { shard: [480, 760], near: [220, 390], crash: [150, 52], start: [260, 520] };
      const [from, to] = tones[kind];
      oscillator.type = kind === 'crash' ? 'sawtooth' : 'sine';
      oscillator.frequency.setValueAtTime(from, now);
      oscillator.frequency.exponentialRampToValueAtTime(to, now + (kind === 'crash' ? .35 : .13));
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(kind === 'crash' ? .16 : .07, now + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, now + (kind === 'crash' ? .38 : .17));
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + (kind === 'crash' ? .4 : .2));
    } catch { /* Audio is an enhancement; gameplay does not depend on it. */ }
  }, [muted]);
  useEffect(() => () => { void contextRef.current?.close(); }, []);
  return play;
}

function StartScreen({ bestScore, bestCombo, muted, onMute, onPlay }: { bestScore: number; bestCombo: number; muted: boolean; onMute: () => void; onPlay: () => void }) {
  return <main className="signal-shell start-screen">
    <section className="start-copy">
      <div className="eyebrow">Signal integrity // 01</div>
      <h1>Signal<span>Drift</span></h1>
      <p>Thread the current. Catch the charge. Hold your nerve inside a field that never stops moving.</p>
      <div className="start-actions">
        <button className="button-primary" onClick={onPlay} data-testid="button-play">Play signal <span aria-hidden>→</span></button>
        <div className="control-note"><MousePointer2 size={16} aria-hidden /> drag to steer <span className="keycap">WASD</span></div>
      </div>
      <div className="start-stats">
        <div className="stat-line"><strong data-testid="text-best-score">{bestScore.toLocaleString()}</strong><span>best signal</span></div>
        <div className="stat-line"><strong data-testid="text-best-combo">{bestCombo}x</strong><span>best chain</span></div>
      </div>
    </section>
    <div className="orbit-art" aria-label="Abstract signal field visualization">
      <div className="art-grid" /><div className="art-core" /><div className="art-ray ray-1" /><div className="art-ray ray-2" /><div className="art-ray ray-3" />
      <div className="art-label">live field / 00:00</div><div className="art-node node-1" /><div className="art-node node-2" /><div className="art-node node-3" />
    </div>
    <div className="topbar-tools" style={{ position: 'absolute', top: 0, right: 0 }}><button className="button-quiet" onClick={onMute} aria-label={muted ? 'Turn sound on' : 'Mute sound'} data-testid="button-mute-start">{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button></div>
  </main>;
}

function SignalGame({ bestScore, bestCombo, muted, onMute, onFinish, onExit }: { bestScore: number; bestCombo: number; muted: boolean; onMute: () => void; onFinish: (score: number, combo: number) => void; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const stateRef = useRef({ phase: 'playing' as 'playing' | 'paused' | 'over', last: 0, elapsed: 0, score: 0, combo: 0, bestRunCombo: 0, spawnShard: .2, spawnHazard: 1.1, nextId: 1, shake: 0, flash: 0, player: { x: .5, y: .58 }, target: { x: .5, y: .58 }, keys: new Set<string>(), shards: [] as Shard[], hazards: [] as Hazard[], sparks: [] as Spark[], callouts: [] as Callout[], nearCooldown: 0 });
  const [hud, setHud] = useState({ score: 0, combo: 0, elapsed: 0, level: 1, phase: 'playing' as 'playing' | 'paused' | 'over' });
  const reducedMotion = useReducedMotion();
  const sound = useSynthAudio(muted);

  const finish = useCallback(() => {
    const state = stateRef.current;
    if (state.phase !== 'playing') return;
    state.phase = 'over'; state.shake = reducedMotion ? 0 : 14; state.flash = reducedMotion ? 0 : .8;
    sound('crash'); setHud({ score: Math.floor(state.score), combo: state.bestRunCombo, elapsed: state.elapsed, level: Math.floor(1 + state.elapsed / 18), phase: 'over' }); onFinish(Math.floor(state.score), state.bestRunCombo);
  }, [onFinish, reducedMotion, sound]);

  const togglePause = useCallback(() => {
    const state = stateRef.current;
    if (state.phase === 'over') return;
    state.phase = state.phase === 'paused' ? 'playing' : 'paused';
    state.last = performance.now();
    setHud((current) => ({ ...current, phase: state.phase }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const state = stateRef.current;
    const setTarget = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      state.target.x = clamp((event.clientX - rect.left) / rect.width, .04, .96);
      state.target.y = clamp((event.clientY - rect.top) / rect.height, .06, .94);
    };
    const down = (event: PointerEvent) => { canvas.setPointerCapture?.(event.pointerId); setTarget(event); };
    const move = (event: PointerEvent) => { if (event.buttons || event.pointerType === 'touch') setTarget(event); };
    const key = (event: KeyboardEvent, downState: boolean) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) event.preventDefault();
      if (downState) state.keys.add(event.code); else state.keys.delete(event.code);
      if (downState && event.code === 'Space') togglePause();
    };
    const visibility = () => { if (document.hidden && state.phase === 'playing') { state.phase = 'paused'; setHud((current) => ({ ...current, phase: 'paused' })); } };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    window.addEventListener('keydown', (event) => key(event, true)); window.addEventListener('keyup', (event) => key(event, false)); document.addEventListener('visibilitychange', visibility);
    const resize = () => { const rect = canvas.getBoundingClientRect(); const scale = window.devicePixelRatio || 1; canvas.width = Math.floor(rect.width * scale); canvas.height = Math.floor(rect.height * scale); ctx.setTransform(scale, 0, 0, scale, 0, 0); };
    resize(); window.addEventListener('resize', resize);

    const draw = (time: number) => {
      const width = canvas.clientWidth; const height = canvas.clientHeight;
      const dt = Math.min((time - (state.last || time)) / 1000, .04); state.last = time;
      const level = Math.floor(1 + state.elapsed / 18);
      if (state.phase === 'playing') {
        state.elapsed += dt; state.spawnShard -= dt; state.spawnHazard -= dt; state.nearCooldown -= dt;
        const speed = (.24 + level * .012) * dt;
        const axisX = (state.keys.has('ArrowRight') || state.keys.has('KeyD') ? 1 : 0) - (state.keys.has('ArrowLeft') || state.keys.has('KeyA') ? 1 : 0);
        const axisY = (state.keys.has('ArrowDown') || state.keys.has('KeyS') ? 1 : 0) - (state.keys.has('ArrowUp') || state.keys.has('KeyW') ? 1 : 0);
        if (axisX || axisY) { state.target.x = clamp(state.target.x + axisX * speed, .035, .965); state.target.y = clamp(state.target.y + axisY * speed, .06, .94); }
        state.player.x += (state.target.x - state.player.x) * Math.min(1, dt * 8); state.player.y += (state.target.y - state.player.y) * Math.min(1, dt * 8);
        if (state.spawnShard <= 0) { state.shards.push({ id: state.nextId++, x: .08 + Math.random() * .84, y: .12 + Math.random() * .76, phase: Math.random() * 6.28 }); state.spawnShard = Math.max(.58, 1.18 - level * .045); }
        if (state.spawnHazard <= 0) { const axis = state.nextId % 2 ? 'x' : 'y'; state.hazards.push({ id: state.nextId++, x: .15 + Math.random() * .7, y: .15 + Math.random() * .7, radius: .035 + Math.min(.018, level * .002), speed: .08 + level * .007, phase: Math.random() * 6.28, axis }); state.spawnHazard = Math.max(.62, 1.7 - level * .09); }
        state.shards.forEach((shard) => { shard.x += Math.sin(state.elapsed * .7 + shard.phase) * dt * .015; shard.y += Math.cos(state.elapsed * .5 + shard.phase) * dt * .012; });
        state.hazards.forEach((hazard) => { if (hazard.axis === 'x') hazard.x = .5 + Math.sin(state.elapsed * hazard.speed * 6 + hazard.phase) * .39; else hazard.y = .5 + Math.cos(state.elapsed * hazard.speed * 6 + hazard.phase) * .39; });
        state.shards = state.shards.filter((shard) => {
          if (distance(state.player, shard) < .052) { const bonus = 10 + state.combo * 4; state.score += bonus; state.combo += 1; state.bestRunCombo = Math.max(state.bestRunCombo, state.combo); state.shake = reducedMotion ? 0 : 3; state.flash = reducedMotion ? 0 : .18; state.callouts.push({ id: state.nextId++, x: shard.x, y: shard.y, text: state.combo > 1 ? `CHAIN +${bonus}` : `CHARGE +${bonus}`, life: 1, color: state.combo > 1 ? '#ff8276' : '#6ceff0' }); for (let i = 0; i < (reducedMotion ? 3 : 9); i++) state.sparks.push({ id: state.nextId++, x: shard.x, y: shard.y, life: 1, size: 1 + Math.random() * 3, color: state.combo > 1 ? '#ff8276' : '#6ceff0', vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35 }); sound('shard'); return false; }
          return true;
        });
        state.hazards.forEach((hazard) => {
          const hit = distance(state.player, hazard) < hazard.radius + .027;
          const near = distance(state.player, hazard) < hazard.radius + .075 && !hit && state.nearCooldown <= 0;
          if (near) { state.score += 7 + state.combo * 2; state.combo += 1; state.bestRunCombo = Math.max(state.bestRunCombo, state.combo); state.nearCooldown = .35; state.callouts.push({ id: state.nextId++, x: state.player.x, y: state.player.y - .05, text: 'NEAR MISS +7', life: 1, color: '#ff8276' }); state.shake = reducedMotion ? 0 : 2; sound('near'); }
          if (hit) finish();
        });
        state.sparks = state.sparks.filter((spark) => { spark.x += spark.vx * dt; spark.y += spark.vy * dt; spark.life -= dt * 2.7; return spark.life > 0; });
        state.callouts = state.callouts.filter((callout) => { callout.life -= dt * 1.4; return callout.life > 0; });
        state.shake = Math.max(0, state.shake - dt * 18); state.flash = Math.max(0, state.flash - dt * 2.5);
      }
      ctx.clearRect(0, 0, width, height);
      const gradient = ctx.createRadialGradient(width * .5, height * .4, 0, width * .5, height * .5, Math.max(width, height) * .75); gradient.addColorStop(0, '#142a47'); gradient.addColorStop(.55, '#0d1730'); gradient.addColorStop(1, '#090d20'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
      const shakeX = state.shake ? (Math.sin(time * .09) * state.shake) : 0; const shakeY = state.shake ? (Math.cos(time * .1) * state.shake) : 0; ctx.save(); ctx.translate(shakeX, shakeY);
      ctx.strokeStyle = 'rgba(91, 201, 216, .095)'; ctx.lineWidth = 1; const grid = Math.max(34, width / 17);
      for (let x = -grid; x < width + grid; x += grid) { ctx.beginPath(); ctx.moveTo(x + ((state.elapsed * 8) % grid), 0); ctx.lineTo(x + ((state.elapsed * 8) % grid), height); ctx.stroke(); }
      for (let y = -grid; y < height + grid; y += grid) { ctx.beginPath(); ctx.moveTo(0, y + ((state.elapsed * 5) % grid)); ctx.lineTo(width, y + ((state.elapsed * 5) % grid)); ctx.stroke(); }
      for (let i = 0; i < 26; i++) { const x = (i * 83 + 32) % width; const y = (i * 47 + 17) % height; ctx.fillStyle = `rgba(120, 220, 240, ${.12 + (i % 3) * .08})`; ctx.fillRect(x, y, i % 4 ? 1 : 2, i % 4 ? 1 : 2); }
      state.hazards.forEach((hazard) => { const x = hazard.x * width; const y = hazard.y * height; const r = hazard.radius * Math.min(width, height) * 1.5; ctx.strokeStyle = 'rgba(255,130,118,.26)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r * 2.3, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = '#ff8276'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = 'rgba(255,130,118,.16)'; ctx.fill(); ctx.beginPath(); ctx.moveTo(x - r * 1.6, y); ctx.lineTo(x + r * 1.6, y); ctx.moveTo(x, y - r * 1.6); ctx.lineTo(x, y + r * 1.6); ctx.stroke(); });
      state.shards.forEach((shard) => { const x = shard.x * width; const y = shard.y * height; const pulse = 1 + Math.sin(state.elapsed * 4 + shard.phase) * .13; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.shadowColor = '#6ceff0'; ctx.shadowBlur = 18; ctx.fillStyle = '#6ceff0'; ctx.fillRect(-5 * pulse, -5 * pulse, 10 * pulse, 10 * pulse); ctx.restore(); });
      state.sparks.forEach((spark) => { ctx.globalAlpha = spark.life; ctx.fillStyle = spark.color; ctx.fillRect(spark.x * width, spark.y * height, spark.size, spark.size); }); ctx.globalAlpha = 1;
      const px = state.player.x * width; const py = state.player.y * height; const playerGlow = ctx.createRadialGradient(px, py, 0, px, py, 43); playerGlow.addColorStop(0, 'rgba(108,239,240,.65)'); playerGlow.addColorStop(1, 'rgba(108,239,240,0)'); ctx.fillStyle = playerGlow; ctx.fillRect(px - 45, py - 45, 90, 90); ctx.strokeStyle = 'rgba(108,239,240,.42)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, py, 18 + Math.sin(time * .006) * 2, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#d4ffff'; ctx.shadowColor = '#6ceff0'; ctx.shadowBlur = 20; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.restore();
      state.callouts.forEach((callout) => { ctx.globalAlpha = callout.life; ctx.fillStyle = callout.color; ctx.font = '500 12px "DM Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(callout.text, callout.x * width, callout.y * height - (1 - callout.life) * 24); }); ctx.globalAlpha = 1;
      if (state.flash > 0) { ctx.fillStyle = `rgba(150,245,245,${state.flash})`; ctx.fillRect(0, 0, width, height); }
      if (Math.floor(state.elapsed * 3) % 3 === 0 && state.phase === 'playing') setHud({ score: Math.floor(state.score), combo: state.combo, elapsed: state.elapsed, level, phase: state.phase });
      frameRef.current = requestAnimationFrame(draw);
    };
    frameRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frameRef.current); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility); };
  }, [finish, reducedMotion, sound, togglePause]);

  const playAgain = () => { const state = stateRef.current; state.phase = 'playing'; state.elapsed = 0; state.score = 0; state.combo = 0; state.bestRunCombo = 0; state.spawnShard = .2; state.spawnHazard = 1.1; state.shards = []; state.hazards = []; state.sparks = []; state.callouts = []; state.player = { x: .5, y: .58 }; state.target = { x: .5, y: .58 }; state.last = performance.now(); setHud({ score: 0, combo: 0, elapsed: 0, level: 1, phase: 'playing' }); sound('start'); };
  const seconds = Math.floor(hud.elapsed);
  return <main className="signal-shell game-wrap">
    <header className="game-header"><div><div className="eyebrow">Live transmission</div><h1 className="game-title">Signal<span>Drift</span></h1></div><div className="hud-row"><div className="hud-chip"><span className="hud-label">score</span><strong className="cyan" data-testid="text-score">{hud.score.toLocaleString()}</strong></div><div className="hud-chip"><span className="hud-label">combo</span><strong className="coral" data-testid="text-combo">{hud.combo}x</strong></div><div className="hud-chip"><span className="hud-label">run / level</span><strong data-testid="text-elapsed-level">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')} / {String(hud.level).padStart(2, '0')}</strong></div><button className="button-quiet" onClick={onMute} aria-label={muted ? 'Turn sound on' : 'Mute sound'} data-testid="button-mute-game">{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button></div></header>
    <div className="game-stage"><canvas ref={canvasRef} className="game-canvas" aria-label="Signal Drift playfield. Move the signal with pointer, touch, WASD, or arrow keys." data-testid="canvas-playfield" /><div className="stage-vignette" /><span className="stage-corner corner-tl" /><span className="stage-corner corner-tr" /><span className="stage-corner corner-bl" /><span className="stage-corner corner-br" /><button className="button-quiet pause-button" onClick={togglePause} aria-label={hud.phase === 'paused' ? 'Resume game' : 'Pause game'} data-testid="button-pause">{hud.phase === 'paused' ? <><Play size={13} /> resume</> : <><Pause size={13} /> pause</>}</button>{hud.phase === 'playing' && <div className="stage-hint">pointer drift / WASD steer</div>}{hud.phase === 'paused' && <div className="pause-layer"><div className="pause-card"><div className="eyebrow">Signal held</div><h2>Paused</h2><p>The field is waiting for your return.</p><button className="button-primary" onClick={togglePause} data-testid="button-resume"><Play size={15} /> resume run</button></div></div>}{hud.phase === 'over' && <div className="game-over-layer"><div className="game-over-card"><div className="eyebrow">Carrier lost</div><h2>Signal ended</h2><p>You held the line for <strong data-testid="text-final-time">{seconds}s</strong>.</p><div className="overlay-stats"><div className="overlay-stat"><span>score</span><strong data-testid="text-final-score">{hud.score.toLocaleString()}</strong></div><div className="overlay-stat"><span>best score</span><strong data-testid="text-final-best">{Math.max(bestScore, hud.score).toLocaleString()}</strong></div><div className="overlay-stat"><span>best chain</span><strong data-testid="text-final-combo">{Math.max(bestCombo, hud.combo)}x</strong></div><div className="overlay-stat"><span>field level</span><strong data-testid="text-final-level">{hud.level}</strong></div></div>{hud.score > bestScore && <p className="new-record" data-testid="status-new-record">new signal record</p>}<button className="button-primary" onClick={playAgain} data-testid="button-play-again"><RotateCcw size={15} /> play again</button></div></div>}</div>
    <footer className="game-foot"><p><strong>CHARGE</strong> shards for points · skim <strong>GATES</strong> for chain bonuses · collision ends the run</p><button className="button-quiet" onClick={onExit} data-testid="button-exit-run">exit to start</button></footer>
  </main>;
}

function GameRoute() {
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem('signal-drift-muted') === 'true'; } catch { return false; } });
  const [bestScore, setBestScore] = useState(readStored(BEST_SCORE_KEY));
  const [bestCombo, setBestCombo] = useState(readStored(BEST_COMBO_KEY));
  const updateMute = () => setMuted((value) => { const next = !value; try { localStorage.setItem('signal-drift-muted', String(next)); } catch { /* no-op */ } return next; });
  const finish = (score: number, combo: number) => { if (score > bestScore) { setBestScore(score); try { localStorage.setItem(BEST_SCORE_KEY, String(score)); } catch { /* no-op */ } } if (combo > bestCombo) { setBestCombo(combo); try { localStorage.setItem(BEST_COMBO_KEY, String(combo)); } catch { /* no-op */ } } };
  return <div className="signal-app"><div className="signal-shell signal-topbar"><div className="brand-mark"><span className="brand-symbol" /><span>Signal Drift</span></div>{started && <div className="topbar-tools"><span className="mono best-mini" style={{ color: 'hsl(var(--muted-foreground))', fontSize: '.7rem' }}>best {bestScore.toLocaleString()}</span></div>}</div>{started ? <SignalGame bestScore={bestScore} bestCombo={bestCombo} muted={muted} onMute={updateMute} onFinish={finish} onExit={() => setStarted(false)} /> : <StartScreen bestScore={bestScore} bestCombo={bestCombo} muted={muted} onMute={updateMute} onPlay={() => setStarted(true)} />}</div>;
}

function Router() {
  return <Switch><Route path="/" component={GameRoute} /><Route path="/signal-drift/" component={GameRoute} /><Route component={NotFound} /></Switch>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;