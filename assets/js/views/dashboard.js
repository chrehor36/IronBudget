const IB_VIEW_DASHBOARD = {
  title: "Dashboard",
  render(container, data) {
    const agg = data.agg;
    const accts = agg.accounts;
    const acctNote = accts.length > 1 ? `${accts.length} accounts: ${accts.join(", ")}` : `${accts[0]} account`;

    let html = `<div class="page-header">
      <h1>${window.__ironbudget.budgetTitle || "Dashboard"}</h1>
      <div class="sub">${agg.START} - ${agg.END} (${agg.DAYS} days, ~${agg.MONTHS.toFixed(1)} months) | ${acctNote}</div>
    </div>`;

    html += `<div class="kpi-row">
      <div class="kpi-tile"><div class="label">Total income / mo</div><div class="value">${IB_CHARTS.fmtMoney(agg.inc_m)}</div><div class="note">Paychecks, refunds, interest</div></div>
      <div class="kpi-tile"><div class="label">Total expenses / mo</div><div class="value">${IB_CHARTS.fmtMoney(agg.exp_m)}</div><div class="note">Adjusted spend</div></div>
      <div class="kpi-tile"><div class="label">Surplus / mo</div><div class="value ${agg.net_m >= 0 ? "" : ""}" style="color:${agg.net_m >= 0 ? "var(--status-good)" : "var(--status-critical)"}">${IB_CHARTS.fmtMoney(agg.net_m)}</div><div class="note">Income minus expenses</div></div>
      <div class="kpi-tile" id="dash-essentials-tile"><div class="label">Essentials / mo</div><div class="value">-</div><div class="note">Loading...</div></div>`;
    if (agg.has_transfers) {
      html += `<div class="kpi-tile"><div class="label">Moved between accounts / mo</div><div class="value">${IB_CHARTS.fmtMoney(agg.xfer_m)}</div><div class="note">${IB_CHARTS.fmtMoney(agg.xfer_total)} total across ${accts.length} accounts</div></div>`;
    }
    html += `</div>`;

    const gap = agg.net_m - agg.xfer_m;
    let banner, bannerClass;
    if (gap >= 0 || !agg.has_transfers) {
      banner = `Income covers expenses with ${IB_CHARTS.fmtMoney(agg.net_m)}/mo to spare.`;
      bannerClass = "good";
    } else {
      banner = `Bills covered with ${IB_CHARTS.fmtMoney(agg.net_m)}/mo to spare, but your savings pace runs ${IB_CHARTS.fmtMoney(-gap)}/mo ahead of that surplus.`;
      bannerClass = "warn";
    }
    html += `<div class="banner ${bannerClass}" id="dash-banner">${banner}</div>`;

    html += `<div class="card chart-card"><h2>Top 10 categories</h2><div id="dash-cat-bar"></div></div>`;

    if (agg.detected_trips && agg.detected_trips.length) {
      html += `<div class="card"><h2>Auto-detected trips (home base: ${agg.home_state})</h2><div id="dash-trips"></div></div>`;
    } else if (agg.trip_cost || agg.trip_reimb) {
      html += `<div class="card"><h2>Trip reconciliation</h2><table class="data-table">
        <tr><td>Trip expenses fronted</td><td class="num">${IB_CHARTS.fmtMoney(agg.trip_cost)}</td></tr>
        <tr><td>Reimbursement received</td><td class="num">${IB_CHARTS.fmtMoney(agg.trip_reimb)}</td></tr>
        <tr class="total"><td>Net out of pocket</td><td class="num">${IB_CHARTS.fmtMoney(agg.trip_reimb - agg.trip_cost)}</td></tr>
      </table></div>`;
    }

    const lumpy = agg.lumpy.slice(0, 14);
    html += `<div class="card"><h2>Notable one-time purchases (&ge; $100)</h2><table class="data-table"><tbody>`;
    lumpy.forEach((t) => {
      html += `<tr><td>${t.date} - ${t.desc} (${t.cat})</td><td class="num">${IB_CHARTS.fmtMoney(-t.amt)}</td></tr>`;
    });
    html += `</tbody></table></div>`;

    container.innerHTML = html;

    // Top 10 only here - full detail (every category, as a table and a
    // matching bar chart) lives on the Categories page; this is a
    // glance-only view, so showing the same everything-table there too was
    // pure redundancy.
    const catSorted = agg.cat_sorted;
    const total = agg.exp_adj;
    const top10 = catSorted.slice(0, 10);
    const barData = top10.map(([label, value], i) => ({
      label, value, pct: total ? (value / total) * 100 : 0, color: IB_CHARTS.SERIES_COLORS[i % IB_CHARTS.SERIES_COLORS.length],
    }));
    IB_CHARTS.verticalBar(document.getElementById("dash-cat-bar"), barData);

    if (agg.detected_trips && agg.detected_trips.length) {
      const host = document.getElementById("dash-trips");
      let tt = `<table class="data-table"><thead><tr><th>Dates</th><th>State(s)</th><th class="num">Cost</th><th>Reimbursement</th></tr></thead><tbody>`;
      agg.detected_trips.forEach((d) => {
        const span = d.start === d.end ? d.start : `${d.start} - ${d.end}`;
        const reimb = d.reimb_amt ? `${IB_CHARTS.fmtMoney(d.reimb_amt)} on ${d.reimb_date}` : "none found - counted as a real expense";
        tt += `<tr><td>${span}</td><td>${d.locations.join(", ")}</td><td class="num">${IB_CHARTS.fmtMoney(d.cost)}</td><td>${reimb}</td></tr>`;
      });
      tt += `<tr class="total"><td colspan="2">Total</td><td class="num">${IB_CHARTS.fmtMoney(agg.trip_cost)}</td><td></td></tr></tbody></table>`;
      const netOop = agg.trip_cost - agg.trip_reimb;
      tt += `<div class="note" style="margin-top:8px; color:var(--ink-muted);">Net out of pocket across all detected trips: ${IB_CHARTS.fmtMoney(netOop)}</div>`;
      host.innerHTML = tt;
    }

    // Essentials classification is settings-driven (same source as the
    // Savings page's "Where you could cut back" card) - fetched async so the
    // rest of the dashboard doesn't wait on it.
    IB_API.call("get_spend_classification").then((classification) => {
      const cats = catSorted.map(([c]) => c);
      const necessarySet = new Set(classification ? classification.necessary_categories : ib_defaultNecessary(cats));
      const essentialsTotal = catSorted.reduce((sum, [c, v]) => sum + (necessarySet.has(c) ? v : 0), 0);
      const tile = document.getElementById("dash-essentials-tile");
      if (!tile) return;
      tile.querySelector(".value").textContent = IB_CHARTS.fmtMoney(essentialsTotal / agg.MONTHS);
      tile.querySelector(".note").textContent = "What it costs to live - see Savings for the full breakdown";
    });

    // Swap the plain computed banner for an AI-generated one-sentence
    // summary once it's ready - keeps the instant fallback above so the
    // dashboard never waits on the model to show something.
    IB_API.call("get_dashboard_insight").then((result) => {
      const el = document.getElementById("dash-banner");
      if (!el || !result || !result.ok || !result.insight) return;
      el.textContent = result.insight;
    }).catch(() => {});
  },
};
