// CC0 samples for flight events; procedural continuous wind/altitude layers.
// и разовые удары (взлёт, приземление, хлопок на сверхзвуке). Контекст стартует по первому касанию.
import { BOOST_RELEASE_PHASE } from '../render/flight-cues.js';
const noiseBuf = (ctx, sec = 3) => {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
  const d = b.getChannelData(0);
  let l = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; l = (l + 0.02 * w) / 1.02; d[i] = w * 0.7 + l * 3; }
  return b;
};

// Independent noise textures, mixed narrowly around the centre without stereo sway.
function airNoise(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 5, ctx.sampleRate);
  const data = buffer.getChannelData(0); let low = 0, mid = 0, high = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    low += .012 * (white - low); mid += .085 * (white - mid); high += .42 * (white - high);
    data[i] = low * 2.8 + mid * .95 + high * .24;
  }
  return buffer;
}

// короткая пластинчатая реверберация — она склеивает синтез в «пространство»
function plate(ctx, sec = 2.2) {
  const b = ctx.createBuffer(2, ctx.sampleRate * sec, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (0.5 + 0.5 * Math.sin(i * 0.0007 + c));
    }
  }
  const cv = ctx.createConvolver(); cv.buffer = b; return cv;
}

export function createAudio() {
  const A = { ctx: null, on: true, vol: 0.9 };
  let output;
  let master, windG, airG, airF, rumbleG, rumbleF, boostG, boostF, boostSource, humG, verb, passVerb, sfxG, nb;
  const windVoices = [];
  const sampleFiles = { jump: 'jump-air', flight: 'flight-rise', takeoff: 'flight-rise', 'boost-charge': 'boost-charge', 'boost-release': 'boost-release' };
  for (let i = 0; i < 4; i++) {
    sampleFiles[`footstep-${i}`] = `move-step-${i}`;
    sampleFiles[`cloth-${i}`] = `move-cloth-${i}`;
  }
  const buffers = new Map(), names = [...new Set(Object.values(sampleFiles))];
  const downloads = Promise.all(names.map(async name => {
    try { const r = await fetch(`${import.meta.env.BASE_URL}audio/${name}.wav`); if (!r.ok) throw new Error(r.status); return [name, await r.arrayBuffer()]; }
    catch { return [name, null]; }
  }));
  A.ready = Promise.resolve();
  let chargeVoice = null, lastVisual = null, released = false, passUntil = 0;
  let gait = null, lastStep = -Infinity, stepIndex = 0;

  A.start = () => {
    if (A.ctx) { A.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    A.ctx = ctx;
    A.ready = downloads.then(async entries => {
      await Promise.all(entries.map(async ([name, data]) => { if (data) try { buffers.set(name, await ctx.decodeAudioData(data)); } catch {} }));
      return [...buffers.keys()];
    });
    nb = noiseBuf(ctx);
    master = ctx.createGain(); master.gain.value = A.on ? A.vol : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.22;
    // Catch rare coincident gust peaks after compression without digital clipping.
    const limiter = ctx.createWaveShaper();
    limiter.curve = Float32Array.from({ length: 2049 }, (_, i) => {
      const x = i / 1024 - 1, a = Math.abs(x);
      return Math.sign(x) * (a <= .8 ? a : .8 + .18 * Math.tanh((a - .8) / .18));
    });
    master.connect(comp).connect(limiter).connect(ctx.destination);
    output = limiter;

    verb = plate(ctx);
    const vg = ctx.createGain(); vg.gain.value = 0.3;
    verb.connect(vg).connect(master);
    sfxG = ctx.createGain(); sfxG.gain.value = 1;
    sfxG.connect(master); sfxG.connect(verb);
    // Separate short facade reflection; the general 2.2 s plate swamps quick passes.
    passVerb = plate(ctx, .75);
    const passWet = ctx.createGain(); passWet.gain.value = .32;
    const passDelay = ctx.createDelay(.1); passDelay.delayTime.value = .028;
    passVerb.connect(passDelay).connect(passWet).connect(master);

    // Fixed, narrow stereo bed. Independent amplitude LFOs made the apparent
    // source jump between speakers; the base flow now keeps a stable centre.
    windG = ctx.createGain(); windG.gain.value = 0;
    windG.connect(master);
    for (const [i, side] of [-1, 1].entries()) {
      const source = ctx.createBufferSource(); source.buffer = airNoise(ctx); source.loop = true;
      source.playbackRate.value = .91 + i * .17;
      const highpass = ctx.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 95;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1700;
      const gust = ctx.createGain(); gust.gain.value = .78;
      const pan = ctx.createStereoPanner(); pan.pan.value = side * .22;
      source.connect(highpass).connect(filter).connect(gust).connect(pan).connect(windG); source.start(0, i * 1.17);
      windVoices.push({ source, filter, highpass, side });
    }
    // A lighter, wide high-frequency layer appears gradually at high speed.
    const airBuffer = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = airBuffer.getChannelData(channel); for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * .45;
    }
    const air = ctx.createBufferSource(); air.buffer = airBuffer; air.loop = true;
    airF = ctx.createBiquadFilter(); airF.type = 'bandpass'; airF.frequency.value = 2400; airF.Q.value = .55;
    airG = ctx.createGain(); airG.gain.value = 0;
    air.connect(airF).connect(airG).connect(master); air.start();

    // тяга: низкий рокот
    const rum = ctx.createBufferSource(); rum.buffer = nb; rum.loop = true;
    rumbleF = ctx.createBiquadFilter(); rumbleF.type = 'lowpass'; rumbleF.frequency.value = 160;
    rumbleG = ctx.createGain(); rumbleG.gain.value = 0;
    rum.connect(rumbleF).connect(rumbleG).connect(master);
    rum.start();

    // Centred turbulent pressure, gated by the straightening cue. No stereo LFO.
    boostSource = ctx.createBufferSource(); boostSource.buffer = airNoise(ctx); boostSource.loop = true;
    const boostHighpass = ctx.createBiquadFilter(); boostHighpass.type = 'highpass'; boostHighpass.frequency.value = 55;
    boostF = ctx.createBiquadFilter(); boostF.type = 'lowpass'; boostF.frequency.value = 1300; boostF.Q.value = .6;
    boostG = ctx.createGain(); boostG.gain.value = 0;
    boostSource.connect(boostHighpass).connect(boostF).connect(boostG).connect(master); boostSource.start();

    // гул высоты: две расстроенные пилы — «тишина космоса» с лёгким звоном
    humG = ctx.createGain(); humG.gain.value = 0;
    humG.connect(verb); humG.connect(master);
    for (const f of [110, 164.8]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.16;
      o.connect(g).connect(humG); o.start();
    }
  };

  A.setVolume = (v) => { A.vol = v; if (master) master.gain.value = A.on ? v : 0; };
  A.mute = (m) => { A.on = !m; if (master) master.gain.value = m ? 0 : A.vol; };

  // непрерывные слои раз в кадр
  A.update = (speed, rho, alt, thrust, grounded, { boost = false } = {}) => {
    if (!A.ctx) return;
    const now = A.ctx.currentTime, at = (p, v) => p.setTargetAtTime(v, now, 0.12);
    const airDensity = Math.min(1, Math.max(0, rho * 1.4));
    const k = Math.min(1, Math.max(0, speed) / 1400), flow = Math.pow(k, .65) * airDensity;
    const high = Math.min(1, Math.max(0, (speed * 3.6 - 1600) / 3400));
    const duck = now < passUntil ? .25 : 1, moving = grounded ? Math.min(.18, speed / 100) : 1;
    at(windG.gain, moving * (.015 * airDensity + flow * .9) * duck);
    at(airG.gain, moving * high * airDensity * .16 * duck);
    at(airF.frequency, 2000 + high * 3300);
    for (const voice of windVoices) {
      at(voice.filter.frequency, 750 + k * 6100);
      at(voice.highpass.frequency, 85 + k * 150);
      at(voice.source.playbackRate, .8 + k * .65 + voice.side * .07);
    }
    at(rumbleG.gain, thrust && !grounded ? airDensity * (.035 + flow * .24) : 0);
    at(rumbleF.frequency, 65 + k * 115);
    at(boostG.gain, boost && thrust && !grounded ? airDensity * (.42 + k * .7) * duck : 0);
    at(boostF.frequency, 1100 + k * 2900);
    at(boostSource.playbackRate, .7 + k * .45);
    at(humG.gain, alt > 30_000 ? Math.min(0.14, (alt - 30_000) / 500_000 + 0.03) : 0);
  };

  // --- разовые звуки ---
  const env = (g, t0, a, d, peak) => {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  };
  const noiseHit = (t0, dur, f0, f1, peak, type = 'lowpass') => {
    const ctx = A.ctx;
    const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = 1.1;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    const g = ctx.createGain();
    env(g, t0, dur * 0.12, dur * 0.9, peak);
    s.connect(f).connect(g).connect(sfxG);
    s.start(t0); s.stop(t0 + dur + 0.1);
    s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
  };
  const tone = (t0, f0, f1, dur, peak, type = 'sine') => {
    const ctx = A.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain(); env(g, t0, dur * 0.08, dur * 0.95, peak);
    o.connect(g).connect(sfxG);
    o.start(t0); o.stop(t0 + dur + 0.05);
  };

  A.play = (name, k = 1, rate = 1) => {
    if (!A.ctx || !A.on) return;
    const t0 = A.ctx.currentTime + 0.01;
    if (sampleFiles[name]) {
      const buffer = buffers.get(sampleFiles[name]);
      if (!buffer) {
        if (name.startsWith('cloth-')) return;
        noiseHit(t0, name.startsWith('footstep-') ? .1 : name === 'jump' ? .2 : .55, 550, 140, .12 * k); return;
      }
      const source = A.ctx.createBufferSource(), gain = A.ctx.createGain();
      source.buffer = buffer; gain.gain.value = Math.min(1.2, Math.max(0, k));
      source.playbackRate.value = Math.min(2, Math.max(.5, rate));
      source.connect(gain).connect(master); // Keep these short impulses out of the long plate reverb.
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(t0);
      return { stop() { const now = A.ctx.currentTime; gain.gain.setTargetAtTime(0, now, .03); source.stop(now + .15); } };
    }
    if (name === 'charge') tone(t0, 90, 300, 1.1, 0.12, 'triangle');
    if (name === 'boom') {                       // хлопок: удар + раскат
      noiseHit(t0, 0.18, 7000, 300, 1.0 * k, 'lowpass');
      noiseHit(t0 + 0.04, 1.6, 400, 45, 0.55 * k, 'lowpass');
      tone(t0, 160, 28, 0.9, 0.5 * k, 'sine');
    }
    if (name === 'step') noiseHit(t0, 0.12, 700, 120, 0.18 * k);
    if (name === 'thunder') {
      noiseHit(t0, 1.4, 1300, 160, .7 * k);
      noiseHit(t0 + .3, 3.2, 380, 55, .85 * k);
      noiseHit(t0 + 1.1, 2.5, 220, 45, .45 * k);
    }
    if (name === 'land') { noiseHit(t0, 0.35, 900, 70, 0.5 * k); tone(t0, 90, 35, 0.35, 0.4 * k); }
    if (name === 'slam') {
      noiseHit(t0, .22, 1800, 110, .6 * k); tone(t0, 75, 24, .65, .5 * k);
      noiseHit(t0 + .09, 1.1, 500, 60, .32 * k);
    }
    if (name === 'orbit') { tone(t0, 330, 660, 0.9, 0.16, 'sine'); tone(t0 + 0.12, 495, 990, 0.8, 0.1, 'sine'); }
  };
  A.followFlight = visual => {
    const active = visual?.state === 'booststart';
    if (active && (!lastVisual || lastVisual.state !== 'booststart' || visual.time < lastVisual.time)) {
      chargeVoice?.stop(); chargeVoice = A.play('boost-charge', .7); released = false;
    }
    if (active && !released && visual.time / Math.max(.01, visual.duration) >= BOOST_RELEASE_PHASE) {
      chargeVoice?.stop(); chargeVoice = null; A.play('boost-release', .8); released = true;
    }
    if (!active && chargeVoice) { chargeVoice.stop(); chargeVoice = null; }
    lastVisual = visual ? { ...visual } : null;
  };
  A.followMovement = (visual, grounded, speed) => {
    const state = visual?.state;
    if (!A.ctx || !grounded || speed < .3 || !['walk', 'run'].includes(state)) { gait = null; return; }
    // Two contacts per animation loop; dropped frames never queue a burst of steps.
    const phase = Math.floor(visual.time / Math.max(.1, visual.duration) * 2);
    const changed = gait && gait.state === state && visual.time >= gait.time && phase !== gait.phase;
    gait = { state, phase, time: visual.time };
    if (!changed || A.ctx.currentTime - lastStep < .12) return;
    lastStep = A.ctx.currentTime;
    const index = [0, 2, 1, 3][stepIndex++ % 4], run = state === 'run';
    const power = run ? .65 + Math.min(.35, speed / 45 * .35) : .42;
    A.play(`footstep-${index}`, power, run ? 1.03 + (index % 2) * .035 : .96 + index * .02);
    A.play(`cloth-${index}`, run ? .3 : .12, run ? 1.15 : 1);
  };
  // Air rushing past one ear, followed by a short diffuse facade reflection.
  A.passBy = ({ strength, speed, distance, pan }) => {
    if (!A.ctx || !A.on || strength <= 0) return;
    const ctx = A.ctx, now = ctx.currentTime + .005;
    const duration = Math.min(.85, Math.max(.55, (22 + distance) / Math.max(35, speed) + .52));
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
    const gain = ctx.createGain(), stereo = ctx.createStereoPanner(), highpass = ctx.createBiquadFilter();
    source.buffer = nb; source.loop = true; source.playbackRate.setValueAtTime(1.2, now);
    source.playbackRate.exponentialRampToValueAtTime(.9, now + duration);
    highpass.type = 'highpass'; highpass.frequency.value = 750; highpass.Q.value = .5;
    filter.type = 'bandpass'; filter.Q.value = 1.15;
    filter.frequency.setValueAtTime(3100 + Math.min(1200, speed), now);
    filter.frequency.exponentialRampToValueAtTime(1900, now + duration * .5);
    filter.frequency.exponentialRampToValueAtTime(950, now + duration);
    stereo.pan.setValueAtTime(pan * .65, now); stereo.pan.linearRampToValueAtTime(pan, now + duration * .3);
    // A rounded envelope, with no transient at contact: this must whistle, not knock.
    const envelope = Float32Array.from({ length: 65 }, (_, i) => Math.sin(i / 64 * Math.PI) ** 2 * strength * 2.2);
    gain.gain.setValueCurveAtTime(envelope, now, duration);
    const whistle = ctx.createOscillator(), whistleGain = ctx.createGain();
    whistle.type = 'sine'; whistle.frequency.setValueAtTime(1850, now);
    whistle.frequency.exponentialRampToValueAtTime(850, now + duration);
    whistleGain.gain.setValueCurveAtTime(Float32Array.from(envelope, v => v * .018), now, duration);
    whistle.connect(whistleGain).connect(stereo); whistle.start(now); whistle.stop(now + duration + .02);
    whistle.onended = () => { whistle.disconnect(); whistleGain.disconnect(); };
    passUntil = now + duration;
    windG.gain.setTargetAtTime(windG.gain.value * .25, now, .02);
    airG.gain.setTargetAtTime(airG.gain.value * .25, now, .02);
    source.connect(highpass).connect(filter).connect(gain).connect(stereo).connect(master);
    stereo.connect(passVerb);
    source.onended = () => { source.disconnect(); highpass.disconnect(); filter.disconnect(); gain.disconnect(); stereo.disconnect(); };
    source.start(now); source.stop(now + duration + .02);
  };
  A.capture = () => {
    A.start();
    const destination = A.ctx.createMediaStreamDestination();
    output.connect(destination);
    return { stream: destination.stream, dispose() { output.disconnect(destination); destination.stream.getTracks().forEach(t => t.stop()); } };
  };
  return A;
}
