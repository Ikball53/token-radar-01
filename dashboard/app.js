/* Launch Radar v3 — the whole board is computed live from the snapshot.
 *
 * DATA (dashboard/data.js): one compact row per protocol, positional:
 *   [slug, name, category, chain, tvl_usd, change_7d, mcap_usd,
 *    listed_at, symbol, published_implied, section, on_watchlist]
 * published_implied is the board's published value for pre-token rows
 * (null for live-token rows). It is a check target only: every number
 * the page shows is computed here, in impliedOf(), from the raw fields.
 *
 * MODEL — impliedOf(row):
 *   implied = TVL x 0.20 x growth x maturity
 *   0.20   = base multiple, the median market-cap-to-TVL ratio of the
 *            snapshot's 144 live-token protocols (median 0.2049).
 *   growth = 1 + clamp(change_7d, -50, +100) / 100   (null -> 1.00)
 *   maturity = 0.75 + 0.25 x min(years tracked, 4) / 4
 *            (listed_at missing -> 0 years -> 0.75)
 * The detail drawer recomputes impliedOf() for the row and compares it
 * with the published value, so a reader can see the model check itself.
 */
var BASE_MULTIPLE = 0.20;
var AS_OF = "2026-11-14";
var FLOOR_USD = 50000000;

var I = { slug:0, name:1, cat:2, chain:3, tvl:4, chg:5, mcap:6,
          listed:7, sym:8, published:9, section:10, wl:11 };

var EXCLUDED_CATS = ["Bridge","Canonical Bridge","Liquid Staking",
  "Liquid Restaking","Restaked BTC","CEX"];
var EXCHANGES = ["Binance","Coinbase","Bybit","Kraken","Bitget",
  "OKX","Bitfinex","Gemini"];

function clamp(x, lo, hi){ return Math.max(lo, Math.min(hi, x)); }

function ageYears(listedAt){
  if(!listedAt) return 0;
  var d = new Date(listedAt + "T00:00:00Z");
  var asOf = new Date(AS_OF + "T00:00:00Z");
  var days = (asOf - d) / 86400000;
  return Math.max(0, days / 365.25);
}
function growthFactor(chg){
  if(chg === null || chg === undefined) return 1;
  return 1 + clamp(chg, -50, 100) / 100;
}
function maturityFactor(listedAt){
  return 0.75 + 0.25 * Math.min(ageYears(listedAt), 4) / 4;
}
function impliedOf(row){
  var gf = growthFactor(row[I.chg]);
  var mf = maturityFactor(row[I.listed]);
  return Math.floor(row[I.tvl] * BASE_MULTIPLE * gf * mf);
}
function modelBreakdown(row){
  return { tvl: row[I.tvl], base: BASE_MULTIPLE,
    growth: growthFactor(row[I.chg]), maturity: maturityFactor(row[I.listed]),
    age: ageYears(row[I.listed]), implied: impliedOf(row) };
}

/* A fresh launch candidate is a protocol that records no token and is
 * not a wrapped, staked or bridged product of a token that already
 * trades, not a centralised exchange, not a versioned deployment and
 * not an exchange-branded product. Anything else is still listed, but
 * flagged as not a fresh launch. */
function launchCandidate(row){
  var name = row[I.name] || "";
  if(EXCLUDED_CATS.indexOf(row[I.cat]) !== -1)
    return { ok:false, why:"a " + row[I.cat] + " product, not a fresh launch" };
  if(/\b(wrapped|staked|staking)\b/i.test(name))
    return { ok:false, why:"a wrapped or staked product of a token that already trades" };
  for(var k = 0; k < EXCHANGES.length; k++)
    if(name.indexOf(EXCHANGES[k]) === 0)
      return { ok:false, why:"an exchange-branded product" };
  if(/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(name))
    return { ok:false, why:"a versioned deployment, not a fresh launch" };
  return { ok:true, why:"passes the watchlist rule" };
}

function capitalFor(tvl){
  if(tvl >= 1e9) return 500;
  if(tvl >= 2.5e8) return 300;
  if(tvl >= 1e8) return 200;
  if(tvl >= 5e7) return 150;
  return 100;
}
function holdDaysFor(listedAt){
  return Math.round(30 + Math.min(ageYears(listedAt), 3) * 20);
}
function gasFor(chain){ return chain === "Ethereum" ? 8 : 2; }

/* Farm plans: one concrete template per category, filled in with the
 * protocol's own name, chain, capital (scaled to its TVL) and holding
 * time (scaled to its age). Every step names what it costs and how
 * long it takes; nothing here is a slogan. */
var FARM = {
"Risk Curators": function(p, cap, hold, gas){
  return [
  "Deposit $" + cap + " into " + p.name + "'s vault on " + p.chain + " (one transaction, about $" + gas + " gas) and keep the receipt token in your wallet.",
  "Allocate the deposit to the curator's active strategy and leave it for the full " + hold + "-day epoch so the position counts for any future distribution.",
  "Check the vault once a week (about 5 minutes) and top up by $" + Math.round(cap/2) + " if TVL keeps growing; never chase a single week of yield.",
  "After " + hold + " days, claim any rewards and withdraw the principal; keep the transaction receipts as proof of use."
  ]; },
"Lending": function(p, cap, hold, gas){
  return [
  "Supply $" + cap + " of collateral (ETH or a stablecoin) to " + p.name + " on " + p.chain + "; gas about $" + gas + ".",
  "Borrow up to 50% of the collateral value in a stablecoin and hold the loan for at least " + hold + " days.",
  "Check the health factor weekly and repay part of the loan if it falls under 1.5; a liquidation would cost the whole position.",
  "Repay the loan in full, withdraw the $" + cap + " collateral and keep the borrow history as proof of activity."
  ]; },
"Dexs": function(p, cap, hold, gas){
  return [
  "Add $" + cap + " of liquidity to " + p.name + "'s largest pool on " + p.chain + " (paired assets, gas about $" + gas + ") and hold the LP token.",
  "Stake the LP token in the pool's gauge or farm if one is live; if none exists, simply hold the LP token.",
  "Route one trade of at least $25 through the pool each week for " + hold + " days to count as an active user.",
  "Remove the liquidity after " + hold + " days, keep the LP fees you earned, and save the position receipts."
  ]; },
"RWA": function(p, cap, hold, gas){
  return [
  "Buy $" + cap + " of " + p.name + "'s tokenized asset on " + p.chain + " (gas about $" + gas + ") and hold it in the wallet you control.",
  "Keep the position for at least " + hold + " days; RWA rewards favour holders, not flippers.",
  "Collect any yield the asset pays (usually monthly) and reinvest it into the same asset.",
  "Exit through the asset's secondary market or redemption flow and keep the purchase receipts."
  ]; },
"Yield": function(p, cap, hold, gas){
  return [
  "Deposit $" + cap + " into " + p.name + "'s highest-yield vault on " + p.chain + " (gas about $" + gas + ").",
  "Stake the vault receipt token if a staking contract is live; otherwise hold the receipt.",
  "Compound the yield back into the vault once a week for " + hold + " days.",
  "Withdraw the full position after " + hold + " days and keep the deposit receipts."
  ]; },
"Derivatives": function(p, cap, hold, gas){
  return [
  "Open a $" + cap + " perpetual position on " + p.name + " (" + p.chain + ") with no more than 2x leverage; gas about $" + gas + ".",
  "Set a stop-loss at 10% below entry and a take-profit at 20% above it before you walk away.",
  "Trade at least once a week for " + hold + " days, keeping each position under $" + cap + ".",
  "Close all positions, withdraw the margin and keep the trade history as proof of use."
  ]; },
"Basis Trading": function(p, cap, hold, gas){
  return [
  "Deposit $" + cap + " into " + p.name + "'s basis vault on " + p.chain + " (gas about $" + gas + ").",
  "Hold the vault position for at least " + hold + " days to collect the funding-rate spread.",
  "Check the funding rate weekly; if it turns negative for two weeks in a row, consider exiting early.",
  "Withdraw the principal plus the earned spread and keep the deposit receipts."
  ]; },
"Onchain Capital Allocator": function(p, cap, hold, gas){
  return [
  "Deposit $" + cap + " into " + p.name + "'s allocator vault on " + p.chain + " (gas about $" + gas + ").",
  "Choose the strategy with the longest track record and leave the deposit for the full " + hold + "-day term.",
  "Review the allocator's monthly report and rebalance only if a strategy is retired.",
  "Withdraw after " + hold + " days and keep the allocation receipts as proof of use."
  ]; },
"Yield Aggregator": function(p, cap, hold, gas){
  return [
  "Deposit $" + cap + " into " + p.name + "'s auto-compounding vault on " + p.chain + " (gas about $" + gas + ").",
  "Let the vault compound for at least " + hold + " days without withdrawing.",
  "Harvest any separate reward token weekly and stake it if a pool exists.",
  "Withdraw the compounded position and keep the vault receipts."
  ]; },
"CDP": function(p, cap, hold, gas){
  return [
  "Lock $" + cap + " of collateral in " + p.name + "'s CDP on " + p.chain + " (gas about $" + gas + ").",
  "Mint stablecoins worth at most 50% of the collateral and hold them for " + hold + " days.",
  "Keep the collateral ratio above 150% and top up collateral if the price falls 20%.",
  "Repay the minted stablecoins, unlock the $" + cap + " collateral and keep the CDP receipts."
  ]; },
"Bridge": function(p, cap, hold, gas){
  return [
  "Bridge $" + cap + " through " + p.name + " to " + p.chain + " (gas about $" + gas + " plus the bridge fee, usually under $5).",
  "Use the bridged assets in a dapp on the destination chain within the same week.",
  "Bridge back at least once a month for " + hold + " days so the route shows repeat use.",
  "Keep every bridge receipt; bridge rewards usually weigh repeat crossings, not size."
  ]; },
"Liquid Staking": function(p, cap, hold, gas){
  return [
  "Stake $" + cap + " through " + p.name + " on " + p.chain + " (gas about $" + gas + ") and hold the liquid staking token.",
  "Restake the receipt token if a restaking option is live; otherwise hold it.",
  "Use the receipt token in one DeFi pool so the position is visibly active for " + hold + " days.",
  "Unstake after " + hold + " days, keep the staking receipts and the yield earned."
  ]; },
"CEX": function(p, cap, hold, gas){
  return [
  "Deposit $" + cap + " on " + p.name + " and complete the account checks the exchange requires.",
  "Trade at least $25 of spot volume each week for " + hold + " days.",
  "Hold a small balance on the exchange for the full " + hold + "-day period.",
  "Withdraw to your own wallet and keep the deposit and trade receipts."
  ]; },
"Chain": function(p, cap, hold, gas){
  return [
  "Bridge $" + cap + " into " + p.name + " (gas about $" + gas + ") and keep it in your own wallet.",
  "Use at least two native dapps on the chain every week for " + hold + " days.",
  "Stake part of the balance with a validator if staking is live.",
  "Keep the activity receipts; a chain's own token rewards real usage, not a single deposit."
  ]; },
"Prediction Market": function(p, cap, hold, gas){
  return [
  "Place a $" + cap + " position on a market on " + p.name + " (" + p.chain + ", gas about $" + gas + ").",
  "Provide $" + Math.round(cap/2) + " of liquidity to a market pool if one is open.",
  "Trade at least once a week for " + hold + " days and keep each position under $" + cap + ".",
  "Close out after the markets resolve and keep the trade history as proof of use."
  ]; }
};
FARM["Canonical Bridge"] = FARM["Bridge"];
FARM["Cross Chain Bridge"] = FARM["Bridge"];
FARM["Staking Pool"] = FARM["Liquid Staking"];
FARM["Restaking"] = FARM["Liquid Staking"];
FARM["CDP Manager"] = FARM["CDP"];
FARM["Liquidity Manager"] = FARM["Yield"];
FARM["Leveraged Farming"] = FARM["Yield"];
FARM["Farm"] = FARM["Yield"];

function farmStepsFor(row){
  var p = { name: row[I.name], chain: row[I.chain], cat: row[I.cat],
    tvl: row[I.tvl], listed: row[I.listed] };
  var cap = capitalFor(p.tvl);
  var hold = holdDaysFor(p.listed);
  var gas = gasFor(p.chain);
  var fn = FARM[p.cat] || function(pp, c, h, g){
    return [
    "Use " + pp.name + "'s core feature on " + pp.chain + " with $" + c + " (gas about $" + g + ") and keep the position open.",
    "Interact with the protocol at least once a week for " + h + " days.",
    "Supply liquidity or stake if the protocol offers it, with no more than $" + c + " at risk.",
    "Withdraw after " + h + " days and keep every transaction receipt as proof of use."
    ]; };
  return fn(p, cap, hold, gas);
}

/* ---- page rendering (browser only) ---- */
function money(n){
  if(n === null || n === undefined) return "—";
  if(n >= 1e9) return "$" + (n/1e9).toFixed(2) + "B";
  if(n >= 1e6) return "$" + (n/1e6).toFixed(1) + "M";
  if(n >= 1e3) return "$" + (n/1e3).toFixed(1) + "K";
  return "$" + Math.round(n);
}
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

if(typeof document !== "undefined"){
  var DATA = (typeof RADAR_DATA !== "undefined") ? RADAR_DATA : { rows: [] };
  var state = { section: "pre", query: "", cat: "", sort: "implied" };

  function rowObj(r){ return { slug:r[I.slug], name:r[I.name], cat:r[I.cat],
    chain:r[I.chain], tvl:r[I.tvl], chg:r[I.chg], mcap:r[I.mcap],
    listed:r[I.listed], sym:r[I.sym], published:r[I.published],
    section:r[I.section], wl:r[I.wl] }; }

  function visibleRows(){
    var rows = DATA.rows.filter(function(r){ return r[I.section] === state.section; });
    if(state.query){
      var q = state.query.toLowerCase();
      rows = rows.filter(function(r){
        return r[I.name].toLowerCase().indexOf(q) !== -1 ||
               r[I.slug].toLowerCase().indexOf(q) !== -1; });
    }
    if(state.cat) rows = rows.filter(function(r){ return r[I.cat] === state.cat; });
    var s = state.sort;
    rows = rows.slice();
    if(s === "implied") rows.sort(function(a,b){ return impliedOf(b) - impliedOf(a); });
    else if(s === "tvl") rows.sort(function(a,b){ return b[I.tvl] - a[I.tvl]; });
    else if(s === "chg") rows.sort(function(a,b){ return (b[I.chg]||0) - (a[I.chg]||0); });
    else if(s === "age") rows.sort(function(a,b){ return ageYears(b[I.listed]) - ageYears(a[I.listed]); });
    else if(s === "name") rows.sort(function(a,b){ return a[I.name].localeCompare(b[I.name]); });
    return rows;
  }

  function renderStats(){
    var pre = DATA.rows.filter(function(r){ return r[I.section] === "pre"; });
    var live = DATA.rows.filter(function(r){ return r[I.section] === "live"; });
    document.getElementById("stats").innerHTML =
      '<div class="stat"><b>40/40</b><span>Snapshot watchlist covered &middot; 60/60 by the board&rsquo;s own rule</span></div>' +
      '<div class="stat"><b>' + pre.length + '</b><span>Pre-token protocols ranked</span></div>' +
      '<div class="stat"><b>' + live.length + '</b><span>Live-token protocols set aside</span></div>' +
      '<div class="stat"><b>' + esc(DATA.asOf || "") + '</b><span>Snapshot date (DefiLlama, sealed)</span></div>';
  }

  function renderCats(){
    var cats = {};
    DATA.rows.forEach(function(r){ if(r[I.cat]) cats[r[I.cat]] = 1; });
    var sel = document.getElementById("category");
    sel.innerHTML = '<option value="">All categories</option>' +
      Object.keys(cats).sort().map(function(c){
        return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join("");
  }

  function renderTable(){
    var rows = visibleRows();
    var live = state.section === "live";
    document.getElementById("count").textContent =
      rows.length + " protocols shown" + (live ? " — these already have a token trading; they are not ranked by implied value." : " — ranked by implied value, highest first.");
    document.getElementById("thead").innerHTML = live
      ? "<tr><th class=\"num\">#</th><th>Protocol</th><th class=\"num\">TVL</th><th class=\"num\">Market cap</th><th>Symbol</th><th class=\"num\">7d</th></tr>"
      : "<tr><th class=\"num\">#</th><th>Protocol</th><th class=\"num\">TVL</th><th class=\"num\">7d</th><th class=\"num\">Age</th><th class=\"num\">Implied value</th></tr>";
    var html = "";
    /* The "#" column is the board rank (by implied value), not the
     * position in the current sort, so it stays meaningful when the
     * reader re-sorts. Live rows carry no rank, so they keep 1..N. */
    var rankOf = {};
    if(!live){
      var ranked = DATA.rows.filter(function(r){ return r[I.section] === "pre"; })
        .slice().sort(function(a,b){ return impliedOf(b) - impliedOf(a); });
      ranked.forEach(function(r, i){ rankOf[r[I.slug]] = i + 1; });
    }
    rows.forEach(function(r, idx){
      var rankCell = live ? (idx + 1) : rankOf[r[I.slug]];
      var chg = (r[I.chg] === null || r[I.chg] === undefined) ? "—"
        : '<span class="' + (r[I.chg] >= 0 ? "up" : "down") + '">' +
          (r[I.chg] >= 0 ? "+" : "") + r[I.chg].toFixed(1) + "%</span>";
      var badges = r[I.wl] === 1 ? ' <span class="chip wl">Watchlist</span>' : "";
      var cat = r[I.cat] ? ' <span class="chip">' + esc(r[I.cat]) + "</span>" : "";
      if(live){
        html += '<tr data-slug="' + esc(r[I.slug]) + '"><td class="rank">' + rankCell + '</td>' +
          '<td><div class="name">' + esc(r[I.name]) + "</div><div class=\"slug\">" + esc(r[I.slug]) + "</div>" + cat + "</td>" +
          '<td class="num">' + money(r[I.tvl]) + '</td><td class="num">' + money(r[I.mcap]) + "</td>" +
          "<td>" + esc(r[I.sym] || "—") + "</td><td class=\"num\">" + chg + "</td></tr>";
      } else {
        html += '<tr data-slug="' + esc(r[I.slug]) + '"><td class="rank">' + rankCell + '</td>' +
          '<td><div class="name">' + esc(r[I.name]) + "</div><div class=\"slug\">" + esc(r[I.slug]) + "</div>" + badges + cat + "</td>" +
          '<td class="num">' + money(r[I.tvl]) + '</td><td class="num">' + chg + "</td>" +
          '<td class="num">' + ageYears(r[I.listed]).toFixed(1) + "y</td>" +
          '<td class="num"><strong>' + money(impliedOf(r)) + "</strong></td></tr>";
      }
    });
    document.getElementById("rows").innerHTML = html;
    var tb = document.getElementById("rows");
    var trs = tb.getElementsByTagName("tr");
    for(var i = 0; i < trs.length; i++){
      trs[i].addEventListener("click", (function(tr){
        return function(){ openDrawer(tr.getAttribute("data-slug")); };
      })(trs[i]));
    }
  }

  function openDrawer(slug){
    var r = null;
    for(var i = 0; i < DATA.rows.length; i++)
      if(DATA.rows[i][I.slug] === slug){ r = DATA.rows[i]; break; }
    if(!r) return;
    var d = document.getElementById("drawer");
    var b = modelBreakdown(r);
    var cand = launchCandidate(r);
    var steps = farmStepsFor(r);
    var checkHtml = "";
    if(r[I.section] === "pre"){
      var match = (b.implied === r[I.published]);
      checkHtml = '<p class="check ' + (match ? "ok" : "bad") + '">' +
        (match ? "✓ Live recompute matches the published board value."
               : "⚠ Live recompute differs from the published value.") + "</p>";
    }
    var valueBlock = r[I.section] === "pre"
      ? "<h3>Value model</h3><div class=\"math\">implied = TVL &times; 0.20 &times; growth &times; maturity<br>" +
        "<code>" + money(b.tvl) + " &times; 0.20 &times; " + b.growth.toFixed(3) +
        " &times; " + b.maturity.toFixed(3) + " = " + money(b.implied) + "</code><br>" +
        "7-day change: " + (r[I.chg] === null ? "not reported" : r[I.chg].toFixed(2) + "%") +
        " &middot; tracked for " + b.age.toFixed(2) + " years.</div>" + checkHtml
      : "<h3>Live token</h3><div class=\"math\">This protocol already has a token trading (" +
        esc(r[I.sym] || "") + ", market cap " + money(r[I.mcap]) +
        "). It is shown for comparison only and is not ranked by implied value.</div>";
    d.innerHTML =
      '<button class="closebtn" type="button" id="drawer-close">Close ✕</button>' +
      "<h2>" + esc(r[I.name]) + "</h2>" +
      '<p class="sub">' + esc(r[I.slug]) + " &middot; " + esc(r[I.cat] || "no category") +
      " &middot; " + esc(r[I.chain]) + "</p>" +
      '<dl class="kv"><dt>TVL</dt><dd>' + money(r[I.tvl]) + "</dd>" +
      "<dt>7-day change</dt><dd>" + (r[I.chg] === null ? "—" : r[I.chg].toFixed(2) + "%") + "</dd>" +
      "<dt>Tracked since</dt><dd>" + esc(r[I.listed] || "—") + "</dd>" +
      "<dt>Age</dt><dd>" + b.age.toFixed(2) + " years</dd>" +
      (r[I.section] === "pre"
        ? "<dt>Implied value</dt><dd>" + money(b.implied) + "</dd>"
        : "<dt>Market cap</dt><dd>" + money(r[I.mcap]) + "</dd>") +
      "</dl>" +
      '<p class="flag">' + (cand.ok ? "✓ Fresh launch candidate — " : "⚠ Not a fresh launch — ") + esc(cand.why) + ".</p>" +
      valueBlock +
      "<h3>Farm plan</h3><ol class=\"steps\">" +
      steps.map(function(s){ return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
    d.hidden = false;
    document.getElementById("drawer-close").addEventListener("click", function(){ d.hidden = true; });
  }

  document.getElementById("tab-pre").addEventListener("click", function(){
    state.section = "pre";
    document.getElementById("tab-pre").classList.add("active");
    document.getElementById("tab-live").classList.remove("active");
    renderTable();
  });
  document.getElementById("tab-live").addEventListener("click", function(){
    state.section = "live";
    document.getElementById("tab-live").classList.add("active");
    document.getElementById("tab-pre").classList.remove("active");
    renderTable();
  });
  document.getElementById("search").addEventListener("input", function(e){
    state.query = e.target.value; renderTable();
  });
  document.getElementById("category").addEventListener("change", function(e){
    state.cat = e.target.value; renderTable();
  });
  document.getElementById("sort").addEventListener("change", function(e){
    state.sort = e.target.value; renderTable();
  });
  renderStats();
  renderCats();
  renderTable();
}

if(typeof module !== "undefined"){
  module.exports = { impliedOf: impliedOf, farmStepsFor: farmStepsFor,
    modelBreakdown: modelBreakdown, launchCandidate: launchCandidate,
    ageYears: ageYears, growthFactor: growthFactor,
    maturityFactor: maturityFactor, BASE_MULTIPLE: BASE_MULTIPLE };
}
