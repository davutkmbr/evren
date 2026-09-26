// Review capture of a chain burst (phase 20 perceived speed), evaluated in the page by scripts/snap.mjs (see
// tools/review/burst-shots.json): low over the Bosphorus at race speed, it lands chain link 3 and grabs the canvas at
// fixed sim times through the burst. Returns { frames: [{ t, fov, speed, burst, image }] } (PNG data URLs).
(async () => {
  const params = new URLSearchParams(location.search);
  const ft = window.__flightTest;
  const ev = window.__evren;
  const dragon = ev.ctx.services.get('dragon');
  dragon.setRacing?.(params.get('racing') !== '0');
  const s0 = ft.view('bogaz', 58);
  ft.teleport(s0.x, 7.5, s0.z, s0.headingDeg, 0, 58);
  ft.setStamina(1);
  ft.options({ turbulence: false, wind: false });
  ft.snapCamera();
  const sim = ft.sim;
  const flow = params.has('flow') ? Number(params.get('flow')) : 0.95;
  const hold = () => {
    sim.flow.setValue(flow);
    sim.stamina = 1;
  };
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const canvas = ev.ctx.renderer.domElement;
  // Level flight on the path hold for a few frames so the camera settles.
  const t0 = sim.time;
  while (sim.time - t0 < 1.2) {
    hold();
    sim.overrides.pathTarget = 0;
    sim.overrides.bankTarget = 0;
    await frame();
  }
  const out = [];
  const grab = (label) => {
    out.push({ label, t: +(sim.time - tBurst).toFixed(2), fov: +ev.ctx.camera.fov.toFixed(2), speed: +sim.airspeed.toFixed(1), burst: +(sim.flow.burst.rate / 2).toFixed(2), image: canvas.toDataURL('image/png') });
  };
  let tBurst = sim.time;
  await frame();
  grab('before');
  ft.chainLink(3);
  tBurst = sim.time;
  const marks = [0.25, 0.5, 0.75, 1.0, 1.5, 2.2];
  let i = 0;
  while (i < marks.length && sim.time - tBurst < 3) {
    hold();
    sim.overrides.pathTarget = 0;
    sim.overrides.bankTarget = 0;
    await frame();
    if (sim.time - tBurst >= marks[i]) {
      grab(`+${marks[i]} s`);
      i++;
    }
  }
  return { frames: out };
})()
