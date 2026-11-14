// Token Launch Radar dashboard: board, filter, sort, detail view.
// Reads window.RADAR_DATA from data.js next to the page. No network.
(function () {
  var data = (window.RADAR_DATA && window.RADAR_DATA.rows) || [];
  var state = { q: '', cat: '', pre: true, watch: false, sort: 'rank', dir: 1, sel: null };
  var rowsEl = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var detailEl = document.getElementById('detail');
  var catEl = document.getElementById('cat');

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'k';
    return '$' + Math.round(n);
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = data.filter(function (r) {
      if (state.pre && !r.pre_token) return false;
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    out.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (typeof av === 'string') return av.localeCompare(bv) * state.dir;
      return ((av || 0) - (bv || 0)) * state.dir;
    });
    return out;
  }
  function render() {
    var list = filtered();
    countEl.textContent = list.length + ' of ' + data.length + ' protocols';
    var html = '';
    list.forEach(function (r) {
      var chg = r.change_7d === null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%';
      var cls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
      html += '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="sel"' : '') + '>'
        + '<td class="num">' + r.rank + '</td>'
        + '<td><b>' + esc(r.name) + '</b>' + (r.on_watchlist ? '<span class="badge">watchlist</span>' : '') + '<br><span style="color:var(--mut);font-size:12px">' + esc(r.slug) + '</span></td>'
        + '<td>' + esc(r.category) + '</td>'
        + '<td>' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>'
        + '<td class="num">' + money(r.tvl_usd) + '</td>'
        + '<td class="num ' + cls + '">' + chg + '</td>'
        + '<td class="num val">' + money(r.implied_value_usd) + '</td>'
        + '<td>' + r.farm_steps.length + ' steps</td></tr>';
    });
    rowsEl.innerHTML = html || '<tr><td colspan="8">No protocols match this filter.</td></tr>';
  }
  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < data.length; i++) if (data[i].slug === slug) { r = data[i]; break; }
    if (!r) { detailEl.classList.add('hidden'); state.sel = null; return; }
    state.sel = slug;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    detailEl.innerHTML = '<button class="close" id="dx">Close</button>'
      + '<h2>' + esc(r.name) + '</h2>'
      + '<p class="meta">Rank ' + r.rank + ' · ' + esc(r.category) + ' · ' + esc(r.chains.join(', '))
      + ' · TVL ' + money(r.tvl_usd) + ' · listed ' + (r.listed_at || 'unknown')
      + (r.pre_token ? ' · records no token' : ' · token already trades') + '</p>'
      + '<div class="big">' + money(r.implied_value_usd) + ' <span style="font-size:13px;color:var(--mut)">implied value · ' + r.value_multiple + '× TVL</span></div>'
      + '<h3>Farm plan</h3><ol>' + steps + '</ol>';
    detailEl.classList.remove('hidden');
    document.getElementById('dx').addEventListener('click', function () {
      state.sel = null; detailEl.classList.add('hidden'); render();
      if (location.hash.indexOf('#/p/') === 0) history.replaceState(null, '', '#/');
    });
    render();
  }
  function applyHash() {
    var h = location.hash || '';
    var m = h.match(/^#\/p\/([\w\-.]+)/);
    if (m) { showDetail(m[1]); return; }
    var f = h.match(/^#\/f\/(.+)$/);
    if (f) {
      var cat = decodeURIComponent(f[1]);
      if (catEl.querySelector('option[value="' + cat.replace(/"/g, '') + '"]')) {
        state.cat = cat; catEl.value = cat;
      }
    }
    render();
  }
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
  catEl.addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  document.getElementById('pre').addEventListener('change', function (e) { state.pre = e.target.checked; render(); });
  document.getElementById('watch').addEventListener('change', function (e) { state.watch = e.target.checked; render(); });
  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = 1; }
      render();
    });
  });
  rowsEl.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  window.addEventListener('hashchange', applyHash);

  var cats = [];
  data.forEach(function (r) { if (cats.indexOf(r.category) === -1) cats.push(r.category); });
  cats.sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; catEl.appendChild(o);
  });
  var pre = data.filter(function (r) { return r.pre_token; }).length;
  var top = data.length ? data[0] : null;
  document.getElementById('stats').innerHTML =
    '<div class="stat"><b>' + data.length + '</b><span>rows</span></div>'
    + '<div class="stat"><b>' + pre + '</b><span>pre-token</span></div>'
    + '<div class="stat"><b>' + (top ? money(top.implied_value_usd) : '—') + '</b><span>top value</span></div>';
  applyHash();
})();
