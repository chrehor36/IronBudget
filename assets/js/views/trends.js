const IB_VIEW_TRENDS = {
  title: "Trends",
  render(container, data) {
    const agg = data.agg;
    const weeks = Array.from(new Set([...Object.keys(agg.w_raw), ...Object.keys(agg.w_adj), ...Object.keys(agg.w_inc)])).sort();
    const labels = weeks.map((k) => new Date(k).toLocaleString(undefined, { month: "short", day: "numeric" }));
    let cum = 0;
    const cumSeries = weeks.map((k) => { cum += (agg.w_inc[k] || 0) - (agg.w_adj[k] || 0); return cum; });

    let html = `<div class="page-header"><h1>Spending trends</h1>
      <div class="sub">Weekly spend (Mon-start weeks) and cumulative surplus.</div></div>`;
    html += `<div class="card"><h2>Weekly spending</h2><div id="trend-weekly"></div></div>`;
    html += `<div class="card"><h2>Cumulative surplus</h2><div id="trend-cum"></div></div>`;
    container.innerHTML = html;

    // Just one series while trip tracking is disabled - "raw" and
    // "adjusted" are only different once trip spend gets excluded, and
    // showing two legend entries for two identical, fully-overlapping
    // lines was confusing rather than informative.
    IB_CHARTS.lineChart(document.getElementById("trend-weekly"), labels, [
      { label: "Weekly spending", color: "var(--series-1)", values: weeks.map((k) => agg.w_adj[k] || 0) },
    ], { labelSkip: Math.max(1, Math.floor(weeks.length / 12)) });
    IB_CHARTS.lineChart(document.getElementById("trend-cum"), labels, [
      { label: "Cumulative surplus", color: "var(--series-2)", values: cumSeries },
    ], { labelSkip: Math.max(1, Math.floor(weeks.length / 12)) });
  },
};
