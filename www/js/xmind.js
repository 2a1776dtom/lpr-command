/* Xmind importer. A .xmind file is a zip. New files have content.json.
   Older files with only content.xml are refused with a fixed warning. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CommandXmind = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var DEFAULT_PALETTE = ['#6F93B3', '#8FA3B5', '#6FAE8E', '#C4776F', '#E0B07A', '#A9C4DC', '#D7A98A', '#8E7CC3'];
  var CHILD_KEYS = ['attached', 'summary', 'callout', 'detached'];

  function normalizeColor(c) {
    if (!c || typeof c !== 'string') return '';
    var s = c.trim();
    if (/^(none|inherited|transparent)$/i.test(s)) return '';
    if (/^#[0-9a-fA-F]{8}$/.test(s)) {
      if (s.slice(6, 8).toLowerCase() === '00') return '';
      s = s.slice(0, 7);
    }
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
    return '';
  }

  function styleFill(topic) {
    var props = topic && topic.style && topic.style.properties;
    if (!props || typeof props !== 'object') return '';
    return normalizeColor(props['svg:fill'] || '');
  }

  function themeProps(theme, key) {
    var block = theme && theme[key];
    if (!block || typeof block !== 'object') return {};
    return block.properties || {};
  }

  function paletteFromTheme(theme) {
    var map = themeProps(theme, 'map');
    var raw = String(map['color-list'] || map['multi-line-colors'] || '');
    var out = [];
    raw.split(/\s+/).forEach(function (part) {
      var c = normalizeColor(part);
      if (!c) return;
      var r = parseInt(c.slice(1, 3), 16);
      var g = parseInt(c.slice(3, 5), 16);
      var b = parseInt(c.slice(5, 7), 16);
      var y = (r * 299 + g * 587 + b * 114) / 1000;
      if (y > 242) return;
      if (out.indexOf(c) === -1) out.push(c);
    });
    return out.length ? out : DEFAULT_PALETTE.slice();
  }

  function topicTitle(topic) {
    if (!topic || typeof topic !== 'object') return '';
    if (typeof topic.title === 'string') return topic.title;
    var at = topic.attributedTitle;
    if (Array.isArray(at)) {
      return at.map(function (run) {
        if (typeof run === 'string') return run;
        return run && run.text ? String(run.text) : '';
      }).join('');
    }
    return '';
  }

  function topicStruck(topic) {
    var at = topic && topic.attributedTitle;
    if (!Array.isArray(at) || !at.length) return false;
    var runs = at.filter(function (run) {
      if (typeof run === 'string') return run.trim();
      return run && String(run.text || '').trim();
    });
    if (!runs.length) return false;
    return runs.every(function (run) {
      return run && typeof run === 'object' && String(run['fo:text-decoration'] || '').indexOf('line-through') !== -1;
    });
  }

  function topicNote(topic) {
    var notes = topic && topic.notes;
    if (!notes) return '';
    if (typeof notes === 'string') return notes;
    if (typeof notes !== 'object') return '';
    if (typeof notes.plain === 'string') return notes.plain;
    if (notes.plain && typeof notes.plain.content === 'string') return notes.plain.content;
    if (notes.realHTML && typeof notes.realHTML.content === 'string') {
      return String(notes.realHTML.content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  function markerIds(topic) {
    var list = topic && topic.markers;
    if (!Array.isArray(list)) return [];
    return list.map(function (m) {
      if (typeof m === 'string') return m;
      if (m && typeof m === 'object') return String(m.markerId || m['marker-id'] || '');
      return '';
    }).filter(Boolean);
  }

  function taskInfo(topic) {
    var list = topic && topic.extensions;
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) {
      var ext = list[i];
      if (ext && ext.provider === 'org.xmind.ui.task' && ext.content && typeof ext.content === 'object') {
        return ext.content;
      }
    }
    return null;
  }

  function labelsOf(topic) {
    var raw = topic && topic.labels;
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (item) {
      var text = '';
      if (typeof item === 'string') text = item;
      else if (item && typeof item === 'object') text = item.text || item.label || '';
      text = String(text || '').trim();
      if (text) out.push(text);
    });
    return out.slice(0, 8);
  }

  function safeHref(href) {
    if (typeof href !== 'string') return '';
    var s = href.trim();
    if (/^https?:\/\//i.test(s)) return s;
    return '';
  }

  function isoDate(value) {
    if (value == null || value === '') return '';
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return '';
    if (n < 1e12) n = n * 1000;
    var d = new Date(n);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function cleanId(id, fallback) {
    var s = String(id || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!s) s = fallback;
    if (!/^[a-zA-Z0-9]/.test(s)) s = 'n' + s;
    return s.slice(0, 36);
  }

  function childTopics(topic) {
    var children = topic && topic.children;
    var out = [];
    if (!children) return out;
    if (Array.isArray(children)) {
      children.forEach(function (kid, i) {
        if (kid && typeof kid === 'object') out.push({ topic: kid, kind: 'attached', order: i });
      });
      return out;
    }
    if (typeof children !== 'object') return out;
    var used = {};
    function take(key, kind) {
      var list = children[key];
      if (!Array.isArray(list)) return;
      used[key] = true;
      list.forEach(function (kid) {
        if (kid && typeof kid === 'object') out.push({ topic: kid, kind: kind, order: out.length });
      });
    }
    CHILD_KEYS.forEach(function (key) { take(key, key); });
    Object.keys(children).forEach(function (key) {
      if (used[key]) return;
      var list = children[key];
      if (!Array.isArray(list)) return;
      list.forEach(function (kid) {
        if (kid && typeof kid === 'object') out.push({ topic: kid, kind: key, order: out.length });
      });
    });
    return out;
  }

  function baseName(filename) {
    var s = String(filename || '').split(/[/\\]/).pop() || '';
    return s.replace(/\.xmind$/i, '').trim();
  }

  function genericSheet(title) {
    return /^(mind map|map\s*\d+|sheet\s*\d+|canvas\s*\d+|sheet)$/i.test(String(title || '').trim());
  }

  function buildMap(sheet, rootTopic, sourceName, sheetIndex, sheetCount) {
    var palette = paletteFromTheme(sheet.theme);
    var rootFill = styleFill(rootTopic) || normalizeColor(themeProps(sheet.theme, 'centralTopic')['svg:fill']) || '#6F93B3';
    var fileTitle = baseName(sourceName);
    var rootText = topicTitle(rootTopic).trim();
    var sheetTitle = typeof sheet.title === 'string' ? sheet.title.trim() : '';
    var title = fileTitle || rootText || sheetTitle || 'Untitled map';
    if (sheetCount > 1 && sheetTitle && !genericSheet(sheetTitle)) {
      title = (fileTitle || rootText || 'Map') + ' / ' + sheetTitle;
    }
    var map = {
      id: '',
      title: title,
      sheetTitle: sheetTitle,
      source: fileTitle || title,
      rootId: '',
      palette: palette,
      nodes: {},
      rels: [],
      updatedAt: ''
    };
    var counter = 0;
    var visiting = new Set();

    function addTopic(topic, parentId, order, kind, depth, parentColor, branchIndex) {
      if (!topic || typeof topic !== 'object') return '';
      if (visiting.has(topic)) return '';
      visiting.add(topic);
      counter += 1;
      var id = cleanId(topic.id, 'n' + counter);
      while (map.nodes[id]) {
        counter += 1;
        id = cleanId(String(topic.id || '') + 'x' + counter, 'n' + counter);
      }
      var own = styleFill(topic);
      var color = own;
      if (!color) {
        if (depth === 0) color = rootFill;
        else if (depth === 1) color = palette[(branchIndex || 0) % palette.length];
        else color = parentColor || palette[0];
      }
      var markers = markerIds(topic);
      var task = taskInfo(topic);
      var struck = topicStruck(topic);
      var todo = !!task || struck;
      var done = struck;
      var priority = null;
      markers.forEach(function (mid) {
        var pri = /^priority-(\d+)$/.exec(mid);
        if (pri && priority == null) priority = Number(pri[1]);
        if (/^task-/.test(mid)) todo = true;
        if (mid === 'task-done') {
          todo = true;
          done = true;
        }
      });
      if (task) {
        if (typeof task.priority === 'number') priority = task.priority;
        if (Number(task.progress) >= 100) {
          todo = true;
          done = true;
        }
      }
      var kids = childTopics(topic);
      var node = {
        id: id,
        parentId: parentId || '',
        childIds: [],
        title: topicTitle(topic),
        note: topicNote(topic),
        color: color,
        todo: todo,
        done: done,
        folded: topic.branch === 'folded',
        collapsed: false,
        decisionId: '',
        sortOrder: order || 0,
        kind: kind || 'attached',
        labels: labelsOf(topic),
        href: safeHref(topic.href),
        priority: priority,
        due: task ? isoDate(task.due) : '',
        dx: 0,
        dy: 0
      };
      map.nodes[id] = node;
      kids.forEach(function (kid, index) {
        var cid = addTopic(kid.topic, id, index, kid.kind, depth + 1, color, depth === 0 ? index : branchIndex);
        if (cid) node.childIds.push(cid);
      });
      visiting.delete(topic);
      return id;
    }

    map.rootId = addTopic(rootTopic, '', 0, 'attached', 0, rootFill, 0);
    var big = Object.keys(map.nodes).length > 80;
    function applyFold(id, depth) {
      var node = map.nodes[id];
      if (!node) return;
      if (node.folded) node.collapsed = true;
      else if (big && depth >= 2 && node.childIds.length) node.collapsed = true;
      else node.collapsed = false;
      node.childIds.forEach(function (cid) { applyFold(cid, depth + 1); });
    }
    if (map.rootId) applyFold(map.rootId, 0);

    var rels = Array.isArray(sheet.relationships) ? sheet.relationships : [];
    rels.forEach(function (rel) {
      if (!rel || typeof rel !== 'object') return;
      var a = cleanId(rel.end1Id, '');
      var b = cleanId(rel.end2Id, '');
      if (!a || !b || !map.nodes[a] || !map.nodes[b]) return;
      var relTitle = typeof rel.title === 'string' ? rel.title : '';
      map.rels.push({ from: a, to: b, title: relTitle });
    });
    return map;
  }

  function parseContent(data, sourceName) {
    if (typeof data === 'string') {
      try { data = JSON.parse(data); }
      catch (e) { return { maps: [], warning: 'Could not read this map file.' }; }
    }
    var sheets = null;
    if (Array.isArray(data)) sheets = data;
    else if (data && Array.isArray(data.sheets)) sheets = data.sheets;
    else if (data && typeof data === 'object' && (data.rootTopic || data.root)) sheets = [data];
    else return { maps: [], warning: 'Could not read this map file.' };

    var maps = [];
    sheets.forEach(function (sheet, index) {
      if (!sheet || typeof sheet !== 'object') return;
      var root = sheet.rootTopic || sheet.root || sheet.topic;
      if (!root || typeof root !== 'object') return;
      var map = buildMap(sheet, root, sourceName, index, sheets.length);
      if (map.rootId) maps.push(map);
    });
    if (!maps.length) return { maps: [], warning: 'No sheets found in this map.' };
    return { maps: maps, warning: '' };
  }

  function findEocd(u8) {
    var maxBack = Math.min(u8.length, 22 + 65535);
    var start = u8.length - 22;
    var end = u8.length - maxBack;
    var i;
    for (i = start; i >= end; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
        var commentLen = u8[i + 20] | (u8[i + 21] << 8);
        if (i + 22 + commentLen === u8.length) return i;
      }
    }
    for (i = start; i >= end; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) return i;
    }
    return -1;
  }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('unzip');
    }
    var lastErr = null;
    var modes = ['deflate-raw', 'deflate'];
    for (var i = 0; i < modes.length; i++) {
      try {
        var ds = new DecompressionStream(modes[i]);
        var stream = new Blob([u8]).stream().pipeThrough(ds);
        var buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('unzip');
  }

  async function unzip(u8) {
    if (typeof u8.length !== 'number') throw new Error('bad zip');
    var eocd = findEocd(u8);
    if (eocd < 0) throw new Error('bad zip');
    var view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var count = view.getUint16(eocd + 10, true);
    var cdOffset = view.getUint32(eocd + 16, true);
    if (cdOffset === 0xffffffff) throw new Error('zip64');
    var entries = {};
    var p = cdOffset;
    var n;
    for (n = 0; n < count; n++) {
      if (p + 46 > u8.length) break;
      if (view.getUint32(p, true) !== 0x02014b50) break;
      var method = view.getUint16(p + 10, true);
      var compSize = view.getUint32(p + 20, true);
      var nameLen = view.getUint16(p + 28, true);
      var extraLen = view.getUint16(p + 30, true);
      var commentLen = view.getUint16(p + 32, true);
      var localOffset = view.getUint32(p + 42, true);
      var nameBytes = u8.subarray(p + 46, p + 46 + nameLen);
      var name = new TextDecoder('utf-8').decode(nameBytes);
      p += 46 + nameLen + extraLen + commentLen;
      if (!name || name.endsWith('/')) continue;
      if (localOffset + 30 > u8.length) continue;
      var localNameLen = view.getUint16(localOffset + 26, true);
      var localExtraLen = view.getUint16(localOffset + 28, true);
      var dataStart = localOffset + 30 + localNameLen + localExtraLen;
      var compressed = u8.subarray(dataStart, dataStart + compSize);
      var raw;
      if (method === 0) raw = compressed;
      else if (method === 8) raw = await inflateRaw(compressed);
      else continue;
      entries[name] = raw;
    }
    return entries;
  }

  async function importXmindBuffer(buffer, filename) {
    var u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var entries;
    try {
      entries = await unzip(u8);
    } catch (err) {
      return { maps: [], warning: 'Could not open that file. Export it from Xmind again.' };
    }
    var names = Object.keys(entries);
    function pick(file) {
      return names.find(function (name) {
        return !name.includes('__MACOSX') && new RegExp('(^|/)' + file + '$', 'i').test(name);
      });
    }
    var jsonName = pick('content.json');
    var xmlName = pick('content.xml');
    if (!jsonName && xmlName) return { maps: [], warning: 'Re-save in Xmind first.' };
    if (!jsonName) return { maps: [], warning: 'No content.json in that file. Re-save in Xmind first.' };
    var text = new TextDecoder('utf-8').decode(entries[jsonName]).replace(/^\uFEFF/, '');
    var data;
    try { data = JSON.parse(text); }
    catch (err) { return { maps: [], warning: 'Could not read this map file.' }; }
    return parseContent(data, filename || 'Imported map');
  }

  function hashId(prefix, text) {
    var h = 2166136261;
    var s = String(text || '');
    var i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (String(prefix || 'm') + (h >>> 0).toString(36)).slice(0, 36);
  }

  function finalizeMap(map, id) {
    map.id = id || map.id || hashId('m', map.title || 'map');
    var prefix = String(map.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 4) || 'mapx';
    var remap = {};
    var used = {};
    Object.keys(map.nodes).forEach(function (old) {
      var raw = prefix + String(old).replace(/[^a-zA-Z0-9]/g, '');
      var base = raw.slice(0, 36);
      if (!/^[A-Za-z0-9]/.test(base)) base = ('n' + base).slice(0, 36);
      var next = base;
      var n = 0;
      while (used[next]) {
        n += 1;
        next = (base.slice(0, 30) + 'x' + n.toString(36)).slice(0, 36);
      }
      used[next] = true;
      remap[old] = next;
    });
    var nodes = {};
    Object.keys(map.nodes).forEach(function (old) {
      var node = map.nodes[old];
      node.id = remap[old];
      node.parentId = node.parentId ? (remap[node.parentId] || '') : '';
      node.childIds = (node.childIds || []).map(function (cid) { return remap[cid]; }).filter(Boolean);
      nodes[node.id] = node;
    });
    map.nodes = nodes;
    map.rootId = remap[map.rootId] || map.rootId;
    map.rels = (map.rels || []).map(function (rel) {
      return { from: remap[rel.from] || rel.from, to: remap[rel.to] || rel.to, title: rel.title || '' };
    }).filter(function (rel) { return map.nodes[rel.from] && map.nodes[rel.to]; });
    return map;
  }

  return {
    parseContent: parseContent,
    importXmindBuffer: importXmindBuffer,
    normalizeColor: normalizeColor,
    finalizeMap: finalizeMap,
    hashId: hashId,
    DEFAULT_PALETTE: DEFAULT_PALETTE
  };
});
