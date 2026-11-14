// Token Launch Radar — dashboard logic (no network, no framework).
// Data comes from data.js (window.RADAR). Farm steps are rebuilt here from
// the same plan main.ts writes to board.json: chain sets gas, TVL sets the
// position size, 7-day change sets the tone.

(function () {
  'use strict';

  var DATA = window.RADAR || { asOf: '', floorUsd: 0, rows: [] };

  // Row fields, in order (see data.js header):
  // [slug, name, rank, implied_value_usd, tvl_usd, category, chains,
  //  change_7d, age_days, multiple_used, on_watchlist]
  function toRow(a) {
    return {
      slug: a[0], name: a[1], rank: a[2], value: a[3], tvl: a[4],
      category: a[5], chains: a[6], change: a[7], age: a[8],
      multiple: a[9], watch: a[10] === 1
    };
  }
  var ROWS = DATA.rows.map(toRow);
  var BY_SLUG = {};
  ROWS.forEach(function (r) { BY_SLUG[r.slug] = r; });

  // ------------------------------------------------------------ formatting

  function commas(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function money(n) { return '$' + commas(n); }
  function compact(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return money(n);
  }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function gasUsd(chain) {
    var table = {
      Ethereum: 3.0, Base: 0.05, Solana: 0.02, Arbitrum: 0.3, Optimism: 0.1,
      'BNB Chain': 0.15, Polygon: 0.05, Avalanche: 0.3, Blast: 0.05, Linea: 0.1,
      Scroll: 0.1, zkSync: 0.1, Mantle: 0.05, Sui: 0.02, Aptos: 0.02
    };
    return table[chain] || 0.5;
  }

  // ------------------------------------------------------------ farm plan

  // Same plan main.ts writes to board.json, rebuilt from the row's own figures.
  function farmPlanFor(r) {
    var primary = r.chains[0] || 'Ethereum';
    var gas = gasUsd(primary);
    var gasText = gas < 0.1 ? gas.toFixed(2) : gas.toFixed(1);
    var position = clamp(Math.round(r.tvl / 200000), 50, 400);
    var gasFund = Math.max(5, Math.ceil(gas * 12));
    var bridgeFee = Math.max(1, Math.round(gas * 4));
    var claimGas = Math.max(1, Math.ceil(gas * 3));
    var cat = (r.category || 'protocol').toLowerCase();
    var changeText = r.change === null
      ? 'with no 7-day change reported'
      : r.change >= 0
        ? 'up ' + r.change.toFixed(1) + '% over 7 days'
        : 'down ' + Math.abs(r.change).toFixed(1) + '% over 7 days';
    return [
      'Set up a fresh wallet and fund it with about ' + money(gasFund) + ' of ' + primary + ' gas plus ' + money(position) + ' for positions. A ' + primary + ' transaction costs roughly $' + gasText + ', so ' + money(gasFund) + ' covers 10+ transactions over the next 6 weeks.',
      'Bridge ' + money(position) + ' of stablecoins to ' + primary + ' through the chain\'s canonical bridge (about ' + money(bridgeFee) + ' in fees, 10-20 minutes) and keep ' + money(Math.max(2, Math.ceil(gas * 5))) + ' in reserve for gas so a later claim never strands you.',
      'Put ' + money(position) + ' to work in ' + r.name + '\'s ' + cat + ' product on ' + primary + ': deposit, hold the position for at least 4 weeks, and make a small second interaction in week 2 so the activity reads as real usage, not a one-off deposit.',
      'Repeat one small interaction a week for 6-8 weeks — a deposit, a withdrawal, or a vote — at about $' + gasText + ' in gas each, and watch the protocol\'s TVL (now ' + compact(r.tvl) + ', ' + changeText + ') to tell whether usage is growing or fading.',
      'Watch ' + r.name + ' for a token announcement; if one lands, claim inside the first 48 hours and budget about ' + money(claimGas) + ' in gas for the claim, then decide whether to hold the airdrop or sell half. The radar\'s implied value for this launch is ' + compact(r.value) + '.'
    ];
  }

  // ------------------------------------------------------------ controls

  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var chainEl = document.getElementById('chain');
  var sortEl = document.getElementById('sort');
  var watchEl = document.getElementById('watch');
  var rowsEl = document.getElementById('rows');
  var emptyEl = document.getElementById('empty');
  var detailEl = document.getElementById('detail');

  var cats = {};
  var chains = {};
  ROWS.forEach(function (r) {
    cats[r.category || 'Uncategorized'] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catEl.appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; chainEl.appendChild(o);
  });

  document.getElementById('asof').textContent = 'Snapshot ' + DATA.asOf;
  document.getElementById('counts').textContent =
    ROWS.length + ' protocols · ' + ROWS.filter(function (r) { return r.watch; }).length +
    ' on the watchlist · floor ' + compact(DATA.floorUsd);

  var state = { q: '', cat: '', chain: '', sort: 'value', watch: false, active: null };

  var SORTERS = {
    value: function (a, b) { return b.value - a.value; },
    tvl: function (a, b) { return b.tvl - a.tvl; },
    growth: function (a, b) { return (b.change || 0) - (a.change || 0); },
    age: function (a, b) { return (b.age || 0) - (a.age || 0); },
    name: function (a, b) { return a.name < b.name ? -1 : 1; }
  };

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return ROWS.filter(function (r) {
      if (state.watch && !r.watch) return false;
      if (state.cat && (r.category || 'Uncategorized') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    }).sort(SORTERS[state.sort] || SORTERS.value);
  }

  function changeCell(r) {
    if (r.change === null) return '<td class="num">&ndash;</td>';
    var cls = r.change >= 0 ? 'up' : 'down';
    var sign = r.change >= 0 ? '+' : '';
    return '<td class="num ' + cls + '">' + sign + r.change.toFixed(1) + '%</td>';
  }

  function renderBoard() {
    var list = visibleRows();
    var html = '';
    list.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '"' + (state.active === r.slug ? ' class="active"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' +
        (r.watch ? '<span class="badge">WATCHLIST</span>' : '') +
        '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorized') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + compact(r.tvl) + '</td>' +
        changeCell(r) +
        '<td class="num">' + (r.age === null ? '&ndash;' : r.age + 'd') + '</td>' +
        '<td class="num"><span class="val">' + compact(r.value) + '</span></td>' +
        '</tr>';
    });
    rowsEl.innerHTML = html;
    emptyEl.hidden = list.length > 0;
  }

  // ------------------------------------------------------------ detail view

  function svgBars(r) {
    // Log-scale bars: TVL vs implied value vs category-median value of the TVL.
    var items = [
      ['TVL', r.tvl, '#3ec9a7'],
      ['Implied value', r.value, '#f2b33d'],
      ['TVL x category multiple', Math.round(r.tvl * r.multiple), '#6f86b8']
    ];
    var maxLog = Math.log10(Math.max.apply(null, items.map(function (i) { return i[1]; })));
    var y = 8;
    var out = '';
    items.forEach(function (it) {
      var w = Math.max(4, (Math.log10(Math.max(1, it[1])) / maxLog) * 560);
      out += '<text x="0" y="' + (y + 12) + '" fill="#93a1bd" font-size="12">' + it[0] + '</text>' +
        '<rect x="170" y="' + y + '" width="' + w.toFixed(0) + '" height="16" rx="3" fill="' + it[2] + '"/>' +
        '<text x="' + (180 + w) + '" y="' + (y + 12) + '" fill="#e6ebf5" font-size="12">' + compact(it[1]) + '</text>';
      y += 30;
    });
    return '<figure class="chart"><figcaption>Value picture (log scale, USD)</figcaption>' +
      '<svg width="100%" height="' + (y + 4) + '" viewBox="0 0 900 ' + (y + 4) + '" role="img">' + out + '</svg></figure>';
  }

  function renderDetail(slug) {
    var r = BY_SLUG[slug];
    if (!r) { detailEl.hidden = true; return; }
    state.active = slug;
    var ageText = r.age === null ? 'not reported' : r.age + ' days';
    var changeText = r.change === null ? 'not reported' : (r.change >= 0 ? '+' : '') + r.change.toFixed(1) + '%';
    var steps = farmPlanFor(r).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    detailEl.innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' &middot; ' + esc(r.slug) + ' &middot; ' + esc(r.category || 'Uncategorized') +
      ' &middot; ' + esc(r.chains.join(', ')) + (r.watch ? ' &middot; on the watchlist' : '') + '</p>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + compact(r.value) + '</b><span>Implied launch value</span></div>' +
      '<div class="stat"><b>' + compact(r.tvl) + '</b><span>Total value locked</span></div>' +
      '<div class="stat"><b>' + r.multiple.toFixed(3) + '&times;</b><span>Category TVL multiple</span></div>' +
      '<div class="stat"><b>' + ageText + '</b><span>Tracked with no token recorded</span></div>' +
      '</div>' +
      svgBars(r) +
      '<p>TVL change over 7 days: <strong>' + changeText + '</strong>. This protocol records no token in the snapshot — that is the record, not proof it has none.</p>' +
      '<h3>How to farm it</h3><ol class="steps">' + steps + '</ol>';
    detailEl.hidden = false;
    renderBoard();
  }

  rowsEl.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr');
    if (tr) renderDetail(tr.getAttribute('data-slug'));
  });

  // Column headers sort the board.
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      var map = { rank: 'value', name: 'name', tvl: 'tvl', growth: 'growth', age: 'age', value: 'value' };
      if (map[k]) { sortEl.value = map[k]; state.sort = map[k]; renderBoard(); }
    });
  });

  qEl.addEventListener('input', function () { state.q = qEl.value; renderBoard(); });
  catEl.addEventListener('change', function () { state.cat = catEl.value; renderBoard(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; renderBoard(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; renderBoard(); });
  watchEl.addEventListener('change', function () { state.watch = watchEl.checked; renderBoard(); });

  // ------------------------------------------------------------ shot params

  var params = new URLSearchParams(window.location.search);
  var shot = params.get('shot') || 'board';
  if (shot === 'filtered') {
    // Pre-apply the most common category as the filtered view.
    var counts = {};
    ROWS.forEach(function (r) { var c = r.category || 'Uncategorized'; counts[c] = (counts[c] || 0) + 1; });
    var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    state.cat = top;
    catEl.value = top;
  }
  renderBoard();
  if (shot === 'detail') {
    // The detail shot shows the protocol's detail, not the board: hide the
    // board and controls so the detail sits right under the header.
    document.body.classList.add('shot-detail');
    renderDetail(params.get('slug') || (ROWS[0] && ROWS[0].slug));
  }
})();
