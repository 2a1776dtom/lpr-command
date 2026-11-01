/* Home feed importer. Tolerant of the home assistant JSON shape.
   A project that is waiting on a choice becomes a Decision in the Home area. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CommandHome = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function hash(text) {
    var h = 2166136261;
    var s = String(text || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function asLines(value) {
    if (Array.isArray(value)) {
      return value.map(function (line) { return String(line == null ? '' : line).trim(); }).filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      return value.split(/\n+/).map(function (line) { return line.trim(); }).filter(Boolean);
    }
    return [];
  }

  function asNumber(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && isFinite(Number(value))) return Number(value);
    return null;
  }

  function mealRows(value) {
    if (!Array.isArray(value)) return null;
    var rows = value.filter(function (row) {
      return row && typeof row === 'object' && (row.meal || row.name || row.title);
    });
    return rows.length ? rows : null;
  }

  function formatPlanDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    var month = MONTHS[Number(m[2]) - 1] || m[2];
    return month + ' ' + Number(m[3]) + ', ' + m[1];
  }

  function findPlan(meal) {
    var empty = { rows: [], date: '', label: '', key: '' };
    if (!meal || typeof meal !== 'object') return empty;
    var current = mealRows(meal.plan) || mealRows(meal.meals) || mealRows(meal.week);
    if (current) return { rows: current, date: '', label: 'This week', key: 'plan' };
    var dated = [];
    Object.keys(meal).forEach(function (key) {
      var rows = mealRows(meal[key]);
      if (!rows) return;
      var found = key.match(/\d{4}-\d{2}-\d{2}/);
      if (found || key === 'last_plan' || key.indexOf('last_plan') === 0 || key.indexOf('plan') === 0) {
        dated.push({ key: key, rows: rows, date: found ? found[0] : '' });
      }
    });
    dated.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return 0;
    });
    if (dated.length) {
      var best = dated[0];
      var label = best.date ? ('Last plan ' + formatPlanDate(best.date)) : 'Last plan';
      return { rows: best.rows, date: best.date, label: label, key: best.key };
    }
    return empty;
  }

  function normalizeMeal(row, index) {
    var name = String(row.meal || row.name || row.title || '').trim();
    var servings = row.servings;
    if (typeof servings === 'string' && servings.trim() && isFinite(Number(servings))) servings = Number(servings);
    if (servings == null) servings = '';
    return {
      id: 'meal' + hash(name + ':' + index),
      meal: name,
      servings: servings,
      ingredients: String(row.ingredients || row.detail || row.notes || '').trim(),
      checked: !!row.checked
    };
  }

  function isPendingChoice(project) {
    if (!project || typeof project !== 'object') return false;
    if (project.choice === true || project.pending === true) return true;
    if (project.choice === false || project.pending === false) return false;
    var status = String(project.status || '').toLowerCase();
    var next = String(project.next || project.next_step || '').toLowerCase();
    if (status.indexOf('waiting') !== -1) return true;
    if (/decid|whether|says go|say go|go\/no-go|go or no/.test(next)) return true;
    return false;
  }

  function option(id, label) {
    return { id: id, label: label };
  }

  function decisionFor(project) {
    var title = String(project.title || project.name || '').trim();
    var next = String(project.next || project.next_step || '').trim();
    var files = String(project.files || project.file || project.path || '').trim();
    var blob = (title + ' ' + next).toLowerCase();
    var id = 'hf' + hash(title);
    var base = {
      id: id,
      area: 'Home',
      status: 'open',
      chosenId: '',
      comment: '',
      note: files ? ('Files: ' + files) : '',
      said: '',
      raised: '',
      due: '',
      sample: false,
      source: 'home-feed',
      sourceKey: title,
      updatedAt: ''
    };
    if (/adirondack|svg export|fusion 360/.test(blob)) {
      base.title = 'Adirondack chair: export the SVG?';
      base.question = 'Export the Adirondack chair SVG for Fusion 360 now?';
      base.urgency = 'Soon';
      base.options = [
        option(id + 'a', 'Go, export the SVG'),
        option(id + 'b', 'Not yet'),
        option(id + 'c', 'Drop this chair')
      ];
      base.recommendedId = id + 'a';
      base.comment = 'Concept is done. Export when you say go.';
      return base;
    }
    if (/pain program|gumroad|persistent pain/.test(blob)) {
      base.title = 'Build the pain program?';
      base.question = 'Build the Persistent Pain Home Program ($97)?';
      base.urgency = 'Soon';
      base.options = [
        option(id + 'a', 'Build the draft'),
        option(id + 'b', 'Wait'),
        option(id + 'c', 'Do not build')
      ];
      base.recommendedId = id + 'a';
      base.comment = 'Attorney review before any launch.';
      return base;
    }
    if (/heloc|equity loan|home equity/.test(blob)) {
      base.title = 'HELOC or home equity loan?';
      base.question = 'How should the owner-built addition be funded?';
      base.urgency = 'Waiting';
      base.options = [
        option(id + 'a', 'HELOC'),
        option(id + 'b', 'Home equity loan'),
        option(id + 'c', 'Need the numbers first')
      ];
      base.recommendedId = id + 'c';
      base.comment = 'Need a lender name, the build cost, and equity figures.';
      return base;
    }
    base.title = title || 'Home decision';
    base.question = next || title || 'What do you want to do?';
    base.urgency = String(project.status || '').toLowerCase().indexOf('waiting') !== -1 ? 'Waiting' : 'Soon';
    base.options = [
      option(id + 'a', 'Go'),
      option(id + 'b', 'Not yet'),
      option(id + 'c', 'Drop it')
    ];
    base.recommendedId = id + 'a';
    if (next) base.comment = next;
    return base;
  }

  function emptyHome() {
    return {
      updated: '',
      source: '',
      rules: [],
      planDate: '',
      planLabel: '',
      next: '',
      meals: [],
      shopping: [],
      projects: [],
      fun: { routine: '', rules: '', tslaShares: null, tslaText: '' }
    };
  }

  function importHomeFeed(input) {
    var data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); }
      catch (err) {
        return { ok: false, warning: 'That home feed is not valid JSON.', home: emptyHome(), decisions: [] };
      }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, warning: 'Home feed must be a JSON object.', home: emptyHome(), decisions: [] };
    }
    var meal = data.meal_prep || data.mealPrep || data.meals_block || {};
    if (typeof meal !== 'object') meal = {};
    var plan = findPlan(meal);
    var home = emptyHome();
    home.updated = String(data.updated || data.date || '').slice(0, 40);
    home.source = String(data.source || '').slice(0, 200);
    home.rules = asLines(meal.rules || data.rules);
    home.planDate = plan.date;
    home.planLabel = plan.label;
    home.next = String(meal.next || meal.note || '').trim();
    home.meals = plan.rows.map(normalizeMeal);
    var projects = Array.isArray(data.projects) ? data.projects : [];
    var decisions = [];
    projects.forEach(function (project) {
      if (!project || typeof project !== 'object') return;
      var title = String(project.title || project.name || '').trim();
      if (!title) return;
      var pending = isPendingChoice(project);
      home.projects.push({
        title: title,
        status: String(project.status || '').trim(),
        files: String(project.files || project.file || project.path || '').trim(),
        next: String(project.next || project.next_step || '').trim(),
        pending: pending
      });
      if (pending) {
        var decision = decisionFor(project);
        decision.raised = home.updated && /^\d{4}-\d{2}-\d{2}/.test(home.updated) ? home.updated.slice(0, 10) : '';
        decisions.push(decision);
      }
    });
    var fun = data.fun_money || data.funMoney || data.fun || {};
    if (typeof fun !== 'object' || !fun) fun = {};
    var shareSource = fun.tsla_shares != null ? fun.tsla_shares : fun.tsla;
    var rules = fun.rules;
    home.fun = {
      routine: String(fun.routine || '').trim(),
      rules: Array.isArray(rules) ? rules.map(function (line) { return String(line).trim(); }).filter(Boolean).join(' ') : String(rules || '').trim(),
      tslaShares: asNumber(shareSource),
      tslaText: shareSource == null ? '' : String(shareSource).trim()
    };
    return { ok: true, warning: '', home: home, decisions: decisions };
  }

  function mergeHome(prev, next) {
    var home = next || emptyHome();
    var oldMeals = prev && prev.meals ? prev.meals : [];
    var checks = {};
    oldMeals.forEach(function (meal) { checks[meal.meal] = !!meal.checked; });
    home.meals.forEach(function (meal) {
      if (Object.prototype.hasOwnProperty.call(checks, meal.meal)) meal.checked = checks[meal.meal] || meal.checked;
    });
    if (prev && Array.isArray(prev.shopping) && prev.shopping.length && (!home.shopping || !home.shopping.length)) {
      home.shopping = prev.shopping;
    }
    return home;
  }

  function mergeDecisions(existing, incoming) {
    var list = existing.slice();
    var keys = {};
    list.forEach(function (item) {
      if (item && item.sourceKey) keys[item.sourceKey] = true;
    });
    incoming.forEach(function (item) {
      if (!item || !item.sourceKey || keys[item.sourceKey]) return;
      list.push(item);
      keys[item.sourceKey] = true;
    });
    return list;
  }

  return {
    importHomeFeed: importHomeFeed,
    isPendingChoice: isPendingChoice,
    emptyHome: emptyHome,
    mergeHome: mergeHome,
    mergeDecisions: mergeDecisions,
    formatPlanDate: formatPlanDate
  };
});
