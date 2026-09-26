# Music prototype: synthesised taksim beds for "Anlar"

This folder holds three short Turkish classical pieces in taksim style. Everything is synthesised in pure TypeScript:
there are no samples, no external audio assets and no native dependencies. This is a prototype for deciding whether
self-made music can be good enough. It is not wired into the game.

```sh
npx tsx tools/music-proto/render.ts            # render all pieces to .shots/music/ (full + loop variants) and print the analysis
npx tsx tools/music-proto/render.ts hicaz      # render only one piece
npx tsx tools/music-proto/render.ts --stems    # also write the balanced dry stems to .shots/music/stems/
npx tsx tools/music-proto/render.ts --test     # instrument checks: pitch accuracy of the makam intervals, decay times
npx tsx tools/music-proto/spectrogram.ts .shots/music/hicaz-kanun.wav 0 12 8000   # spectrogram + envelope PNG
```

Output is 48 kHz, 24-bit stereo WAV. Each piece is normalised to −20 LUFS integrated (ITU-R BS.1770-4, measured by
`analysis.ts`). The `-loop` variant has no fades: the reverb and string tails that run past the loop point are wrapped
back onto the start, so the loop seam is continuous.

## Files

| File | Role |
| --- | --- |
| `makam.ts` | The AEU 53-comma pitch table (perde names → commas, kanun course), the 72-EDO kanun mandal quantisation, and the makam definitions (scale, durak, güçlü, yeden, seyir, performance-practice pitch overrides) |
| `score.ts` | The score notation and the "performer": rubato, phrase dynamics, and the dynamic arc of each block |
| `pieces.ts` | The three scores (one phrase per line, commented with the seyir step each phrase covers) and their mix settings |
| `strings.ts` | Digital-waveguide plucked string and the plectrum excitation |
| `kanun.ts`, `ud.ts`, `ney.ts`, `bendir.ts` | The instruments |
| `body.ts` | Modal body impulse responses and the synthetic room impulse response |
| `mix.ts` | Places the blocks on a timeline, balances the stems by loudness, adds the room reverb, then masters: high-pass, loudness, soft limiter, fades and the loop variant |
| `analysis.ts` | LUFS, true peak, RMS, DC, clipping, spectral centroid, stereo correlation, FFT pitch estimate, T60 estimate |
| `dsp.ts`, `wav.ts`, `spectrogram.ts` | FFT and FFT convolution, biquads, RNG, WAV I/O, and the PNG spectrograms |

## Tuning

Pitches follow Arel–Ezgi–Uzdilek: an octave has 53 Holdrian commas of 22.64 cents each. Every perde is stored as its
comma offset above Rast, for example Dügâh 9, Dik Kürdî 14, Segâh 17, Çârgâh 22, Nîm Hicaz 26, Nevâ 31, Nîm Hisar 35,
Hisar 36, Hüseynî 40, Acem 44 and Eviç 48. `neva'` is one octave up and `neva,` one octave down, and the classical names
(Yegâh, Hüseynî Aşiran, Acem Aşiran, Muhayyer, Tiz Nevâ, …) work as aliases.

- **Hicaz**: the Hicaz tetrachord on Dügâh is 5 + 12 + 5 commas (Dügâh, Dik Kürdî, Nîm Hicaz, Nevâ). The Rast
  pentachord on Nevâ uses Eviç going up and Acem coming down.
- **Uşşak**: the Uşşak tetrachord is 8 + 5 + 9 commas, followed by the Bûselik pentachord on Nevâ. Performers play the
  Uşşak segâh lower than the AEU value, so the makam carries a performance-practice override of −1 comma (7 commas,
  158 cents above Dügâh).
- **Nihâvend**: the Bûselik pentachord on Rast (9 + 4 + 9 + 9) plus the Kürdî tetrachord on Nevâ. The Hicaz tetrachord
  on Nevâ (Hisar, Eviç) appears as a colour in the ney's climax.
- **Kanun**: the kanun's pitches are quantised to the mandal grid of a modern Turkish kanun (six mandals per semitone,
  16.67 cents per step). The quantisation moves a pitch by at most 8 cents from AEU. The ud (fretless) and the ney play
  the AEU values directly. They also add human intonation deviations: the ud a ±2 c random scatter per note, the ney a
  slow ±4 c drift.

`render.ts --test` renders each scale degree in isolation and measures its pitch with a 16×-zero-padded FFT and
parabolic peak interpolation. The kanun and the ud land within 0.5 cents of their targets, and the ney within 5 cents
(its drift is intentional).

## Synthesis

**Kanun.** Each course has 3 strings, and each string is an extended Karplus–Strong / digital waveguide:

- The delay line is read with a time-varying 4-point Lagrange fractional delay, which allows bends and vibrato.
- A one-pole loss filter is solved per string so that the fundamental decays with T60(f0) (about 6 s at 90 Hz down to
  1.2 s at 1.4 kHz) and 3.5 kHz decays within 0.3–0.5 s. This models nylon strings on a fish-skin bridge.
- Two all-pass sections add stiffness dispersion, and their phase delay is compensated so the string stays in tune.
- The 3 strings of a course are detuned by 0.5–1.8 cents, which makes them beat.
- The mızrap excitation is a raised-cosine contact pulse whose width depends on velocity, followed by a pluck-position
  comb (β ≈ 0.10–0.15), a −6 dB/oct tilt and a short high-passed click. The plectrum crosses the 3 strings with a
  0.4–1.2 ms stagger.

Kanun idioms:

- Octave doubling with both hands.
- Tremolo at 12–14 strokes/s that alternates hands (an octave tremolo with `tr+8`) and swells, then relaxes.
- Glissando sweeps across the neighbouring courses at their current mandal settings.
- Çarpma and mordent graces.
- Mandal changes: the old pitch is damped and the course retuned just before the stroke.
- Mandal/fingernail bends (`b=`): the pitch glides while the string rings.

The undamped courses ring in sympathy: a Karplus–Strong resonator bank tuned to the makam's mandal setting is fed by
the bridge signal and adds about +0.6 LU. The body is a modal impulse response built from an air/rosette mode near
170 Hz, spruce top modes from 250 to 700 Hz, and around 90 random modes with bright, fast-decaying "skin" formants near
1.1 and 2.7 kHz, mixed with a 50 % direct path. The left and right channels share 80 % of the body response.

**Ud.** Each course has two waveguide strings, with stronger flesh damping and darker highs than the kanun (T60 about
3.4 s down to 0.8 s). The risha excitation is a wider pulse than the mızrap, with a darker tilt and alternating
down/up strokes. The ud techniques are modelled like this:

- Slides (`s`) glide the delay length on the same ringing string. Only a whisper of new energy is added.
- Hammer-ons and pull-offs (`h`) jump the pitch and add a soft excitation.
- Vibrato (`v`) is 9–16 c at 4.9–5.7 Hz and fades in after the attack.
- Risha tremolo runs at 13–15 strokes/s.
- Çarpma strikes the neighbouring note and then hammers or pulls to the main note.
- Lifting the finger damps the previous note.

The body is a modal impulse response built from a strong Helmholtz mode of the bowl at 104 Hz, low top modes, and highs
rolled off above about 900 Hz.

**Ney.** The ney is a hybrid additive and noise model:

- The tone has 9 harmonics with slow per-harmonic amplitude jitter. Brightness depends on dynamics and register.
- Tube-filtered breath noise passes white noise through 4th-order time-varying band-passes at the first three
  harmonics.
- Broadband air hiss leads the tone at each phrase onset and is stronger in the low register.
- Phrases are breath arcs with a slow attack of 160–260 ms, a scoop from below at the start, legato portamento of
  50–80 ms between notes, a small breath dip on repeated notes (the ney is not tongued), a messa di voce swell on long
  notes, and a delayed breath vibrato with both pitch and amplitude modulation.

**Bendir.** The membrane uses the circular-membrane mode ratios, with a pitch drop on strong strokes. The düm stroke
weights the centre modes and the tek/ka strokes weight the edge modes. The snare buzz is noise gated by the membrane's
motion. The instrument plays a slow, soft cycle like Sofyan (düm – tek ka) at 50 bpm that fades in and out.

**Room and master.** The reverb impulse response is synthetic:

- 14 early-reflection taps.
- A diffuse tail made from band-limited noise with its own T60 in each octave band (2.2–2.6 s at mid frequencies, and
  about 0.4 × that at 8 kHz).
- Left and right are decorrelated, with a 35 ms build-up.

The stems are balanced by their measured loudness before they are mixed. The master chain is:

1. High-pass at 32 Hz (4th order), which also removes DC.
2. A gentle high shelf at 9 kHz.
3. Normalisation to −20 LUFS.
4. A soft limiter above −3 dBFS. None of the current renders reaches it.
5. Fades.

## The pieces (seyir)

All melodies are original phrases built on the classical seyir rules. Nothing is quoted.

1. **`hicaz-kanun`, Hicaz kanun taksim (Sarayburnu, dusk).** Dügâh = A3. The piece:
   - Opens on the güçlü Nevâ with an octave tremolo, shows the Hicaz tetrachord and rests on Dügâh.
   - Explores below the durak with the yeden Rast and a Nîm Hicaz bent up from Çârgâh, then the low Yegâh register.
   - Rises through the Rast pentachord on Nevâ (Hüseynî, Eviç) to Gerdaniye, and runs up to the climax on Muhayyer.
   - Comes back down with Acem, the descending form, in a cascade from Gerdaniye.
   - Makes an asma kalış on Nevâ and cadences Nevâ – Nîm Hicaz – Dik Kürdî – Dügâh, Rast – Dügâh, ending with a long
     octave tremolo on Dügâh.
2. **`ussak-ud`, Uşşak ud taksim with a kanun answer (Galata, evening).** Ud Dügâh = A2, with the kanun an octave
   higher. The piece:
   - Starts on the durak and shows the Uşşak tetrachord with its low Segâh, then slides up to Nevâ.
   - Suspends on Segâh.
   - Rises through the Bûselik pentachord on Nevâ to Gerdaniye and Muhayyer.
   - Visits the low register (Acem Aşiran, Hüseynî Aşiran).
   - Descends in a sequence to the Segâh suspension. The kanun answers with a Nevâ tremolo and a Segâh bent up from
     Kürdî.
   - Ends on the ud cadence Rast – Dügâh, Çârgâh – Segâh – Dügâh, with a soft kanun octave on the final Dügâh.
3. **`nihavend-kanun-ney`, Nihâvend kanun and ney with bendir (Bosphorus, morning).** Rast = G3. The piece:
   - Opens with a free kanun taksim around Nevâ with Kürdî colour, settles on Rast, then runs up to Gerdaniye.
   - Brings in the ney low on Rast, rising to Nevâ, and the bendir pulse starts.
   - Alternates ney and kanun phrases (karşılıklı) through the Kürdî tetrachord on Nevâ, with suspensions on Nevâ and
     Çârgâh.
   - Builds the ney climax with Hicaz colour (Hisar, Eviç) up to Tiz Kürdî.
   - Lets the kanun lead down through the Bûselik pentachord.
   - Ends with the ney's cadence on Rast in its breathy low register, with Acem Aşiran as the yeden, over a kanun
     octave tremolo.

## Known weaknesses

- The strings have a single polarisation and no two-stage decay. Courses do not couple to each other except through the
  one-way sympathetic bank. The body modes are generic, not measured from a real kanun or ud. As a result, the kanun
  can drift towards a "harp/koto" colour and the ud towards a nylon-string lute.
- The ud lacks the strong low "boom" and the slight string buzz of a real ud. Its slides are ideal glides of the delay
  length.
- The ney is the most synthetic of the instruments. It models neither the real jet–tube interaction nor the
  register-dependent spectral changes, and it has no audible inhalation. It may read as a breathy synth flute.
- Mandal flips make no mechanical click. Real kanun recordings have them, and they would add realism.
- The phrasing is composed, not improvised by a master. The rubato is algorithmic, and the dynamics follow simple
  arches.
