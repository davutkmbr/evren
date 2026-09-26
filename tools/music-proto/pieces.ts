// The three prototype pieces, written as makam-degree scores (see score.ts for the notation).
// All melodies are original taksim phrases built on the classical seyir rules of each makam; no quotations.
import { MAKAMS } from './makam.ts';
import type { PieceDef } from './mix.ts';

// ---------------------------------------------------------------------------------------------------------------
// 1. Kanun taksim in Hicaz — dusk over Sarayburnu. Dügâh = A3 (220 Hz).
// ---------------------------------------------------------------------------------------------------------------
const hicazScore = `
@kanun +0.35
# I. Opening on the güçlü Nevâ (octave tremolo), first glimpse of the Hicaz tetrachord, rest on Dügâh
neva:2.4:tr+8  huseyni:.26  neva:.24  nimHicaz:.3:c  neva:1.1
nimHicaz:.34  dikKurdi:.3  nimHicaz:.28  dikKurdi:.3  dugah:2.1:8
_:1.1
# II. Below the durak: the yeden Rast, the augmented second Dik Kürdî – Nîm Hicaz bent up from Çârgâh
rast:.5:gu=3  dugah:.34  dikKurdi:.36  nimHicaz:1.3:b=cargah  dikKurdi:.3  dugah:.3  rast:.7  dugah:1.9:tr
_:1.0
# III. Low register: Yegâh with the right hand's upper octave, climbing back to the durak
yegah:1.1:8u  rast:.36  dugah:.34  dikKurdi:.4  dugah:.3  rast:.34  yegah:.5  rast:.4  dugah:1.8:tr
_:1.0
# IV. Rising: Hicaz run to Nevâ, Rast pentachord on Nevâ (Hüseynî, Eviç) up to Gerdaniye, back to Nevâ
dugah:.2  dikKurdi:.2  nimHicaz:.22  neva:1.3:tr+8  huseyni:.34  evic:.36  gerdaniye:1.9:tr  evic:.3  huseyni:.3  neva:1.3:m
_:0.9
# V. Quick ascending run to the climax on Muhayyer, descent with Acem (descending form of the makam)
dugah:.1 dikKurdi:.1 nimHicaz:.1 neva:.1 huseyni:.11 evic:.12 gerdaniye:.14  muhayyer:2.6:tr+8  gerdaniye:.3  acem:.34  huseyni:.3  neva:1.0
acem:.26  huseyni:.26  neva:.26  nimHicaz:.3  dikKurdi:.32  nimHicaz:.36  neva:1.8:tr
_:1.1
# VI. Cascade from Gerdaniye, asma kalış on Nevâ, cadence Nevâ – Nîm Hicaz – Dik Kürdî – Dügâh, Rast – Dügâh
gerdaniye:.9:gd=6  huseyni:.32  neva:1.0:tr  nimHicaz:.4  dikKurdi:.36  dugah:.9
rast:.42  dugah:.36  dikKurdi:.4  nimHicaz:1.4:tr  dikKurdi:.42  dugah:.42  rast:.65  dugah:4.2:tr+8
`;

export const hicaz: PieceDef = {
  id: 'hicaz-kanun',
  title: 'Hicaz kanun taksim (Sarayburnu, dusk)',
  makam: MAKAMS.hicaz,
  seed: 11,
  score: hicazScore,
  kanun: { dugahHz: 220, pan: -0.05, spread: 0.55, sympathetic: 1, level: 0, send: 0.34 },
  reverb: { t60: 2.5, predelay: 0.022 },
  tail: 6.5,
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Ud taksim in Uşşak with a kanun answer — Galata evening. Ud Dügâh = A2 (110 Hz), kanun an octave higher.
// ---------------------------------------------------------------------------------------------------------------
const ussakScore = `
@ud +0.3
# I. Durak and the Uşşak tetrachord with its low Segâh; slide up to the güçlü Nevâ
dugah:1.7:v  segah:.3:h  cargah:.32  segah:.3:h  dugah:1.3:v
rast:.34  dugah:.3  segah:.34  cargah:.42  neva:1.9:s+v
_:0.9
# II. Around Nevâ, then the characteristic suspension on Segâh, back to the durak
neva:.3  huseyni:.28:h  neva:.3  cargah:.36  segah:1.6:v  cargah:.26:h  segah:.26  dugah:1.4:v
_:1.0
# III. Rising through the Bûselik pentachord on Nevâ to Gerdaniye and Muhayyer
neva:.26  huseyni:.26  acem:.28  gerdaniye:1.7:s+v  acem:.3:h  huseyni:.3  neva:1.3:tr
huseyni:.2  acem:.2  gerdaniye:.22  muhayyer:2.1:v  gerdaniye:.3  acem:.3:h  huseyni:.34  neva:1.5:v
_:0.9
# IV. Low register: the lower octave of the Bûselik pentachord (Acem Aşiran, Hüseynî Aşiran) under the durak
cargah:.3  segah:.3  dugah:.3  rast:.32  acemAsiran:.34  huseyniAsiran:1.3:v  acemAsiran:.3:h  rast:.32  dugah:1.7:tr
_:0.8
# V. Descending sequence from Gerdaniye to the Segâh suspension
gerdaniye:.26 acem:.26 huseyni:.5  acem:.26 huseyni:.26 neva:.5  huseyni:.26 neva:.26 cargah:.5  segah:1.9:v
_:0.5
@kanun -0.3
# VI. The kanun answers an octave higher: Nevâ tremolo, the same descent, suspension on Segâh
neva:1.7:tr+8  cargah:.3  segah:.32  cargah:.3  neva:1.0:c  huseyni:.3  neva:.3  cargah:.34  segah:1.5:tr+b=kurdi
@ud -0.15
# VII. Cadence: yeden Rast – Dügâh, Çârgâh – Segâh – Dügâh
rast:.36  dugah:.3  segah:.36  cargah:1.0:s+v  segah:.34:h  dugah:.3  rast:.62  dugah:3.4:v
@kanun -3.1
dugah:3.0:8+p
`;

export const ussak: PieceDef = {
  id: 'ussak-ud',
  title: 'Uşşak ud taksim with kanun answer (Galata, evening)',
  makam: MAKAMS.ussak,
  seed: 23,
  score: ussakScore,
  ud: { dugahHz: 110, pan: 0.08, level: 0, send: 0.26 },
  kanun: { dugahHz: 220, pan: -0.35, spread: 0.35, sympathetic: 0.8, level: -2.5, send: 0.34 },
  reverb: { t60: 2.2, predelay: 0.018 },
  tail: 6,
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Kanun and ney with a soft bendir pulse in Nihâvend — Bosphorus morning. Rast = G3, ney in the same octave.
// ---------------------------------------------------------------------------------------------------------------
const nihavendScore = `
@kanun +0.35
# I. The kanun opens on the güçlü Nevâ, Kürdî colour above it, and settles on the durak Rast
neva:2.1:tr+8  nimHisar:.3  neva:.28  cargah:.3  neva:1.2:c
acem:.3  nimHisar:.28  neva:.3  cargah:.32  kurdi:.34  dugah:.36  rast:1.9:8
_:0.6
# II. Rising run through the Bûselik pentachord and Kürdî tetrachord to Gerdaniye, back to Nevâ
rast:.12 dugah:.12 kurdi:.12 cargah:.12 neva:.14 nimHisar:.14 acem:.16 gerdaniye:1.7:tr+8  acem:.3  nimHisar:.3  neva:1.5:tr
_:0.3
@ney +0.2 id=ney1
# III. The ney enters low on Rast and rises through the Bûselik pentachord to Nevâ
rast:1.5  dugah:.5  kurdi:.6  cargah:.7  neva:2.5:v
_:0.2
@kanun -0.5
neva:.9:tr  cargah:.3  kurdi:.3  dugah:.3  cargah:1.3:m
@ney +0.1
# IV. Kürdî tetrachord on Nevâ up to Gerdaniye, suspension on Nevâ, then on Çârgâh
neva:.6  nimHisar:.5  acem:.6  gerdaniye:2.3:v  acem:.5  nimHisar:.55  neva:1.9:v
cargah:.5:c  neva:.5  acem:.8:s  nimHisar:.5  neva:.6  cargah:2.1:v
_:0.3
@kanun -0.7
neva:.6:gu=4  acem:.3  gerdaniye:1.0:tr+8  acem:.3  nimHisar:.3  neva:1.5:tr
@ney +0.2
# V. Climax: Hicaz colour on Nevâ (Hisar, Eviç) up to Muhayyer and Tiz Kürdî, descent to Nevâ
neva:.5  hisar:.55  evic:.6  gerdaniye:1.4:v  muhayyer:.6  kurdi':2.3:v  muhayyer:.5  gerdaniye:.6  acem:.6  nimHisar:.6  neva:2.3:v
@kanun -0.5
# VI. The kanun leads down through the Bûselik pentachord towards the durak
neva:.8:tr  cargah:.3  kurdi:.32  dugah:.34  kurdi:.3  dugah:.3  rast:1.1:8
@ney +0.1 id=neyEnd
# VII. Cadence on Rast in the ney's low, breathy register, Acem Aşiran as the yeden
cargah:.8  kurdi:.6  dugah:.7  rast:.6  acemAsiran:.6  rast:3.8:v
@kanun -3.6
rast:3.3:tr+8+p
@bendir from=ney1+0.1 to=neyEnd.end-2.5 bpm=50
`;

export const nihavend: PieceDef = {
  id: 'nihavend-kanun-ney',
  title: 'Nihâvend kanun and ney with bendir (Bosphorus, morning)',
  makam: MAKAMS.nihavend,
  seed: 37,
  score: nihavendScore,
  kanun: { dugahHz: 220, pan: -0.28, spread: 0.45, sympathetic: 0.9, level: -1.5, send: 0.3 },
  ney: { dugahHz: 220, pan: 0.25, breath: 1, level: 0, send: 0.4 },
  bendir: { pan: 0.05, f1: 62, level: -16, send: 0.5 },
  reverb: { t60: 2.6, predelay: 0.024 },
  tail: 6.5,
};

export const PIECES: PieceDef[] = [hicaz, ussak, nihavend];
