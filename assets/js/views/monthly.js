const IB_VIEW_MONTHLY = {
  title: "Monthly",
  render(container, data) {
    const agg = data.agg;
    const months = agg.months;
    const labels = months.map((k) => {
      const [y, m] = k.split("-");
      return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
    });
    let html = `<div class="page-header"><h1>Monthly Cash Flow</h1>
      <div class="sub">Transfers between your own accounts shown separately.</div></div>`;
    html += `<div class="card"><h2>Income, expenses, net</h2><table class="data-table"><thead><tr>
      <th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th><th class="num">Transferred out</th>
      </tr></thead><tbody>`;
    let totInc = 0, totExp = 0, totXfer = 0;
    months.forEach((k, i) => {
      const inc = agg.m_inc[k] || 0, exp = agg.m_exp_adj[k] || 0, xfer = agg.m_xfer[k] || 0;
      totInc += inc; totExp += exp; totXfer += xfer;
      html += `<tr><td>${labels[i]}</td><td class="num">${IB_CHARTS.fmtMoney(inc)}</td><td class="num">${IB_CHARTS.fmtMoney(exp)}</td>
        <td class="num">${IB_CHARTS.fmtMoney(inc - exp)}</td><td class="num">${IB_CHARTS.fmtMoney(xfer)}</td></tr>`;
    });
    html += `<tr class="total"><td>Total</td><td class="num">${IB_CHARTS.fmtMoney(totInc)}</td><td class="num">${IB_CHARTS.fmtMoney(totExp)}</td>
      <td class="num">${IB_CHARTS.fmtMoney(totInc - totExp)}</td><td class="num">${IB_CHARTS.fmtMoney(totXfer)}</td></tr>`;
    html += `</tbody></table></div>`;
    html += `<div class="card"><h2>Income vs expenses by month</h2><div id="monthly-bar"></div></div>`;
    html += `<div class="card"><h2>Net cash flow by month</h2><div id="monthly-line"></div></div>`;
    container.innerHTML = html;

    IB_CHARTS.groupedBar(document.getElementById("monthly-bar"), labels, [
      { label: "Income", color: "var(--series-2)", values: months.map((k) => agg.m_inc[k] || 0) },
      { label: "Expenses", color: "var(--series-1)", values: months.map((k) => agg.m_exp_adj[k] || 0) },
    ]);
    IB_CHARTS.lineChart(document.getElementById("monthly-line"), labels, [
      { label: "Net", color: "var(--series-5)", values: months.map((k) => (agg.m_inc[k] || 0) - (agg.m_exp_adj[k] || 0)) },
    ]);
  },
};
