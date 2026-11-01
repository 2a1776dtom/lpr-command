/* Command UI. Local first. Sync turns on only after Setup has an endpoint, project id, and API key. */
(function () {
  var Store = window.CommandStore;
  var Home = window.CommandHome;
  var Xmind = window.CommandXmind;
  var backend = Store.browserBackend();
  var state = null;
  var ui = { area: 'All', urgency: 'All', sort: 'urgency', query: '', mode: 'map', selected: '', cam: null, jump: '', showAllTodos: false, showRules: false };
  var renderGen = 0;
  var saveTimer = null;
  var syncTimer = null;
  var toastTimer = null;
  var SWATCHES = ['#6F93B3', '#8FA3B5', '#6FAE8E', '#C4776F', '#E0B07A', '#A9C4DC', '#D7A98A', '#8E7CC3'];

  function plain(value) {
    return String(value == null ? '' : value)
      .replace(/\u2014/g, ' - ')
      .replace(/\u2013/g, ' - ')
      .replace(/\u2012/g, ' - ');
  }
  function esc(value) {
    return plain(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function toast(message) {
    var el = document.getElementById('toast');
    el.textContent = plain(message);
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2400);
  }
  function todayLA() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: 'numeric' }).format(new Date());
    } catch (err) {
      return new Date().toISOString().slice(0, 10);
    }
  }
  function greeting() {
    var hour = 12;
    var day = '';
    try {
      hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
      day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date());
    } catch (err) {
      day = '';
    }
    var hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return { hello: hello, day: day };
  }
  function parseHash() {
    var raw = (location.hash || '#home').replace(/^#/, '');
    var parts = raw.split('/');
    return { tab: parts[0] || 'home', id: decodeURIComponent(parts.slice(1).join('/')) };
  }
  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }
  var dictation = null;
  function findDecision(id) {
    return (state.decisions || []).filter(function (item) { return item.id === id; })[0] || null;
  }
  function findThought(id) {
    return (state.thoughts || []).filter(function (item) { return item.id === id; })[0] || null;
  }
  function sortedThoughts() {
    return (state.thoughts || []).slice().sort(function (a, b) {
      return String(b.created || b.updated || '').localeCompare(String(a.created || a.updated || ''));
    });
  }
  function thoughtLabel(thought) {
    var title = String(thought.title || '').trim();
    if (title) return title;
    var line = String(thought.text || '').replace(/\s+/g, ' ').trim();
    if (!line) return 'Untitled thought';
    return line.length > 80 ? line.slice(0, 79) + '...' : line;
  }
  function shortWhen(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso).slice(0, 10);
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      }).format(date);
    } catch (err) {
      return String(iso).slice(0, 16);
    }
  }
  function statusClass(status) {
    if (status === 'New') return 'new';
    if (status === 'Picked up') return 'picked';
    if (status === 'In progress') return 'progress';
    if (status === 'Done') return 'done';
    if (status === 'Parked') return 'parked';
    return '';
  }
  function linkify(text) {
    return esc(text).replace(/https?:\/\/[^\s<]+/g, function (url) {
      var clean = url.replace(/[),.;]+$/, '');
      return '<a href="' + clean + '" target="_blank" rel="noopener noreferrer">' + clean + '</a>' + url.slice(clean.length);
    });
  }
  function stopDictation() {
    if (!dictation) return;
    var rec = dictation.rec;
    dictation = null;
    try { rec.stop(); } catch (err) {}
    var btn = document.getElementById('dictateBtn');
    if (btn) btn.textContent = 'Dictate';
  }
  function joinSpeech(base, extra) {
    var left = String(base || '');
    var right = String(extra || '').replace(/^\s+/, '');
    if (!right) return left;
    if (!left) return right;
    if (/\s$/.test(left)) return left + right;
    return left + ' ' + right;
  }
  function startDictation(thought) {
    var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      toast('Use the microphone on your keyboard.');
      return;
    }
    if (dictation) { stopDictation(); return; }
    var rec = new Rec();
    var box = document.getElementById('thoughtText');
    var committed = box ? box.value : (thought.text || '');
    dictation = { rec: rec, thoughtId: thought.id };
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = function (event) {
      var finals = '';
      var interim = '';
      var i;
      for (i = event.resultIndex; i < event.results.length; i++) {
        var said = event.results[i][0] ? event.results[i][0].transcript : '';
        if (event.results[i].isFinal) finals += said;
        else interim += said;
      }
      if (finals) committed = joinSpeech(committed, finals);
      var shown = interim ? joinSpeech(committed, interim) : committed;
      thought.text = shown;
      thought.updated = Store.nowIso();
      if (box) box.value = shown;
      var hint = document.getElementById('saveHint');
      if (hint) hint.textContent = 'Saved on this phone';
      saveSoon();
    };
    rec.onerror = function (event) {
      var code = event && event.error;
      dictation = null;
      var btn = document.getElementById('dictateBtn');
      if (btn) btn.textContent = 'Dictate';
      if (code === 'not-allowed') toast('Allow the microphone, or use the keyboard microphone.');
      else if (code && code !== 'aborted' && code !== 'no-speech') toast('Dictation stopped. The keyboard microphone still works.');
    };
    rec.onend = function () {
      dictation = null;
      var btn = document.getElementById('dictateBtn');
      if (btn) btn.textContent = 'Dictate';
    };
    var btn = document.getElementById('dictateBtn');
    if (btn) btn.textContent = 'Stop';
    try { rec.start(); }
    catch (err) {
      dictation = null;
      if (btn) btn.textContent = 'Dictate';
      toast('Use the microphone on your keyboard.');
    }
  }
  function dropEmptyThought(id) {
    var thought = findThought(id);
    if (!thought) return;
    if (String(thought.text || '').trim() || String(thought.title || '').trim() || (thought.bot_notes || []).length || thought.linked_decision_id) return;
    state.thoughts = state.thoughts.filter(function (item) { return item.id !== id; });
    state.tombstones.push({ col: 'thoughts', id: id, updatedAt: Store.nowIso() });
    persist();
  }
  function makeDecisionFromThought(thought) {
    var id = Store.uid('d');
    var title = String(thought.title || '').trim() || thoughtLabel(thought);
    state.decisions.unshift({
      id: id,
      title: title.slice(0, 180),
      question: String(thought.text || title).slice(0, 2000),
      area: Store.AREAS.indexOf(thought.area) !== -1 ? thought.area : 'Home',
      urgency: 'Soon',
      options: [
        { id: id + 'a', label: 'Do it' },
        { id: id + 'b', label: 'Not yet' },
        { id: id + 'c', label: 'Park it' }
      ],
      recommendedId: id + 'a',
      chosenId: '',
      comment: '',
      note: 'From a thought.',
      said: '',
      raised: todayLA(),
      due: '',
      status: 'open',
      sample: false,
      source: 'thought',
      sourceKey: thought.id,
      updatedAt: Store.nowIso()
    });
    thought.linked_decision_id = id;
    if ((thought.status || 'New') === 'New') thought.status = 'Picked up';
    thought.updated = Store.nowIso();
    persist();
    go('#decision/' + encodeURIComponent(id));
  }
  function findMap(id) {
    return (state.maps || []).filter(function (map) { return map.id === id; })[0] || null;
  }
  function syncLabel() {
    var settings = state.settings || {};
    var el = document.getElementById('syncLabel');
    if (!settings.endpoint || !settings.projectId) el.textContent = 'On this phone';
    else if (!settings.apiKey) el.textContent = 'Add an API key to sync';
    else if (state.syncError) el.textContent = 'Sync needs a look';
    else if (state.lastSync) el.textContent = 'Synced';
    else el.textContent = 'Sync ready';
  }
  function measureHead() {
    var head = document.querySelector('.top');
    if (head) document.documentElement.style.setProperty('--head', head.offsetHeight + 'px');
  }
  function persist() {
    state.updatedAt = Store.nowIso();
    return backend.set('state', state).then(function () {
      scheduleSync();
    }).catch(function () {
      toast('Could not save on this phone.');
    });
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 350);
  }
  function scheduleSync() {
    if (!Store.syncConfigured(state.settings)) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, 1200);
  }
  function friendlySync(err) {
    var msg = String(err && err.message || '');
    if (/failed to fetch|network|load/i.test(msg)) return 'No signal. Saved on this phone.';
    if (/401|unauthorized|missing scope/i.test(msg)) return 'Appwrite refused the key.';
    return 'Sync failed. Saved on this phone.';
  }
  async function runSync() {
    if (!Store.syncConfigured(state.settings)) {
      state.syncError = state.settings && state.settings.endpoint ? 'Add an API key to sync.' : '';
      syncLabel();
      return;
    }
    try {
      var client = Store.createClient(state.settings);
      var result = await Store.syncState(state, client);
      if (!result.ok) state.syncError = result.reason === 'no-key' ? 'Add an API key to sync.' : 'Sync is off.';
      else state.syncError = '';
      await backend.set('state', state);
    } catch (err) {
      var message = friendlySync(err);
      if (state.syncError !== message) toast(message);
      state.syncError = message;
    }
    syncLabel();
    var route = parseHash();
    if (route.tab === 'home' || route.tab === 'decisions' || route.tab === 'decision') render();
  }

  function closeSheet() {
    document.querySelectorAll('.sheet-ov').forEach(function (node) { node.remove(); });
    document.body.classList.remove('noscroll');
  }
  function openSheet(title, body, setup) {
    closeSheet();
    var ov = document.createElement('div');
    ov.className = 'sheet-ov';
    ov.innerHTML = '<div class="sheet" role="dialog" aria-label="' + esc(title) + '"><div class="sheet-h"><b>' + esc(title) + '</b><button type="button" class="btn xbtn" data-x>Close</button></div><div class="sheet-b">' + body + '</div></div>';
    document.body.appendChild(ov);
    document.body.classList.add('noscroll');
    ov.querySelector('[data-x]').onclick = closeSheet;
    ov.addEventListener('click', function (event) { if (event.target === ov) closeSheet(); });
    if (setup) setup(ov);
    return ov;
  }
  function confirmBox(title, message, okLabel) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        closeSheet();
        resolve(value);
      }
      openSheet(title, '<p>' + esc(message) + '</p><div class="row"><button type="button" class="btn" data-no>Cancel</button><button type="button" class="btn primary" data-yes>' + esc(okLabel || 'Yes') + '</button></div>', function (ov) {
        ov.querySelector('[data-yes]').onclick = function () { finish(true); };
        ov.querySelector('[data-no]').onclick = function () { finish(false); };
        ov.addEventListener('click', function (event) { if (event.target === ov) finish(false); });
      });
    });
  }

  function decisionCard(item) {
    var options = (item.options || []).map(function (opt) {
      var cls = 'btn opt' + (opt.id === item.chosenId ? ' on' : '') + (opt.id === item.recommendedId ? ' sug' : '');
      return '<button type="button" class="' + cls + '" data-act="pick" data-id="' + esc(item.id) + '" data-opt="' + esc(opt.id) + '"><b>' + esc(opt.label) + '</b>' + (opt.id === item.recommendedId ? '<small>Suggested</small>' : '') + '</button>';
    }).join('');
    var clear = item.status === 'decided'
      ? '<button type="button" class="btn" data-act="pick" data-id="' + esc(item.id) + '" data-opt="' + esc(item.chosenId) + '">Clear pick</button>'
      : '';
    return '<article class="card decision" id="d-' + esc(item.id) + '">' +
      '<div class="pills">' +
        (item.sample ? '<span class="pill sample">Sample</span>' : '') +
        '<span class="pill">' + esc(item.area) + '</span>' +
        '<span class="pill ' + esc(String(item.urgency || '').toLowerCase()) + '">' + esc(item.urgency) + '</span>' +
        '<span class="pill ' + esc(item.status) + '">' + (item.status === 'decided' ? 'Decided' : 'Open') + '</span>' +
      '</div>' +
      '<h2>' + esc(item.title) + '</h2>' +
      '<p class="question">' + esc(item.question) + '</p>' +
      '<div class="options">' + options + '</div>' +
      clear +
      '<label class="fld">Comment<textarea data-act="comment" data-id="' + esc(item.id) + '">' + esc(item.comment || '') + '</textarea></label>' +
      '<div class="meta"><span>Raised ' + esc(item.raised || 'not set') + '</span><span>Due ' + esc(item.due || 'none') + '</span></div>' +
      '<div class="row"><button type="button" class="btn" data-act="edit-decision" data-id="' + esc(item.id) + '">Edit</button>' +
      '<button type="button" class="btn" data-act="note-decision" data-id="' + esc(item.id) + '">Note</button></div>' +
      (item.note ? '<p class="note">' + esc(item.note) + '</p>' : '') +
      (item.said ? '<p class="note">You said: ' + esc(item.said) + '</p>' : '') +
      '</article>';
  }

  function renderHome() {
    var hello = greeting();
    var todos = Store.openTodos(state);
    var shown = ui.showAllTodos ? todos : todos.slice(0, 8);
    var urgent = Store.filterDecisions(state.decisions, { urgency: 'Urgent', status: 'open', sort: 'urgency' });
    var homeCalls = Store.filterDecisions(state.decisions, { area: 'Home', status: 'open', sort: 'urgency' });
    var openCount = (state.decisions || []).filter(function (item) { return item.status !== 'decided'; }).length;
    var meals = state.home && state.home.meals ? state.home.meals : [];
    var projects = state.home && state.home.projects ? state.home.projects : [];
    var fun = (state.home && state.home.fun) || {};
    var top = (state.top3 || []).slice().sort(function (a, b) { return a.slot - b.slot; });
    var tiles = top.map(function (item) {
      var label = item.text ? esc(item.text) : 'Tap to set';
      return '<button type="button" class="dashbtn" data-act="open-top" data-slot="' + item.slot + '">' +
        (item.sample ? '<span class="pill sample">Sample</span>' : '') +
        '<b>' + label + '</b><small>Tap to open</small></button>';
    }).join('');
    var todoRows = shown.map(function (row) {
      var title = plain(row.node.title || '').replace(/\s+/g, ' ').trim();
      if (title.length > 140) title = title.slice(0, 139) + '...';
      return '<label class="todorow btn"><input type="checkbox" data-act="todo-check" data-map="' + esc(row.mapId) + '" data-id="' + esc(row.node.id) + '"><span><b>' + esc(title || 'Untitled') + '</b><small class="serv">' + esc(row.mapTitle) + (row.node.due ? ' · due ' + esc(row.node.due) : '') + '</small></span></label>';
    }).join('');
    var mealRows = meals.map(function (meal) {
      var servings = meal.servings === '' || meal.servings == null ? '' : (meal.servings + ' servings');
      return '<label class="checkrow btn"><input type="checkbox" data-act="meal-check" data-id="' + esc(meal.id) + '"' + (meal.checked ? ' checked' : '') + '><span><b>' + esc(meal.meal) + '</b><small class="serv">' + esc(servings) + (meal.ingredients ? ' · ' + esc(meal.ingredients) : '') + '</small></span></label>';
    }).join('');
    var shopRows = (state.home.shopping || []).map(function (line) {
      return '<label class="checkrow btn"><input type="checkbox" data-act="shop-check" data-id="' + esc(line.id) + '"' + (line.checked ? ' checked' : '') + '><span><b>' + esc(line.text) + '</b><small class="serv">Shopping line</small></span></label>';
    }).join('');
    var projectCards = projects.map(function (project, index) {
      var decision = (state.decisions || []).filter(function (item) { return item.sourceKey === project.title; })[0];
      var statusCls = /done/i.test(project.status) ? 'good' : /wait/i.test(project.status) ? 'bad' : 'steel';
      return '<article class="card project"><div class="pills"><span class="status ' + statusCls + '">' + esc(project.status || 'No status') + '</span>' +
        (project.pending ? '<span class="pill warn">Needs a call</span>' : '') + '</div><h3>' + esc(project.title) + '</h3>' +
        (project.next ? '<p>' + esc(project.next) + '</p>' : '') +
        (project.files ? '<p class="path">' + esc(project.files) + '</p><button type="button" class="btn" data-act="copy" data-text="' + esc(project.files) + '">Copy path</button>' : '') +
        (decision ? '<div class="row"><button type="button" class="btn primary" data-act="goto-decision" data-id="' + esc(decision.id) + '">Open decision</button></div>' : '') +
        '</article>';
    }).join('');
    var rules = (state.home.rules || []).map(function (rule) { return '<li>' + esc(rule) + '</li>'; }).join('');
    return '<div class="wrap">' +
      '<h1 id="greeting">' + esc(hello.hello) + '</h1><p class="sub">' + esc(hello.day) + '</p>' +
      '<button type="button" class="btn big primary wide" id="newThought" data-act="new-thought">New thought</button>' +
      '<section class="section" id="thoughtsHome"><h2>Thoughts</h2><p class="sub" id="thoughtCount">' + (state.thoughts || []).filter(function (item) { return (item.status || 'New') === 'New'; }).length + ' new</p>' +
        (sortedThoughts().slice(0, 3).map(function (thought) {
          return '<button type="button" class="maprow btn" data-act="open-thought" data-id="' + esc(thought.id) + '"><span class="thoughtline"><b>' + esc(thoughtLabel(thought)) + '</b><small>' + esc(thought.status || 'New') + ' · ' + esc(shortWhen(thought.created)) + '</small></span></button>';
        }).join('') || '<p class="empty">Nothing here yet. Tap New thought and talk.</p>') +
        '<button type="button" class="btn" data-act="tab" data-tab="thoughts">All thoughts</button></section>' +
      '<div class="jumps">' +
        '<button type="button" class="btn" data-act="jump" data-jump="thoughtsHome">Thoughts</button>' +
        '<button type="button" class="btn" data-act="jump" data-jump="top3">Top 3</button>' +
        '<button type="button" class="btn" data-act="jump" data-jump="urgent">Urgent</button>' +
        '<button type="button" class="btn" data-act="jump" data-jump="homecalls">Home</button>' +
        '<button type="button" class="btn" data-act="jump" data-jump="todos">To-dos</button>' +
        '<button type="button" class="btn" data-act="jump" data-jump="meals">Meals</button>' +
        '<button type="button" class="btn" data-act="jump" data-jump="projects">Projects</button>' +
        '<button type="button" class="btn" data-act="jump" data-jump="money">Money</button>' +
      '</div>' +
      '<section class="section" id="top3"><h2>Top 3</h2><div class="grid3">' + tiles + '</div><button type="button" class="btn" data-act="edit-top3">Edit Top 3</button></section>' +
      '<section class="section" id="urgent"><h2>Urgent</h2>' + (urgent.length ? urgent.map(decisionCard).join('') : '<p class="empty">Nothing urgent.</p>') + '</section>' +
      '<section class="section" id="homecalls"><h2>Home decisions</h2><p class="sub">Open calls in the Home area. The Decisions tab can filter to Home too.</p>' +
        (homeCalls.length ? homeCalls.map(decisionCard).join('') : '<p class="empty">No open home decisions.</p>') + '</section>' +
      '<section class="section" id="todos"><h2>Open to-dos (' + todos.length + ')</h2>' +
        (todoRows || '<p class="empty">No open to-dos. Mark a map branch as a to-do and it shows up here.</p>') +
        (todos.length > 8 ? '<button type="button" class="btn" data-act="toggle-todos">' + (ui.showAllTodos ? 'Show fewer' : 'Show all ' + todos.length) + '</button>' : '') +
      '</section>' +
      '<section class="section" id="glance"><h2>At a glance</h2><div class="grid2 grid4">' +
        '<button type="button" class="dashbtn" data-act="tab" data-tab="decisions"><span class="num">' + openCount + '</span><span class="numlabel">Open decisions</span></button>' +
        '<button type="button" class="dashbtn" data-act="urgent-filter"><span class="num">' + urgent.length + '</span><span class="numlabel">Urgent</span></button>' +
        '<button type="button" class="dashbtn" data-act="jump" data-jump="todos"><span class="num">' + todos.length + '</span><span class="numlabel">Open to-dos</span></button>' +
        '<button type="button" class="dashbtn" data-act="tab" data-tab="maps"><span class="num">' + (state.maps || []).length + '</span><span class="numlabel">Maps</span></button>' +
        '<button type="button" class="dashbtn" data-act="tab" data-tab="thoughts"><span class="num">' + (state.thoughts || []).filter(function (item) { return (item.status || 'New') === 'New'; }).length + '</span><span class="numlabel">New thoughts</span></button>' +
      '</div></section>' +
      '<section class="section" id="meals"><h2>Meal prep</h2><div class="card">' +
        '<p class="callout">' + esc(state.home.planLabel || 'No plan yet') + (state.home.next ? '. Next: ' + esc(state.home.next) : '') + '</p>' +
        (mealRows || '<p class="empty">No meals on this plan yet. Add names first.</p>') +
        '<h3>Shopping list</h3>' + (shopRows || '<p class="empty">No extra shopping lines.</p>') +
        '<div class="row"><button type="button" class="btn big" data-act="add-meal">Add meal</button><button type="button" class="btn" data-act="add-shop">Add shopping line</button></div>' +
        (rules ? '<details class="foldbox"><summary>Meal rules</summary><ul class="rules">' + rules + '</ul></details>' : '') +
      '</div></section>' +
      '<section class="section" id="projects"><h2>Projects</h2>' + (projectCards || '<p class="empty">No projects yet.</p>') +
        '<button type="button" class="btn" data-act="add-project">Add project</button></section>' +
      '<section class="section" id="money"><h2>Fun money</h2><div class="card">' +
        (fun.tslaText ? '<div class="sub">TSLA shares</div><div class="shares">' + esc(fun.tslaText) + '</div>' : '<p class="empty">No share count yet.</p>') +
        (fun.routine ? '<p>' + esc(fun.routine) + '</p>' : '') +
        (fun.rules ? '<p class="fun-rules">' + esc(fun.rules) + '</p>' : '') +
      '</div></section></div>';
  }

  function renderDecisions(route) {
    var list = Store.filterDecisions(state.decisions, { area: ui.area, urgency: ui.urgency, sort: ui.sort });
    function chip(act, value, current, label) {
      return '<button type="button" class="btn' + (current === value ? ' on' : '') + '" data-act="' + act + '" data-value="' + esc(value) + '">' + esc(label || value) + '</button>';
    }
    var areas = ['All'].concat(Store.AREAS).map(function (area) { return chip('filter-area', area, ui.area); }).join('');
    var urgencies = ['All'].concat(Store.URGENCIES).map(function (urgency) { return chip('filter-urgency', urgency, ui.urgency); }).join('');
    var sorts = [['urgency', 'Urgency'], ['due', 'Due'], ['oldest', 'Oldest'], ['area', 'Area']].map(function (pair) {
      return chip('filter-sort', pair[0], ui.sort, pair[1]);
    }).join('');
    var cards = list.length ? list.map(decisionCard).join('') : '<p class="empty">No decisions in this filter.</p><button type="button" class="btn" data-act="clear-filters">Clear filters</button>';
    return '<div class="wrap"><h1>Decisions</h1><p class="sub">Tap an option to pick it. Tap it again to undo.</p>' +
      '<button type="button" class="btn big primary" data-act="new-decision">New decision</button>' +
      '<div class="filters"><div class="scroller">' + areas + '</div><div class="scroller">' + urgencies + '</div><div class="scroller">' + sorts + '</div></div>' +
      '<div class="dec-grid" id="decisionList">' + cards + '</div></div>';
  }

  function renderMapList() {
    var q = ui.query.trim().toLowerCase();
    var maps = (state.maps || []).filter(function (map) {
      if (!q) return true;
      return plain(map.title).toLowerCase().indexOf(q) !== -1;
    });
    var rows = maps.map(function (map) {
      var count = Object.keys(map.nodes || {}).length;
      var todos = Object.keys(map.nodes || {}).filter(function (id) { return map.nodes[id].todo && !map.nodes[id].done; }).length;
      return '<button type="button" class="maprow btn" data-act="open-map" data-id="' + esc(map.id) + '"><span><b>' + esc(map.title) + '</b><small>' + count + ' branches' + (todos ? ' · ' + todos + ' open to-dos' : '') + '</small></span></button>';
    }).join('');
    return '<div class="wrap"><h1>Maps</h1><p class="sub">Your Xmind maps. Import a .xmind file any time.</p>' +
      '<div class="row"><button type="button" class="btn big primary" data-act="new-map">New map</button>' +
      '<label class="btn big file">Import .xmind<input id="xmindFile" type="file" accept=".xmind,application/zip" multiple hidden data-act="import-xmind"></label></div>' +
      '<label class="fld">Search<input id="mapSearch" data-act="map-search" value="' + esc(ui.query) + '"></label>' +
      '<div id="mapList">' + (rows || '<p class="empty">No maps match.</p>') + '</div></div>';
  }

  function descendants(map, id) {
    var out = [];
    var node = map.nodes[id];
    if (!node) return out;
    (node.childIds || []).forEach(function (cid) {
      if (!map.nodes[cid]) return;
      out.push(cid);
      descendants(map, cid).forEach(function (next) { out.push(next); });
    });
    return out;
  }
  function isHidden(map, id) {
    var parent = map.nodes[id] && map.nodes[id].parentId;
    while (parent) {
      var node = map.nodes[parent];
      if (!node) return false;
      if (node.collapsed) return true;
      parent = node.parentId;
    }
    return false;
  }
  function layoutMap(map) {
    var gapY = 18;
    var narrow = typeof window !== 'undefined' && window.innerWidth < 700;
    var gapX = narrow ? 28 : 64;
    function boxOf(node) {
      var h = narrow ? 76 : 72;
      if (node.todo) h += 22;
      if (node.labels && node.labels.length) h += 16;
      var w = narrow ? (node.parentId ? 156 : 168) : (node.parentId ? 220 : 250);
      return { w: w, h: h };
    }
    function kidsOf(node) {
      if (!node || node.collapsed) return [];
      return (node.childIds || []).filter(function (cid) { return map.nodes[cid]; });
    }
    function measure(id) {
      var node = map.nodes[id];
      var box = boxOf(node);
      node._w = box.w;
      node._h = box.h;
      var kids = kidsOf(node);
      if (!kids.length) { node._sub = box.h; return; }
      kids.forEach(measure);
      var kidsH = 0;
      kids.forEach(function (cid, index) { kidsH += map.nodes[cid]._sub + (index ? gapY : 0); });
      node._sub = Math.max(box.h, kidsH);
    }
    function place(id, x, top) {
      var node = map.nodes[id];
      var kids = kidsOf(node);
      node.x = x;
      if (!kids.length) { node.y = top; return; }
      var kidsH = 0;
      kids.forEach(function (cid, index) { kidsH += map.nodes[cid]._sub + (index ? gapY : 0); });
      var y = top + Math.max(0, (node._sub - kidsH) / 2);
      kids.forEach(function (cid, index) {
        if (index) y += gapY;
        place(cid, x + node._w + gapX, y);
        y += map.nodes[cid]._sub;
      });
      var first = map.nodes[kids[0]];
      var last = map.nodes[kids[kids.length - 1]];
      node.y = ((first.y + first._h / 2 + last.y + last._h / 2) / 2) - node._h / 2;
      if (node.y < top) node.y = top;
    }
    if (!map.rootId || !map.nodes[map.rootId]) return { minX: 0, minY: 0, w: 20, h: 20 };
    measure(map.rootId);
    place(map.rootId, 0, 0);
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    Object.keys(map.nodes).forEach(function (id) {
      if (isHidden(map, id)) return;
      var node = map.nodes[id];
      if (node.x == null) return;
      var x = node.x + (node.dx || 0);
      var y = node.y + (node.dy || 0);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + node._w);
      maxY = Math.max(maxY, y + node._h);
    });
    if (!isFinite(minX)) return { minX: 0, minY: 0, w: 20, h: 20 };
    return { minX: minX - 32, minY: minY - 32, maxX: maxX + 48, maxY: maxY + 48, w: (maxX + 48) - (minX - 32), h: (maxY + 48) - (minY - 32) };
  }

  function renderMapScreen(id) {
    var map = findMap(id);
    if (!map) return '<div class="map-screen"><div class="map-bar"><button type="button" class="btn" data-act="tab" data-tab="maps">Back</button><span class="title">Map missing</span></div><p class="empty">That map is gone.</p></div>';
    var list = ui.mode === 'list';
    return '<div class="map-screen">' +
      '<div class="map-bar"><button type="button" class="btn" data-act="tab" data-tab="maps">Back</button><span class="title">' + esc(map.title) + '</span>' +
      '<button type="button" class="btn" data-act="mode" data-mode="' + (list ? 'map' : 'list') + '">' + (list ? 'Map' : 'List') + '</button>' +
      '<button type="button" class="btn" data-act="fit">Fit</button>' +
      '<button type="button" class="btn" data-act="zoom" data-z="0.85">-</button>' +
      '<button type="button" class="btn" data-act="zoom" data-z="1.18">+</button>' +
      '<button type="button" class="btn" data-act="expand-all">Expand</button>' +
      '<button type="button" class="btn" data-act="overview">Overview</button>' +
      '<button type="button" class="btn danger" data-act="delete-map">Delete</button>' +
      '</div>' +
      '<p class="hint">Drag empty space to pan. Drag a branch to move it. Drop it on another branch to attach it.</p>' +
      '<div class="map-view' + (list ? ' list' : '') + '" id="mapView"></div>' +
      '<div class="dock" id="dock"></div></div>';
  }

  function outlineHtml(map, id, depth) {
    var node = map.nodes[id];
    if (!node) return '';
    var kids = node.childIds || [];
    var fold = kids.length ? '<button type="button" class="mini" data-act="fold" data-id="' + esc(id) + '">' + (node.collapsed ? '+' + kids.length : '-') + '</button>' : '<span class="mini"></span>';
    var tick = node.todo ? '<button type="button" class="mini" data-act="tick" data-id="' + esc(id) + '">' + (node.done ? '✓' : '○') + '</button>' : '';
    var title = plain(node.title || '').trim() || 'Empty';
    var html = '<div class="olrow" style="padding-left:' + (depth * 16) + 'px">' + fold + tick +
      '<button type="button" class="oltitle' + (ui.selected === id ? ' on' : '') + '" style="--c:' + esc(node.color || '#6F93B3') + '" data-act="select-node" data-id="' + esc(id) + '">' + esc(title) +
      (node.decisionId ? '<small>Linked decision</small>' : '') + '</button></div>';
    if (!node.collapsed) kids.forEach(function (cid) { html += outlineHtml(map, cid, depth + 1); });
    return html;
  }

  function drawDock(map) {
    var dock = document.getElementById('dock');
    if (!dock) return;
    var node = map && ui.selected ? map.nodes[ui.selected] : null;
    if (!node) {
      dock.innerHTML = '<span class="hint">Tap a branch to edit it.</span>';
      return;
    }
    dock.innerHTML = '<button type="button" class="btn" data-act="add-child" data-id="' + esc(node.id) + '">Add</button>' +
      '<button type="button" class="btn" data-act="color-node" data-id="' + esc(node.id) + '">Color</button>' +
      '<button type="button" class="btn" data-act="toggle-todo" data-id="' + esc(node.id) + '">' + (node.todo ? 'To-do on' : 'To-do') + '</button>' +
      '<button type="button" class="btn" data-act="link-node" data-id="' + esc(node.id) + '">Link</button>' +
      '<button type="button" class="btn" data-act="edit-node" data-id="' + esc(node.id) + '">Edit</button>' +
      '<button type="button" class="btn danger" data-act="delete-node" data-id="' + esc(node.id) + '">Delete</button>';
  }

  function armMap(gen, id) {
    var map = findMap(id);
    var view = document.getElementById('mapView');
    if (!map || !view) return;
    if (!ui.cam || ui.cam.mapId !== map.id) ui.cam = { mapId: map.id, panX: 0, panY: 0, zoom: 1, fitted: false };
    if (ui.mode === 'list') {
      view.innerHTML = outlineHtml(map, map.rootId, 0);
      drawDock(map);
      return;
    }
    var bounds = layoutMap(map);
    var world = document.createElement('div');
    world.className = 'map-world';
    world.style.width = bounds.w + 'px';
    world.style.height = bounds.h + 'px';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'map-links');
    svg.style.left = '0px';
    svg.style.top = '0px';
    svg.setAttribute('width', bounds.w);
    svg.setAttribute('height', bounds.h);
    world.appendChild(svg);
    function pos(node) {
      return { x: node.x + (node.dx || 0) - bounds.minX, y: node.y + (node.dy || 0) - bounds.minY, w: node._w, h: node._h };
    }
    Object.keys(map.nodes).forEach(function (nid) {
      if (isHidden(map, nid)) return;
      var node = map.nodes[nid];
      if (node.x == null) return;
      var p = pos(node);
      (node.childIds || []).forEach(function (cid) {
        var child = map.nodes[cid];
        if (!child || child.x == null || isHidden(map, cid)) return;
        var c = pos(child);
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        var x1 = p.x + p.w;
        var y1 = p.y + p.h / 2;
        var x2 = c.x;
        var y2 = c.y + c.h / 2;
        var mx = (x1 + x2) / 2;
        path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', child.color || '#8FA3B5');
        path.setAttribute('stroke-width', '2');
        svg.appendChild(path);
      });
      var el = document.createElement('div');
      el.className = 'node' + (ui.selected === nid ? ' on' : '') + (node.done ? ' done' : '');
      el.dataset.id = nid;
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.style.width = p.w + 'px';
      el.style.height = p.h + 'px';
      el.style.setProperty('--c', node.color || '#6F93B3');
      var tools = '';
      if (node.todo) tools += '<button type="button" class="tick" data-act="tick" data-id="' + esc(nid) + '">' + (node.done ? '✓' : '○') + '</button>';
      if ((node.childIds || []).length) tools += '<button type="button" class="fold" data-act="fold" data-id="' + esc(nid) + '">' + (node.collapsed ? '+' + node.childIds.length : '-') + '</button>';
      var title = plain(node.title || '').trim() || 'Empty';
      el.innerHTML = '<div class="node-row"><div class="node-title"></div>' +
        (tools ? '<div class="node-tools">' + tools + '</div>' : '') + '</div>' +
        ((node.labels && node.labels.length) ? '<div class="node-flag"></div>' : '') +
        (node.decisionId ? '<div class="node-flag">Decision</div>' : '');
      el.querySelector('.node-title').textContent = title;
      if (node.labels && node.labels.length) el.querySelector('.node-flag').textContent = node.labels.slice(0, 2).map(plain).join(' · ');
      world.appendChild(el);
    });
    view.innerHTML = '';
    view.appendChild(world);
    drawDock(map);
    requestAnimationFrame(function () {
      if (gen !== renderGen) return;
      if (!ui.cam.fitted) fitMap(view, world);
      else applyCam(world);
      bindMap(view, world, map, bounds);
    });
  }

  function applyCam(world) {
    world.style.transform = 'translate(' + ui.cam.panX + 'px,' + ui.cam.panY + 'px) scale(' + ui.cam.zoom + ')';
  }
  function fitMap(view, world) {
    var rect = view.getBoundingClientRect();
    var w = world.offsetWidth || 1;
    var h = world.offsetHeight || 1;
    var fit = Math.min((rect.width - 24) / w, (rect.height - 24) / h);
    var floor = rect.width < 700 ? 0.9 : 0.55;
    ui.cam.zoom = Math.max(0.12, Math.min(1.35, Math.max(floor, fit)));
    if (fit >= floor) {
      ui.cam.panX = (rect.width - w * ui.cam.zoom) / 2;
      ui.cam.panY = (rect.height - h * ui.cam.zoom) / 2;
    } else {
      ui.cam.panX = 16;
      ui.cam.panY = 16;
    }
    ui.cam.fitted = true;
    applyCam(world);
  }
  function zoomAt(view, world, clientX, clientY, factor) {
    var rect = view.getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    var next = Math.max(0.12, Math.min(2.2, ui.cam.zoom * factor));
    var k = next / ui.cam.zoom;
    ui.cam.panX = x - (x - ui.cam.panX) * k;
    ui.cam.panY = y - (y - ui.cam.panY) * k;
    ui.cam.zoom = next;
    ui.cam.fitted = true;
    applyCam(world);
  }
  function bindMap(view, world, map, bounds) {
    var pointers = new Map();
    var mode = '';
    var start = null;
    var dragged = false;
    var dragIds = [];
    var orig = {};
    var pinchDist = 0;
    function pointList() { return Array.from(pointers.values()); }
    function distance() {
      var pts = pointList();
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
    view.addEventListener('pointerdown', function (event) {
      if (event.target.closest('button, a, input, textarea')) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      try { view.setPointerCapture(event.pointerId); } catch (err) {}
      if (pointers.size >= 2) { mode = 'pinch'; pinchDist = distance() || 1; return; }
      var nodeEl = event.target.closest('.node');
      if (nodeEl) {
        mode = 'drag';
        dragged = false;
        var id = nodeEl.dataset.id;
        dragIds = [id].concat(descendants(map, id));
        start = { x: event.clientX, y: event.clientY, id: id };
        orig = {};
        dragIds.forEach(function (nid) {
          var el = world.querySelector('.node[data-id="' + nid + '"]');
          if (!el) return;
          orig[nid] = { left: parseFloat(el.style.left), top: parseFloat(el.style.top), el: el };
        });
      } else {
        mode = 'pan';
        start = { x: event.clientX, y: event.clientY, panX: ui.cam.panX, panY: ui.cam.panY };
      }
    });
    view.addEventListener('pointermove', function (event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (mode === 'pinch' && pointers.size >= 2) {
        var dist = distance() || pinchDist;
        zoomAt(view, world, event.clientX, event.clientY, dist / pinchDist);
        pinchDist = dist;
        return;
      }
      if (!start) return;
      if (mode === 'pan') {
        ui.cam.panX = start.panX + (event.clientX - start.x);
        ui.cam.panY = start.panY + (event.clientY - start.y);
        ui.cam.fitted = true;
        applyCam(world);
      } else if (mode === 'drag') {
        var dx = (event.clientX - start.x) / ui.cam.zoom;
        var dy = (event.clientY - start.y) / ui.cam.zoom;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) dragged = true;
        Object.keys(orig).forEach(function (nid) {
          orig[nid].el.style.left = (orig[nid].left + dx) + 'px';
          orig[nid].el.style.top = (orig[nid].top + dy) + 'px';
          orig[nid].el.style.pointerEvents = 'none';
        });
        var under = document.elementFromPoint(event.clientX, event.clientY);
        world.querySelectorAll('.node.drop').forEach(function (el) { el.classList.remove('drop'); });
        var target = under && under.closest ? under.closest('.node') : null;
        if (target && dragIds.indexOf(target.dataset.id) === -1) target.classList.add('drop');
      }
    });
    function endDrag(event) {
      pointers.delete(event.pointerId);
      if (pointers.size) return;
      if (mode === 'drag' && start) {
        Object.keys(orig).forEach(function (nid) { orig[nid].el.style.pointerEvents = ''; });
        if (!dragged) {
          ui.selected = start.id;
          world.querySelectorAll('.node.on').forEach(function (el) { el.classList.remove('on'); });
          var selected = world.querySelector('.node[data-id="' + start.id + '"]');
          if (selected) selected.classList.add('on');
          drawDock(map);
        } else {
          var dx = (event.clientX - start.x) / ui.cam.zoom;
          var dy = (event.clientY - start.y) / ui.cam.zoom;
          var under = document.elementFromPoint(event.clientX, event.clientY);
          var target = under && under.closest ? under.closest('.node') : null;
          var targetId = target ? target.dataset.id : '';
          if (targetId && dragIds.indexOf(targetId) === -1 && targetId !== map.nodes[start.id].parentId) {
            reparent(map, start.id, targetId);
          } else {
            dragIds.forEach(function (nid) {
              if (!map.nodes[nid]) return;
              map.nodes[nid].dx = (map.nodes[nid].dx || 0) + dx;
              map.nodes[nid].dy = (map.nodes[nid].dy || 0) + dy;
            });
          }
          map.updatedAt = Store.nowIso();
          ui.selected = start.id;
          persist();
          render();
        }
      }
      mode = '';
      start = null;
    }
    view.addEventListener('pointerup', endDrag);
    view.addEventListener('pointercancel', endDrag);
    view.addEventListener('wheel', function (event) {
      event.preventDefault();
      zoomAt(view, world, event.clientX, event.clientY, event.deltaY < 0 ? 1.08 : 0.92);
    }, { passive: false });
  }

  function reparent(map, id, parentId) {
    var node = map.nodes[id];
    var parent = map.nodes[parentId];
    if (!node || !parent || id === parentId) return;
    if (descendants(map, id).indexOf(parentId) !== -1) return;
    var old = map.nodes[node.parentId];
    if (old) old.childIds = old.childIds.filter(function (cid) { return cid !== id; });
    node.parentId = parentId;
    parent.childIds = parent.childIds || [];
    parent.childIds.push(id);
    parent.collapsed = false;
    node.sortOrder = parent.childIds.length - 1;
    [id].concat(descendants(map, id)).forEach(function (nid) {
      if (!map.nodes[nid]) return;
      map.nodes[nid].dx = 0;
      map.nodes[nid].dy = 0;
    });
  }

  function blankDecision(prefill) {
    var id = Store.uid('d');
    prefill = prefill || {};
    return {
      id: id,
      title: prefill.title || '',
      question: prefill.question || '',
      area: prefill.area || 'Home',
      urgency: prefill.urgency || 'Soon',
      options: [
        { id: id + 'a', label: prefill.optionA || '' },
        { id: id + 'b', label: prefill.optionB || '' }
      ],
      recommendedId: id + 'a',
      chosenId: '',
      comment: '',
      note: prefill.note || '',
      said: '',
      raised: todayLA(),
      due: '',
      status: 'open',
      sample: false,
      source: prefill.source || '',
      sourceKey: '',
      updatedAt: Store.nowIso()
    };
  }

  function decisionForm(item) {
    var areaChips = Store.AREAS.map(function (area) {
      return '<button type="button" class="btn area-chip' + (item.area === area ? ' on' : '') + '" data-area="' + esc(area) + '">' + esc(area) + '</button>';
    }).join('');
    var urgencyChips = Store.URGENCIES.map(function (urgency) {
      return '<button type="button" class="btn urgency-chip' + (item.urgency === urgency ? ' on' : '') + '" data-urgency="' + esc(urgency) + '">' + esc(urgency) + '</button>';
    }).join('');
    var options = item.options.map(function (opt, index) {
      return '<div class="row"><label class="fld" style="flex:1">Option ' + (index + 1) + '<input data-opt="' + esc(opt.id) + '" value="' + esc(opt.label) + '"></label>' +
        '<button type="button" class="btn sug-btn' + (item.recommendedId === opt.id ? ' on' : '') + '" data-sug="' + esc(opt.id) + '">Suggested</button>' +
        (item.options.length > 2 ? '<button type="button" class="btn" data-rm="' + esc(opt.id) + '">Remove</button>' : '') + '</div>';
    }).join('');
    return '<label class="fld">Title<input id="f-title" value="' + esc(item.title) + '"></label>' +
      '<label class="fld">Question<textarea id="f-question">' + esc(item.question) + '</textarea></label>' +
      '<div class="fld">Area<div class="chips" id="f-areas">' + areaChips + '</div></div>' +
      '<div class="fld">Urgency<div class="chips" id="f-urgency">' + urgencyChips + '</div></div>' +
      options +
      (item.options.length < 4 ? '<button type="button" class="btn" id="f-add">Add option</button>' : '') +
      '<label class="fld">Comment<textarea id="f-comment">' + esc(item.comment || '') + '</textarea></label>' +
      '<label class="fld">Note<textarea id="f-note">' + esc(item.note || '') + '</textarea></label>' +
      '<label class="fld">What you said<textarea id="f-said">' + esc(item.said || '') + '</textarea></label>' +
      '<div class="row"><label class="fld">Date raised<input id="f-raised" type="date" value="' + esc(item.raised || '') + '"></label>' +
      '<label class="fld">Due date<input id="f-due" type="date" value="' + esc(item.due || '') + '"></label></div>' +
      '<div class="row"><button type="button" class="btn big primary" id="f-save">Save</button>' +
      (item.id && findDecision(item.id) ? '<button type="button" class="btn danger" id="f-delete">Delete</button>' : '') + '</div>';
  }

  function paintChoices(root, item) {
    root.querySelectorAll('.area-chip').forEach(function (btn) { btn.classList.toggle('on', btn.dataset.area === item.area); });
    root.querySelectorAll('.urgency-chip').forEach(function (btn) { btn.classList.toggle('on', btn.dataset.urgency === item.urgency); });
    root.querySelectorAll('.sug-btn').forEach(function (btn) { btn.classList.toggle('on', btn.dataset.sug === item.recommendedId); });
  }

  function openDecisionEditor(existing, prefill) {
    var item = existing ? Store.clone(existing) : blankDecision(prefill);
    function draw() {
      openSheet(existing ? 'Edit decision' : 'New decision', decisionForm(item), wire);
    }
    function read(root) {
      item.title = root.querySelector('#f-title').value.trim();
      item.question = root.querySelector('#f-question').value.trim();
      item.comment = root.querySelector('#f-comment').value;
      item.note = root.querySelector('#f-note').value;
      item.said = root.querySelector('#f-said').value;
      item.raised = root.querySelector('#f-raised').value;
      item.due = root.querySelector('#f-due').value;
      item.options.forEach(function (opt) {
        var input = root.querySelector('[data-opt="' + opt.id + '"]');
        if (input) opt.label = input.value.trim();
      });
    }
    function wire(ov) {
      paintChoices(ov, item);
      ov.addEventListener('click', function (event) {
        var area = event.target.closest('[data-area]');
        var urgency = event.target.closest('[data-urgency]');
        var sug = event.target.closest('[data-sug]');
        var rm = event.target.closest('[data-rm]');
        if (area) { item.area = area.dataset.area; paintChoices(ov, item); }
        if (urgency) { item.urgency = urgency.dataset.urgency; paintChoices(ov, item); }
        if (sug) { item.recommendedId = sug.dataset.sug; paintChoices(ov, item); }
        if (rm) {
          read(ov);
          if (item.options.length <= 2) return;
          item.options = item.options.filter(function (opt) { return opt.id !== rm.dataset.rm; });
          if (!item.options.some(function (opt) { return opt.id === item.recommendedId; })) item.recommendedId = item.options[0].id;
          draw();
        }
        if (event.target.id === 'f-add') {
          read(ov);
          if (item.options.length >= 4) return;
          item.options.push({ id: Store.uid('o'), label: '' });
          draw();
        }
        if (event.target.id === 'f-save') {
          read(ov);
          item.options = item.options.filter(function (opt) { return opt.label; });
          if (!item.title) { toast('Add a title.'); return; }
          if (item.options.length < 2) { toast('Add at least two options.'); return; }
          if (!item.options.some(function (opt) { return opt.id === item.recommendedId; })) item.recommendedId = item.options[0].id;
          item.sample = false;
          item.updatedAt = Store.nowIso();
          var index = state.decisions.findIndex(function (row) { return row.id === item.id; });
          if (index >= 0) state.decisions[index] = item;
          else state.decisions.unshift(item);
          closeSheet();
          persist();
          go('#decision/' + encodeURIComponent(item.id));
        }
        if (event.target.id === 'f-delete') {
          confirmBox('Delete this decision?', 'You can make it again later.', 'Delete').then(function (yes) {
            if (!yes) return;
            state.decisions = state.decisions.filter(function (row) { return row.id !== item.id; });
            state.tombstones.push({ col: 'decisions', id: item.id, updatedAt: Store.nowIso() });
            (state.top3 || []).forEach(function (slot) {
              if (slot.refId === item.id) { slot.refId = ''; slot.refType = ''; }
            });
            closeSheet();
            persist();
            go('#decisions');
          });
        }
      });
    }
    draw();
  }

  function openTopEditor() {
    var slots = [1, 2, 3].map(function (slot) {
      return (state.top3 || []).filter(function (item) { return item.slot === slot; })[0] || { slot: slot, text: '', sample: false, refType: '', refId: '' };
    });
    var body = slots.map(function (slot) {
      return '<label class="fld">Top ' + slot.slot + '<input data-slot="' + slot.slot + '" value="' + esc(slot.text) + '"></label>';
    }).join('') + '<button type="button" class="btn big primary" id="top-save">Save Top 3</button>';
    openSheet('Edit Top 3', body, function (ov) {
      ov.querySelector('#top-save').onclick = function () {
        state.top3 = [1, 2, 3].map(function (slot) {
          var previous = slots.filter(function (item) { return item.slot === slot; })[0];
          var text = ov.querySelector('[data-slot="' + slot + '"]').value.trim();
          var changed = text !== (previous.text || '');
          return { slot: slot, text: text, sample: changed ? false : !!previous.sample, refType: changed ? '' : (previous.refType || ''), refId: changed ? '' : (previous.refId || '') };
        });
        closeSheet();
        persist();
        render();
      };
    });
  }

  function openNodeEditor(map, id) {
    var node = map.nodes[id];
    if (!node) return;
    var body = '<label class="fld">Title<textarea id="n-title">' + esc(node.title || '') + '</textarea></label>' +
      '<label class="fld">Note<textarea id="n-note">' + esc(node.note || '') + '</textarea></label>' +
      '<div class="fld">Color<div class="swatches">' + SWATCHES.map(function (color) {
        return '<button type="button" class="swatch" data-color="' + color + '" style="background:' + color + '"></button>';
      }).join('') + '</div></div>' +
      '<button type="button" class="btn big primary" id="n-save">Save branch</button>';
    openSheet('Edit branch', body, function (ov) {
      var picked = node.color;
      ov.querySelectorAll('[data-color]').forEach(function (btn) {
        btn.onclick = function () { picked = btn.dataset.color; };
      });
      ov.querySelector('#n-save').onclick = function () {
        node.title = ov.querySelector('#n-title').value;
        node.note = ov.querySelector('#n-note').value;
        node.color = picked || node.color;
        map.updatedAt = Store.nowIso();
        closeSheet();
        persist();
        render();
      };
    });
  }

  function openLinkSheet(map, id) {
    var node = map.nodes[id];
    var buttons = '<button type="button" class="btn" data-link="">No decision</button>' +
      (state.decisions || []).map(function (item) {
        return '<button type="button" class="btn' + (node.decisionId === item.id ? ' on' : '') + '" data-link="' + esc(item.id) + '">' + esc(item.title) + '</button>';
      }).join('') +
      '<button type="button" class="btn primary" id="link-new">New decision from this branch</button>';
    openSheet('Link a decision', '<div class="options">' + buttons + '</div>', function (ov) {
      ov.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-link]');
        if (btn) {
          node.decisionId = btn.dataset.link || '';
          map.updatedAt = Store.nowIso();
          closeSheet();
          persist();
          render();
        }
        if (event.target.id === 'link-new') {
          var title = plain(node.title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'New decision';
          closeSheet();
          openDecisionEditor(null, {
            title: title,
            question: title,
            area: 'Home',
            note: 'From map: ' + map.title,
            source: 'map',
            optionA: 'Go',
            optionB: 'Not yet'
          });
          var createdWatch = setInterval(function () {
            var match = (state.decisions || []).filter(function (item) { return item.source === 'map' && item.title === title; })[0];
            if (match) {
              node.decisionId = match.id;
              map.updatedAt = Store.nowIso();
              clearInterval(createdWatch);
              persist();
            }
          }, 400);
          setTimeout(function () { clearInterval(createdWatch); }, 20000);
        }
      });
    });
  }

  function addChild(map, parentId) {
    var parent = map.nodes[parentId];
    if (!parent) return;
    var id = Store.uid('n');
    map.nodes[id] = {
      id: id, parentId: parentId, childIds: [], title: 'New branch', note: '', color: parent.color || '#6F93B3',
      todo: false, done: false, folded: false, collapsed: false, decisionId: '', sortOrder: (parent.childIds || []).length,
      kind: 'attached', labels: [], href: '', priority: null, due: '', dx: 0, dy: 0
    };
    parent.childIds = parent.childIds || [];
    parent.childIds.push(id);
    parent.collapsed = false;
    ui.selected = id;
    map.updatedAt = Store.nowIso();
  }

  function deleteNode(map, id) {
    if (id === map.rootId) { toast('The center branch stays. Delete the map from the list if you want it gone.'); return; }
    var ids = [id].concat(descendants(map, id));
    var node = map.nodes[id];
    var parent = node && map.nodes[node.parentId];
    if (parent) parent.childIds = parent.childIds.filter(function (cid) { return cid !== id; });
    ids.forEach(function (nid) {
      delete map.nodes[nid];
      state.tombstones.push({ col: 'nodes', id: nid, updatedAt: Store.nowIso() });
    });
    if (ids.indexOf(ui.selected) !== -1) ui.selected = '';
    map.updatedAt = Store.nowIso();
  }

  async function importXmindFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      try {
        var buf = await file.arrayBuffer();
        var result = await Xmind.importXmindBuffer(buf, file.name);
        if (!result.maps.length) { toast(result.warning || 'Could not read that file.'); continue; }
        result.maps.forEach(function (map, index) {
          Xmind.finalizeMap(map, Xmind.hashId('m', file.name + ':' + Date.now() + ':' + index));
          map.updatedAt = Store.nowIso();
          state.maps.unshift(map);
        });
        toast(result.warning ? result.warning : 'Imported ' + file.name);
      } catch (err) {
        toast('Could not import ' + file.name);
      }
    }
    await persist();
    render();
  }

  function textSheet(title, fields, onSave) {
    var body = fields.map(function (field) {
      return '<label class="fld">' + esc(field.label) + (field.area ? '<textarea id="' + field.id + '">' + esc(field.value || '') + '</textarea>' : '<input id="' + field.id + '" value="' + esc(field.value || '') + '">') + '</label>';
    }).join('') + '<button type="button" class="btn big primary" id="text-save">Save</button>';
    openSheet(title, body, function (ov) {
      ov.querySelector('#text-save').onclick = function () {
        var values = {};
        fields.forEach(function (field) { values[field.id] = ov.querySelector('#' + field.id).value.trim(); });
        onSave(values);
      };
    });
  }

  function thoughtNotesHtml(thought) {
    var notes = thought.bot_notes || [];
    if (!notes.length) return '';
    var items = notes.map(function (note) {
      var who = note.bot === 'Brandon' ? 'You' : (note.bot || 'Bot');
      return '<article><p class="who">' + esc(who) + ' · ' + esc(shortWhen(note.time)) + '</p><p>' + linkify(note.text || '') + '</p></article>';
    }).join('');
    return '<div class="thread">' + items + '</div>';
  }
  function renderThoughts() {
    var q = (ui.thoughtQuery || '').trim().toLowerCase();
    var rows = sortedThoughts().filter(function (thought) {
      if (!q) return true;
      var blob = (thought.title + ' ' + thought.text + ' ' + (thought.tags || []).join(' ') + ' ' + (thought.owner_bot || '')).toLowerCase();
      return blob.indexOf(q) !== -1;
    });
    var list = rows.map(function (thought) {
      var latest = (thought.bot_notes || []).slice(-1)[0];
      return '<article class="card" id="t-' + esc(thought.id) + '">' +
        '<div class="pills"><span class="pill ' + statusClass(thought.status || 'New') + '">' + esc(thought.status || 'New') + '</span>' +
        (thought.area ? '<span class="pill">' + esc(thought.area) + '</span>' : '') +
        '<span class="pill">' + esc(shortWhen(thought.created)) + '</span></div>' +
        '<h2>' + esc(thoughtLabel(thought)) + '</h2>' +
        (thought.title ? '<p>' + esc(String(thought.text || '').replace(/\s+/g, ' ').trim().slice(0, 180)) + '</p>' : '') +
        (latest ? '<p class="note">' + esc(latest.bot === 'Brandon' ? 'You' : (latest.bot || 'Bot')) + ': ' + esc(String(latest.text || '').replace(/\s+/g, ' ').trim().slice(0, 160)) + '</p>' : '') +
        '<button type="button" class="btn" data-act="open-thought" data-id="' + esc(thought.id) + '">Open</button></article>';
    }).join('');
    return '<div class="wrap"><h1>Thoughts</h1><p class="sub">Newest first. Bots can pick these up.</p>' +
      '<button type="button" class="btn big primary wide" data-act="new-thought">New thought</button>' +
      '<label class="fld">Search<input id="thoughtSearch" data-act="thought-search" value="' + esc(ui.thoughtQuery || '') + '"></label>' +
      '<div id="thoughtList">' + (list || '<p class="empty">No thoughts match.</p>') + '</div></div>';
  }
  function renderThought(id) {
    var thought = findThought(id);
    if (!thought) return '<div class="wrap"><h1>Thought</h1><p class="empty">That thought is gone.</p><button type="button" class="btn" data-act="tab" data-tab="thoughts">All thoughts</button></div>';
    var statuses = (Store.THOUGHT_STATUSES || []).map(function (status) {
      return '<button type="button" class="btn' + ((thought.status || 'New') === status ? ' on' : '') + '" data-act="thought-status" data-id="' + esc(thought.id) + '" data-status="' + esc(status) + '">' + esc(status) + '</button>';
    }).join('');
    var areas = '<button type="button" class="btn' + (!thought.area ? ' on' : '') + '" data-act="thought-area" data-id="' + esc(thought.id) + '" data-area="">None</button>' +
      Store.AREAS.map(function (area) {
        return '<button type="button" class="btn' + (thought.area === area ? ' on' : '') + '" data-act="thought-area" data-id="' + esc(thought.id) + '" data-area="' + esc(area) + '">' + esc(area) + '</button>';
      }).join('');
    var linked = thought.linked_decision_id && findDecision(thought.linked_decision_id);
    return '<div class="wrap composer"><div class="row"><button type="button" class="btn" data-act="thought-back" data-id="' + esc(thought.id) + '">Back</button><span class="sub" id="saveHint">Saved on this phone</span></div>' +
      '<label class="fld">Title, optional<input id="thoughtTitle" data-act="thought-title" data-id="' + esc(thought.id) + '" value="' + esc(thought.title || '') + '"></label>' +
      '<label class="fld">Thought<textarea id="thoughtText" class="composer-box" data-act="thought-text" data-id="' + esc(thought.id) + '">' + esc(thought.text || '') + '</textarea></label>' +
      '<button type="button" class="btn big" id="dictateBtn" data-act="dictate" data-id="' + esc(thought.id) + '">Dictate</button>' +
      '<p class="sub">The keyboard microphone works in this box too.</p>' +
      '<p class="meta"><span>' + esc(shortWhen(thought.created)) + '</span></p>' +
      '<div class="fld">Status<div class="scroller">' + statuses + '</div></div>' +
      '<div class="fld">Area<div class="scroller">' + areas + '</div></div>' +
      '<label class="fld">Tags<input data-act="thought-tags" data-id="' + esc(thought.id) + '" value="' + esc((thought.tags || []).join(', ')) + '" placeholder="clinic, idea"></label>' +
      (thought.owner_bot ? '<p class="sub">Picked up by ' + esc(thought.owner_bot) + '</p>' : '') +
      thoughtNotesHtml(thought) +
      '<label class="fld">Your reply<textarea id="thoughtReply" data-act="thought-reply" data-id="' + esc(thought.id) + '"></textarea></label>' +
      '<div class="row"><button type="button" class="btn" data-act="add-reply" data-id="' + esc(thought.id) + '">Add reply</button>' +
      (linked ? '<button type="button" class="btn primary" data-act="goto-decision" data-id="' + esc(thought.linked_decision_id) + '">Open decision</button>' : '<button type="button" class="btn primary" data-act="thought-decide" data-id="' + esc(thought.id) + '">Make a decision</button>') +
      '<button type="button" class="btn danger" data-act="delete-thought" data-id="' + esc(thought.id) + '">Delete</button></div></div>';
  }

  function render() {
    if (!state) return;
    var gen = ++renderGen;
    var route = parseHash();
    var tab = route.tab || 'home';
    if (tab === 'decision') tab = 'decisions';
    if (tab !== 'home' && tab !== 'decisions' && tab !== 'maps' && tab !== 'map' && tab !== 'thoughts' && tab !== 'thought') tab = 'home';
    document.body.dataset.view = tab === 'map' ? 'map' : (tab === 'thought' ? 'thought' : tab);
    if (tab !== 'thought') stopDictation();
    if (ui.lastHash !== location.hash) {
      ui.lastHash = location.hash;
      if (tab !== 'map') window.scrollTo(0, 0);
    }
    syncLabel();
    measureHead();
    document.querySelectorAll('.tabbar .tab').forEach(function (btn) {
      var on = btn.dataset.tab === (tab === 'map' ? 'maps' : (tab === 'thought' ? 'thoughts' : tab));
      btn.classList.toggle('active', on);
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    var view = document.getElementById('view');
    if (tab === 'map') view.innerHTML = renderMapScreen(route.id);
    else if (tab === 'decisions') view.innerHTML = renderDecisions(route);
    else if (tab === 'maps') view.innerHTML = renderMapList();
    else if (tab === 'thoughts') view.innerHTML = renderThoughts();
    else if (tab === 'thought') view.innerHTML = renderThought(route.id);
    else view.innerHTML = renderHome();
    if (tab === 'map') armMap(gen, route.id);
    if (tab === 'thought') {
      requestAnimationFrame(function () {
        var box = document.getElementById('thoughtText');
        if (box && !box.value && document.activeElement !== box) box.focus();
      });
    }
    if (route.tab === 'decision' && route.id) {
      requestAnimationFrame(function () {
        var el = document.getElementById('d-' + route.id);
        if (el) el.scrollIntoView({ block: 'start' });
      });
    }
    if (ui.jump) {
      var jumpId = ui.jump;
      ui.jump = '';
      requestAnimationFrame(function () {
        var el = document.getElementById(jumpId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  function onClick(event) {
    var btn = event.target.closest('[data-act]');
    if (!btn || btn.closest('.sheet-ov')) return;
    var act = btn.dataset.act;
    if (act === 'tab') {
      if (parseHash().tab === 'thought') dropEmptyThought(parseHash().id);
      stopDictation();
      persist();
      go('#' + btn.dataset.tab);
      return;
    }
    if (act === 'new-thought') {
      stopDictation();
      var freshId = Store.uid('t');
      var now = Store.nowIso();
      state.thoughts = state.thoughts || [];
      state.thoughts.unshift({
        id: freshId, text: '', title: '', created: now, updated: now, status: 'New',
        tags: [], area: '', owner_bot: '', bot_notes: [], linked_decision_id: ''
      });
      persist();
      var target = '#thought/' + encodeURIComponent(freshId);
      if (location.hash !== target) location.hash = target;
      render();
      var box = document.getElementById('thoughtText');
      if (box) box.focus();
      return;
    }
    if (act === 'open-thought') { stopDictation(); go('#thought/' + encodeURIComponent(btn.dataset.id)); return; }
    if (act === 'thought-back') {
      stopDictation();
      dropEmptyThought(btn.dataset.id);
      persist();
      go('#thoughts');
      return;
    }
    if (act === 'thought-status') {
      var statusThought = findThought(btn.dataset.id);
      if (!statusThought) return;
      statusThought.status = btn.dataset.status || 'New';
      statusThought.updated = Store.nowIso();
      persist();
      render();
      return;
    }
    if (act === 'thought-area') {
      var areaThought = findThought(btn.dataset.id);
      if (!areaThought) return;
      areaThought.area = btn.dataset.area || '';
      areaThought.updated = Store.nowIso();
      persist();
      render();
      return;
    }
    if (act === 'dictate') {
      var dictateThought = findThought(btn.dataset.id);
      if (dictateThought) startDictation(dictateThought);
      return;
    }
    if (act === 'add-reply') {
      var replyThought = findThought(btn.dataset.id);
      var replyBox = document.getElementById('thoughtReply');
      var reply = replyBox ? replyBox.value.trim() : '';
      if (!replyThought || !reply) { toast('Write a reply first.'); return; }
      replyThought.bot_notes = replyThought.bot_notes || [];
      replyThought.bot_notes.push({ bot: 'Brandon', time: Store.nowIso(), text: reply });
      replyThought.updated = Store.nowIso();
      persist();
      render();
      return;
    }
    if (act === 'thought-decide') {
      var decideThought = findThought(btn.dataset.id);
      if (!decideThought) return;
      if (!String(decideThought.text || '').trim() && !String(decideThought.title || '').trim()) {
        toast('Write the thought first.');
        return;
      }
      makeDecisionFromThought(decideThought);
      return;
    }
    if (act === 'delete-thought') {
      var removeId = btn.dataset.id;
      confirmBox('Delete this thought?', 'Bots will no longer see it.', 'Delete').then(function (yes) {
        if (!yes) return;
        stopDictation();
        state.thoughts = (state.thoughts || []).filter(function (item) { return item.id !== removeId; });
        state.tombstones.push({ col: 'thoughts', id: removeId, updatedAt: Store.nowIso() });
        persist();
        go('#thoughts');
      });
      return;
    }
    if (act === 'setup') { openSetup(); return; }
    if (act === 'jump') {
      var el = document.getElementById(btn.dataset.jump);
      if (parseHash().tab !== 'home' && parseHash().tab !== '') { ui.jump = btn.dataset.jump; go('#home'); return; }
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (act === 'urgent-filter') { ui.urgency = 'Urgent'; ui.area = 'All'; go('#decisions'); return; }
    if (act === 'open-top') {
      var slot = Number(btn.dataset.slot);
      var item = (state.top3 || []).filter(function (row) { return row.slot === slot; })[0];
      if (item && item.refType === 'decision' && findDecision(item.refId)) { go('#decision/' + encodeURIComponent(item.refId)); return; }
      if (item && item.refType === 'jump') { ui.jump = item.refId; if (parseHash().tab === 'home') render(); else go('#home'); return; }
      openTopEditor();
      return;
    }
    if (act === 'edit-top3') { openTopEditor(); return; }
    if (act === 'toggle-todos') { ui.showAllTodos = !ui.showAllTodos; render(); return; }
    if (act === 'pick') {
      var decision = findDecision(btn.dataset.id);
      if (!decision) return;
      Store.chooseOption(decision, btn.dataset.opt);
      persist();
      render();
      return;
    }
    if (act === 'edit-decision') { openDecisionEditor(findDecision(btn.dataset.id)); return; }
    if (act === 'note-decision') {
      var noted = findDecision(btn.dataset.id);
      if (!noted) return;
      textSheet('Note', [
        { id: 'note', label: 'Note', area: true, value: noted.note },
        { id: 'said', label: 'What you said', area: true, value: noted.said }
      ], function (values) {
        noted.note = values.note;
        noted.said = values.said;
        noted.updatedAt = Store.nowIso();
        closeSheet();
        persist();
        render();
      });
      return;
    }
    if (act === 'goto-decision') { go('#decision/' + encodeURIComponent(btn.dataset.id)); return; }
    if (act === 'new-decision') { openDecisionEditor(null, { area: ui.area !== 'All' ? ui.area : 'Home' }); return; }
    if (act === 'filter-area') { ui.area = btn.dataset.value; render(); return; }
    if (act === 'filter-urgency') { ui.urgency = btn.dataset.value; render(); return; }
    if (act === 'filter-sort') { ui.sort = btn.dataset.value; render(); return; }
    if (act === 'clear-filters') { ui.area = 'All'; ui.urgency = 'All'; ui.sort = 'urgency'; render(); return; }
    if (act === 'copy') {
      var text = btn.dataset.text || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('Copied'); }, function () { toast(text); });
      } else toast(text);
      return;
    }
    if (act === 'add-meal') {
      textSheet('Add meal', [{ id: 'meal', label: 'Meal name' }, { id: 'servings', label: 'Servings' }], function (values) {
        if (!values.meal) { toast('Add a meal name.'); return; }
        state.home.meals.push({ id: Store.uid('meal'), meal: values.meal, servings: values.servings, ingredients: '', checked: false });
        closeSheet();
        persist();
        render();
      });
      return;
    }
    if (act === 'add-shop') {
      textSheet('Shopping line', [{ id: 'text', label: 'Item' }], function (values) {
        if (!values.text) return;
        state.home.shopping = state.home.shopping || [];
        state.home.shopping.push({ id: Store.uid('shop'), text: values.text, checked: false });
        closeSheet();
        persist();
        render();
      });
      return;
    }
    if (act === 'add-project') {
      textSheet('Add project', [
        { id: 'title', label: 'Title' },
        { id: 'status', label: 'Status' },
        { id: 'next', label: 'Next step', area: true },
        { id: 'files', label: 'File path' }
      ], function (values) {
        if (!values.title) { toast('Add a title.'); return; }
        var imported = Home.importHomeFeed({ projects: [values] });
        if (imported.home.projects[0]) state.home.projects.push(imported.home.projects[0]);
        state.decisions = Home.mergeDecisions(state.decisions, imported.decisions || []);
        closeSheet();
        persist();
        render();
      });
      return;
    }
    if (act === 'open-map') { ui.selected = ''; go('#map/' + encodeURIComponent(btn.dataset.id)); return; }
    if (act === 'new-map') {
      textSheet('New map', [{ id: 'title', label: 'Map name', value: 'New map' }], function (values) {
        var map = {
          id: 'temp', title: values.title || 'New map', sheetTitle: '', source: 'New map', rootId: 'root',
          palette: SWATCHES.slice(), rels: [], updatedAt: Store.nowIso(),
          nodes: { root: { id: 'root', parentId: '', childIds: [], title: values.title || 'New map', note: '', color: '#6F93B3', todo: false, done: false, folded: false, collapsed: false, decisionId: '', sortOrder: 0, kind: 'attached', labels: [], href: '', priority: null, due: '', dx: 0, dy: 0 } }
        };
        Xmind.finalizeMap(map, Xmind.hashId('m', (values.title || 'map') + Date.now()));
        state.maps.unshift(map);
        closeSheet();
        persist();
        go('#map/' + encodeURIComponent(map.id));
      });
      return;
    }
    if (act === 'mode') { ui.mode = btn.dataset.mode; render(); return; }
    if (act === 'fit') { if (ui.cam) ui.cam.fitted = false; render(); return; }
    if (act === 'zoom') {
      var view = document.getElementById('mapView');
      var world = view && view.querySelector('.map-world');
      if (view && world) {
        var rect = view.getBoundingClientRect();
        zoomAt(view, world, rect.left + rect.width / 2, rect.top + rect.height / 2, Number(btn.dataset.z));
      }
      return;
    }
    if (act === 'expand-all' || act === 'overview') {
      var mapId = parseHash().id;
      var map = findMap(mapId);
      if (!map) return;
      function walk(nid, depth) {
        var node = map.nodes[nid];
        if (!node) return;
        node.collapsed = act === 'overview' ? (depth >= 1 && (node.childIds || []).length > 0) : false;
        (node.childIds || []).forEach(function (cid) { walk(cid, depth + 1); });
      }
      walk(map.rootId, 0);
      map.updatedAt = Store.nowIso();
      if (ui.cam) ui.cam.fitted = false;
      persist();
      render();
      return;
    }
    if (act === 'fold') {
      var foldMap = findMap(parseHash().id);
      var foldNode = foldMap && foldMap.nodes[btn.dataset.id];
      if (!foldNode) return;
      foldNode.collapsed = !foldNode.collapsed;
      foldMap.updatedAt = Store.nowIso();
      saveSoon();
      render();
      return;
    }
    if (act === 'tick' || act === 'toggle-todo') {
      var tickMap = findMap(parseHash().id);
      var tickNode = tickMap && tickMap.nodes[btn.dataset.id];
      if (!tickNode) return;
      if (act === 'tick') tickNode.done = !tickNode.done;
      else { tickNode.todo = !tickNode.todo; if (!tickNode.todo) tickNode.done = false; }
      if (tickNode.done) tickNode.todo = true;
      tickMap.updatedAt = Store.nowIso();
      ui.selected = tickNode.id;
      persist();
      render();
      return;
    }
    if (act === 'select-node') {
      ui.selected = btn.dataset.id;
      document.querySelectorAll('.oltitle.on, .node.on').forEach(function (el) { el.classList.remove('on'); });
      btn.classList.add('on');
      drawDock(findMap(parseHash().id));
      return;
    }
    if (act === 'add-child') { var addMap = findMap(parseHash().id); addChild(addMap, btn.dataset.id); persist(); render(); return; }
    if (act === 'color-node') {
      var colorMap = findMap(parseHash().id);
      var colorNode = colorMap && colorMap.nodes[btn.dataset.id];
      if (!colorNode) return;
      openSheet('Branch color', '<div class="swatches">' + SWATCHES.map(function (color) {
        return '<button type="button" class="swatch" data-color="' + color + '" style="background:' + color + '"></button>';
      }).join('') + '</div>', function (ov) {
        ov.addEventListener('click', function (ev) {
          var sw = ev.target.closest('[data-color]');
          if (!sw) return;
          colorNode.color = sw.dataset.color;
          colorMap.updatedAt = Store.nowIso();
          closeSheet();
          persist();
          render();
        });
      });
      return;
    }
    if (act === 'link-node') { openLinkSheet(findMap(parseHash().id), btn.dataset.id); return; }
    if (act === 'edit-node') { openNodeEditor(findMap(parseHash().id), btn.dataset.id); return; }
    if (act === 'delete-map') {
      var gone = findMap(parseHash().id);
      if (!gone) return;
      confirmBox('Delete this map?', gone.title, 'Delete').then(function (yes) {
        if (!yes) return;
        state.maps = state.maps.filter(function (map) { return map.id !== gone.id; });
        state.tombstones.push({ col: 'maps', id: gone.id, updatedAt: Store.nowIso() });
        persist();
        go('#maps');
      });
      return;
    }
    if (act === 'delete-node') {
      var delMap = findMap(parseHash().id);
      confirmBox('Delete this branch?', 'Child branches go with it.', 'Delete').then(function (yes) {
        if (!yes || !delMap) return;
        deleteNode(delMap, btn.dataset.id);
        persist();
        render();
      });
    }
  }

  function onChange(event) {
    var input = event.target;
    if (!input.dataset) return;
    if (input.dataset.act === 'comment' || input.dataset.act === 'said') return;
    if (input.dataset.act === 'meal-check') {
      var meal = (state.home.meals || []).filter(function (row) { return row.id === input.dataset.id; })[0];
      if (meal) { meal.checked = input.checked; saveSoon(); }
    }
    if (input.dataset.act === 'shop-check') {
      var line = (state.home.shopping || []).filter(function (row) { return row.id === input.dataset.id; })[0];
      if (line) { line.checked = input.checked; saveSoon(); }
    }
    if (input.dataset.act === 'todo-check') {
      var map = findMap(input.dataset.map);
      var node = map && map.nodes[input.dataset.id];
      if (node) {
        node.done = input.checked;
        node.todo = true;
        map.updatedAt = Store.nowIso();
        persist();
        render();
      }
    }
    if (input.dataset.act === 'import-xmind') {
      importXmindFiles(input.files);
      input.value = '';
    }
    if (input.dataset.act === 'feed-file') readFeed(input.files && input.files[0]);
    if (input.dataset.act === 'backup-file') readBackup(input.files && input.files[0]);
  }
  function onInput(event) {
    var input = event.target;
    if (input.dataset.act === 'comment') {
      var decision = findDecision(input.dataset.id);
      if (!decision) return;
      decision.comment = input.value;
      decision.updatedAt = Store.nowIso();
      saveSoon();
    }
    if (input.dataset.act === 'thought-text' || input.dataset.act === 'thought-title' || input.dataset.act === 'thought-tags') {
      var live = findThought(input.dataset.id);
      if (!live) return;
      if (input.dataset.act === 'thought-text') live.text = input.value;
      if (input.dataset.act === 'thought-title') live.title = input.value;
      if (input.dataset.act === 'thought-tags') {
        live.tags = input.value.split(',').map(function (tag) { return tag.trim(); }).filter(Boolean);
      }
      live.updated = Store.nowIso();
      var hint = document.getElementById('saveHint');
      if (hint) hint.textContent = 'Saving...';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        persist().then(function () {
          var mark = document.getElementById('saveHint');
          if (mark) mark.textContent = 'Saved on this phone';
        });
      }, 350);
    }
    if (input.dataset.act === 'thought-search') {
      ui.thoughtQuery = input.value;
      var holder = document.getElementById('thoughtList');
      if (!holder) return;
      var query = ui.thoughtQuery.trim().toLowerCase();
      var found = sortedThoughts().filter(function (thought) {
        if (!query) return true;
        var blob = (thought.title + ' ' + thought.text + ' ' + (thought.tags || []).join(' ')).toLowerCase();
        return blob.indexOf(query) !== -1;
      });
      holder.innerHTML = found.map(function (thought) {
        return '<article class="card"><div class="pills"><span class="pill ' + statusClass(thought.status || 'New') + '">' + esc(thought.status || 'New') + '</span></div><h2>' + esc(thoughtLabel(thought)) + '</h2><button type="button" class="btn" data-act="open-thought" data-id="' + esc(thought.id) + '">Open</button></article>';
      }).join('') || '<p class="empty">No thoughts match.</p>';
    }
    if (input.dataset.act === 'map-search') {
      ui.query = input.value;
      var list = document.getElementById('mapList');
      if (!list) return;
      var q = ui.query.trim().toLowerCase();
      var maps = (state.maps || []).filter(function (map) { return !q || plain(map.title).toLowerCase().indexOf(q) !== -1; });
      list.innerHTML = maps.map(function (map) {
        var count = Object.keys(map.nodes || {}).length;
        return '<button type="button" class="maprow btn" data-act="open-map" data-id="' + esc(map.id) + '"><span><b>' + esc(map.title) + '</b><small>' + count + ' branches</small></span></button>';
      }).join('') || '<p class="empty">No maps match.</p>';
    }
  }

  async function readFeed(file) {
    if (!file) return;
    try {
      var text = await file.text();
      var imported = Home.importHomeFeed(text);
      var result = Store.applyHomeFeed(state, imported);
      if (!result.ok) { toast(result.warning); return; }
      await persist();
      toast(result.added ? ('Home feed loaded. ' + result.added + ' new decisions.') : 'Home feed loaded.');
      closeSheet();
      go('#home');
    } catch (err) {
      toast('Could not read that home feed.');
    }
  }
  async function readBackup(file) {
    if (!file) return;
    try {
      var data = JSON.parse(await file.text());
      if (!data || !data.version || !Array.isArray(data.decisions) || !Array.isArray(data.maps)) {
        toast('That backup is missing decisions or maps.');
        return;
      }
      var key = state.settings && state.settings.apiKey;
      state = hydrate(data);
      if (state.settings && !state.settings.apiKey && key) state.settings.apiKey = key;
      await persist();
      toast('Backup loaded.');
      closeSheet();
      go('#home');
    } catch (err) {
      toast('Could not read that backup.');
    }
  }

  function openSetup() {
    var settings = state.settings || {};
    var body = '<p class="sub">Command works with no account. Paste Appwrite ids when you want the phone and the bot to share one copy. Steps are in SETUP.md.</p>' +
      '<label class="fld">Endpoint<input id="s-endpoint" value="' + esc(settings.endpoint || '') + '" placeholder="https://cloud.appwrite.io/v1" autocomplete="off"></label>' +
      '<label class="fld">Project ID<input id="s-project" value="' + esc(settings.projectId || '') + '" autocomplete="off"></label>' +
      '<label class="fld">Database ID<input id="s-db" value="' + esc(settings.databaseId || 'command') + '" autocomplete="off"></label>' +
      '<label class="fld">API key<input id="s-key" type="password" value="' + esc(settings.apiKey || '') + '" autocomplete="off"></label>' +
      '<p class="note">The key stays on this phone. It is left out of backups. Make a second key for the bot.</p>' +
      '<div class="row"><button type="button" class="btn primary" id="s-save">Save</button><button type="button" class="btn" id="s-sync">Sync now</button></div>' +
      '<div class="row"><button type="button" class="btn" id="s-backup">Download backup</button>' +
      '<label class="btn file">Load backup<input type="file" accept="application/json,.json" hidden data-act="backup-file"></label></div>' +
      '<div class="row"><label class="btn file">Load home feed<input type="file" accept="application/json,.json" hidden data-act="feed-file"></label>' +
      '<button type="button" class="btn danger" id="s-reset">Reset this phone</button></div>' +
      '<p class="note">Command 1.0.0</p>';
    openSheet('Setup', body, function (ov) {
      ov.querySelector('#s-save').onclick = function () {
        state.settings = {
          endpoint: ov.querySelector('#s-endpoint').value.trim().replace(/\/$/, ''),
          projectId: ov.querySelector('#s-project').value.trim(),
          databaseId: ov.querySelector('#s-db').value.trim() || 'command',
          apiKey: ov.querySelector('#s-key').value.trim()
        };
        state.syncError = '';
        persist().then(function () {
          toast(Store.syncConfigured(state.settings) ? 'Sync is on.' : 'Saved on this phone.');
          syncLabel();
          if (Store.syncConfigured(state.settings)) runSync();
        });
      };
      ov.querySelector('#s-sync').onclick = function () {
        state.settings.endpoint = ov.querySelector('#s-endpoint').value.trim().replace(/\/$/, '');
        state.settings.projectId = ov.querySelector('#s-project').value.trim();
        state.settings.databaseId = ov.querySelector('#s-db').value.trim() || 'command';
        state.settings.apiKey = ov.querySelector('#s-key').value.trim();
        persist().then(runSync);
      };
      ov.querySelector('#s-backup').onclick = function () {
        var copy = Store.clone(state);
        if (copy.settings) copy.settings.apiKey = '';
        var blob = new Blob([JSON.stringify(copy)], { type: 'application/json' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'command-backup.json';
        link.click();
      };
      ov.querySelector('#s-reset').onclick = function () {
        confirmBox('Reset this phone?', 'This puts the starter maps and sample decisions back. Download a backup first if you want to keep edits.', 'Reset').then(function (yes) {
          if (!yes || !window.COMMAND_SEED) return;
          var key = state.settings && state.settings.apiKey;
          state = hydrate(Store.clone(window.COMMAND_SEED));
          if (key) state.settings.apiKey = key;
          persist().then(function () { closeSheet(); go('#home'); toast('Starter copy is back.'); });
        });
      };
    });
  }

  function hydrate(raw) {
    var base = Store.emptyState();
    var next = Object.assign(base, raw || {});
    next.home = Object.assign(Store.clone(base.home), (raw && raw.home) || {});
    next.home.fun = Object.assign({ routine: '', rules: '', tslaShares: null, tslaText: '' }, next.home.fun || {});
    next.home.meals = next.home.meals || [];
    next.home.shopping = next.home.shopping || [];
    next.home.projects = next.home.projects || [];
    next.home.rules = next.home.rules || [];
    next.settings = Object.assign({ endpoint: '', projectId: '', databaseId: 'command', apiKey: '' }, (raw && raw.settings) || {});
    next.decisions = next.decisions || [];
    next.maps = next.maps || [];
    next.thoughts = Array.isArray(raw && raw.thoughts) ? raw.thoughts : [];
    next.top3 = next.top3 && next.top3.length ? next.top3 : base.top3;
    next.tombstones = next.tombstones || [];
    return next;
  }

  document.body.addEventListener('click', onClick);
  document.body.addEventListener('change', onChange);
  document.body.addEventListener('input', onInput);
  window.addEventListener('hashchange', render);
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeSheet();
  });

  async function boot() {
    var saved = null;
    try { saved = await backend.get('state'); } catch (err) { saved = null; }
    if (saved && saved.version && Array.isArray(saved.decisions) && Array.isArray(saved.maps)) state = hydrate(saved);
    else if (window.COMMAND_SEED) state = hydrate(Store.clone(window.COMMAND_SEED));
    else state = Store.emptyState();
    if (!location.hash) location.hash = '#home';
    render();
    if (Store.syncConfigured(state.settings)) runSync();
  }
  boot();
})();
