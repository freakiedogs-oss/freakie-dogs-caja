# -*- coding: utf-8 -*-
"""Genera el reporte de ventas (HTML listo para imprimir a PDF)."""
import os, sys
from collections import defaultdict, OrderedDict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from datos_ventas_2025_2026 import ROWS, CHK_TIENDA, CHK_PEYA, CHK_TOTAL_TIENDA, STORES

MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]
def mlabel(m):  # "2026-01" -> "Ene 26"
    y, mm = m.split("-"); return f"{MESES[int(mm)-1]} {y[2:]}"
def mlong(m):
    y, mm = m.split("-"); return f"{MESES[int(mm)-1]}-{y}"

# ---------- agregados ----------
meses = sorted({r[0] for r in ROWS})
stores = [s for s in STORES if any(r[1] == s for r in ROWS)]

M = OrderedDict((m, dict(tienda=0.0, peya=0.0, efec=0.0, tarj=0.0, transf=0.0,
                         link=0.0, dias=0, npeya=0)) for m in meses)
S = defaultdict(lambda: defaultdict(lambda: dict(tienda=0.0, peya=0.0, npeya=0)))  # [store][mes]
for mes, st, ti, pe, ef, ta, tr, li, dias, npy in ROWS:
    a = M[mes]
    a["tienda"] += ti; a["peya"] += pe; a["efec"] += ef; a["tarj"] += ta
    a["transf"] += tr; a["link"] += li; a["npeya"] += npy
    a["dias"] = max(a["dias"], dias)
    b = S[st][mes]; b["tienda"] += ti; b["peya"] += pe; b["npeya"] += npy
for m in meses:
    M[m]["total"] = M[m]["tienda"] + M[m]["peya"]

def year_agg(y):
    a = dict(tienda=0.0, peya=0.0, efec=0.0, tarj=0.0, transf=0.0, link=0.0, npeya=0, meses=0)
    for m in meses:
        if m.startswith(y):
            a["meses"] += 1
            for k in ("tienda","peya","efec","tarj","transf","link","npeya"):
                a[k] += M[m][k]
    a["total"] = a["tienda"] + a["peya"]
    return a
Y = {y: year_agg(y) for y in ("2025","2026")}
TOT = dict((k, Y["2025"][k] + Y["2026"][k]) for k in
           ("tienda","peya","total","efec","tarj","transf","link","npeya"))

# YoY comparable ene-ago
def rango(y, m1, m2):
    a = dict(tienda=0.0, peya=0.0)
    for m in meses:
        if m.startswith(y) and m1 <= int(m[5:]) <= m2:
            a["tienda"] += M[m]["tienda"]; a["peya"] += M[m]["peya"]
    a["total"] = a["tienda"] + a["peya"]; return a
YTD26, YTD25 = rango("2026", 1, 8), rango("2025", 1, 8)

def mismas(y, sucs=("M001","S001")):
    return sum(S[s][m]["tienda"] for s in sucs for m in meses
               if m.startswith(y) and 1 <= int(m[5:]) <= 8 and m in S[s])
SS25, SS26 = mismas("2025"), mismas("2026")
ss_var = 100 * (SS26 - SS25) / SS25

# ---------- formato ----------
def d(v, dec=2):
    return "$" + f"{v:,.{dec}f}"
def k(v):
    if v >= 1_000_000: return f"${v/1_000_000:.2f}M"
    if v >= 1000:      return f"${v/1000:.0f}K"
    return f"${v:.0f}"
def pct(v, dec=1):
    return f"{v:,.{dec}f}%"
def sign(v, dec=1):
    return ("+" if v >= 0 else "") + f"{v:,.{dec}f}%"

# ---------- charts (SVG) ----------
C_TIENDA, C_PEYA = "#2a78d6", "#eb6834"
C_MIX = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
INK, INK2, INK3, GRID = "#0b0b0b", "#52514e", "#78766f", "#e6e4df"

def chart_mensual(w=712, h=250):
    pl, pr, pt, pb = 44, 8, 16, 34
    iw, ih = w - pl - pr, h - pt - pb
    vals = [M[m]["total"] for m in meses]
    top = 360000.0
    bw = iw / len(meses) * 0.66
    step = iw / len(meses)
    o = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="Venta total por mes">']
    for gy in range(0, int(top) + 1, 60000):
        y = pt + ih - ih * gy / top
        o.append(f'<line x1="{pl}" y1="{y:.1f}" x2="{w-pr}" y2="{y:.1f}" stroke="{GRID}" stroke-width="1"/>')
        o.append(f'<text x="{pl-6}" y="{y+3:.1f}" text-anchor="end" font-size="8" fill="{INK3}">{k(gy) if gy else "$0"}</text>')
    for i, m in enumerate(meses):
        x = pl + i * step + (step - bw) / 2
        ti, pe = M[m]["tienda"], M[m]["peya"]
        hti, hpe = ih * ti / top, ih * pe / top
        ybase = pt + ih
        if pe > 0:
            o.append(f'<rect x="{x:.1f}" y="{ybase-hti-hpe:.1f}" width="{bw:.1f}" height="{max(hpe-2,1):.1f}" rx="3" fill="{C_PEYA}"/>')
            o.append(f'<rect x="{x:.1f}" y="{ybase-hti:.1f}" width="{bw:.1f}" height="{hti:.1f}" fill="{C_TIENDA}"/>')
        else:
            o.append(f'<rect x="{x:.1f}" y="{ybase-hti:.1f}" width="{bw:.1f}" height="{hti:.1f}" rx="3" fill="{C_TIENDA}"/>')
        o.append(f'<text x="{x+bw/2:.1f}" y="{ybase-hti-hpe-4:.1f}" text-anchor="middle" font-size="7.5" font-weight="600" fill="{INK}">{k(ti+pe)}</text>')
        o.append(f'<text x="{x+bw/2:.1f}" y="{ybase+12:.1f}" text-anchor="middle" font-size="7.5" fill="{INK2}">{MESES[int(m[5:])-1]}</text>')
        if m[5:] in ("01",) or i == 0:
            o.append(f'<text x="{x+bw/2:.1f}" y="{ybase+22:.1f}" text-anchor="middle" font-size="7.5" font-weight="700" fill="{INK}">{m[:4]}</text>')
    o.append(f'<line x1="{pl}" y1="{pt+ih}" x2="{w-pr}" y2="{pt+ih}" stroke="{INK3}" stroke-width="1"/>')
    o.append("</svg>")
    return "".join(o)

def small_multiples(w=712):
    cols, cw, ch = 3, w / 3, 104
    pl, pt, pb = 6, 20, 22
    top = max(max(S[s][m]["tienda"] + S[s][m]["peya"] for m in meses if m in S[s]) for s in stores)
    rows = (len(stores) + cols - 1) // cols
    h = rows * ch
    o = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="Venta mensual por sucursal">']
    for idx, s in enumerate(stores):
        ox, oy = (idx % cols) * cw, (idx // cols) * ch
        iw, ih = cw - pl - 10, ch - pt - pb
        step = iw / len(meses); bw = step * 0.62
        tot = sum(S[s][m]["tienda"] + S[s][m]["peya"] for m in meses if m in S[s])
        o.append(f'<text x="{ox+pl}" y="{oy+9}" font-size="8.5" font-weight="700" fill="{INK}">{STORES[s]}</text>')
        o.append(f'<text x="{ox+pl}" y="{oy+18}" font-size="7.5" fill="{INK2}">{s} · {k(tot)} acumulado</text>')
        o.append(f'<line x1="{ox+pl}" y1="{oy+pt+ih}" x2="{ox+pl+iw}" y2="{oy+pt+ih}" stroke="{GRID}" stroke-width="1"/>')
        for i, m in enumerate(meses):
            v = S[s][m]["tienda"] + S[s][m]["peya"] if m in S[s] else 0
            if v <= 0: continue
            bh = ih * v / top
            o.append(f'<rect x="{ox+pl+i*step+(step-bw)/2:.1f}" y="{oy+pt+ih-bh:.1f}" width="{bw:.1f}" height="{max(bh,0.8):.1f}" rx="1.5" fill="{C_TIENDA}"/>')
        o.append(f'<text x="{ox+pl}" y="{oy+pt+ih+10}" font-size="6.5" fill="{INK3}">Ene 25</text>')
        o.append(f'<text x="{ox+pl+iw}" y="{oy+pt+ih+10}" font-size="6.5" fill="{INK3}" text-anchor="end">Ago 26</text>')
    o.append("</svg>")
    return "".join(o)

def chart_mix(w=712, h=132):
    labels = ["Efectivo", "Tarjeta", "Transferencia", "Link de pago"]
    o = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="Mix de métodos de pago por año">']
    barh, pl = 30, 52
    h = 132
    for row, y in enumerate(("2025", "2026")):
        a = Y[y]; base = a["efec"] + a["tarj"] + a["transf"] + a["link"]
        parts = [a["efec"], a["tarj"], a["transf"], a["link"]]
        yy = 30 + row * 52
        o.append(f'<text x="0" y="{yy+barh/2+4}" font-size="9.5" font-weight="700" fill="{INK}">{y}</text>')
        x = pl; iw = w - pl
        small = 0
        for i, v in enumerate(parts):
            bwid = iw * v / base
            if bwid <= 0: continue
            o.append(f'<rect x="{x:.1f}" y="{yy}" width="{max(bwid-2,0.5):.1f}" height="{barh}" rx="3" fill="{C_MIX[i]}"/>')
            p = 100 * v / base
            if bwid > 34:
                o.append(f'<text x="{x+bwid/2-1:.1f}" y="{yy+barh/2+3.5:.1f}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#ffffff">{p:.1f}%</text>')
            else:
                dy = 5 + small * 9.5
                o.append(f'<rect x="{w-6.5:.1f}" y="{yy-dy-5.5:.1f}" width="6.5" height="6.5" rx="1.5" fill="{C_MIX[i]}"/>')
                o.append(f'<text x="{w-10:.1f}" y="{yy-dy:.1f}" text-anchor="end" font-size="7.5" fill="{INK2}">{labels[i]} {p:.1f}%</text>')
                small += 1
            x += bwid
    o.append("</svg>")
    leg = "".join(f'<span class="lg"><i style="background:{C_MIX[i]}"></i>{l}</span>' for i, l in enumerate(labels))
    return "".join(o), leg

# ---------- tablas ----------
def tabla_mensual():
    r = []
    prev = None
    for m in meses:
        a = M[m]
        var = "—" if prev is None else sign(100 * (a["total"] - prev) / prev)
        cls = "" if prev is None else ("pos" if a["total"] >= prev else "neg")
        prom = a["total"] / a["dias"] if a["dias"] else 0
        r.append(f'<tr><td class="l">{mlong(m)}</td><td>{d(a["tienda"])}</td>'
                 f'<td>{d(a["peya"]) if a["peya"] else "—"}</td><td class="b">{d(a["total"])}</td>'
                 f'<td class="{cls}">{var}</td><td>{a["dias"]}</td><td>{d(prom)}</td></tr>')
        prev = a["total"]
    for y in ("2025", "2026"):
        a = Y[y]
        r.append(f'<tr class="sub"><td class="l">Total {y}{" (ene–ago)" if y=="2026" else ""}</td>'
                 f'<td>{d(a["tienda"])}</td><td>{d(a["peya"]) if a["peya"] else "—"}</td>'
                 f'<td class="b">{d(a["total"])}</td><td>—</td><td>{a["meses"]} meses</td>'
                 f'<td>{d(a["total"]/a["meses"])}</td></tr>')
    return "".join(r)

def matriz(y, campo):
    ms = [m for m in meses if m.startswith(y)]
    head = "".join(f"<th>{MESES[int(m[5:])-1]}</th>" for m in ms) + "<th>Total</th>"
    body = []
    for s in stores:
        vals = [S[s][m][campo] if m in S[s] else 0 for m in ms]
        if sum(vals) == 0: continue
        tds = "".join(f'<td>{d(v,0) if v else "—"}</td>' for v in vals)
        body.append(f'<tr><td class="l"><b>{s}</b> {STORES[s]}</td>{tds}<td class="b">{d(sum(vals),0)}</td></tr>')
    tot = [sum(S[s][m][campo] for s in stores if m in S[s]) for m in ms]
    body.append('<tr class="sub"><td class="l">Total</td>' +
                "".join(f'<td>{d(v,0) if v else "—"}</td>' for v in tot) +
                f'<td class="b">{d(sum(tot),0)}</td></tr>')
    return f'<table class="mx"><thead><tr><th class="l">Sucursal</th>{head}</tr></thead><tbody>{"".join(body)}</tbody></table>'

def tabla_anual_sucursal():
    r = []
    for s in stores:
        v25 = sum(S[s][m]["tienda"] + S[s][m]["peya"] for m in meses if m.startswith("2025") and m in S[s])
        v26 = sum(S[s][m]["tienda"] + S[s][m]["peya"] for m in meses if m.startswith("2026") and m in S[s])
        tot = v25 + v26
        var = sign(100 * (v26 - v25) / v25) if v25 > 0 else "—"
        share = 100 * v26 / Y["2026"]["total"] if v26 else 0
        r.append(f'<tr><td class="l"><b>{s}</b> {STORES[s]}</td><td>{d(v25) if v25 else "—"}</td>'
                 f'<td>{d(v26) if v26 else "—"}</td><td>{pct(share)}</td><td class="b">{d(tot)}</td></tr>')
    r.append(f'<tr class="sub"><td class="l">Total</td><td>{d(Y["2025"]["total"])}</td>'
             f'<td>{d(Y["2026"]["total"])}</td><td>100.0%</td><td class="b">{d(TOT["total"])}</td></tr>')
    return "".join(r)

def tabla_peya():
    r = []
    for m in meses:
        a = M[m]
        if a["peya"] <= 0: continue
        tk = a["peya"] / a["npeya"] if a["npeya"] else 0
        share = 100 * a["peya"] / a["total"]
        r.append(f'<tr><td class="l">{mlong(m)}</td><td>{a["npeya"]:,}</td><td>{d(a["peya"])}</td>'
                 f'<td>{d(tk)}</td><td>{pct(share)}</td></tr>')
    a = Y["2026"]
    r.append(f'<tr class="sub"><td class="l">Total 2026 (ene–ago)</td><td>{a["npeya"]:,}</td>'
             f'<td>{d(a["peya"])}</td><td>{d(a["peya"]/a["npeya"])}</td>'
             f'<td>{pct(100*a["peya"]/a["total"])}</td></tr>')
    return "".join(r)

def tabla_mix():
    r = []
    for m in meses:
        a = M[m]; base = a["efec"] + a["tarj"] + a["transf"] + a["link"]
        r.append(f'<tr><td class="l">{mlong(m)}</td>'
                 f'<td>{d(a["efec"],0)}</td><td>{pct(100*a["efec"]/base)}</td>'
                 f'<td>{d(a["tarj"],0)}</td><td>{pct(100*a["tarj"]/base)}</td>'
                 f'<td>{d(a["transf"],0) if a["transf"] else "—"}</td>'
                 f'<td>{d(a["link"],0) if a["link"] else "—"}</td></tr>')
    return "".join(r)

# ---------- KPIs de texto ----------
mejor_mes = max(meses, key=lambda m: M[m]["total"])
mejor_suc26 = max(stores, key=lambda s: sum(S[s][m]["tienda"] + S[s][m]["peya"] for m in meses if m.startswith("2026") and m in S[s]))
yoy = 100 * (YTD26["total"] - YTD25["total"]) / YTD25["total"]
prom26 = Y["2026"]["total"] / Y["2026"]["meses"]
prom25 = Y["2025"]["total"] / Y["2025"]["meses"]
peya_share26 = 100 * Y["2026"]["peya"] / Y["2026"]["total"]

base_stores = [s for s in stores if s != "S006"]
base_ene = sum(S[s]["2026-01"]["tienda"] + S[s]["2026-01"]["peya"] for s in base_stores)
base_ago = sum(S[s]["2026-08"]["tienda"] + S[s]["2026-08"]["peya"] for s in base_stores)
base_var = 100 * (base_ago - base_ene) / base_ene
s006_ago = S["S006"]["2026-08"]["tienda"]
m001_ago_t = S["M001"]["2026-08"]["tienda"]
m001_ago_tot = S["M001"]["2026-08"]["tienda"] + S["M001"]["2026-08"]["peya"]
apertura_s006 = "julio-2026"
peya_var = 100 * (M["2026-08"]["peya"] - M["2026-01"]["peya"]) / M["2026-01"]["peya"]
tk_ene = M["2026-01"]["peya"] / M["2026-01"]["npeya"]
tk_ago = M["2026-08"]["peya"] / M["2026-08"]["npeya"]
base26 = Y["2026"]["efec"] + Y["2026"]["tarj"] + Y["2026"]["transf"] + Y["2026"]["link"]
a8 = M["2026-08"]
dig_ago = 100 * (a8["transf"] + a8["link"]) / (a8["efec"] + a8["tarj"] + a8["transf"] + a8["link"])
peor_mes26 = min([m for m in meses if m.startswith("2026")], key=lambda m: M[m]["total"])

mix_svg, mix_leg = chart_mix()

HTML = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Freakie Dogs — Reporte de Ventas Mensual y Anual</title>
<style>
  @page {{ size: A4 portrait; margin: 13mm 12mm 14mm 12mm; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
         color:{INK}; background:#fff; font-size:9px; line-height:1.45; }}
  h1 {{ font-size:20px; margin:0 0 2px; letter-spacing:-.3px; }}
  h2 {{ font-size:12.5px; margin:0 0 2px; letter-spacing:-.1px; }}
  h3 {{ font-size:10px; margin:0 0 4px; color:{INK2}; font-weight:700;
        text-transform:uppercase; letter-spacing:.6px; }}
  p  {{ margin:0 0 6px; color:{INK2}; }}
  .page {{ page-break-after: always; }}
  .page:last-child {{ page-break-after: auto; }}
  section {{ margin-bottom:14px; break-inside: avoid; }}
  header {{ border-bottom:2px solid {INK}; padding-bottom:8px; margin-bottom:12px; }}
  .brand {{ font-size:9px; font-weight:700; letter-spacing:2px;
            text-transform:uppercase; color:{C_PEYA}; margin-bottom:4px; }}
  .meta {{ display:flex; flex-wrap:wrap; gap:6px 18px; font-size:8.5px; color:{INK2}; margin-top:6px; }}
  .meta b {{ color:{INK}; font-weight:700; }}
  .kpis {{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:14px; }}
  .kpi {{ border:1px solid {GRID}; border-top:3px solid {C_TIENDA}; border-radius:5px; padding:8px 9px; }}
  .kpi .lbl {{ font-size:7.5px; text-transform:uppercase; letter-spacing:.5px; color:{INK2}; font-weight:700; }}
  .kpi .val {{ font-size:17px; font-weight:700; letter-spacing:-.5px; margin:2px 0 1px; }}
  .kpi .sub {{ font-size:7.5px; color:{INK3}; }}
  .kpi.alt {{ border-top-color:{C_PEYA}; }}
  table {{ width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }}
  th {{ font-size:7.5px; text-transform:uppercase; letter-spacing:.4px; color:{INK2};
        text-align:right; padding:4px 5px; border-bottom:1px solid {INK}; font-weight:700; }}
  td {{ text-align:right; padding:3.2px 5px; border-bottom:1px solid #f1efeb; }}
  th.l, td.l {{ text-align:left; }}
  td.b {{ font-weight:700; }}
  tr.sub td {{ font-weight:700; border-top:1px solid {INK}; border-bottom:none; background:#faf9f7; }}
  .pos {{ color:#0f7a4d; }} .neg {{ color:#b3261e; }}
  table.mx {{ font-size:7.4px; }}
  table.mx td, table.mx th {{ padding:2.6px 3px; }}
  .lgs {{ display:flex; gap:14px; margin:6px 0 2px; font-size:8px; color:{INK2}; }}
  .lg {{ display:flex; align-items:center; gap:5px; }}
  .lg i {{ width:9px; height:9px; border-radius:2px; display:inline-block; }}
  .note {{ font-size:8px; color:{INK3}; margin-top:5px; }}
  .cols {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }}
  ol, ul {{ margin:0 0 6px; padding-left:15px; color:{INK2}; }}
  li {{ margin-bottom:3px; }}
  .box {{ border:1px solid {GRID}; border-radius:5px; padding:9px 11px; background:#faf9f7; }}
  footer {{ font-size:7.5px; color:{INK3}; border-top:1px solid {GRID}; padding-top:5px; margin-top:8px; }}
</style></head><body>

<div class="page">
  <header>
    <div class="brand">Freakie Dogs · ERP</div>
    <h1>Reporte de Ventas — Mensual y Anual</h1>
    <p>Venta consolidada de las 6 sucursales, canal tienda (mostrador, para llevar, drive-thru y delivery propio) y canal PedidosYa.</p>
    <div class="meta">
      <span><b>Periodo:</b> ene-2025 → ago-2026</span>
      <span><b>Generado:</b> 01-sep-2026</span>
      <span><b>Fuente:</b> Supabase · ventas_diarias + pedidos_peya</span>
      <span><b>Moneda:</b> USD (IVA incluido)</span>
    </div>
  </header>

  <div class="kpis">
    <div class="kpi"><div class="lbl">Venta total del periodo</div>
      <div class="val">{d(TOT['total'],0)}</div><div class="sub">20 meses · {d(TOT['total']/20,0)} promedio mensual</div></div>
    <div class="kpi"><div class="lbl">Año 2025 (12 meses)</div>
      <div class="val">{d(Y['2025']['total'],0)}</div><div class="sub">{d(prom25,0)} por mes</div></div>
    <div class="kpi"><div class="lbl">Año 2026 (ene–ago)</div>
      <div class="val">{d(Y['2026']['total'],0)}</div><div class="sub">{d(prom26,0)} por mes</div></div>
    <div class="kpi alt"><div class="lbl">Crecimiento ene–ago 26 vs 25</div>
      <div class="val">{sign(yoy,0)}</div><div class="sub">{d(YTD26['total'],0)} vs {d(YTD25['total'],0)}</div></div>
  </div>

  <section>
    <h2>Venta total por mes</h2>
    <div class="lgs"><span class="lg"><i style="background:{C_TIENDA}"></i>Tienda (POS / cierre de caja)</span>
      <span class="lg"><i style="background:{C_PEYA}"></i>PedidosYa</span></div>
    {chart_mensual()}
    <div class="note">PedidosYa se registra en el ERP desde enero-2026; en 2025 la venta mostrada es únicamente la de tienda.</div>
  </section>

  <section>
    <h2>Resumen anual</h2>
    <table>
      <thead><tr><th class="l">Año</th><th>Tienda</th><th>PedidosYa</th><th>Venta total</th>
      <th>Meses</th><th>Promedio mensual</th><th>Sucursales</th></tr></thead>
      <tbody>
        <tr><td class="l">2025 (ene–dic)</td><td>{d(Y['2025']['tienda'])}</td><td>—</td>
            <td class="b">{d(Y['2025']['total'])}</td><td>12</td><td>{d(prom25)}</td><td>5</td></tr>
        <tr><td class="l">2026 (ene–ago)</td><td>{d(Y['2026']['tienda'])}</td><td>{d(Y['2026']['peya'])}</td>
            <td class="b">{d(Y['2026']['total'])}</td><td>8</td><td>{d(prom26)}</td><td>6</td></tr>
        <tr class="sub"><td class="l">Acumulado</td><td>{d(TOT['tienda'])}</td><td>{d(TOT['peya'])}</td>
            <td class="b">{d(TOT['total'])}</td><td>20</td><td>{d(TOT['total']/20)}</td><td>6</td></tr>
      </tbody>
    </table>
    <div class="note">Comparativo homogéneo ene–ago: {d(YTD25['total'])} en 2025 → {d(YTD26['total'])} en 2026 ({sign(yoy)}).
      El mejor mes del periodo fue {mlong(mejor_mes)} con {d(M[mejor_mes]['total'])}.</div>
    <div class="note">El salto interanual responde sobre todo a aperturas (de 2 a 6 sucursales) y a la incorporación
      de PedidosYa. A tiendas comparables —Cafetalón y Soyapango, únicas abiertas todo ene–ago de ambos años—
      la venta de tienda pasó de {d(SS25)} a {d(SS26)} ({sign(ss_var)}).</div>
  </section>
</div>

<div class="page">
  <h2>Detalle mensual consolidado</h2>
  <p>Venta por mes, canal y variación contra el mes anterior. El promedio diario usa los días con venta registrada. La variación de ene-2026 (+23.1%) incluye la entrada de PedidosYa al reporte: solo en tienda, ene-2026 creció +1.6% contra dic-2025.</p>
  <table>
    <thead><tr><th class="l">Mes</th><th>Tienda</th><th>PedidosYa</th><th>Venta total</th>
    <th>Var. vs mes ant.</th><th>Días</th><th>Prom. diario</th></tr></thead>
    <tbody>{tabla_mensual()}</tbody>
  </table>

  <section style="margin-top:16px">
    <h2>Venta mensual por sucursal</h2>
    <div class="note" style="margin:0 0 4px">Misma escala en los seis paneles · barras = venta total del mes (tienda + PedidosYa)</div>
    {small_multiples()}
  </section>
</div>

<div class="page">
  <h2>Ventas por sucursal</h2>
  <p>Venta total (tienda + PedidosYa) acumulada por sucursal y su peso dentro del año en curso.</p>
  <table>
    <thead><tr><th class="l">Sucursal</th><th>2025</th><th>2026 (ene–ago)</th>
    <th>% del total 2026</th><th>Acumulado</th></tr></thead>
    <tbody>{tabla_anual_sucursal()}</tbody>
  </table>
  <div class="note">La sucursal líder del año 2026 es {STORES[mejor_suc26]} con {d(sum(S[mejor_suc26][m]["tienda"]+S[mejor_suc26][m]["peya"] for m in meses if m.startswith("2026")))}.
    Paseo Venecia abrió en diciembre-2025 y Metro Centro 8ª Etapa en julio-2026: esta última, en solo dos meses, ya lidera la venta de mostrador.</div>

  <section style="margin-top:14px">
    <h3>Venta en tienda por sucursal — 2025</h3>
    {matriz("2025","tienda")}
  </section>
  <section>
    <h3>Venta en tienda por sucursal — 2026 (ene–ago)</h3>
    {matriz("2026","tienda")}
  </section>
  <section>
    <h3>Venta PedidosYa por sucursal — 2026 (ene–ago)</h3>
    {matriz("2026","peya")}
    <div class="note">Metro Centro (S006) aún no opera con PedidosYa. Cifras en dólares, redondeadas.</div>
  </section>
</div>

<div class="page">
  <h2>Mix de métodos de pago — venta en tienda</h2>
  <div class="lgs">{mix_leg}</div>
  {mix_svg}
  <table style="margin-top:6px">
    <thead><tr><th class="l">Mes</th><th>Efectivo</th><th>%</th><th>Tarjeta</th><th>%</th>
    <th>Transferencia</th><th>Link de pago</th></tr></thead>
    <tbody>{tabla_mix()}</tbody>
  </table>
  <div class="note">Transferencia y link de pago se habilitaron en el cierre de caja a partir de marzo-2026.
    Los montos por método suman la venta de tienda con diferencias menores en algunos cierres antiguos.</div>

  <section style="margin-top:16px">
    <h2>Canal PedidosYa</h2>
    <table>
      <thead><tr><th class="l">Mes</th><th>Pedidos entregados</th><th>Venta</th>
      <th>Ticket promedio</th><th>% de la venta total</th></tr></thead>
      <tbody>{tabla_peya()}</tbody>
    </table>
    <div class="note">Venta bruta al cliente (antes de comisión de PedidosYa). Excluye pedidos cancelados o rechazados.
      El canal representa {pct(peya_share26)} de la venta total de 2026.</div>
  </section>

</div>

<div class="page">
  <section>
    <h2>Lectura del periodo</h2>
    <div class="box">
      <ol>
        <li><b>El crecimiento vino de aperturas, no de más venta por tienda.</b> La venta ene–ago pasó de {d(YTD25['total'])} a {d(YTD26['total'])} ({sign(yoy)}), pero a tiendas comparables (Cafetalón y Soyapango) el alza es de {sign(ss_var)}. Las sucursales que ya operaban en enero-2026 vendieron {d(base_ene)} ese mes y {d(base_ago)} en agosto ({sign(base_var)}).</li>
        <li><b>Metro Centro 8ª Etapa entró fuerte.</b> Abrió en {apertura_s006} —22 días con venta ese mes— y en agosto-2026 ya fue la sucursal con mayor venta de mostrador: {d(s006_ago)} contra {d(m001_ago_t)} de Cafetalón. Sumando PedidosYa, Cafetalón sigue liderando ({d(m001_ago_tot)}), porque Metro Centro aún no opera ese canal.</li>
        <li><b>PedidosYa aporta {pct(peya_share26)} de la venta 2026</b> ({d(Y['2026']['peya'])} en {Y['2026']['npeya']:,} pedidos), pero se está enfriando: de {d(M['2026-01']['peya'])} en enero a {d(M['2026-08']['peya'])} en agosto ({sign(peya_var)}), con el ticket promedio bajando de {d(tk_ene)} a {d(tk_ago)}.</li>
        <li><b>El mix de pago sigue partido en dos.</b> Efectivo {pct(100*Y['2026']['efec']/base26)} y tarjeta {pct(100*Y['2026']['tarj']/base26)} en 2026; transferencia y link de pago, habilitados en marzo, ya son {pct(100*(Y['2026']['transf']+Y['2026']['link'])/base26)} del año y {pct(dig_ago)} en agosto.</li>
        <li><b>Mejor y peor mes.</b> El pico fue {mlong(mejor_mes)} con {d(M[mejor_mes]['total'])} y el piso de 2026 fue {mlong(peor_mes26)} con {d(M[peor_mes26]['total'])}; agosto cerró en {d(M['2026-08']['total'])}.</li>
      </ol>
    </div>
  </section>

  <section>
    <h2>Notas metodológicas</h2>
    <div class="box">
      <ul>
        <li><b>Tienda:</b> tabla <code>ventas_diarias</code> (<code>total_ventas_quanto</code>), que consolida el cierre de caja diario por sucursal — QUANTO POS hasta julio-2026 y el POS propio desde entonces. Incluye mostrador, para llevar, drive-thru y delivery propio.</li>
        <li><b>PedidosYa:</b> tabla <code>pedidos_peya</code>, pedidos en estado Entregado/Retirado, importados desde los reportes de PedidosYa. Se contabiliza aparte porque no entra en el cierre de caja: <b>no hay doble conteo</b> con la columna de tienda.</li>
        <li><b>Cobertura:</b> ene-2025 → 31-ago-2026. En 2025 solo operaban Cafetalón y Soyapango (Usulután desde ago-2025, Lourdes y Venecia desde dic-2025); Metro Centro abrió en jul-2026. Los datos de PedidosYa cargados en el ERP arrancan en ene-2026, por lo que 2025 no incluye ese canal.</li>
        <li><b>Validación:</b> los totales mensuales de tienda cuadran con la venta facturada por DTE (<code>quanto_ordenes</code>) dentro de ±3% en ene–jun 2026, periodo en el que ambas fuentes se traslapan.</li>
        <li><b>Pendiente conocido:</b> el 31-ago-2026 quedó sin cierre Z en Cafetalón y Usulután, por lo que agosto-2026 podría estar subestimado en aproximadamente $1.8K.</li>
        <li>Cifras en dólares con IVA incluido. Propinas no incluidas en la venta.</li>
      </ul>
    </div>
  </section>
  <footer>Freakie Dogs ERP · reporte generado automáticamente el 01-sep-2026 desde la base de datos de producción · uso interno.</footer>
</div>
</body></html>"""

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reporte.html")
open(out, "w").write(HTML)
print("ok", out, len(HTML))
print("2025", round(Y["2025"]["total"],2), "2026", round(Y["2026"]["total"],2), "tot", round(TOT["total"],2))
print("yoy", round(yoy,2), "mejor mes", mejor_mes, round(M[mejor_mes]["total"],2))
