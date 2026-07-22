const IB_VIEW_RECURRING = {
  title: "Subscriptions",
  render(container, data) {
    const agg = data.agg;
    let html = `<div class="page-header"><h1>Subscriptions (auto-detected)</h1>
      <div class="sub">Merchants billing on a roughly monthly cycle, at least 3 times. "Est. monthly" = total / months elapsed.</div></div>`;
    html += `<div class="card"><table class="data-table"><thead><tr>
      <th>Item</th><th class="num">Hits</th><th class="num">Total</th><th class="num">Est. monthly</th>
      </tr></thead><tbody>`;
    let subTotal = 0;
    const shown = agg.subscriptions;
    if (!shown.length) {
      html += `<tr><td colspan="4" style="text-align:center;color:var(--ink-muted);">No monthly subscriptions detected.</td></tr>`;
    }
    shown.forEach(([label, txns]) => {
      const tot = txns.reduce((s, t) => s - t.amt, 0);
      subTotal += tot;
      html += `<tr><td>${label}</td><td class="num">${txns.length}</td><td class="num">${IB_CHARTS.fmtMoney(tot)}</td>
        <td class="num">${IB_CHARTS.fmtMoney(tot / agg.MONTHS)}</td></tr>`;
    });
    if (shown.length) {
      html += `<tr class="total"><td>Total</td><td></td><td class="num">${IB_CHARTS.fmtMoney(subTotal)}</td>
        <td class="num">${IB_CHARTS.fmtMoney(subTotal / agg.MONTHS)}</td></tr>`;
    }
    html += `</tbody></table></div>`;
    container.innerHTML = html;
  },
};
