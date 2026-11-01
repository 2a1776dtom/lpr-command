/* Local-first store. IndexedDB, then localStorage. Appwrite sync is optional. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CommandStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var AREAS = ['Clinic', 'Money', 'Home', 'Product', 'Bots/System'];
  var URGENCIES = ['Urgent', 'Soon', 'Later', 'Waiting'];
  var URGENCY_RANK = { Urgent: 0, Soon: 1, Later: 2, Waiting: 3 };
  var COLLECTIONS = ['decisions', 'maps', 'nodes', 'todos', 'top3', 'home_feed', 'thoughts'];
  var THOUGHT_STATUSES = ['New', 'Picked up', 'In progress', 'Done', 'Parked'];

  function nowIso() {
    return new Date().toISOString();
  }

  function uid(prefix) {
    return String(prefix || 'id') + Math.random().toString(36).slice(2, 10);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function sampleDecisions() {
    function opt(id, label) { return { id: id, label: label }; }
    return [
      {
        id: 'sample1',
        title: 'SAMPLE: Keep Thursday afternoon open?',
        question: 'Keep Thursday afternoon for patients, or block it for admin?',
        area: 'Clinic',
        urgency: 'Urgent',
        options: [
          opt('sample1a', 'Keep it open'),
          opt('sample1b', 'Block it for admin'),
          opt('sample1c', 'Split the afternoon')
        ],
        recommendedId: 'sample1a',
        chosenId: '',
        comment: '',
        note: 'Sample data. Not a real clinic decision.',
        said: '',
        raised: '2026-10-28',
        due: '2026-11-02',
        status: 'open',
        sample: true,
        source: 'sample',
        sourceKey: '',
        updatedAt: '2026-10-31T00:00:00.000Z'
      },
      {
        id: 'sample2',
        title: 'SAMPLE: Review software bills this month?',
        question: 'When should the software subscriptions get a look?',
        area: 'Money',
        urgency: 'Later',
        options: [
          opt('sample2a', 'Review this week'),
          opt('sample2b', 'Wait until December'),
          opt('sample2c', 'Cancel the extras now')
        ],
        recommendedId: 'sample2a',
        chosenId: '',
        comment: '',
        note: 'Sample data. Not a real money decision.',
        said: '',
        raised: '2026-10-01',
        due: '',
        status: 'open',
        sample: true,
        source: 'sample',
        sourceKey: '',
        updatedAt: '2026-10-31T00:00:00.000Z'
      },
      {
        id: 'sample3',
        title: 'SAMPLE: Which bot reads Command first?',
        question: 'Which assistant should get the decisions key first?',
        area: 'Bots/System',
        urgency: 'Waiting',
        options: [
          opt('sample3a', 'Chief of Staff'),
          opt('sample3b', 'Research bot'),
          opt('sample3c', 'Both after sync is on')
        ],
        recommendedId: 'sample3a',
        chosenId: '',
        comment: '',
        note: 'Sample data. Not a live bot setup.',
        said: '',
        raised: '2026-10-20',
        due: '',
        status: 'open',
        sample: true,
        source: 'sample',
        sourceKey: '',
        updatedAt: '2026-10-31T00:00:00.000Z'
      },
      {
        id: 'sample4',
        title: 'SAMPLE: Leave the wallet idea on the shelf?',
        question: 'What should happen to the metal wallet idea?',
        area: 'Product',
        urgency: 'Later',
        options: [
          opt('sample4a', 'Leave it'),
          opt('sample4b', 'Sketch improvements'),
          opt('sample4c', 'Drop the idea')
        ],
        recommendedId: 'sample4a',
        chosenId: '',
        comment: '',
        note: 'Sample data. Not a real product decision.',
        said: '',
        raised: '2026-10-15',
        due: '',
        status: 'open',
        sample: true,
        source: 'sample',
        sourceKey: '',
        updatedAt: '2026-10-31T00:00:00.000Z'
      }
    ];
  }

  function sampleTop3() {
    return [
        { slot: 1, text: 'Sunday meal prep, names first', sample: true, refType: 'jump', refId: 'meals' },
      { slot: 2, text: 'Adirondack SVG: go or no', sample: true, refType: 'decision', refId: 'hfa' },
      { slot: 3, text: 'Pain program: build or wait', sample: true, refType: 'decision', refId: 'hfb' }
    ];
  }

  function chooseOption(decision, optionId) {
    if (!decision || !Array.isArray(decision.options)) return decision;
    var match = decision.options.some(function (opt) { return opt.id === optionId; });
    if (!match) return decision;
    if (decision.chosenId === optionId) {
      decision.chosenId = '';
      decision.status = 'open';
    } else {
      decision.chosenId = optionId;
      decision.status = 'decided';
    }
    decision.updatedAt = nowIso();
    return decision;
  }

  function filterDecisions(list, query) {
    var q = query || {};
    var out = (list || []).filter(function (item) {
      if (!item) return false;
      if (q.area && q.area !== 'All' && item.area !== q.area) return false;
      if (q.urgency && q.urgency !== 'All' && item.urgency !== q.urgency) return false;
      if (q.status && q.status !== 'All' && item.status !== q.status) return false;
      return true;
    });
    var sort = q.sort || 'urgency';
    out.sort(function (a, b) {
      if (sort === 'due') {
        var ad = a.due || '9999-99-99';
        var bd = b.due || '9999-99-99';
        if (ad !== bd) return ad < bd ? -1 : 1;
      } else if (sort === 'oldest') {
        var ar = a.raised || '9999-99-99';
        var br = b.raised || '9999-99-99';
        if (ar !== br) return ar < br ? -1 : 1;
      } else if (sort === 'area') {
        if (a.area !== b.area) return a.area < b.area ? -1 : 1;
      } else {
        var rank = (URGENCY_RANK[a.urgency] == null ? 9 : URGENCY_RANK[a.urgency]) - (URGENCY_RANK[b.urgency] == null ? 9 : URGENCY_RANK[b.urgency]);
        if (rank) return rank;
        var dueA = a.due || '9999-99-99';
        var dueB = b.due || '9999-99-99';
        if (dueA !== dueB) return dueA < dueB ? -1 : 1;
      }
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
    return out;
  }

  function openTodos(state) {
    var out = [];
    (state.maps || []).forEach(function (map) {
      Object.keys(map.nodes || {}).forEach(function (id) {
        var node = map.nodes[id];
        if (node && node.todo && !node.done) {
          out.push({ mapId: map.id, mapTitle: map.title, node: node });
        }
      });
    });
    out.sort(function (a, b) {
      var ap = a.node.priority == null ? 9 : a.node.priority;
      var bp = b.node.priority == null ? 9 : b.node.priority;
      if (ap !== bp) return ap - bp;
      var ad = a.node.due || '9999-99-99';
      var bd = b.node.due || '9999-99-99';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return String(a.node.title || '').localeCompare(String(b.node.title || ''));
    });
    return out;
  }

  function emptyState() {
    return {
      version: 1,
      booted: true,
      decisions: [],
      maps: [],
      top3: [
        { slot: 1, text: '', sample: false, refType: '', refId: '' },
        { slot: 2, text: '', sample: false, refType: '', refId: '' },
        { slot: 3, text: '', sample: false, refType: '', refId: '' }
      ],
      home: {
        updated: '', source: '', rules: [], planDate: '', planLabel: '', next: '',
        meals: [], shopping: [], projects: [],
        fun: { routine: '', rules: '', tslaShares: null, tslaText: '' }
      },
      thoughts: [],
      tombstones: [],
      settings: { endpoint: '', projectId: '', databaseId: 'command', apiKey: '' },
      lastSync: '',
      syncError: '',
      updatedAt: nowIso()
    };
  }

  function linkTop3(top3, decisions) {
    var byTitle = {};
    (decisions || []).forEach(function (item) {
      if (!item || !item.title) return;
      byTitle[item.title] = item.id;
    });
    return (top3 || []).map(function (item) {
      var copy = {
        slot: item.slot,
        text: item.text || '',
        sample: !!item.sample,
        refType: item.refType || '',
        refId: item.refId || ''
      };
      if (copy.text.indexOf('Adirondack') !== -1 && byTitle['Adirondack chair: export the SVG?']) {
        copy.refType = 'decision';
        copy.refId = byTitle['Adirondack chair: export the SVG?'];
      }
      if (copy.text.indexOf('Pain program') !== -1 && byTitle['Build the pain program?']) {
        copy.refType = 'decision';
        copy.refId = byTitle['Build the pain program?'];
      }
      return copy;
    });
  }

  function buildSeedState(parts) {
    var state = emptyState();
    var imported = parts.feed || { home: state.home, decisions: [] };
    state.home = imported.home || state.home;
    state.decisions = (imported.decisions || []).concat(parts.sampleDecisions || sampleDecisions());
    state.maps = parts.maps || [];
    state.top3 = linkTop3(parts.top3 || sampleTop3(), state.decisions);
    state.updatedAt = '2026-10-31T00:00:00.000Z';
    state.maps.forEach(function (map) {
      if (!map.updatedAt) map.updatedAt = state.updatedAt;
    });
    state.decisions.forEach(function (item) {
      if (!item.updatedAt) item.updatedAt = state.updatedAt;
    });
    state.thoughts = parts.thoughts || [];
    return state;
  }

  function applyHomeFeed(state, imported) {
    var homeApi = typeof CommandHome !== 'undefined' ? CommandHome : null;
    if (!imported || !imported.ok) return { ok: false, warning: (imported && imported.warning) || 'Could not read the home feed.' };
    if (homeApi) state.home = homeApi.mergeHome(state.home, imported.home);
    else state.home = imported.home;
    var before = state.decisions.length;
    if (homeApi) state.decisions = homeApi.mergeDecisions(state.decisions, imported.decisions || []);
    else state.decisions = state.decisions.concat(imported.decisions || []);
    state.updatedAt = nowIso();
    return { ok: true, warning: '', added: state.decisions.length - before };
  }

  function decisionDoc(item) {
    return {
      title: String(item.title || '').slice(0, 500),
      question: String(item.question || '').slice(0, 2000),
      area: item.area || 'Home',
      urgency: item.urgency || 'Soon',
      options: JSON.stringify(item.options || []).slice(0, 8000),
      recommendedId: item.recommendedId || '',
      chosenId: item.chosenId || '',
      comment: String(item.comment || '').slice(0, 4000),
      raised: item.raised || '',
      due: item.due || '',
      status: item.status || 'open',
      note: String(item.note || '').slice(0, 4000),
      said: String(item.said || '').slice(0, 4000),
      sample: !!item.sample,
      source: item.source || '',
      sourceKey: item.sourceKey || '',
      updatedAt: item.updatedAt || ''
    };
  }

  function decisionFromDoc(doc) {
    var data = doc.data || doc;
    var options = [];
    try { options = JSON.parse(data.options || '[]'); } catch (err) { options = []; }
    if (!Array.isArray(options)) options = [];
    return {
      id: doc.$id || data.id,
      title: data.title || '',
      question: data.question || '',
      area: data.area || 'Home',
      urgency: data.urgency || 'Soon',
      options: options,
      recommendedId: data.recommendedId || '',
      chosenId: data.chosenId || '',
      comment: data.comment || '',
      raised: data.raised || '',
      due: data.due || '',
      status: data.status || 'open',
      note: data.note || '',
      said: data.said || '',
      sample: !!data.sample,
      source: data.source || '',
      sourceKey: data.sourceKey || '',
      updatedAt: data.updatedAt || doc.$updatedAt || ''
    };
  }

  function nodeDoc(map, node) {
    return {
      mapId: map.id,
      parentId: node.parentId || '',
      title: String(node.title || '').slice(0, 7000),
      note: String(node.note || '').slice(0, 7000),
      color: node.color || '',
      todo: !!node.todo,
      done: !!node.done,
      collapsed: !!node.collapsed,
      decisionId: node.decisionId || '',
      sortOrder: node.sortOrder || 0,
      labels: (node.labels || []).join('\n').slice(0, 1000),
      priority: node.priority == null ? -1 : node.priority,
      due: node.due || '',
      href: node.href || '',
      kind: node.kind || 'attached',
      folded: !!node.folded,
      dx: node.dx || 0,
      dy: node.dy || 0,
      updatedAt: map.updatedAt || ''
    };
  }

  function mapDoc(map) {
    return {
      title: String(map.title || '').slice(0, 300),
      sheetTitle: String(map.sheetTitle || '').slice(0, 300),
      source: String(map.source || '').slice(0, 300),
      rootId: map.rootId || '',
      palette: JSON.stringify(map.palette || []).slice(0, 1000),
      rels: JSON.stringify(map.rels || []).slice(0, 8000),
      updatedAt: map.updatedAt || ''
    };
  }

  function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      var parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function thoughtDoc(item) {
    var notes = (item.bot_notes || []).map(function (note) {
      return {
        bot: String(note && note.bot || '').slice(0, 80),
        time: String(note && note.time || '').slice(0, 40),
        text: String(note && note.text || '').slice(0, 2000)
      };
    });
    return {
      title: String(item.title || '').slice(0, 300),
      text: String(item.text || '').slice(0, 9000),
      created: item.created || '',
      updated: item.updated || '',
      status: item.status || 'New',
      tags: JSON.stringify(item.tags || []).slice(0, 1000),
      area: item.area || '',
      owner_bot: String(item.owner_bot || '').slice(0, 80),
      bot_notes: JSON.stringify(notes).slice(0, 9000),
      linked_decision_id: item.linked_decision_id || ''
    };
  }

  function thoughtFromDoc(doc) {
    var data = doc.data || doc;
    var notes = parseJsonArray(data.bot_notes).map(function (note) {
      return {
        bot: note && note.bot ? String(note.bot) : '',
        time: note && note.time ? String(note.time) : '',
        text: note && note.text ? String(note.text) : ''
      };
    }).filter(function (note) { return note.text; });
    var tags = parseJsonArray(data.tags).map(function (tag) { return String(tag || '').trim(); }).filter(Boolean);
    if (!tags.length && typeof data.tags === 'string' && data.tags && data.tags.charAt(0) !== '[') {
      tags = data.tags.split(',').map(function (tag) { return tag.trim(); }).filter(Boolean);
    }
    return {
      id: doc.$id || data.id,
      title: data.title || '',
      text: data.text || '',
      created: data.created || '',
      updated: data.updated || doc.$updatedAt || '',
      status: data.status || 'New',
      tags: tags,
      area: data.area || '',
      owner_bot: data.owner_bot || '',
      bot_notes: notes,
      linked_decision_id: data.linked_decision_id || ''
    };
  }

  function newer(a, b) {
    return String(a || '') > String(b || '');
  }

  async function syncThoughts(state, client) {
    state.thoughts = state.thoughts || [];
    var remoteRows = await client.list('thoughts');
    var localById = {};
    state.thoughts.forEach(function (item) { localById[item.id] = item; });
    var remoteIds = {};
    var i;
    for (i = 0; i < remoteRows.length; i++) {
      var remote = thoughtFromDoc(remoteRows[i]);
      remoteIds[remote.id] = true;
      var local = localById[remote.id];
      if (!local || newer(remote.updated, local.updated)) localById[remote.id] = remote;
      else if (newer(local.updated, remote.updated)) await client.upsert('thoughts', local.id, thoughtDoc(local));
    }
    var next = Object.keys(localById).map(function (id) { return localById[id]; });
    var n;
    for (n = 0; n < next.length; n++) {
      if (!remoteIds[next[n].id]) await client.upsert('thoughts', next[n].id, thoughtDoc(next[n]));
    }
    state.thoughts = next;
  }

  async function syncState(state, client) {
    if (!client) return { ok: false, reason: 'no-client' };
    var settings = state.settings || {};
    if (!settings.endpoint || !settings.projectId) return { ok: false, reason: 'not-configured' };
    if (!settings.apiKey) return { ok: false, reason: 'no-key' };

    var remoteDecisions = await client.list('decisions');
    var localById = {};
    state.decisions.forEach(function (item) { localById[item.id] = item; });
    var remoteIds = {};
    for (var i = 0; i < remoteDecisions.length; i++) {
      var remote = decisionFromDoc(remoteDecisions[i]);
      remoteIds[remote.id] = true;
      var local = localById[remote.id];
      if (!local || newer(remote.updatedAt, local.updatedAt)) localById[remote.id] = remote;
      else if (newer(local.updatedAt, remote.updatedAt)) await client.upsert('decisions', local.id, decisionDoc(local));
    }
    var nextDecisions = Object.keys(localById).map(function (id) { return localById[id]; });
    for (var d = 0; d < nextDecisions.length; d++) {
      var item = nextDecisions[d];
      if (!remoteIds[item.id]) await client.upsert('decisions', item.id, decisionDoc(item));
    }
    state.decisions = nextDecisions;

    try {
      await syncThoughts(state, client);
    } catch (err) {
      if (!err || err.status !== 404) throw err;
      state.syncError = 'Add the thoughts collection in Appwrite. Other data still syncs.';
    }

    var tombstones = state.tombstones || [];
    var kept = [];
    for (var t = 0; t < tombstones.length; t++) {
      var tomb = tombstones[t];
      try {
        await client.remove(tomb.col, tomb.id);
        if (tomb.col === 'maps') {
          var leftovers = await client.list('nodes', tomb.id);
          var li;
          for (li = 0; li < leftovers.length; li++) await client.remove('nodes', leftovers[li].$id);
          var leftTodos = await client.list('todos', tomb.id);
          var lt;
          for (lt = 0; lt < leftTodos.length; lt++) await client.remove('todos', leftTodos[lt].$id);
        }
      } catch (err) {
        if (!err || (err.status !== 404 && err.status !== 400)) kept.push(tomb);
      }
    }
    state.tombstones = kept;

    var remoteMaps = await client.list('maps');
    var remoteMapById = {};
    remoteMaps.forEach(function (doc) { remoteMapById[doc.$id] = doc; });
    for (var m = 0; m < state.maps.length; m++) {
      var map = state.maps[m];
      var remoteMap = remoteMapById[map.id];
      var remoteUpdated = remoteMap && remoteMap.data ? remoteMap.data.updatedAt : '';
      if (remoteMap && newer(remoteUpdated, map.updatedAt)) {
        var pulled = await client.list('nodes', map.id);
        var nodes = {};
        pulled.forEach(function (doc) {
          var data = doc.data || {};
          nodes[doc.$id] = {
            id: doc.$id,
            parentId: data.parentId || '',
            childIds: [],
            title: data.title || '',
            note: data.note || '',
            color: data.color || '',
            todo: !!data.todo,
            done: !!data.done,
            collapsed: !!data.collapsed,
            decisionId: data.decisionId || '',
            sortOrder: data.sortOrder || 0,
            labels: String(data.labels || '').split('\n').filter(Boolean),
            priority: data.priority == null || data.priority < 0 ? null : data.priority,
            due: data.due || '',
            href: data.href || '',
            kind: data.kind || 'attached',
            folded: !!data.folded,
            dx: data.dx || 0,
            dy: data.dy || 0
          };
        });
        Object.keys(nodes).forEach(function (id) {
          var node = nodes[id];
          if (node.parentId && nodes[node.parentId]) nodes[node.parentId].childIds.push(id);
        });
        Object.keys(nodes).forEach(function (id) {
          nodes[id].childIds.sort(function (a, b) { return (nodes[a].sortOrder || 0) - (nodes[b].sortOrder || 0); });
        });
        var data = remoteMap.data || {};
        map.title = data.title || map.title;
        map.rootId = data.rootId || map.rootId;
        map.updatedAt = remoteUpdated;
        map.nodes = nodes;
        try { map.palette = JSON.parse(data.palette || '[]'); } catch (err) { map.palette = map.palette || []; }
        try { map.rels = JSON.parse(data.rels || '[]'); } catch (err) { map.rels = []; }
      } else if (!remoteMap || newer(map.updatedAt, remoteUpdated)) {
        await client.upsert('maps', map.id, mapDoc(map));
        var existingNodes = remoteMap ? await client.list('nodes', map.id) : [];
        var seen = {};
        var ids = Object.keys(map.nodes || {});
        for (var n = 0; n < ids.length; n++) {
          var nodeId = ids[n];
          seen[nodeId] = true;
          await client.upsert('nodes', nodeId, nodeDoc(map, map.nodes[nodeId]));
        }
        for (var e = 0; e < existingNodes.length; e++) {
          if (!seen[existingNodes[e].$id]) await client.remove('nodes', existingNodes[e].$id);
        }
        var todoDocs = [];
        ids.forEach(function (nodeId) {
          var node = map.nodes[nodeId];
          if (!node.todo) return;
          todoDocs.push({
            id: nodeId,
            data: {
              mapId: map.id,
              nodeId: nodeId,
              mapTitle: String(map.title || '').slice(0, 300),
              title: String(node.title || '').slice(0, 500),
              done: !!node.done,
              due: node.due || '',
              priority: node.priority == null ? -1 : node.priority,
              updatedAt: map.updatedAt || ''
            }
          });
        });
        var existingTodos = await client.list('todos', map.id);
        var todoSeen = {};
        for (var td = 0; td < todoDocs.length; td++) {
          todoSeen[todoDocs[td].id] = true;
          await client.upsert('todos', todoDocs[td].id, todoDocs[td].data);
        }
        for (var et = 0; et < existingTodos.length; et++) {
          if (!todoSeen[existingTodos[et].$id]) await client.remove('todos', existingTodos[et].$id);
        }
      }
      delete remoteMapById[map.id];
    }

    for (var s = 0; s < state.top3.length; s++) {
      var slot = state.top3[s];
      await client.upsert('top3', 'top' + slot.slot, {
        slot: slot.slot,
        text: String(slot.text || '').slice(0, 300),
        sample: !!slot.sample,
        refType: slot.refType || '',
        refId: slot.refId || '',
        updatedAt: state.updatedAt || ''
      });
    }
    await client.upsert('home_feed', 'current', {
      payload: JSON.stringify(state.home || {}).slice(0, 16000),
      updatedAt: state.updatedAt || ''
    });
    state.lastSync = nowIso();
    state.syncError = '';
    return { ok: true };
  }

  function memoryBackend(initial) {
    var data = initial || {};
    return {
      async get(key) {
        return Object.prototype.hasOwnProperty.call(data, key) ? clone(data[key]) : null;
      },
      async set(key, value) {
        data[key] = clone(value);
      }
    };
  }

  function browserBackend() {
    var dbPromise = null;
    function db() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise(function (resolve, reject) {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('no idb'));
          return;
        }
        var req = indexedDB.open('command', 1);
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('idb')); };
      });
      return dbPromise;
    }
    return {
      async get(key) {
        try {
          var database = await db();
          var value = await new Promise(function (resolve, reject) {
            var tx = database.transaction('kv', 'readonly');
            var req = tx.objectStore('kv').get(key);
            req.onsuccess = function () { resolve(req.result || null); };
            req.onerror = function () { reject(req.error); };
          });
          if (value) return value;
        } catch (err) { /* fall through */ }
        try {
          var text = localStorage.getItem('command.state');
          if (text && key === 'state') return JSON.parse(text);
        } catch (err) { /* ignore */ }
        return null;
      },
      async set(key, value) {
        var copy = clone(value);
        var idbOk = false;
        try {
          var database = await db();
          await new Promise(function (resolve, reject) {
            var tx = database.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(copy, key);
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
          });
          idbOk = true;
        } catch (err) { idbOk = false; }
        if (key === 'state') {
          try {
            var text = JSON.stringify(copy);
            if (text.length < 4500000) localStorage.setItem('command.state', text);
          } catch (err) {
            if (!idbOk) throw err;
          }
        }
        if (!idbOk && key === 'state') {
          try {
            if (!localStorage.getItem('command.state')) throw new Error('save failed');
          } catch (err) {
            throw err;
          }
        }
      }
    };
  }

  function createClient(settings, fetchImpl) {
    var doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    var endpoint = String(settings.endpoint || '').replace(/\/$/, '');
    var databaseId = settings.databaseId || 'command';
    async function request(method, path, body) {
      var res = await doFetch(endpoint + path, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'X-Appwrite-Project': settings.projectId,
          'X-Appwrite-Key': settings.apiKey
        },
        body: body ? JSON.stringify(body) : undefined
      });
      var text = await res.text();
      var json = null;
      try { json = text ? JSON.parse(text) : null; } catch (err) { json = { message: text }; }
      if (!res.ok) {
        var error = new Error((json && json.message) || ('Sync failed (' + res.status + ')'));
        error.status = res.status;
        throw error;
      }
      return json;
    }
    return {
      async list(collection, mapId) {
        var docs = [];
        var cursor = '';
        var guard = 0;
        while (guard < 40) {
          guard += 1;
          var queries = [{ method: 'limit', values: [100] }];
          if (mapId && (collection === 'nodes' || collection === 'todos')) {
            queries.push({ method: 'equal', attribute: 'mapId', values: [mapId] });
          }
          if (cursor) queries.push({ method: 'cursorAfter', values: [cursor] });
          var qs = queries.map(function (q, index) {
            return 'queries[' + index + ']=' + encodeURIComponent(JSON.stringify(q));
          }).join('&');
          var page = await request('GET', '/databases/' + databaseId + '/collections/' + collection + '/documents?' + qs);
          var batch = page && page.documents ? page.documents : [];
          docs = docs.concat(batch);
          if (!batch.length || batch.length < 100) break;
          cursor = batch[batch.length - 1].$id;
        }
        return docs;
      },
      async upsert(collection, id, data) {
        var path = '/databases/' + databaseId + '/collections/' + collection + '/documents/' + encodeURIComponent(id);
        try {
          return await request('PATCH', path, { data: data });
        } catch (err) {
          if (!err || (err.status !== 404 && err.status !== 400)) {
            try {
              return await request('POST', '/databases/' + databaseId + '/collections/' + collection + '/documents', {
                documentId: id,
                data: data
              });
            } catch (err2) {
              if (err2 && err2.status === 409) return request('PATCH', path, { data: data });
              throw err2;
            }
          }
          return request('POST', '/databases/' + databaseId + '/collections/' + collection + '/documents', {
            documentId: id,
            data: data
          });
        }
      },
      async remove(collection, id) {
        var path = '/databases/' + databaseId + '/collections/' + collection + '/documents/' + encodeURIComponent(id);
        return request('DELETE', path);
      }
    };
  }

  function syncConfigured(settings) {
    return !!(settings && settings.endpoint && settings.projectId && settings.apiKey);
  }

  return {
    AREAS: AREAS,
    URGENCIES: URGENCIES,
    COLLECTIONS: COLLECTIONS,
    THOUGHT_STATUSES: THOUGHT_STATUSES,
    thoughtDoc: thoughtDoc,
    thoughtFromDoc: thoughtFromDoc,
    nowIso: nowIso,
    uid: uid,
    clone: clone,
    sampleDecisions: sampleDecisions,
    sampleTop3: sampleTop3,
    chooseOption: chooseOption,
    filterDecisions: filterDecisions,
    openTodos: openTodos,
    emptyState: emptyState,
    buildSeedState: buildSeedState,
    applyHomeFeed: applyHomeFeed,
    decisionDoc: decisionDoc,
    decisionFromDoc: decisionFromDoc,
    syncState: syncState,
    memoryBackend: memoryBackend,
    browserBackend: browserBackend,
    createClient: createClient,
    syncConfigured: syncConfigured,
    linkTop3: linkTop3
  };
});
