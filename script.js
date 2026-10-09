(() => {
  const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
  const K = {regs:"campusconnect.registrations", prof:"campusconnect.profile", saved:"campusconnect.saved", prefs:"campusconnect.prefs"};
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  let EVENTS = [], regs = {}, saved = [], profile = load(K.prof, {});
  const day = n => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + n); return d; };

  // ---------- API (Flask + SQLite) ----------
  // No login: each browser gets an anonymous student id that tags its registrations and saved events.
  const sid = load("campusconnect.student", null) || (() => {
    const v = crypto.randomUUID?.() || Date.now() + Math.random().toString(36).slice(2);
    store("campusconnect.student", v); return v;
  })();
  async function api(path, opts = {}) {
    const res = await fetch("/api" + path, {headers: {"Content-Type": "application/json"}, ...opts});
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Something went wrong");
    return data;
  }
  async function sync() {
    const [ev, rg, sv] = await Promise.all([api("/events"), api("/registrations/" + sid), api("/saved/" + sid)]);
    EVENTS = ev.map(e => { const date = new Date(e.date + "T00:00:00"); return {...e, date, off: Math.round((date - day(0)) / 864e5)}; });
    regs = Object.fromEntries(rg.map(r => [r.event_id, {...r, roll: r.roll_number}]));
    saved = sv; refresh();
  }
  const register = async (id, d) => {
    const r = await api("/registrations", {method: "POST", body: JSON.stringify({student_id: sid, event_id: id, name: d.name, email: d.email, roll_number: d.roll})});
    await sync(); return r;
  };
  const state = {q:"", cat:"All", when:"all", open:false, sort:"date",
    theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", ...load(K.prefs, {})};

  const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = (d, o) => d.toLocaleDateString("en-IN", o);
  const left = e => e.left;
  const rel = e => { const n = Math.round((e.date - day(0)) / 864e5); return n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`; };
  const byId = id => EVENTS.find(e => e.id === id);
  const dateBlock = e => `<div class="date"><small>${fmt(e.date,{month:"short"}).toUpperCase()}</small><b>${e.date.getDate()}</b><small>${fmt(e.date,{weekday:"short"})}</small></div>`;

  // ---------- Cards ----------
  const card = e => {
    const l = left(e), s = saved.includes(e.id);
    const tag = regs[e.id] ? `<span class="tag reg">Registered</span>` : l <= 0 ? `<span class="tag full">Full</span>`
      : l / e.seats <= .25 ? `<span class="tag hot">Filling fast · ${l} left</span>` : `<span class="tag">${l} seats left</span>`;
    return `<article class="card" tabindex="0" data-id="${e.id}" role="button" aria-label="${esc(e.title)}, view details">
      <button class="heart${s ? " on" : ""}" data-save="${e.id}" aria-pressed="${s}" aria-label="${s ? "Remove from saved" : "Save event"}">${s ? "♥" : "♡"}</button>
      ${dateBlock(e)}<div><h3>${esc(e.title)}</h3><div class="meta">${rel(e)} · ${e.time} · ${esc(e.venue)}</div><div class="meta">${esc(e.cat)} · ${esc(e.club)}</div>${tag}</div></article>`;
  };

  const buildChips = () => {
    const cats = ["All", ...new Set(EVENTS.map(e => e.cat))];
    $("#chips").innerHTML = cats.map(c => `<button class="chip" data-cat="${c}">${c}</button>`).join("");
  };

  const isDefault = () => !state.q && state.cat === "All" && state.when === "all" && !state.open;
  function filtered() {
    const q = state.q.toLowerCase();
    const list = EVENTS.filter(e =>
      (state.cat === "All" || e.cat === state.cat) &&
      (!q || [e.title, e.venue, e.club, e.cat].some(t => t.toLowerCase().includes(q))) &&
      (state.when === "all" ||
  (e.off >= 0 &&
   e.off <= (state.when === "week" ? 7 : 30))) &&
      (!state.open || left(e) > 0));
    const sorts = {date:(a,b)=>a.date-b.date, seats:(a,b)=>left(b)-left(a), name:(a,b)=>a.title.localeCompare(b.title)};
    return list.sort(sorts[state.sort]);
  }

  function renderGrid() {
    const list = filtered();
    $("#count").textContent = `${list.length} event${list.length === 1 ? "" : "s"} found`;
    $("#clear").hidden = isDefault();
    $$(".chip").forEach(c => c.classList.toggle("on", c.dataset.cat === state.cat));
    $("#grid").innerHTML = list.length ? list.map(card).join("") : `<div class="empty" style="grid-column:1/-1">No events match your filters.<br><br><button class="btn" data-clear>Clear filters</button></div>`;
    store(K.prefs, state);
  }

  function renderSaved() {
    const list = EVENTS.filter(e => saved.includes(e.id)).sort((a, b) => a.date - b.date);
    $("#sbadge").textContent = list.length;
    $("#savedGrid").innerHTML = list.length ? list.map(card).join("") : `<div class="empty" style="grid-column:1/-1">Nothing saved yet. Tap the heart on any event to keep it here.</div>`;
  }

  function renderMine() {
    const mine = EVENTS.filter(e => regs[e.id]).sort((a, b) => a.date - b.date);
    $("#badge").textContent = mine.length;
    $("#stats").innerHTML = mine.length ? `${mine.length} registered · Next up: <b>${esc(mine[0].title)}</b> (${rel(mine[0]).toLowerCase()}) · <button class="link" data-clearall>Cancel all</button>` : "";
    $("#mineList").innerHTML = mine.length ? mine.map(e => `
      <div class="row">${dateBlock(e)}
        <div class="info"><h3>${esc(e.title)}</h3><div class="meta">${fmt(e.date,{weekday:"long",day:"numeric",month:"long"})} · ${e.time} · ${rel(e)}</div><div class="meta">${esc(e.venue)}</div><div class="meta">Ticket <span class="code">${regs[e.id].code}</span></div></div>
        <button class="btn ghost" data-ics="${e.id}">Add to calendar</button>
        <button class="btn ghost" data-view-id="${e.id}">Details</button>
        <button class="btn danger" data-cancel="${e.id}">Cancel</button>
      </div>`).join("") :
      `<div class="empty">You haven't registered for anything yet.<br><br><button class="btn" data-go="discover">Browse events</button></div>`;
  }

  const refresh = () => { renderGrid(); renderSaved(); renderMine(); };

  // ---------- Modal ----------
  const modal = $("#modal");
  modal.addEventListener("close", () => history.replaceState(null, "", location.pathname + location.search));
  function openEvent(id) {
    const e = byId(id), r = regs[id], l = left(e), s = saved.includes(id);
    const clash = EVENTS.find(x => x.id !== id && regs[x.id] && +x.date === +e.date && x.time === e.time);
    let action;
    if (r) action = `<p class="tag reg">Registered as ${esc(r.name)}</p><p>Your ticket: <span class="code">${r.code}</span></p>
      <div class="actions"><button class="btn danger" data-cancel="${id}">Cancel registration</button><button class="btn" data-ics="${id}">Add to calendar</button></div>`;
    else if (l <= 0) action = `<p class="tag full">This event is full</p>`;
    else action = `${clash ? `<p class="warn">Heads up: this starts at the same time as "${esc(clash.title)}", which you've registered for.</p>` : ""}
      <form id="regForm" data-id="${id}" novalidate>
        <label>Full name<input name="name" required minlength="2" autocomplete="name" value="${esc(profile.name || "")}"></label>
        <label>College email<input name="email" type="email" required autocomplete="email" value="${esc(profile.email || "")}"></label>
        <label>Roll number<input name="roll" required minlength="3" value="${esc(profile.roll || "")}"></label>
        <div class="actions"><button class="btn">Register</button></div></form>`;
    $("#modalBody").innerHTML = `<div class="m"><span class="tag">${esc(e.cat)}</span> <span class="tag">${rel(e)}</span><h2>${esc(e.title)}</h2><p>${esc(e.desc)}</p>
      <dl><dt>Date</dt><dd>${fmt(e.date,{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</dd><dt>Time</dt><dd>${e.time}</dd><dt>Venue</dt><dd>${esc(e.venue)}</dd><dt>Organiser</dt><dd>${esc(e.club)}</dd><dt>Seats</dt><dd>${Math.max(l,0)} of ${e.seats} left</dd></dl>
      <div class="row2"><button class="btn ghost" data-save="${id}">${s ? "♥ Saved" : "♡ Save"}</button><button class="btn ghost" data-share="${id}">Copy link</button><button class="btn ghost" data-close>Close</button></div>${action}</div>`;
    if (!modal.open) modal.showModal();
    history.replaceState(null, "", "#event=" + id);
  }

  // ---------- Helpers ----------
  function toast(msg, label, fn) {
    const t = $("#toast");
    t.innerHTML = esc(msg) + (label ? `<button>${label}</button>` : "");
    t.querySelector("button")?.addEventListener("click", () => { fn(); t.classList.remove("show"); });
    t.classList.add("show");
    clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.remove("show"), label ? 6000 : 2400);
  }

  function downloadIcs(e) {
    const [t, ap] = e.time.split(" "), [h, m] = t.split(":").map(Number);
    const s = new Date(e.date); s.setHours(h % 12 + (ap === "PM" ? 12 : 0), m);
    const end = new Date(s.getTime() + 72e5), p = n => String(n).padStart(2, "0");
    const f = d => `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
    const body = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//CampusConnect//EN","BEGIN:VEVENT",`UID:cc-${e.id}@campusconnect`,`DTSTAMP:${f(new Date())}`,
      `DTSTART:${f(s)}`,`DTEND:${f(end)}`,`SUMMARY:${e.title}`,`LOCATION:${e.venue}`,`DESCRIPTION:${e.desc}`,"END:VEVENT","END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], {type:"text/calendar"}));
    a.download = `${e.title.replace(/\W+/g, "-")}.ics`; a.click(); URL.revokeObjectURL(a.href);
    toast("Calendar file downloaded");
  }

  async function cancelReg(id) {
    const prev = regs[id];
    try { await api(`/registrations/${prev.id}?student_id=${sid}`, {method: "DELETE"}); } catch (e) { return toast(e.message); }
    modal.open && modal.close(); await sync();
    toast("Registration cancelled", "Undo", async () => { try { await register(id, prev); toast("Registration restored"); } catch (e) { toast(e.message); } });
  }

  async function toggleSave(id) {
    const on = saved.includes(id);
    try {
      await api(on ? `/saved/${sid}/${id}` : "/saved", on ? {method: "DELETE"} : {method: "POST", body: JSON.stringify({student_id: sid, event_id: id})});
      saved = on ? saved.filter(x => x !== id) : [...saved, id];
      refresh(); modal.open && openEvent(id); toast(on ? "Removed from saved" : "Saved for later");
    } catch (e) { toast(e.message); }
  }

  function setView(v) {
    $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === v));
    ["discover","saved","mine"].forEach(x => $("#" + x).hidden = x !== v);
    scrollTo({top:0});
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    $("#theme").textContent = state.theme === "dark" ? "Light" : "Dark";
  }

  // ---------- Events ----------
  document.addEventListener("click", ev => {
    const t = ev.target, q = s => t.closest(s);
    if (q("[data-save]")) { ev.stopPropagation(); return toggleSave(+q("[data-save]").dataset.save); }
    if (q("[data-cat]")) { state.cat = q("[data-cat]").dataset.cat; return renderGrid(); }
    if (q(".tab")) return setView(q(".tab").dataset.view);
    if (q("[data-go]")) return setView(q("[data-go]").dataset.go);
    if (q("#theme")) { state.theme = state.theme === "dark" ? "light" : "dark"; applyTheme(); return store(K.prefs, state); }
    if (q("#clear") || q("[data-clear]")) { Object.assign(state, {q:"", cat:"All", when:"all", open:false}); syncInputs(); return renderGrid(); }
    if (q("[data-ics]")) return downloadIcs(byId(+q("[data-ics]").dataset.ics));
    if (q("[data-share]")) {
      const url = location.href.split("#")[0] + "#event=" + q("[data-share]").dataset.share;
      return (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(() => toast("Link copied"), () => toast("Copy failed. Copy the address bar instead."));
    }
    if (q("[data-clearall]")) {
      if (confirm("Cancel all your registrations?")) Promise.all(Object.values(regs).map(r => api(`/registrations/${r.id}?student_id=${sid}`, {method: "DELETE"}))).then(sync).then(() => toast("All registrations cancelled"));
      return;
    }
    if (q("[data-cancel]")) return cancelReg(+q("[data-cancel]").dataset.cancel);
    if (q("[data-view-id]")) return openEvent(+q("[data-view-id]").dataset.viewId);
    if (q(".card")) return openEvent(+q(".card").dataset.id);
    if (q("[data-close]") || t === modal) modal.close();
  });

  document.addEventListener("keydown", ev => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName);
    if (ev.key === "/" && !typing && !modal.open) { ev.preventDefault(); setView("discover"); $("#search").focus(); }
    const c = ev.target.closest?.(".card");
    if (c && ev.target === c && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openEvent(+c.dataset.id); }
  });

  document.addEventListener("submit", async ev => {
    if (ev.target.id !== "regForm") return;
    ev.preventDefault();
    const f = ev.target;
    if (!f.checkValidity()) return f.reportValidity();
    const id = +f.dataset.id, d = Object.fromEntries(new FormData(f));
    Object.keys(d).forEach(k => d[k] = d[k].trim());
    try {
      const r = await register(id, d);
      profile = d; store(K.prof, profile); modal.close(); toast("You're registered! Ticket " + r.code);
    } catch (e) { toast(e.message); }
  });

  $("#search").addEventListener("input", e => { state.q = e.target.value.trim(); renderGrid(); });
  $("#when").addEventListener("change", e => { state.when = e.target.value; renderGrid(); });
  $("#sort").addEventListener("change", e => { state.sort = e.target.value; renderGrid(); });
  $("#open").addEventListener("change", e => { state.open = e.target.checked; renderGrid(); });

  function syncInputs() { $("#search").value = state.q; $("#when").value = state.when; $("#sort").value = state.sort; $("#open").checked = state.open; }

  // ---------- Init ----------
  applyTheme(); syncInputs(); setView("discover");
  sync().then(() => {
    buildChips(); renderGrid();
    const m = location.hash.match(/event=(\d+)/);
    if (m && byId(+m[1])) openEvent(+m[1]);
  }).catch(() => {
    $("#grid").innerHTML = `<div class="empty" style="grid-column:1/-1">Can't reach the CampusConnect server.<br>Start it with <code>python app.py</code> in the backend folder, then open <b>http://127.0.0.1:5000</b></div>`;
  });
})();
