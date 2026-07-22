const IB_VIEW_TRANSFERS = {
  title: "Transfers",
  render(container, data) {
    const agg = data.agg;
    const months = agg.months;
    const labels = months.map((k) => {
      const [y, m] = k.split("-");
      return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
    });
    let html = `<div class="page-header"><h1>Transfers between your own accounts</h1>
      <div class="sub">Money moving between ${agg.accounts.join(" and ")} - this is not spending, it's just parked in a different one of your own accounts.</div></div>`;
    html += `<div class="card"><h2>Moved by month</h2><div id="xfer-bar"></div></div>`;
    html += `<div class="card"><h2>By account</h2>
      <div class="sub" style="margin-bottom:12px;">"Sent" is money that left that account for another one of yours; "Received" is money that arrived from another one of yours - the same dollar moving from Checking to Savings shows up as Sent under Checking and Received under Savings.</div>
      <table class="data-table"><thead><tr><th>Account</th><th class="num">Sent</th><th class="num">Received</th><th class="num">Net</th></tr></thead><tbody>`;
    const allAccts = new Set([...Object.keys(agg.xfer_by_acct), ...Object.keys(agg.xfer_in_by_acct)]);
    const acctRows = [...allAccts].map((a) => {
      const out = agg.xfer_by_acct[a] || 0, into = agg.xfer_in_by_acct[a] || 0;
      return [a, out, into, into - out];
    }).sort((a, b) => (b[1] + b[2]) - (a[1] + a[2]));
    acctRows.forEach(([a, out, into, net]) => {
      html += `<tr><td>${a}</td><td class="num">${IB_CHARTS.fmtMoney(out)}</td><td class="num">${IB_CHARTS.fmtMoney(into)}</td>
        <td class="num" style="color:${net >= 0 ? "var(--status-good)" : "var(--ink-secondary)"};">${net >= 0 ? "+" : ""}${IB_CHARTS.fmtMoney(net)}</td></tr>`;
    });
    html += `<tr class="total"><td>Total moved</td><td class="num">${IB_CHARTS.fmtMoney(agg.xfer_total)}</td><td class="num">${IB_CHARTS.fmtMoney(agg.xfer_total)}</td><td class="num">$0</td></tr>`;
    html += `</tbody></table></div>`;
    container.innerHTML = html;

    IB_CHARTS.groupedBar(document.getElementById("xfer-bar"), labels, [
      { label: "Transferred out", color: "var(--series-7)", values: months.map((k) => agg.m_xfer[k] || 0) },
    ]);
  },
};
