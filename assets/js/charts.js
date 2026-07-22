// Hand-rolled SVG chart builders. No external chart library.
const IB_CHARTS = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const SERIES_COLORS = [
    "var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)",
    "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)",
  ];
  const tooltipEl = () => document.getElementById("chart-tooltip");

  function el(tag, attrs = {}, parent = null) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  function fmtMoney(v) {
    const sign = v < 0 ? "-" : "";
    return `${sign}$${Math.abs(Math.round(v)).toLocaleString()}`;
  }

  function showTip(evt, html) {
    const t = tooltipEl();
    t.innerHTML = html;
    t.style.display = "block";
    t.style.left = (evt.clientX + 14) + "px";
    t.style.top = (evt.clientY + 14) + "px";
  }
  function hideTip() { tooltipEl().style.display = "none"; }

  function legendFor(container, items) {
    const wrap = document.createElement("div");
    wrap.className = "legend";
    items.forEach((it) => {
      const s = document.createElement("span");
      s.className = "swatch";
      s.innerHTML = `<span class="dot" style="background:${it.color}"></span>${it.label}${it.detail ? ` - ${it.detail}` : ""}`;
      wrap.appendChild(s);
    });
    container.appendChild(wrap);
  }

  // ---------------- vertical bar, one color per category ----------------
  function verticalBar(container, data, opts = {}) {
    const w = opts.width || 900, h = opts.height || 380;
    const padL = 64, padB = 20, padT = 34, padR = 20;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const maxV = Math.max(1, ...data.map((d) => d.value));
    const svg = el("svg", { width: "100%", height: h, viewBox: `0 0 ${w} ${h}`, style: "overflow:visible;" });
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = (maxV / ticks) * i;
      const y = padT + plotH - (v / maxV) * plotH;
      el("line", { x1: padL, x2: w - padR, y1: y, y2: y, stroke: "var(--gridline)", "stroke-width": 1 }, svg);
      const t = el("text", { x: padL - 8, y: y + 4, "text-anchor": "end", fill: "var(--ink-muted)", "font-size": 11 }, svg);
      t.textContent = fmtMoney(v);
    }
    const slotW = plotW / data.length;
    const barW = Math.min(70, slotW * 0.62);
    data.forEach((d, i) => {
      const color = d.color || SERIES_COLORS[i % SERIES_COLORS.length];
      const cx = padL + i * slotW + slotW / 2;
      const bh = (d.value / maxV) * plotH;
      const by = padT + plotH - bh;
      const rect = el("rect", {
        x: cx - barW / 2, y: by, width: barW, height: Math.max(0, bh),
        fill: color, rx: 4, ry: 4, class: "chart-mark",
      }, svg);
      rect.style.cursor = "pointer";
      rect.addEventListener("mousemove", (e) => showTip(e, `<b>${d.label}</b><br>${fmtMoney(d.value)}${d.pct !== undefined ? ` (${d.pct.toFixed(1)}%)` : ""}`));
      rect.addEventListener("mouseleave", hideTip);
      if (d.pct !== undefined) {
        const val = el("text", { x: cx, y: by - 8, "text-anchor": "middle", fill: "var(--ink-secondary)", "font-size": 11.5, "font-weight": 600 }, svg);
        val.textContent = `${d.pct.toFixed(1)}%`;
      }
    });
    container.appendChild(svg);
    legendFor(container, data.map((d, i) => ({
      label: d.label,
      color: d.color || SERIES_COLORS[i % SERIES_COLORS.length],
      detail: d.pct !== undefined ? `${fmtMoney(d.value)} (${d.pct.toFixed(1)}%)` : fmtMoney(d.value),
    })));
  }

  // ---------------- vertical grouped bar (Monthly income vs expense) ----------------
  function groupedBar(container, categories, series, opts = {}) {
    const w = opts.width || 620, h = opts.height || 260;
    const padL = 60, padB = 30, padT = 14, padR = 10;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const maxV = Math.max(1, ...series.flatMap((s) => s.values));
    const svg = el("svg", { width: "100%", height: h, viewBox: `0 0 ${w} ${h}`, style: "overflow:visible;" });
    // gridlines + axis labels
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = (maxV / ticks) * i;
      const y = padT + plotH - (v / maxV) * plotH;
      el("line", { x1: padL, x2: w - padR, y1: y, y2: y, stroke: "var(--gridline)", "stroke-width": 1 }, svg);
      const t = el("text", { x: padL - 8, y: y + 4, "text-anchor": "end", fill: "var(--ink-muted)", "font-size": 10 }, svg);
      t.textContent = fmtMoney(v);
    }
    const groupW = plotW / categories.length;
    const barW = Math.min(24, (groupW * 0.6) / series.length);
    categories.forEach((cat, ci) => {
      const groupX = padL + ci * groupW + groupW / 2;
      series.forEach((s, si) => {
        const v = s.values[ci] || 0;
        const bh = (v / maxV) * plotH;
        const bx = groupX - (series.length * barW) / 2 + si * barW + 2;
        const by = padT + plotH - bh;
        const rect = el("rect", {
          x: bx, y: by, width: barW - 4, height: Math.max(0, bh),
          fill: s.color, rx: 3, ry: 3, class: "chart-mark",
        }, svg);
        rect.style.cursor = "pointer";
        rect.addEventListener("mousemove", (e) => showTip(e, `<b>${cat}</b><br>${s.label}: ${fmtMoney(v)}`));
        rect.addEventListener("mouseleave", hideTip);
      });
      const lab = el("text", { x: groupX, y: h - padB + 16, "text-anchor": "middle", fill: "var(--ink-muted)", "font-size": 10.5 }, svg);
      lab.textContent = cat;
    });
    container.appendChild(svg);
    legendFor(container, series.map((s) => ({ label: s.label, color: s.color })));
  }

  // ---------------- horizontal bar (Categories) ----------------
  function horizontalBar(container, data, opts = {}) {
    const w = opts.width || 620;
    const rowH = opts.rowHeight || 38, padL = 150, padR = 110, padT = 8;
    const h = padT * 2 + data.length * rowH;
    const plotW = w - padL - padR;
    const maxV = Math.max(1, ...data.map((d) => d.value));
    const svg = el("svg", { width: "100%", height: h, viewBox: `0 0 ${w} ${h}`, style: "overflow:visible;" });
    data.forEach((d, i) => {
      const y = padT + i * rowH;
      const bw = (d.value / maxV) * plotW;
      const label = el("text", { x: padL - 8, y: y + rowH / 2 + 4, "text-anchor": "end", fill: "var(--ink-secondary)", "font-size": 13 }, svg);
      label.textContent = d.label.length > 20 ? d.label.slice(0, 19) + "…" : d.label;
      const rect = el("rect", { x: padL, y: y + 6, width: Math.max(0, bw), height: rowH - 14, fill: "var(--series-1)", rx: 3, ry: 3, class: "chart-mark" }, svg);
      rect.style.cursor = "pointer";
      rect.addEventListener("mousemove", (e) => showTip(e, `<b>${d.label}</b><br>${fmtMoney(d.value)}${d.pct !== undefined ? ` (${d.pct.toFixed(1)}%)` : ""}`));
      rect.addEventListener("mouseleave", hideTip);
      const val = el("text", { x: padL + bw + 8, y: y + rowH / 2 + 4, fill: "var(--ink-muted)", "font-size": 12.5 }, svg);
      val.textContent = d.pct !== undefined ? `${fmtMoney(d.value)} (${d.pct.toFixed(1)}%)` : fmtMoney(d.value);
    });
    container.appendChild(svg);
  }

  // ---------------- single-series time-bucket bar chart (e.g. weekly spend) ----------------
  function barChart(container, categories, values, opts = {}) {
    const w = opts.width || 620, h = opts.height || 340;
    const padL = 72, padB = 32, padT = 16, padR = 18;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const maxV = Math.max(1, ...values);
    const skip = opts.labelSkip || Math.max(1, Math.floor(categories.length / 10));
    const color = opts.color || "var(--series-1)";

    const svg = el("svg", { width: "100%", height: h, viewBox: `0 0 ${w} ${h}`, style: "overflow:visible;" });
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const v = (maxV / ticks) * i;
      const y = padT + plotH - (v / maxV) * plotH;
      el("line", { x1: padL, x2: w - padR, y1: y, y2: y, stroke: "var(--gridline)", "stroke-width": 1 }, svg);
      const t = el("text", { x: padL - 10, y: y + 4, "text-anchor": "end", fill: "var(--ink-muted)", "font-size": 12 }, svg);
      t.textContent = fmtMoney(v);
    }
    const slotW = plotW / values.length;
    const barW = Math.max(2, Math.min(28, slotW * 0.7));
    values.forEach((v, i) => {
      const cx = padL + i * slotW + slotW / 2;
      const bh = (v / maxV) * plotH;
      const by = padT + plotH - bh;
      const rect = el("rect", {
        x: cx - barW / 2, y: by, width: barW, height: Math.max(0, bh),
        fill: color, rx: 3, ry: 3, class: "chart-mark",
      }, svg);
      rect.style.cursor = "pointer";
      rect.addEventListener("mousemove", (e) => showTip(e, `<b>${categories[i]}</b><br>${fmtMoney(v)}`));
      rect.addEventListener("mouseleave", hideTip);
      if (i % skip === 0) {
        const t = el("text", { x: cx, y: h - padB + 20, "text-anchor": "middle", fill: "var(--ink-muted)", "font-size": 12 }, svg);
        t.textContent = categories[i];
      }
    });
    container.appendChild(svg);
  }

  // ---------------- line chart with crosshair ----------------
  function lineChart(container, categories, series, opts = {}) {
    const w = opts.width || 620, h = opts.height || 340;
    const padL = 72, padB = 32, padT = 16, padR = 18;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const allVals = series.flatMap((s) => s.values);
    const maxV = Math.max(1, ...allVals), minV = Math.min(0, ...allVals);
    const range = maxV - minV || 1;
    const skip = opts.labelSkip || Math.max(1, Math.floor(categories.length / 10));

    const svg = el("svg", { width: "100%", height: h, viewBox: `0 0 ${w} ${h}`, style: "overflow:visible;" });
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const v = minV + (range / ticks) * i;
      const y = padT + plotH - ((v - minV) / range) * plotH;
      el("line", { x1: padL, x2: w - padR, y1: y, y2: y, stroke: "var(--gridline)", "stroke-width": 1 }, svg);
      const t = el("text", { x: padL - 10, y: y + 4, "text-anchor": "end", fill: "var(--ink-muted)", "font-size": 12 }, svg);
      t.textContent = fmtMoney(v);
    }
    const xStep = categories.length > 1 ? plotW / (categories.length - 1) : 0;
    categories.forEach((cat, i) => {
      if (i % skip !== 0) return;
      const x = padL + i * xStep;
      const t = el("text", { x, y: h - padB + 20, "text-anchor": "middle", fill: "var(--ink-muted)", "font-size": 12 }, svg);
      t.textContent = cat;
    });
    series.forEach((s) => {
      const pts = s.values.map((v, i) => [padL + i * xStep, padT + plotH - ((v - minV) / range) * plotH]);
      const d = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0] + " " + p[1]).join(" ");
      el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    });
    // shared crosshair hit area
    const hit = el("rect", { x: padL, y: padT, width: plotW, height: plotH, fill: "transparent" }, svg);
    hit.style.cursor = "crosshair";
    hit.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / rect.width) * w;
      const idx = Math.max(0, Math.min(categories.length - 1, Math.round((relX - padL) / (xStep || 1))));
      const lines = series.map((s) => `${s.label}: ${fmtMoney(s.values[idx] || 0)}`).join("<br>");
      showTip(e, `<b>${categories[idx]}</b><br>${lines}`);
    });
    hit.addEventListener("mouseleave", hideTip);
    container.appendChild(svg);
    legendFor(container, series.map((s) => ({ label: s.label, color: s.color })));
  }

  // ---------------- area chart, stock-ticker style (e.g. cumulative surplus) ----------------
  function areaChart(container, categories, values, opts = {}) {
    const w = opts.width || 620, h = opts.height || 340;
    const padL = 72, padB = 32, padT = 16, padR = 60;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const maxV = Math.max(0, ...values), minV = Math.min(0, ...values);
    const range = (maxV - minV) || 1;
    const skip = opts.labelSkip || Math.max(1, Math.floor(categories.length / 10));
    const trendUp = values[values.length - 1] >= values[0];
    const color = opts.color || (trendUp ? "var(--status-good)" : "var(--status-critical)");
    const gradId = "areaGrad" + Math.random().toString(36).slice(2, 9);
    const xStep = categories.length > 1 ? plotW / (categories.length - 1) : 0;
    const yFor = (v) => padT + plotH - ((v - minV) / range) * plotH;
    const zeroY = yFor(0);

    const svg = el("svg", { width: "100%", height: h, viewBox: `0 0 ${w} ${h}`, style: "overflow:visible;" });
    const defs = el("defs", {}, svg);
    const grad = el("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0.32 }, grad);
    el("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0 }, grad);

    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const v = minV + (range / ticks) * i;
      const y = yFor(v);
      el("line", { x1: padL, x2: w - padR, y1: y, y2: y, stroke: "var(--gridline)", "stroke-width": 1 }, svg);
      const t = el("text", { x: padL - 10, y: y + 4, "text-anchor": "end", fill: "var(--ink-muted)", "font-size": 12 }, svg);
      t.textContent = fmtMoney(v);
    }
    if (minV < 0 && maxV > 0) {
      el("line", { x1: padL, x2: w - padR, y1: zeroY, y2: zeroY, stroke: "var(--ink-muted)", "stroke-width": 1, "stroke-dasharray": "3,3" }, svg);
    }
    categories.forEach((cat, i) => {
      if (i % skip !== 0) return;
      const x = padL + i * xStep;
      const t = el("text", { x, y: h - padB + 20, "text-anchor": "middle", fill: "var(--ink-muted)", "font-size": 12 }, svg);
      t.textContent = cat;
    });

    const pts = values.map((v, i) => [padL + i * xStep, yFor(v)]);
    const linePath = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0] + " " + p[1]).join(" ");
    const areaPath = linePath + ` L ${pts[pts.length - 1][0]} ${zeroY} L ${pts[0][0]} ${zeroY} Z`;
    el("path", { d: areaPath, fill: `url(#${gradId})`, stroke: "none" }, svg);
    el("path", { d: linePath, fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);

    const last = pts[pts.length - 1];
    el("circle", { cx: last[0], cy: last[1], r: 4.5, fill: color, stroke: "var(--bg-card)", "stroke-width": 2 }, svg);
    const lastLabel = el("text", {
      x: last[0] + 8, y: last[1] + 4, "text-anchor": "start", fill: "var(--ink-primary)", "font-size": 13, "font-weight": 700,
    }, svg);
    lastLabel.textContent = fmtMoney(values[values.length - 1]);

    const hit = el("rect", { x: padL, y: padT, width: plotW, height: plotH, fill: "transparent" }, svg);
    hit.style.cursor = "crosshair";
    hit.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / rect.width) * w;
      const idx = Math.max(0, Math.min(categories.length - 1, Math.round((relX - padL) / (xStep || 1))));
      showTip(e, `<b>${categories[idx]}</b><br>${opts.label || "Value"}: ${fmtMoney(values[idx])}`);
    });
    hit.addEventListener("mouseleave", hideTip);
    container.appendChild(svg);
  }

  return { groupedBar, horizontalBar, verticalBar, barChart, lineChart, areaChart, SERIES_COLORS, fmtMoney };
})();
