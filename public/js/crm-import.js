/* TaxPower CRM - article importer.
 * Turns a Word (.docx), Markdown, HTML, text or JSON file (or pasted text from any AI tool)
 * into blog blocks: headings, paragraphs, lists, steps, tables, notes and FAQ.
 * No libraries: .docx files are unzipped with the browser's own DecompressionStream.
 */
(function () {
  "use strict";

  /* ================= shared helpers ================= */

  function clean(s) { return String(s == null ? "" : s).replace(/[ \t ​]+/g, " ").replace(/\s*\n\s*/g, " ").trim(); }
  function plain(s) { return String(s || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim(); }
  function slugify(text) {
    return String(text || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/g, "");
  }
  function cutAtWord(text, max) {
    if (text.length <= max) return text;
    var cut = text.slice(0, max - 1);
    var sp = cut.lastIndexOf(" ");
    return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:\-–]+$/, "") + "…";
  }
  /* wrap text in a marker, keeping outer spaces outside the marker */
  function wrap(text, mark) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    if (!m[2]) return text;
    return m[1] + mark + m[2] + mark + m[3];
  }
  function cellText(s) { return clean(s).replace(/\|/g, "/"); }
  function normalizeHref(h) {
    h = String(h || "").trim();
    if (/^(javascript|data|vbscript):/i.test(h)) return "";
    return h.replace(/^https?:\/\/(www\.)?taxpower\.co\/?/i, "").replace(/^\/+/, "");
  }

  /* ================= Markdown -> items ================= */
  /* An "item" is {k:"h1|h2|h3|p|ul|ol|table|quote|img", ...}. Inline markdown is left as written. */

  var inlineImages = 0;
  function inlineMd(s) {
    s = String(s || "");
    inlineImages += (s.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
    s = s.replace(/<br\s*\/?>/gi, " ").replace(/<\/?(?:b|strong)>/gi, "**").replace(/<\/?(?:i|em)>/gi, "*");
    s = s.replace(/<(https?:\/\/[^>\s]+)>/g, "[$1]($1)");
    s = s.replace(/<\/?[a-z][^>]*>/gi, "");
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
    s = s.replace(/__([^_\n]+?)__/g, "**$1**").replace(/~~([^~\n]+)~~/g, "$1").replace(/`([^`\n]+)`/g, "$1");
    s = s.replace(/\\([*_\[\]()#|`>~-])/g, "$1");
    return clean(s);
  }

  function splitRow(line) {
    var s = line.trim();
    if (s.charAt(0) === "|") s = s.slice(1);
    if (s.charAt(s.length - 1) === "|" && s.charAt(s.length - 2) !== "\\") s = s.slice(0, -1);
    var cells = [], cur = "";
    for (var i = 0; i < s.length; i++) {
      if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
      else if (s[i] === "|") { cells.push(cur); cur = ""; }
      else cur += s[i];
    }
    cells.push(cur);
    return cells.map(function (c) { return cellText(inlineMd(c)); });
  }

  var TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function parseFrontMatter(text) {
    var meta = {};
    var m = /^﻿?---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(text);
    if (!m) return { meta: meta, body: text };
    m[1].split("\n").forEach(function (line) {
      var kv = /^([A-Za-z_ ]+):\s*(.*)$/.exec(line.trim());
      if (kv) meta[kv[1].trim().toLowerCase().replace(/\s+/g, "_")] = kv[2].trim().replace(/^["']|["']$/g, "");
    });
    return { meta: meta, body: text.slice(m[0].length) };
  }

  function mdToItems(text, warn) {
    var lines = text.replace(/\r\n?/g, "\n").split("\n");
    var items = [], para = [], i = 0, inFence = false;
    inlineImages = 0;

    function flushPara() {
      if (!para.length) return;
      var joined = inlineMd(para.join(" "));
      para = [];
      if (joined) items.push({ k: "p", v: joined });
    }

    while (i < lines.length) {
      var line = lines[i], t = line.trim();

      if (/^(```|~~~)/.test(t)) { flushPara(); inFence = !inFence; i++; continue; }
      if (inFence) { if (t) items.push({ k: "p", v: clean(line) }); i++; continue; }

      if (!t) { flushPara(); i++; continue; }

      /* setext headings */
      if (para.length === 1 && /^={3,}\s*$/.test(t)) { items.push({ k: "h1", v: inlineMd(para[0]) }); para = []; i++; continue; }
      if (para.length === 1 && /^-{3,}\s*$/.test(t)) { items.push({ k: "h2", v: inlineMd(para[0]) }); para = []; i++; continue; }

      if (/^([-*_])(\s*\1){2,}\s*$/.test(t)) { flushPara(); i++; continue; }          // horizontal rule

      var h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(t);
      if (h) {
        flushPara();
        var lvl = h[1].length;
        items.push({ k: lvl === 1 ? "h1" : lvl === 2 ? "h2" : "h3", v: plain(inlineMd(h[2])) });
        i++; continue;
      }

      if (/^!\[[^\]]*\]\([^)]*\)\s*$/.test(t)) { flushPara(); items.push({ k: "img" }); i++; continue; }

      /* table */
      if (t.indexOf("|") !== -1 && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].indexOf("-") !== -1) {
        flushPara();
        var head = splitRow(line), rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].indexOf("|") !== -1) { rows.push(splitRow(lines[i])); i++; }
        items.push({ k: "table", head: head, rows: rows });
        continue;
      }

      /* quote */
      if (t.charAt(0) === ">") {
        flushPara();
        var q = [];
        while (i < lines.length && lines[i].trim().charAt(0) === ">") { q.push(lines[i].trim().replace(/^>\s?/, "")); i++; }
        var qt = inlineMd(q.join(" ").replace(/^\[!\w+\]\s*/, ""));
        if (qt) items.push({ k: "quote", v: qt });
        continue;
      }

      /* list */
      var lm = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/.exec(line);
      if (lm) {
        flushPara();
        var ordered = /\d/.test(lm[2]), list = [];
        while (i < lines.length) {
          var mm = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (mm) {
            if (/\d/.test(mm[2]) !== ordered && mm[1].length <= lm[1].length) break;
            list.push(inlineMd(mm[3]));
            i++;
          } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && list.length) {
            list[list.length - 1] = inlineMd(list[list.length - 1] + " " + lines[i].trim());
            i++;
          } else break;
        }
        list = list.filter(Boolean);
        if (list.length) items.push({ k: ordered ? "ol" : "ul", v: list });
        continue;
      }

      para.push(t);
      i++;
    }
    flushPara();
    for (var n = 0; n < inlineImages; n++) items.push({ k: "img" });
    return items;
  }

  /* ================= HTML -> items ================= */

  var INLINE_TAGS = { A: 1, B: 1, STRONG: 1, I: 1, EM: 1, SPAN: 1, U: 1, CODE: 1, SMALL: 1, MARK: 1, SUP: 1, SUB: 1, BR: 1, FONT: 1, ABBR: 1, S: 1, DEL: 1, INS: 1, LABEL: 1, TIME: 1, CITE: 1 };
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NAV: 1, FOOTER: 1, ASIDE: 1, NOSCRIPT: 1, HEAD: 1, FORM: 1, BUTTON: 1, SVG: 1, IFRAME: 1 };

  function inlineHtml(node) {
    var out = "";
    node.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toUpperCase();
      if (SKIP_TAGS[tag]) return;
      if (tag === "BR") { out += " "; return; }
      if (tag === "IMG") return;
      var inner = inlineHtml(n);
      if (tag === "STRONG" || tag === "B") out += wrap(inner, "**");
      else if (tag === "EM" || tag === "I") out += wrap(inner, "*");
      else if (tag === "A") {
        var href = normalizeHref(n.getAttribute("href"));
        out += href && clean(inner) ? "[" + clean(inner) + "](" + href + ")" : inner;
      } else out += inner;
    });
    return out;
  }

  function htmlToItems(doc, warn) {
    var items = [];
    var pending = "";

    function flushPending() {
      var v = clean(pending).replace(/\*\*\s*\*\*/g, " ");
      pending = "";
      if (v) items.push({ k: "p", v: v });
    }

    function listItems(listEl) {
      var out = [];
      Array.prototype.forEach.call(listEl.children, function (li) {
        if (li.tagName.toUpperCase() !== "LI") return;
        var copy = li.cloneNode(true);
        var nested = [];
        Array.prototype.forEach.call(copy.querySelectorAll("ul,ol"), function (n) { nested.push(n); });
        var nestedTexts = [];
        nested.forEach(function (n) { if (n.parentNode) { nestedTexts = nestedTexts.concat(listItems(n)); n.parentNode.removeChild(n); } });
        var text = clean(inlineHtml(copy));
        if (text) out.push(text);
        out = out.concat(nestedTexts);
      });
      return out;
    }

    function tableItem(tbl) {
      var rows = [];
      Array.prototype.forEach.call(tbl.querySelectorAll("tr"), function (tr) {
        if (tr.closest("table") !== tbl) return;
        var cells = [];
        Array.prototype.forEach.call(tr.children, function (c) {
          var tag = c.tagName.toUpperCase();
          if (tag !== "TD" && tag !== "TH") return;
          cells.push(cellText(inlineHtml(c)));
          for (var s = (parseInt(c.getAttribute("colspan"), 10) || 1) - 1; s > 0; s--) cells.push("");
        });
        if (cells.length) rows.push(cells);
      });
      if (rows.length >= 2) items.push({ k: "table", head: rows[0], rows: rows.slice(1) });
      else if (rows.length === 1) items.push({ k: "p", v: rows[0].filter(Boolean).join(" | ") });
    }

    function walk(parent) {
      parent.childNodes.forEach(function (n) {
        if (n.nodeType === 3) { pending += n.nodeValue; return; }
        if (n.nodeType !== 1) return;
        var tag = n.tagName.toUpperCase();
        if (SKIP_TAGS[tag]) return;
        if (INLINE_TAGS[tag]) { pending += inlineHtml({ childNodes: [n] }); return; }
        flushPending();
        if (/^H[1-6]$/.test(tag)) {
          var lvl = Number(tag.charAt(1));
          var ht = plain(clean(inlineHtml(n)));
          if (ht) items.push({ k: lvl === 1 ? "h1" : lvl === 2 ? "h2" : "h3", v: ht });
        } else if (tag === "P" || tag === "PRE" || tag === "FIGCAPTION" || tag === "DT" || tag === "DD") {
          if (n.querySelector && n.querySelector("img") && !clean(n.textContent)) { items.push({ k: "img" }); return; }
          var pv = clean(inlineHtml(n));
          if (pv) items.push({ k: "p", v: pv });
        } else if (tag === "UL" || tag === "OL") {
          var li = listItems(n);
          if (li.length) items.push({ k: tag === "OL" ? "ol" : "ul", v: li });
        } else if (tag === "TABLE") {
          tableItem(n);
        } else if (tag === "BLOCKQUOTE") {
          var bv = clean(inlineHtml(n));
          if (bv) items.push({ k: "quote", v: bv });
        } else if (tag === "IMG" || tag === "PICTURE" || tag === "VIDEO") {
          items.push({ k: "img" });
        } else if (tag === "HR") {
          /* ignore */
        } else {
          walk(n);                       // div, section, article, main, figure, details ...
        }
        flushPending();
      });
    }

    var root = doc.body || doc.documentElement;
    walk(root);
    flushPending();
    return items;
  }

  /* ================= DOCX -> items ================= */

  function readU16(b, o) { return b[o] | (b[o + 1] << 8); }
  function readU32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function inflateRaw(data) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("This browser cannot open .docx files. Please use Chrome, Edge or Safari, or save the file as Markdown or HTML."));
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  /* returns a function name -> Promise<Uint8Array|null> */
  function openZip(buffer) {
    var b = new Uint8Array(buffer);
    var end = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
      if (readU32(b, i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error("This does not look like a Word (.docx) file.");
    var count = readU16(b, end + 10), off = readU32(b, end + 16), entries = {};
    for (var n = 0; n < count; n++) {
      if (readU32(b, off) !== 0x02014b50) break;
      var method = readU16(b, off + 10), csize = readU32(b, off + 20);
      var nlen = readU16(b, off + 28), xlen = readU16(b, off + 30), clen = readU16(b, off + 32), lho = readU32(b, off + 42);
      var name = new TextDecoder().decode(b.subarray(off + 46, off + 46 + nlen));
      entries[name] = { method: method, csize: csize, lho: lho };
      off += 46 + nlen + xlen + clen;
    }
    return function (name) {
      var e = entries[name];
      if (!e) return Promise.resolve(null);
      var p = e.lho, dataStart = p + 30 + readU16(b, p + 26) + readU16(b, p + 28);
      var data = b.subarray(dataStart, dataStart + e.csize);
      if (e.method === 0) return Promise.resolve(data);
      if (e.method === 8) return inflateRaw(data);
      return Promise.reject(new Error("Unsupported compression in the .docx file."));
    };
  }

  function xmlDoc(bytes) {
    if (!bytes) return null;
    var d = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
    return d.getElementsByTagName("parsererror").length ? null : d;
  }

  function kids(el, name) {
    return Array.prototype.filter.call(el.childNodes, function (c) { return c.nodeType === 1 && c.localName === name; });
  }
  function kid(el, name) { return kids(el, name)[0] || null; }
  function attr(el, name) {
    if (!el) return null;
    for (var i = 0; i < el.attributes.length; i++) if (el.attributes[i].localName === name) return el.attributes[i].value;
    return null;
  }
  function descendants(el, name) {
    var out = [];
    (function rec(n) {
      Array.prototype.forEach.call(n.childNodes, function (c) {
        if (c.nodeType !== 1) return;
        if (c.localName === name) out.push(c);
        rec(c);
      });
    })(el);
    return out;
  }

  function docxToItems(buffer, warn) {
    var read;
    try { read = openZip(buffer); } catch (e) { return Promise.reject(e); }
    return Promise.all([read("word/document.xml"), read("word/styles.xml"), read("word/numbering.xml"), read("word/_rels/document.xml.rels")])
      .then(function (files) {
        var doc = xmlDoc(files[0]);
        if (!doc) throw new Error("Could not read the text inside this Word file.");
        var styles = {}, sd = xmlDoc(files[1]);
        if (sd) descendants(sd.documentElement, "style").forEach(function (s) {
          var nm = kid(s, "name");
          styles[attr(s, "styleId")] = { name: (attr(nm, "val") || "").toLowerCase(), based: attr(kid(s, "basedOn"), "val") };
        });
        var numFmt = {}, nd = xmlDoc(files[2]);
        if (nd) {
          var abs = {};
          descendants(nd.documentElement, "abstractNum").forEach(function (a) {
            var levels = {};
            kids(a, "lvl").forEach(function (l) { levels[attr(l, "ilvl")] = attr(kid(l, "numFmt"), "val"); });
            abs[attr(a, "abstractNumId")] = levels;
          });
          descendants(nd.documentElement, "num").forEach(function (nm) {
            numFmt[attr(nm, "numId")] = abs[attr(kid(nm, "abstractNumId"), "val")] || {};
          });
        }
        var rels = {}, rd = xmlDoc(files[3]);
        if (rd) descendants(rd.documentElement, "Relationship").forEach(function (r) { rels[attr(r, "Id")] = attr(r, "Target"); });

        function styleName(id) {
          var s = styles[id], guard = 0;
          while (s && guard++ < 6) {
            if (/heading|title|list|quote|caption/.test(s.name)) return s.name;
            s = styles[s.based];
          }
          return styles[id] ? styles[id].name : "";
        }

        var images = 0;

        function runText(run) {
          var txt = "";
          Array.prototype.forEach.call(run.childNodes, function (c) {
            if (c.nodeType !== 1) return;
            if (c.localName === "t") txt += c.textContent;
            else if (c.localName === "tab") txt += " ";
            else if (c.localName === "br") txt += " ";
            else if (c.localName === "drawing" || c.localName === "pict") images++;
          });
          if (!txt) return "";
          var pr = kid(run, "rPr");
          if (pr) {
            var off = function (e) { var v = attr(e, "val"); return v === "0" || v === "false" || v === "none"; };
            var b = kid(pr, "b"), it = kid(pr, "i");
            if (it && !off(it)) txt = wrap(txt, "*");
            if (b && !off(b)) txt = wrap(txt, "**");
          }
          return txt;
        }

        function inlineOf(p) {
          var out = "";
          (function rec(node) {
            Array.prototype.forEach.call(node.childNodes, function (c) {
              if (c.nodeType !== 1) return;
              if (c.localName === "r") out += runText(c);
              else if (c.localName === "hyperlink") {
                var start = out.length;
                rec(c);
                var rid = c.getAttributeNS ? c.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") : null;
                var href = normalizeHref(rid ? rels[rid] : "");
                var label = out.slice(start);
                if (href && clean(label)) out = out.slice(0, start) + "[" + clean(label).replace(/\*/g, "") + "](" + href + ")";
              } else if (c.localName === "sdt" || c.localName === "smartTag" || c.localName === "ins" || c.localName === "sdtContent" || c.localName === "fldSimple") rec(c);
            });
          })(p);
          return clean(out).replace(/\*\*\s*\*\*/g, " ").replace(/\*\*\*\*/g, "");
        }

        var items = [];
        var curList = null;

        function pushItem(it) { curList = null; items.push(it); }

        function paragraph(p) {
          var ppr = kid(p, "pPr");
          var sname = ppr ? styleName(attr(kid(ppr, "pStyle"), "val")) : "";
          var text = inlineOf(p);
          var hasImg = descendants(p, "drawing").length || descendants(p, "pict").length;
          if (!text) { if (hasImg) pushItem({ k: "img" }); return; }
          var hm = /^heading\s*(\d)/.exec(sname);
          var lvl = hm ? Number(hm[1]) : (sname === "title" ? 1 : 0);
          if (sname === "title") { pushItem({ k: "h1", v: plain(text), title: true }); return; }
          if (!lvl && ppr) {
            var ol = kid(ppr, "outlineLvl");
            if (ol && attr(ol, "val") !== null && Number(attr(ol, "val")) < 6) lvl = Number(attr(ol, "val")) + 1;
          }
          if (lvl) { pushItem({ k: lvl === 1 ? "h1" : lvl === 2 ? "h2" : "h3", v: plain(text) }); return; }
          if (/quote/.test(sname)) { pushItem({ k: "quote", v: text }); return; }

          var num = ppr ? kid(ppr, "numPr") : null, listKind = null;
          if (num) {
            var nid = attr(kid(num, "numId"), "val"), il = attr(kid(num, "ilvl"), "val") || "0";
            if (nid && nid !== "0") {
              var fmt = (numFmt[nid] || {})[il];
              listKind = fmt && fmt !== "bullet" && fmt !== "none" ? "ol" : "ul";
            }
          } else if (/list number/.test(sname)) listKind = "ol";
          else if (/list bullet|list paragraph/.test(sname)) listKind = "ul";
          if (listKind) {
            if (curList && curList.k === listKind) curList.v.push(text);
            else { curList = { k: listKind, v: [text] }; items.push(curList); }
            return;
          }
          pushItem({ k: "p", v: text });
        }

        function table(tbl) {
          var rows = [];
          kids(tbl, "tr").forEach(function (tr) {
            var cells = [];
            kids(tr, "tc").forEach(function (tc) {
              var parts = [];
              kids(tc, "p").forEach(function (p) { var t = inlineOf(p); if (t) parts.push(t); });
              cells.push(cellText(parts.join(" ")));
              var span = Number(attr(kid(kid(tc, "tcPr") || tc, "gridSpan"), "val")) || 1;
              for (var s = span - 1; s > 0; s--) cells.push("");
            });
            if (cells.length) rows.push(cells);
          });
          if (rows.length >= 2) pushItem({ k: "table", head: rows[0], rows: rows.slice(1) });
          else if (rows.length === 1) pushItem({ k: "p", v: rows[0].filter(Boolean).join(" | ") });
        }

        function block(node) {
          Array.prototype.forEach.call(node.childNodes, function (c) {
            if (c.nodeType !== 1) return;
            if (c.localName === "p") paragraph(c);
            else if (c.localName === "tbl") table(c);
            else if (c.localName === "sdt" || c.localName === "sdtContent") block(c);
          });
        }
        block(kid(doc.documentElement, "body") || doc.documentElement);
        for (var k = 0; k < images; k++) items.push({ k: "img" });
        return items;
      });
  }

  /* ================= items -> article ================= */

  var FAQ_HEAD = /^(?:faqs?|frequently asked questions|common questions|questions(?: and answers)?|questions? & answers?|q ?& ?a)\b[:?\s]*$/i;
  var NOTE_LEAD = /^(?:\*\*|\*)?\s*(note|tip|important|pro tip|remember|reminder|disclaimer|नोट|ध्यान दें)\s*[:：\-–]/i;

  function isBoldOnly(v) { return /^\*\*[^*]+\*\*:?$/.test(v) || /^\*[^*]+\*:?$/.test(v); }
  function stripMarks(v) { return v.replace(/\*+/g, "").replace(/^[\s:]+|[\s:]+$/g, ""); }

  function parseFaq(items, from, to) {
    var pairs = [], q = null, a = [];
    function commit() {
      if (q && a.length) pairs.push({ q: stripMarks(q), a: a.join(" ").trim() });
      q = null; a = [];
    }
    for (var i = from; i < to; i++) {
      var it = items[i];
      if (it.k === "h3" || it.k === "h2" || it.k === "h1") { commit(); q = it.v; continue; }
      if (it.k === "p") {
        var qm = /^(?:\*\*)?\s*(?:q(?:uestion)?\s*\d*\s*[.:)\-–]|\d+\s*[.)]\s)\s*(?:\*\*)?\s*(.*)$/i.exec(it.v);
        var am = /^(?:\*\*)?\s*(?:a(?:nswer)?\s*\d*\s*[.:)\-–])\s*(?:\*\*)?\s*(.*)$/i.exec(it.v);
        if (am && q) { a.push(am[1]); continue; }
        var qa = /^\*\*([^*]{3,300}?\?)\*\*:?\s+(\S[\s\S]*)$/.exec(it.v);
        if (qa) { commit(); q = qa[1]; a.push(qa[2]); continue; }
        if (qm && qm[1] && /\?\s*(\*+)?$/.test(qm[1])) { commit(); q = qm[1]; continue; }
        if (isBoldOnly(it.v) && /\?[*:\s]*$/.test(it.v)) { commit(); q = it.v; continue; }
        if (q) { a.push(it.v); continue; }
      } else if ((it.k === "ul" || it.k === "ol") && q) { a.push(it.v.join("; ")); continue; }
    }
    commit();
    return pairs;
  }

  function buildArticle(items, base) {
    var meta = base || {}, warn = [], blocks = [], counts = { h: 0, p: 0, list: 0, steps: 0, table: 0, note: 0, faq: 0, faqQ: 0 };
    var images = items.filter(function (x) { return x.k === "img"; }).length, title = meta.title || "", i = 0;

    /* drop leading empty things, take the first H1 as the title */
    var h1Count = items.filter(function (x) { return x.k === "h1"; }).length;
    var titleIdx = items.findIndex(function (x) { return x.k === "h1" && x.title; });
    if (titleIdx < 0 && h1Count === 1) {
      var fi = items.findIndex(function (x) { return x.k !== "img"; });
      if (fi >= 0 && items[fi].k === "h1") titleIdx = fi;
    }
    if (titleIdx >= 0) {
      if (!title) title = items[titleIdx].v;
      items.splice(titleIdx, 1);
    }
    /* Word documents often use Heading 1 for sections: push every level one step down */
    if (items.some(function (x) { return x.k === "h1"; })) {
      items.forEach(function (x) { if (x.k === "h1") x.k = "h2"; else if (x.k === "h2") x.k = "h3"; });
    }

    /* a lead paragraph before the first heading becomes the summary */
    var summary = meta.summary || "";
    var lead = items.findIndex(function (x) { return x.k !== "img"; });
    if (lead >= 0 && items[lead].k === "p" && items[lead].v.length <= 420 && !summary) {
      summary = plain(items[lead].v);
      items.splice(lead, 1);
    }

    while (i < items.length) {
      var it = items[i];

      if (it.k === "img") { i++; continue; }

      if (it.k === "h1" || it.k === "h2" || it.k === "h3") {
        if (FAQ_HEAD.test(plain(it.v))) {
          var j = i + 1;
          while (j < items.length && !(items[j].k === "h1" || items[j].k === "h2") ) j++;
          if (it.k === "h3") { j = i + 1; while (j < items.length && items[j].k !== "h1" && items[j].k !== "h2" && items[j].k !== "h3") j++; }
          var pairs = parseFaq(items, i + 1, j);
          if (pairs.length) {
            blocks.push({ t: "faq", v: pairs });
            counts.faq++; counts.faqQ += pairs.length;
            i = j; continue;
          }
        }
        blocks.push({ t: it.k === "h3" ? "h3" : "h2", v: it.v });
        counts.h++; i++; continue;
      }

      if (it.k === "p") {
        if (NOTE_LEAD.test(it.v)) { blocks.push({ t: "note", v: it.v.replace(/\*\*/g, "") }); counts.note++; }
        else if (isBoldOnly(it.v) && stripMarks(it.v).length <= 90 && !/[.?]$/.test(stripMarks(it.v))) {
          blocks.push({ t: "h3", v: stripMarks(it.v) }); counts.h++;
        } else { blocks.push({ t: "p", v: it.v }); counts.p++; }
        i++; continue;
      }
      if (it.k === "quote") { blocks.push({ t: "note", v: it.v }); counts.note++; i++; continue; }
      if (it.k === "ul") { blocks.push({ t: "list", v: it.v }); counts.list++; i++; continue; }
      if (it.k === "ol") { blocks.push({ t: "steps", v: it.v }); counts.steps++; i++; continue; }
      if (it.k === "table") {
        var cols = Math.max(it.head.length, it.rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0));
        if (cols > 8) { warn.push("A table has " + cols + " columns. Only the first 8 are kept."); cols = 8; }
        var pad = function (r) { var o = r.slice(0, cols); while (o.length < cols) o.push(""); return o; };
        blocks.push({ t: "table", head: pad(it.head), rows: it.rows.map(pad) });
        counts.table++; i++; continue;
      }
      i++;
    }

    if (images) warn.push(images + (images === 1 ? " image was" : " images were") + " skipped. Add the cover image yourself; pictures inside the article body are not supported.");
    if (!title) warn.push("No title was found. Please type one.");

    var firstPara = blocks.filter(function (b) { return b.t === "p"; })[0];
    var description = meta.description || "";
    var autoDesc = false;
    if (!description) {
      var src = summary || (firstPara ? plain(firstPara.v) : "");
      if (src) { description = cutAtWord(src, 158); autoDesc = true; }
    }
    if (autoDesc) warn.push("The Google description was made from the first paragraph. Please check it.");
    if (!summary && description) summary = description;

    return {
      article: {
        title: title, h1: meta.h1 || "", summary: cutAtWord(summary, 400), description: description,
        category: meta.category || "", slug: meta.slug || "", date: meta.date || "", time: meta.time || "",
        cover_alt: meta.cover_alt || "", blocks: blocks
      },
      counts: counts,
      warnings: warn
    };
  }

  /* ================= JSON ================= */

  var JSON_TYPES = { h2: 1, h3: 1, p: 1, list: 1, steps: 1, note: 1, faq: 1, links: 1, table: 1 };

  function fromJson(text) {
    var raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error("That JSON file is not valid."); }
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.blocks)) throw new Error("This JSON has no “blocks” list. Use a Markdown, Word or HTML file instead.");
    var blocks = raw.blocks.filter(function (b) { return b && JSON_TYPES[b.t]; });
    var counts = { h: 0, p: 0, list: 0, steps: 0, table: 0, note: 0, faq: 0, faqQ: 0 };
    blocks.forEach(function (b) {
      if (b.t === "h2" || b.t === "h3") counts.h++;
      else if (b.t === "p") counts.p++;
      else if (b.t === "list") counts.list++;
      else if (b.t === "steps") counts.steps++;
      else if (b.t === "table") counts.table++;
      else if (b.t === "note") counts.note++;
      else if (b.t === "faq") { counts.faq++; counts.faqQ += (b.v || []).length; }
    });
    return {
      article: {
        title: String(raw.title || ""), h1: String(raw.h1 || ""), summary: String(raw.summary || ""), description: String(raw.description || ""),
        category: String(raw.category || ""), slug: String(raw.slug || ""), date: String(raw.published || raw.date || ""), time: String(raw.time || ""),
        cover_alt: String(raw.cover_alt || ""), blocks: blocks, related: Array.isArray(raw.related) ? raw.related : null
      },
      counts: counts,
      warnings: raw.blocks.length !== blocks.length ? [(raw.blocks.length - blocks.length) + " unknown blocks were skipped."] : []
    };
  }

  /* ================= entry points ================= */

  function metaFromFront(fm) {
    var m = {};
    ["title", "h1", "description", "summary", "category", "slug", "cover_alt"].forEach(function (k) { if (fm[k]) m[k] = fm[k]; });
    if (fm.date || fm.published) m.date = String(fm.date || fm.published).slice(0, 10);
    if (fm.time) m.time = fm.time;
    if (m.slug) m.slug = slugify(m.slug);
    return m;
  }

  function fromMarkdown(text) {
    var fm = parseFrontMatter(text);
    return buildArticle(mdToItems(fm.body), metaFromFront(fm.meta));
  }

  function fromHtml(text) {
    var doc = new DOMParser().parseFromString(text, "text/html");
    var meta = {};
    var t = doc.querySelector("title"), d = doc.querySelector('meta[name="description"]');
    if (d && d.getAttribute("content")) meta.description = clean(d.getAttribute("content"));
    var items = htmlToItems(doc);
    var res = buildArticle(items, meta);
    if (!res.article.title && t) res.article.title = clean(t.textContent);
    if (res.article.title) res.warnings = res.warnings.filter(function (w) { return !/No title/.test(w); });
    return res;
  }

  function fromText(text) {
    var s = String(text || "").trim();
    if (!s) throw new Error("There is nothing to import.");
    if (s.charAt(0) === "{") { try { return fromJson(s); } catch (e) { if (/blocks|valid/.test(e.message) && /"blocks"/.test(s)) throw e; } }
    if (/^<(!doctype|html|body|article|div|h[1-6]|p|section|table|ul|ol)\b/i.test(s)) return fromHtml(s);
    return fromMarkdown(s);
  }

  function fromFile(file) {
    var name = (file.name || "").toLowerCase();
    if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error("That file is too large (limit 8 MB)."));
    if (/\.docx$/.test(name)) {
      return file.arrayBuffer().then(function (buf) { return docxToItems(buf); }).then(function (items) {
        var res = buildArticle(items, {});
        if (!res.article.title) res.article.title = (file.name || "").replace(/\.docx$/i, "").replace(/[-_]+/g, " ").trim();
        if (res.article.title) res.warnings = res.warnings.filter(function (w) { return !/No title/.test(w); });
        return res;
      });
    }
    if (/\.doc$/.test(name)) return Promise.reject(new Error("Old .doc files are not supported. In Word choose Save As, then .docx."));
    if (/\.(pdf|pptx?|xlsx?|png|jpe?g|webp|zip)$/.test(name)) return Promise.reject(new Error("This file type cannot be imported. Use .docx, .md, .html, .txt or .json."));
    return file.text().then(function (text) {
      if (/\.json$/.test(name)) return fromJson(text);
      if (/\.html?$/.test(name)) return fromHtml(text);
      return fromText(text);
    });
  }

  window.CRM_IMPORT = { fromFile: fromFile, fromText: fromText, slugify: slugify, _mdToItems: mdToItems, _build: buildArticle };
})();
