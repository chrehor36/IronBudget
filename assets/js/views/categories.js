const IB_VIEW_CATEGORIES = {
  title: "Categories",
  render(container, data) {
    const agg = data.agg;
    const catSorted = agg.cat_sorted;
    const total = agg.exp_adj;
    let html = `<div class="page-header"><h1>Where the money goes</h1>
      <div class="sub">Adjusted spend by category, full period.</div></div>`;
    html += `<div class="card-row two-col">
      <div class="card"><h2>All categories</h2><table class="data-table"><thead><tr>
        <th>Category</th><th class="num">Total</th><th class="num">Per month</th><th class="num">% of spend</th>
        </tr></thead><tbody>`;
    catSorted.forEach(([cat, v]) => {
      html += `<tr><td>${cat}</td><td class="num">${IB_CHARTS.fmtMoney(v)}</td><td class="num">${IB_CHARTS.fmtMoney(v / agg.MONTHS)}</td>
        <td class="num">${(total ? (v / total) * 100 : 0).toFixed(1)}%</td></tr>`;
    });
    html += `<tr class="total"><td>Total</td><td class="num">${IB_CHARTS.fmtMoney(total)}</td><td class="num">${IB_CHARTS.fmtMoney(agg.exp_m)}</td><td class="num">100%</td></tr>`;
    html += `</tbody></table></div>
      <div class="card chart-card"><h2>Spend by category</h2><div id="cat-bar"></div></div>
    </div>`;
    container.innerHTML = html;

    // Every category, same set the table shows - a top-N+Other cutoff here
    // would mean matching heights with the table forces a handful of bars
    // to stretch absurdly tall to fill the same space a full table needs.
    const barData = catSorted.map(([label, value]) => ({ label, value }));

    // Match the bar chart's height to its sibling table so neither card
    // shows dead space, whichever one happens to be taller.
    const tableCard = container.querySelector(".card-row.two-col .card:first-child");
    const refHeight = tableCard ? tableCard.getBoundingClientRect().height : 0;
    const rowHeight = refHeight ? Math.max(22, Math.min(44, (refHeight - 50) / barData.length)) : 38;
    IB_CHARTS.horizontalBar(document.getElementById("cat-bar"), barData, { rowHeight });
  },
};
