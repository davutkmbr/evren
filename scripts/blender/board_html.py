"""
The S1 review page (.shots/s1/board/index.html), written by board.py: per camera the reference photo next to the
final render (day / dusk / night tabs), the critic's score and note, and at the top the overall realism score and the
checklist status. UI text is Turkish (the user reads it); images are referenced relatively, so the page works from
the dev server (http://127.0.0.1:5199/.shots/s1/board/index.html) and from the file system.

Inputs: the render sidecars (render.py), cameras.json, the photo credits (reference/sources.json), <out>/critique.json
(the critic's review, translated) and <out>/previous/<camera>-<time>.jpg (the renders the critic judged).
"""

import datetime as dt
import html
import json
import os

TIME_LABEL = {'day': 'Gündüz', 'dusk': 'Alacakaranlık', 'night': 'Gece'}
TIME_ORDER = {'day': 0, 'dusk': 1, 'night': 2}
STATUS = {'pass': ('geçti', 'ok'), 'partly': ('kısmen', 'mid'), 'fail': ('kaldı', 'bad')}
CAMERA_TITLES = {
    'c01-pier-1926': '1926 iskelesi, güneydoğu verevinden',
    'c02-pier-square': 'İskele meydanı',
    'c03-new-pier': 'Rıhtımdan yeni iskeleye',
    'c04-haldun-taner': 'Meydandan Haldun Taner Sahnesi',
    'c05-rihtim-tram': 'Rıhtım Cd, İskele Camii T3 durağı',
    'c06-yasa-west-above': 'Yasa Cd batı yarısı, üst kattan (~7 m)',
    'c07-junction-above': 'Yasa × Mühürdar kavşağı ve Aya Efimia, üst kattan (~19 m)',
    'c08-aya-efimia-gate': 'Kavşak meydanı, Aya Efimia kapısı',
    'c09-fountain-wall': 'Avlu duvarı, ahşap kapı ve Sürmeli Ali Paşa Çeşmesi',
    'c10-guneslibahce': 'Güneşlibahçe Sk, balık pazarı kavşağı',
    'c11-yasa-entrance-night': 'Yasa Cd girişi, Tavus Sk köşesi',
    'cafe': 'Lodos Kahvesi, sokaktan açık kapıya',
    'cafe-in': 'Lodos Kahvesi, içeriden',
}


def esc(s):
    return html.escape(str(s if s is not None else ''), quote=True)


def num(x, digits=1):
    if x is None:
        return '–'
    s = f'{x:.{digits}f}'.rstrip('0').rstrip('.') if digits else str(round(x))
    return s.replace('.', ',')


def score_class(score):
    if score is None:
        return 'na'
    return 'bad' if score < 3 else ('mid' if score < 5 else 'ok')


def rel(path_from_root, root, out_dir):
    return os.path.relpath(os.path.join(root, path_from_root), out_dir).replace(os.sep, '/')


def photo_credit(sources, photo_rel):
    name = os.path.basename(photo_rel or '')
    for s in sources or []:
        if s.get('file') == name:
            return s
    return None


def render_caption(meta):
    ex = meta.get('exposure') or {}
    pr = meta.get('preset') or {}
    wb = pr.get('whiteBalance') or {}
    parts = []
    if ex.get('mode') == 'interior':
        parts.append(f"sabit EV {num(ex.get('ev100'))}")
    else:
        parts.append(f"otomatik pozlama {num(ex.get('final'), 2)}")
    if wb.get('kelvin'):
        parts.append(f"beyaz ayarı {int(wb['kelvin'])} K")
    w, h = meta.get('resolution') or (0, 0)
    parts.append(f'{w}×{h}')
    parts.append(f"{meta.get('samples')} örnek")
    parts.append(f"{num(meta.get('seconds'))} sn")
    return ' · '.join(parts)


def pose_notes(meta, cam):
    notes = []
    po = meta.get('poseOverride')
    if po:
        notes.append('Kamera konumu bu turda düzeltildi (scripts/blender/camera-overrides.json)' if not meta.get('interior') else 'Sokak görünümü 1,5 m geriye, şemsiyenin altından çıkarıldı')
    if meta.get('clipStart', 0.1) > 0.1:
        notes.append(f"kamera geometrinin içinde, yakın kırpma {num(meta['clipStart'], 2)} m")
    if (cam or {}).get('poseConfidence') in ('low', 'medium'):
        notes.append('poz güveni ' + {'low': 'düşük', 'medium': 'orta'}[cam['poseConfidence']])
    if not meta.get('referenceSameTime') and meta.get('referencePhoto'):
        notes.append('fotoğraf başka bir günün saatinden')
    if meta.get('dayOn'):
        notes.append('tezgâh ampulleri gündüz de yanıyor')
    return notes


def write(out_dir, root, metas, cams, sources):
    crit = {}
    try:
        with open(os.path.join(out_dir, 'critique.json'), 'r', encoding='utf-8') as f:
            crit = json.load(f)
    except (OSError, ValueError):
        pass
    per = {(c['camera'], c['time']): c for c in crit.get('perCamera', [])}
    groups = {}
    for m in metas:
        groups.setdefault(m['camera'], []).append(m)
    order = [c for c in cams if c in groups] + sorted(c for c in groups if c not in cams)
    counts = {'pass': 0, 'partly': 0, 'fail': 0}
    for it in crit.get('checklist', []):
        counts[it.get('status')] = counts.get(it.get('status'), 0) + 1
    hashes = sorted({m.get('indexHash') for m in metas if m.get('indexHash')})
    total_s = sum((m.get('seconds') or 0) for m in metas)
    newest = max((os.path.getmtime(os.path.join(root, m['file'])) for m in metas if os.path.exists(os.path.join(root, m['file']))), default=None)
    when = dt.datetime.fromtimestamp(newest).strftime('%d.%m.%Y %H:%M') if newest else '–'

    out = []
    w = out.append
    w('<!doctype html><html lang="tr"><head><meta charset="utf-8">')
    w('<meta name="viewport" content="width=device-width, initial-scale=1">')
    w('<title>S1 render panosu</title>')
    w(f'<style>{CSS}</style></head><body>')
    w('<header class="top"><div class="wrap">')
    w('<p class="eyebrow">Evren · sokak katmanı · S1</p>')
    w('<h1>Kadıköy şeridi: fotoğraf ve son render</h1>')
    w('<p class="lede">Rıhtım’dan çarşıya ~200 m, 1,6 m göz yüksekliğinde. Her kamerada solda gerçek fotoğraf, sağda Blender Cycles ile alınan son render.</p>')
    real = crit.get('realismScore')
    w('<div class="stats">')
    w(f'<div class="stat"><span class="k">Gerçekçilik puanı</span><span class="v score-{score_class(real)}">{num(real)}<small>/10</small></span><span class="s">önceki tur</span></div>')
    w('<div class="stat"><span class="k">Kontrol listesi</span><span class="v small">'
      f'<b class="pill ok">{counts.get("pass", 0)} geçti</b> <b class="pill mid">{counts.get("partly", 0)} kısmen</b> <b class="pill bad">{counts.get("fail", 0)} kaldı</b></span><span class="s">{len(crit.get("checklist", []))} madde, önceki tur</span></div>')
    w(f'<div class="stat"><span class="k">Son renderlar</span><span class="v">{len(metas)}</span><span class="s">{len(groups)} görünüm · toplam {num(total_s / 60.0)} dk · {esc(when)}</span></div>')
    w(f'<div class="stat"><span class="k">Derleme</span><span class="v mono small">{esc(", ".join(hashes) or "–")}</span><span class="s">public/world/kadikoy</span></div>')
    w('</div>')
    w('<p class="notice"><b>Not:</b> Puanlar ve notlar, eleştirmenin revizyondan <em>önceki</em> renderlara verdiği değerlendirmedir. '
      'Bu sayfadaki renderlar revizyon sonrası son renderlardır; notun neye dair olduğunu görmek için render üstündeki '
      '<span class="kbd">Önceki tur</span> düğmesine basın.</p>')
    w('<nav class="index" aria-label="Kameralar">')
    for cid in order:
        short = cid.split('-')[0] if cid.startswith('c') and cid[1:3].isdigit() else cid
        w(f'<a href="#{esc(cid)}">{esc(short)}</a>')
    w('<a href="#kontrol">Kontrol listesi</a></nav>')
    w('</div></header><main class="wrap">')
    w('<section class="checklist" id="kontrol"><h2>Kontrol listesi <span class="muted">önceki tur</span></h2><ol>')
    for it in crit.get('checklist', []):
        label, cls = STATUS.get(it.get('status'), (it.get('status'), 'na'))
        w(f'<li><details><summary><b class="pill {cls}">{esc(label)}</b><span>{esc(it.get("item"))}</span></summary><p>{esc(it.get("evidence"))}</p></details></li>')
    w('</ol></section>')

    for cid in order:
        cam = cams.get(cid) or {}
        ms = sorted(groups[cid], key=lambda m: TIME_ORDER.get(m['time'], 9))
        title = CAMERA_TITLES.get(cid) or cam.get('label') or cid
        w(f'<article class="cam" id="{esc(cid)}">')
        w(f'<div class="cam-head"><h2><span class="cid">{esc(cid)}</span> {esc(title)}</h2>')
        if len(ms) > 1:
            w(f'<div class="tabs" role="tablist" aria-label="{esc(cid)} günün saati">')
            for k, m in enumerate(ms):
                pid = f"{cid}--{m['time']}"
                c = per.get((cid, m['time'])) or {}
                sc = c.get('score')
                badge = f' <span class="dot score-{score_class(sc)}">{num(sc)}</span>' if sc is not None else ''
                w(f'<button role="tab" id="tab-{esc(pid)}" aria-controls="{esc(pid)}" aria-selected="{"true" if k == 0 else "false"}" tabindex="{0 if k == 0 else -1}">{TIME_LABEL.get(m["time"], m["time"])}{badge}</button>')
            w('</div>')
        w('</div>')
        for k, m in enumerate(ms):
            pid = f"{cid}--{m['time']}"
            t = m['time']
            photos = cam.get('referencePhotos') or {}
            photo = photos.get(t) or (m.get('referencePhoto') if m.get('referenceSameTime') else None) or m.get('referencePhoto')
            render_src = rel(m['file'], root, out_dir)
            prev_name = f"previous/{cid}-{t}.jpg"
            has_prev = os.path.exists(os.path.join(out_dir, prev_name))
            w(f'<section class="panel" id="{esc(pid)}" role="tabpanel" aria-labelledby="tab-{esc(pid)}"{"" if k == 0 else " hidden"}>')
            size = m.get('resolution') or [1600, 900]
            portrait = size[1] > size[0]
            w(f'<div class="pair{" portrait" if portrait else ""}">')
            if photo and os.path.exists(os.path.join(root, photo)):
                src = photo_credit(sources, photo) or {}
                credit = f"{esc(src.get('author', '?'))}, {esc(src.get('licence', '?'))}"
                link = src.get('url')
                cap = f'Referans fotoğraf · {credit}' + (f' · <a href="{esc(link)}" rel="noopener" target="_blank">kaynak</a>' if link else '')
                w(f'<figure class="shot"><a href="{esc(rel(photo, root, out_dir))}" target="_blank"><img src="{esc(rel(photo, root, out_dir))}" alt="{esc(cid)} referans fotoğrafı ({TIME_LABEL.get(t, t).lower()})" loading="lazy"></a><figcaption>{cap}</figcaption></figure>')
            elif has_prev:
                w(f'<figure class="shot"><a href="{esc(prev_name)}" target="_blank"><img src="{esc(prev_name)}" alt="{esc(cid)} önceki tur render" loading="lazy"></a><figcaption>Referans fotoğraf yok (iç mekân görünümü) · solda önceki tur renderı</figcaption></figure>')
            else:
                w('<figure class="shot empty"><div class="ph">Referans fotoğraf yok</div><figcaption>&nbsp;</figcaption></figure>')
            toggle = ''
            if has_prev and photo:
                toggle = f'<button class="swap" type="button" aria-pressed="false" data-final="{esc(render_src)}" data-prev="{esc(prev_name)}">Önceki tur</button>'
            w(f'<figure class="shot render">{toggle}<a href="{esc(render_src)}" target="_blank"><img src="{esc(render_src)}" width="{size[0]}" height="{size[1]}" alt="{esc(cid)} son render ({TIME_LABEL.get(t, t).lower()})" loading="lazy"></a>'
              f'<figcaption><span class="which">Son render</span><span class="det"> · {esc(render_caption(m))}</span></figcaption></figure>')
            w('</div>')
            c = per.get((cid, t))
            notes = pose_notes(m, cam)
            w('<div class="review">')
            if c:
                w(f'<div class="score score-{score_class(c.get("score"))}"><b>{num(c.get("score"))}</b><span>/10</span></div>')
                w(f'<div class="note"><p class="note-k">Eleştirmen · önceki tur</p><p>{esc(c.get("note"))}</p>')
            else:
                w('<div class="score score-na"><b>–</b><span>/10</span></div>')
                w('<div class="note"><p class="note-k">Eleştirmen</p><p>Bu görünüm için not yok.</p>')
            if notes:
                w('<ul class="meta">' + ''.join(f'<li>{esc(n)}</li>' for n in notes) + '</ul>')
            w('</div></div>')
            w('</section>')
        w('</article>')

    others = crit.get('otherLanes') or []
    if others:
        w('<section class="others"><h2>Kahraman şeridinin görünümleri</h2><p class="lede small">Referans fotoğrafı olmayan ek kameralar (scripts/blender/hero/cameras.json), bu turun ışık ve pozlama ayarlarıyla yeniden render edildi. Eleştirilen hali için <span class="kbd">Önceki tur</span>.</p><div class="other-grid">')
        for o in others:
            prev = o.get('previous') or []
            w('<div class="other">')
            for k, p in enumerate(o.get('images', [])):
                if not os.path.exists(os.path.join(root, p)):
                    continue
                src = rel(p, root, out_dir)
                old = prev[k] if k < len(prev) and os.path.exists(os.path.join(root, prev[k])) else None
                toggle = f'<button class="swap" type="button" aria-pressed="false" data-final="{esc(src)}" data-prev="{esc(rel(old, root, out_dir))}">Önceki tur</button>' if old else ''
                name = os.path.splitext(os.path.basename(p))[0]
                t = name.rsplit('-', 1)[-1]
                w(f'<figure class="shot">{toggle}<a href="{esc(src)}" target="_blank"><img src="{esc(src)}" alt="{esc(name)}" loading="lazy"></a>'
                  f'<figcaption><span class="which">Son render</span><span class="det"> · {esc(name)} · {esc(TIME_LABEL.get(t, t))}</span></figcaption></figure>')
            w(f'<div class="review compact"><div class="score score-{score_class(o.get("score"))}"><b>{num(o.get("score"))}</b><span>/10</span></div><div class="note"><p class="note-k">{esc(o.get("camera"))}</p><p>{esc(o.get("note"))}</p></div></div>')
            w('</div>')
        w('</div></section>')

    w('<footer class="foot">Fotoğraflar Wikimedia Commons’tan, lisansları altındaki adlarıyla. Renderlar: <span class="mono">scripts/blender/render.py</span>, pano: <span class="mono">scripts/blender/board.py</span>.</footer>')
    w(f'</main><script>{JS}</script></body></html>')
    path = os.path.join(out_dir, 'index.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    return path


CSS = """
:root{--bg:#111214;--surface:#191a1d;--raised:#202226;--line:#2c2e33;--text:#ecebe6;--dim:#a3a19b;--faint:#6f6d68;
--ok:#7cc486;--mid:#e3b25a;--bad:#e8765f;--na:#8a8883;--accent:#d9c7a3;color-scheme:dark}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
.wrap{max-width:1480px;margin:0 auto;padding:0 24px}
.top{border-bottom:1px solid var(--line);background:linear-gradient(180deg,#16171a,var(--bg));padding:28px 0 0}
.eyebrow{margin:0;color:var(--faint);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
h1{margin:6px 0 6px;font-size:28px;line-height:1.2;font-weight:650;letter-spacing:-.01em;text-wrap:balance}
.lede{margin:0 0 18px;color:var(--dim);max-width:72ch}
.lede.small{font-size:14px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:0 0 16px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:2px;min-width:0}
.stat .k{font-size:12px;color:var(--dim)}
.stat .v{font-size:28px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.15}
.stat .v small{font-size:15px;color:var(--dim);font-weight:500}
.stat .v.small{font-size:15px;font-weight:500;padding:6px 0 3px;overflow-wrap:anywhere}
.stat .s{font-size:12px;color:var(--faint)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.notice{margin:0 0 16px;padding:10px 14px;border:1px solid #4a3f28;background:#1f1b12;border-radius:8px;color:#e9dcc0;font-size:14px}
.kbd{display:inline-block;padding:0 6px;border:1px solid #5c5040;border-radius:5px;font-size:12.5px}
.index{display:flex;flex-wrap:wrap;gap:6px;padding:0 0 16px}
.index a{font-size:13px;text-decoration:none;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:4px 11px}
.index a:hover{border-color:#4a4d54}
.pill{display:inline-block;font-size:12px;font-weight:600;border-radius:999px;padding:2px 9px;white-space:nowrap}
.pill.ok{background:rgba(124,196,134,.14);color:var(--ok)}
.pill.mid{background:rgba(227,178,90,.14);color:var(--mid)}
.pill.bad{background:rgba(232,118,95,.14);color:var(--bad)}
.score-ok{color:var(--ok)}.score-mid{color:var(--mid)}.score-bad{color:var(--bad)}.score-na{color:var(--na)}
main{padding:24px 24px 40px}
.cam{border-bottom:1px solid var(--line);padding:26px 0 30px;scroll-margin-top:12px}
.cam-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px 20px;flex-wrap:wrap;margin-bottom:14px}
h2{margin:0;font-size:20px;font-weight:620;line-height:1.3;text-wrap:balance}
.cid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;color:var(--dim);font-weight:500;margin-right:6px}
.tabs{display:inline-flex;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:3px;gap:2px}
.tabs button{appearance:none;border:0;background:transparent;color:var(--dim);font:inherit;font-size:14px;padding:6px 14px;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;min-height:32px}
.tabs button:hover{color:var(--text)}
.tabs button[aria-selected=true]{background:var(--raised);color:var(--text);box-shadow:0 0 0 1px var(--line)}
.tabs button:focus-visible,.swap:focus-visible,.index a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.dot{font-size:12px;font-weight:650;font-variant-numeric:tabular-nums}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
.pair.portrait{max-width:980px}
.shot{margin:0;position:relative;min-width:0}
.shot img{display:block;width:100%;height:auto;border-radius:8px;background:#0b0b0c}
.shot a{display:block}
.shot figcaption{margin-top:7px;font-size:12.5px;color:var(--dim);line-height:1.45}
.shot figcaption a{color:var(--dim)}
.shot .which{color:var(--text);font-weight:600}
.shot.empty .ph{aspect-ratio:3/2;border:1px dashed var(--line);border-radius:8px;display:grid;place-items:center;color:var(--faint)}
.swap{position:absolute;top:10px;right:10px;z-index:1;appearance:none;border:1px solid rgba(255,255,255,.18);background:rgba(17,18,20,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:var(--text);font:inherit;font-size:13px;padding:5px 11px;border-radius:7px;cursor:pointer;min-height:30px}
.swap:hover{background:rgba(32,34,38,.9)}
.swap[aria-pressed=true]{background:var(--mid);color:#1b1408;border-color:transparent}
.review{display:grid;grid-template-columns:auto 1fr;gap:14px 16px;margin-top:16px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px;max-width:1100px}
.review.compact{margin-top:10px}
.score{display:flex;align-items:baseline;gap:2px;font-variant-numeric:tabular-nums;min-width:62px}
.score b{font-size:30px;line-height:1;font-weight:700}
.score span{color:var(--dim);font-size:13px}
.note p{margin:0;max-width:95ch}
.note .note-k{font-size:12px;color:var(--faint);margin-bottom:3px}
.meta{margin:10px 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px}
.meta li{font-size:12px;color:var(--dim);border:1px solid var(--line);border-radius:999px;padding:2px 9px}
.others{padding:30px 0 10px;border-bottom:1px solid var(--line)}
.others h2{margin-bottom:4px}
.other-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:18px;margin-top:12px}
.other .shot{margin-bottom:12px}
.checklist{padding:4px 0 22px;border-bottom:1px solid var(--line)}
.checklist h2{margin-bottom:12px}
.muted{color:var(--faint);font-size:14px;font-weight:500}
.checklist ol{list-style:none;margin:0;padding:0;display:grid;gap:8px;max-width:1100px}
.checklist details{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:0}
.checklist summary{cursor:pointer;display:flex;gap:12px;align-items:baseline;padding:12px 14px;list-style:none}
.checklist summary::-webkit-details-marker{display:none}
.checklist summary .pill{flex:none;min-width:62px;text-align:center}
.checklist details[open] summary{border-bottom:1px solid var(--line)}
.checklist details p{margin:0;padding:12px 14px 14px 88px;color:var(--dim);max-width:110ch}
.foot{color:var(--faint);font-size:12.5px;padding:26px 0 0}
@media (max-width:760px){
 .wrap{padding:0 16px} main{padding:16px 16px 32px}
 h1{font-size:23px}
 .pair{grid-template-columns:1fr}
 .pair.portrait{grid-template-columns:1fr 1fr;gap:8px}
 .review{grid-template-columns:1fr;gap:6px}
 .checklist details p{padding-left:14px}
 .other-grid{grid-template-columns:1fr}
 .stats{grid-template-columns:1fr 1fr}
}
@media (prefers-reduced-motion:no-preference){.tabs button,.swap,.index a{transition:background-color .15s ease,color .15s ease,border-color .15s ease}}
"""

JS = """
document.querySelectorAll('.tabs').forEach(function(list){
  var tabs=[].slice.call(list.querySelectorAll('[role=tab]'));
  function select(t){tabs.forEach(function(b){var on=b===t;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1;
    var p=document.getElementById(b.getAttribute('aria-controls'));if(p){p.hidden=!on;}});}
  tabs.forEach(function(b,i){
    b.addEventListener('click',function(){select(b);});
    b.addEventListener('keydown',function(e){var j=null;if(e.key==='ArrowRight')j=(i+1)%tabs.length;if(e.key==='ArrowLeft')j=(i-1+tabs.length)%tabs.length;
      if(j!==null){e.preventDefault();select(tabs[j]);tabs[j].focus();}});
  });
});
document.querySelectorAll('.swap').forEach(function(btn){
  btn.addEventListener('click',function(){
    var fig=btn.closest('figure'),img=fig.querySelector('img'),a=fig.querySelector('a'),which=fig.querySelector('.which');
    var prev=btn.getAttribute('aria-pressed')!=='true';
    var src=prev?btn.dataset.prev:btn.dataset.final;
    img.src=src;a.href=src;btn.setAttribute('aria-pressed',prev);
    which.textContent=prev?'Önceki tur (eleştirilen render)':'Son render';
    var det=fig.querySelector('.det');if(det){det.hidden=prev;}
  });
});
"""
