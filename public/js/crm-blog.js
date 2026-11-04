/* TaxPower CRM - blog editor */
(function () {
  "use strict";

  var app = window.CRM_APP;
  if (!app) return;
  var client = app.client, $ = app.$, esc = app.esc, toast = app.toast;

  var RELATED_OPTIONS = [
    ["free-trial", "Free 30-day trial"],
    ["pricing", "Plans & pricing"],
    ["downloads", "Downloads"],
    ["system-requirements", "System requirements"],
    ["technical-support", "Technical support"],
    ["taxpowergst", "TaxPower GST"],
    ["taxpowertds", "TaxPower TDS"],
    ["gst-return-filing-software", "GST return filing"],
    ["gst-billing-software", "GST billing software"],
    ["tds-return-filing-software", "TDS return filing"],
    ["gst-tds-due-dates", "Due dates calendar"],
    ["blog/gstr-1-vs-gstr-3b-difference", "GSTR-1 vs GSTR-3B"],
    ["blog/gstr-2b-itc-reconciliation-checklist", "GSTR-2B checklist"],
    ["blog/tds-return-forms-24q-26q-27q-27eq-explained", "TDS forms explained"],
    ["blog/form-16-and-form-16a-explained", "Form 16 & 16A"],
    ["blog/how-to-choose-gst-software", "Choosing GST software"]
  ];

  var BLOCK_LABEL = {
    h2: "Heading", h3: "Subheading", table: "Table", p: "Paragraph", steps: "Numbered steps", list: "Bullet list",
    faq: "Frequently asked questions", note: "Note", links: "Links"
  };

  var posts = [];
  var cur = null;       // the article being edited
  var dirty = false;
  var busy = false;

  /* ---------------- helpers ---------------- */

  function todayIST() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }

  function slugify(text) {
    return String(text || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/g, "");
  }

  function emptyPost() {
    return {
      id: null, slug: "", status: "draft", title: "", h1: "", description: "", summary: "",
      category: "Guide", blocks: [{ t: "h2", v: "" }, { t: "p", v: "" }], related: ["free-trial"],
      cover_data: "", cover_alt: "", publish_date: todayIST(), publish_time: "09:00", slugTouched: false
    };
  }

  function status(message, bad) {
    var el = $("blogStatus");
    el.style.color = bad ? "#b91c1c" : "#047857";
    el.textContent = message || "";
  }

  function wordCount(blocks) {
    return blocks.reduce(function (n, b) {
      var text = b.t === "table" ? JSON.stringify([b.head, b.rows]) : typeof b.v === "string" ? b.v : JSON.stringify(b.v || "");
      return n + (text.match(/[A-Za-z0-9ऀ-ॿ]+/g) || []).length;
    }, 0);
  }

  /* ---------------- list ---------------- */

  function loadList() {
    client.from("blog_posts")
      .select("id,slug,status,title,category,publish_date,author_name,updated_at")
      .order("updated_at", { ascending: false })
      .then(function (res) {
        if (res.error) {
          posts = [];
          $("blogEmpty").textContent = /relation|does not exist|schema cache/i.test(res.error.message || "")
            ? "The blog database tables are not set up yet. Ask the administrator to apply the latest database update."
            : res.error.message;
          $("blogEmpty").classList.remove("crm-hidden");
          $("blogRows").innerHTML = "";
          return;
        }
        posts = res.data || [];
        renderList();
      });
  }

  function renderList() {
    var q = ($("blogSearch").value || "").toLowerCase();
    var f = $("blogFilter").value;
    var rows = posts.filter(function (p) {
      if (f !== "all" && p.status !== f) return false;
      return !q || (p.title + " " + p.slug).toLowerCase().indexOf(q) !== -1;
    });
    $("blogCount").textContent = rows.length + (rows.length === 1 ? " article" : " articles");
    $("blogEmpty").textContent = "No articles yet. Click “New article” to write the first one.";
    $("blogEmpty").classList.toggle("crm-hidden", rows.length > 0);
    $("blogRows").innerHTML = rows.map(function (p) {
      return '<tr data-post="' + esc(p.id) + '"><td><strong>' + esc(p.title || "(untitled)") + "</strong><small>/blog/" +
        esc(p.slug) + "</small></td><td>" + statusPill(p.status) + "</td><td>" + esc(p.category) + "</td><td>" +
        esc(p.publish_date || "-") + "</td><td>" + esc(p.author_name || "-") + "</td><td>" + esc(app.fmtStamp(p.updated_at)) + "</td></tr>";
    }).join("");
  }

  function statusPill(st) {
    return '<span class="crm-pill ' + (st === "published" ? "crm-pill-converted" : "crm-pill-contacted") + '">' +
      (st === "published" ? "Live" : "Draft") + "</span>";
  }

  $("blogRows").addEventListener("click", function (e) {
    var row = e.target.closest ? e.target.closest("[data-post]") : null;
    if (row) openPost(row.getAttribute("data-post"));
  });
  $("blogSearch").addEventListener("input", renderList);
  $("blogFilter").addEventListener("change", renderList);
  $("blogNewBtn").addEventListener("click", function () { openEditor(emptyPost()); });

  function openPost(id) {
    client.from("blog_posts").select("*").eq("id", id).maybeSingle().then(function (res) {
      if (res.error || !res.data) { toast("Could not open the article.", "error"); return; }
      var p = res.data;
      p.blocks = Array.isArray(p.blocks) ? p.blocks : [];
      p.related = Array.isArray(p.related) ? p.related : [];
      p.slugTouched = true;
      openEditor(p);
    });
  }

  /* ---------------- editor ---------------- */

  function openEditor(post) {
    cur = post;
    dirty = false;
    $("blogList").classList.add("crm-hidden");
    $("blogEditor").classList.remove("crm-hidden");
    status("");
    $("bTitle").value = cur.title || "";
    $("bH1").value = cur.h1 || "";
    $("bSummary").value = cur.summary || "";
    $("bSlug").value = cur.slug || "";
    $("bSlug").readOnly = cur.status === "published";
    $("bDesc").value = cur.description || "";
    $("bCategory").value = cur.category || "Guide";
    $("bDate").value = cur.publish_date || todayIST();
    $("bTime").value = cur.publish_time || "09:00";
    $("bCoverAlt").value = cur.cover_alt || "";
    renderCover();
    renderRelated();
    renderBlocks();
    refreshHeader();
    refreshCounters();
    window.scrollTo(0, 0);
  }

  function closeEditor() {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    cur = null;
    $("blogEditor").classList.add("crm-hidden");
    $("blogList").classList.remove("crm-hidden");
    loadList();
  }

  $("blogBackBtn").addEventListener("click", closeEditor);

  function refreshHeader() {
    var live = cur.status === "published";
    var pill = $("blogStatusPill");
    pill.textContent = live ? "Live on website" : "Draft";
    pill.className = "crm-pill " + (live ? "crm-pill-converted" : "crm-pill-contacted");
    $("blogPublishBtn").textContent = live ? "Update live article" : "Publish";
    $("blogSaveBtn").textContent = live ? "Save changes" : "Save draft";
    $("blogDangerPanel").classList.toggle("crm-hidden", !cur.id);
    $("blogUnpublishBtn").classList.toggle("crm-hidden", !live);
    $("blogDeleteBtn").classList.toggle("crm-hidden", live || !cur.id);
  }

  function refreshCounters() {
    var t = $("bTitle").value.length, d = $("bDesc").value.length;
    $("titleCount").textContent = t + " characters (aim for 30–60)";
    $("descCount").textContent = d + " characters (aim for 120–160)";
    renderChecks();
  }

  /* basic fields */
  ["bTitle", "bH1", "bSummary", "bDesc", "bCategory", "bDate", "bTime", "bCoverAlt"].forEach(function (id) {
    $(id).addEventListener("input", function () { dirty = true; refreshCounters(); });
  });
  $("bTitle").addEventListener("input", function () {
    if (cur && !cur.slugTouched && cur.status !== "published") $("bSlug").value = slugify($("bTitle").value);
  });
  $("bSlug").addEventListener("input", function () {
    if (!cur) return;
    cur.slugTouched = true;
    dirty = true;
    this.value = this.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-");
    renderChecks();
  });

  /* ---------------- blocks ---------------- */

  function blockHtml(b, i) {
    var body = "";
    if (b.t === "h2" || b.t === "h3") {
      body = '<input type="text" class="b-v" maxlength="160" placeholder="' + (b.t === "h3" ? "Subheading" : "Section heading") + '" value="' + esc(b.v || "") + '" />';
    } else if (b.t === "p" || b.t === "note") {
      body = '<textarea class="b-v" rows="5" placeholder="' + (b.t === "note" ? "A short note or reminder" : "Write the paragraph here") + '">' + esc(b.v || "") + "</textarea>" +
        '<small class="crm-hint">Tip: **bold**, *italic* and [link text](page-name) work here.</small>';
    } else if (b.t === "table") {
      body = '<textarea class="b-v b-table" rows="6" wrap="off" placeholder="Plan | Price | Best for&#10;Basic | Rs 1,000 | Small shops">' + esc(tableToText(b)) + "</textarea>" +
        '<small class="crm-hint">One row per line, columns separated by <b>|</b>. The first line is the heading row.</small>';
    } else if (b.t === "steps" || b.t === "list") {
      body = '<textarea class="b-v" rows="5" placeholder="One item per line">' + esc((b.v || []).join("\n")) + "</textarea>" +
        '<small class="crm-hint">One ' + (b.t === "steps" ? "step" : "point") + " per line.</small>";
    } else if (b.t === "faq") {
      body = '<div class="b-faqs">' + (b.v && b.v.length ? b.v : [{ q: "", a: "" }]).map(faqItemHtml).join("") +
        '</div><button type="button" class="crm-chip-btn" data-faq-add>+ Add question</button>';
    } else if (b.t === "links") {
      body = '<textarea class="b-v" rows="4" placeholder="Button text | page, for example: Go to Downloads | downloads">' +
        esc((b.v || []).map(function (x) { return x[0] + " | " + x[1]; }).join("\n")) + "</textarea>" +
        '<small class="crm-hint">One link per line: text | page name (like <b>pricing</b>) or a full https:// address.</small>';
    }
    return '<div class="crm-block" data-type="' + b.t + '" data-i="' + i + '"><div class="crm-block-head"><strong>' +
      BLOCK_LABEL[b.t] + '</strong><span class="crm-block-tools">' +
      '<button type="button" class="crm-icon-btn" data-move="-1" aria-label="Move up" title="Move up">&uarr;</button>' +
      '<button type="button" class="crm-icon-btn" data-move="1" aria-label="Move down" title="Move down">&darr;</button>' +
      '<button type="button" class="crm-icon-btn" data-del aria-label="Delete block" title="Delete">&times;</button></span></div>' +
      '<div class="crm-block-body">' + body + "</div></div>";
  }

  function tableToText(b) {
    var rows = [(b.head || [])].concat(b.rows || []);
    return rows.map(function (r) { return r.join(" | "); }).join("\n");
  }

  function textToTable(text) {
    var rows = String(text || "").split("\n").map(function (l) { return l.trim(); }).filter(function (l) {
      return l && !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(l);
    }).map(function (l) {
      return l.replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); });
    });
    var cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    rows = rows.map(function (r) { while (r.length < cols) r.push(""); return r; });
    return { head: rows[0] || [], rows: rows.slice(1) };
  }

  function faqItemHtml(f) {
    return '<div class="b-faq"><input type="text" class="b-q" maxlength="300" placeholder="Question" value="' + esc(f.q || "") +
      '" /><textarea class="b-a" rows="3" placeholder="Answer">' + esc(f.a || "") + '</textarea>' +
      '<button type="button" class="crm-link-btn crm-link-danger" data-faq-del>Remove question</button></div>';
  }

  function renderBlocks() {
    $("blockList").innerHTML = cur.blocks.map(blockHtml).join("") ||
      '<p class="crm-empty">Nothing here yet. Use the buttons below to add a heading or paragraph.</p>';
  }

  function readBlocks() {
    var out = [];
    Array.prototype.forEach.call($("blockList").querySelectorAll(".crm-block"), function (el) {
      var t = el.getAttribute("data-type");
      var v;
      if (t === "table") {
        var tb = textToTable(el.querySelector(".b-v").value);
        out.push({ t: "table", head: tb.head, rows: tb.rows });
        return;
      }
      if (t === "h2" || t === "h3") v = el.querySelector(".b-v").value.trim();
      else if (t === "p" || t === "note") v = el.querySelector(".b-v").value.trim();
      else if (t === "steps" || t === "list") {
        v = el.querySelector(".b-v").value.split("\n").map(function (x) { return x.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim(); })
          .filter(Boolean);
      } else if (t === "faq") {
        v = Array.prototype.map.call(el.querySelectorAll(".b-faq"), function (f) {
          return { q: f.querySelector(".b-q").value.trim(), a: f.querySelector(".b-a").value.trim() };
        }).filter(function (f) { return f.q || f.a; });
      } else if (t === "links") {
        v = el.querySelector(".b-v").value.split("\n").map(function (line) {
          var parts = line.split("|");
          var label = (parts[0] || "").trim();
          var href = (parts.slice(1).join("|") || "").trim().replace(/^https?:\/\/(www\.)?taxpower\.co\/?/i, "").replace(/^\/+/, "");
          return [label, href];
        }).filter(function (x) { return x[0] && x[1]; });
      }
      out.push({ t: t, v: v });
    });
    return out;
  }

  $("blockAdd").addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-add]") : null;
    if (!btn) return;
    cur.blocks = readBlocks();
    var t = btn.getAttribute("data-add");
    cur.blocks.push(t === "table" ? { t: "table", head: ["", ""], rows: [["", ""]] } : { t: t, v: t === "h2" || t === "h3" || t === "p" || t === "note" ? "" : [] });
    dirty = true;
    renderBlocks();
    var last = $("blockList").lastElementChild;
    if (last) { var f = last.querySelector("input,textarea"); if (f) f.focus(); }
  });

  $("blockList").addEventListener("input", function () { dirty = true; renderChecksSoon(); });
  $("blockList").addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-move],[data-del],[data-faq-add],[data-faq-del]") : null;
    if (!el) return;
    var blockEl = el.closest(".crm-block");
    var i = Number(blockEl.getAttribute("data-i"));
    if (el.hasAttribute("data-faq-add")) {
      blockEl.querySelector(".b-faqs").insertAdjacentHTML("beforeend", faqItemHtml({}));
      return;
    }
    if (el.hasAttribute("data-faq-del")) {
      var item = el.closest(".b-faq");
      item.parentNode.removeChild(item);
      dirty = true;
      return;
    }
    cur.blocks = readBlocks();
    if (el.hasAttribute("data-del")) {
      cur.blocks.splice(i, 1);
    } else {
      var to = i + Number(el.getAttribute("data-move"));
      if (to < 0 || to >= cur.blocks.length) return;
      var tmp = cur.blocks[i]; cur.blocks[i] = cur.blocks[to]; cur.blocks[to] = tmp;
    }
    dirty = true;
    renderBlocks();
    renderChecks();
  });

  var checksTimer = null;
  function renderChecksSoon() {
    clearTimeout(checksTimer);
    checksTimer = setTimeout(renderChecks, 400);
  }

  /* ---------------- cover image ---------------- */

  function renderCover() {
    var has = !!cur.cover_data;
    $("coverBox").innerHTML = has ? '<img alt="" src="' + esc(cur.cover_data) + '" />' : "<span>No cover yet</span>";
    $("bCoverRemove").classList.toggle("crm-hidden", !has);
    $("bCoverBtn").textContent = has ? "Change image" : "Choose image";
  }

  $("bCoverBtn").addEventListener("click", function () { $("bCoverFile").click(); });
  $("bCoverRemove").addEventListener("click", function () {
    cur.cover_data = ""; dirty = true; renderCover(); renderChecks();
  });
  $("bCoverFile").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = "";
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { toast("That image is too large. Please choose one under 12 MB.", "error"); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var W = 1200, H = 630;
      var canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext("2d");
      var scale = Math.max(W / img.width, H / img.height);
      var w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      URL.revokeObjectURL(url);
      var data = canvas.toDataURL("image/webp", 0.85);
      if (data.indexOf("data:image/webp") !== 0) data = canvas.toDataURL("image/jpeg", 0.88);
      cur.cover_data = data;
      dirty = true;
      renderCover();
      renderChecks();
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast("That file could not be read as an image.", "error"); };
    img.src = url;
  });

  /* ---------------- related pages ---------------- */

  function renderRelated() {
    $("bRelated").innerHTML = RELATED_OPTIONS.map(function (o) {
      return '<label class="crm-check"><input type="checkbox" value="' + esc(o[0]) + '"' +
        (cur.related.indexOf(o[0]) !== -1 ? " checked" : "") + " /> " + esc(o[1]) + "</label>";
    }).join("");
  }
  $("bRelated").addEventListener("change", function () { dirty = true; });

  function readRelated() {
    return Array.prototype.map.call($("bRelated").querySelectorAll("input:checked"), function (i) { return i.value; });
  }

  /* ---------------- checklist ---------------- */

  function renderChecks() {
    if (!cur) return;
    var blocks = readBlocks();
    var title = $("bTitle").value.trim(), desc = $("bDesc").value.trim(), slug = $("bSlug").value.trim();
    var words = wordCount(blocks);
    var headings = blocks.filter(function (b) { return b.t === "h2" && b.v; }).length;
    var faqs = blocks.filter(function (b) { return b.t === "faq"; }).reduce(function (n, b) { return n + b.v.length; }, 0);
    var hasLink = blocks.some(function (b) { return b.t === "links" && b.v.length; }) || readRelated().length > 0;
    var items = [
      [title.length >= 30 && title.length <= 65, "Title is 30–60 characters (" + title.length + ")"],
      [desc.length >= 110 && desc.length <= 165, "Google description is 120–160 characters (" + desc.length + ")"],
      [!!slug && slug.length <= 70, "Web address is short and readable"],
      [!!cur.cover_data && !!$("bCoverAlt").value.trim(), "Cover image with a description"],
      [words >= 300, "At least 300 words (" + words + ")"],
      [headings >= 2, "Two or more section headings (" + headings + ")"],
      [faqs >= 3, "Three or more FAQ questions (" + faqs + ")"],
      [hasLink, "Links to other TaxPower pages"]
    ];
    $("seoChecks").innerHTML = items.map(function (it) {
      return '<li class="' + (it[0] ? "is-ok" : "") + '"><span>' + (it[0] ? "&#10003;" : "&#9675;") + "</span>" + esc(it[1]) + "</li>";
    }).join("");
  }

  /* ---------------- save / publish ---------------- */

  function collect() {
    cur.title = $("bTitle").value.trim();
    cur.h1 = $("bH1").value.trim();
    cur.summary = $("bSummary").value.trim();
    cur.slug = $("bSlug").value.trim().replace(/^-+|-+$/g, "");
    cur.description = $("bDesc").value.trim();
    cur.category = $("bCategory").value;
    cur.publish_date = $("bDate").value || todayIST();
    cur.publish_time = $("bTime").value || "09:00";
    cur.cover_alt = $("bCoverAlt").value.trim();
    cur.blocks = readBlocks();
    cur.related = readRelated();
  }

  function setBusy(on, label) {
    busy = on;
    ["blogSaveBtn", "blogPublishBtn", "blogUnpublishBtn", "blogDeleteBtn", "blogPreviewBtn"].forEach(function (id) { $(id).disabled = on; });
    if (label) status(label);
  }

  function saveDraft() {
    collect();
    if (!cur.title) return Promise.reject(new Error("Please add a title first."));
    if (!cur.slug) cur.slug = slugify(cur.title);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cur.slug)) return Promise.reject(new Error("The web address can only use small letters, numbers and hyphens."));
    $("bSlug").value = cur.slug;
    var row = {
      slug: cur.slug, title: cur.title, h1: cur.h1, description: cur.description, summary: cur.summary,
      category: cur.category, blocks: cur.blocks, related: cur.related, cover_data: cur.cover_data,
      cover_alt: cur.cover_alt, publish_date: cur.publish_date, publish_time: cur.publish_time,
      updated_by_name: $("profileName").textContent || ""
    };
    var q;
    if (cur.id) {
      q = client.from("blog_posts").update(row).eq("id", cur.id).select("id,status").single();
    } else {
      row.author_id = app.state.user ? app.state.user.id : null;
      row.author_name = $("profileName").textContent || "";
      row.status = "draft";
      q = client.from("blog_posts").insert(row).select("id,status").single();
    }
    return q.then(function (res) {
      if (res.error) {
        if (res.error.code === "23505") throw new Error("Another article already uses that web address. Please change it.");
        throw new Error(res.error.message);
      }
      cur.id = res.data.id;
      cur.status = res.data.status;
      dirty = false;
      refreshHeader();
    });
  }

  $("blogSaveBtn").addEventListener("click", function () {
    if (busy) return;
    setBusy(true, "Saving...");
    saveDraft().then(function () { status("Saved."); toast("Article saved."); })
      .catch(function (e) { status(e.message, true); })
      .then(function () { setBusy(false); });
  });

  function callPublish(action) {
    return app.token().then(function (token) {
      return fetch("/api/public/blog", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({ id: cur.id, action: action })
      });
    }).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok) throw new Error(data.error || "Request failed (" + resp.status + ").");
        return data;
      });
    });
  }

  $("blogPublishBtn").addEventListener("click", function () {
    if (busy) return;
    collect();
    var problems = [];
    if (!cur.title) problems.push("a title");
    if (!cur.description) problems.push("a Google description");
    if (wordCount(cur.blocks) < 60) problems.push("more content");
    if (problems.length) { status("Please add " + problems.join(", ") + " before publishing.", true); return; }
    var future = cur.publish_date > todayIST();
    var question = (cur.status === "published" ? "Update the live article on taxpower.co?" : "Publish this article on taxpower.co?") +
      "\n\nIt will be live in about 2 minutes." + (future ? "\n\nNote: the publish date is in the future, so the page will show that date." : "");
    if (!window.confirm(question)) return;
    setBusy(true, "Saving...");
    saveDraft().then(function () {
      status("Sending to the website...");
      return callPublish("publish");
    }).then(function (data) {
      cur.status = "published";
      $("bSlug").readOnly = true;
      refreshHeader();
      status(data.message || "Published.");
      toast("Sent to the website. Live in about 2 minutes.", "success");
    }).catch(function (e) { status(e.message, true); })
      .then(function () { setBusy(false); });
  });

  $("blogUnpublishBtn").addEventListener("click", function () {
    if (busy || !cur || !cur.id) return;
    if (!window.confirm("Take this article off the website? It stays here as a draft.")) return;
    setBusy(true, "Removing from the website...");
    callPublish("unpublish").then(function (data) {
      cur.status = "draft";
      $("bSlug").readOnly = false;
      refreshHeader();
      status(data.message || "Removed.");
    }).catch(function (e) { status(e.message, true); })
      .then(function () { setBusy(false); });
  });

  $("blogDeleteBtn").addEventListener("click", function () {
    if (busy || !cur || !cur.id) return;
    if (!window.confirm("Delete this draft permanently?")) return;
    client.from("blog_posts").delete().eq("id", cur.id).then(function (res) {
      if (res.error) { status(res.error.message, true); return; }
      dirty = false;
      cur = null;
      $("blogEditor").classList.add("crm-hidden");
      $("blogList").classList.remove("crm-hidden");
      toast("Draft deleted.");
      loadList();
    });
  });

  /* ---------------- preview ---------------- */

  function rich(text) {
    return esc(text).replace(/\[([^\]\n]{1,160})\]\(([^)\s]{1,300})\)/g, "<u>$1</u>")
      .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, "$1<em>$2</em>");
  }

  function previewHtml() {
    collect();
    var out = '<article class="crm-prev">';
    if (cur.cover_data) out += '<img class="crm-prev-cover" alt="' + esc(cur.cover_alt) + '" src="' + esc(cur.cover_data) + '" />';
    out += '<span class="crm-prev-kicker">' + esc(cur.category) + " &middot; GUIDE</span><h1>" + esc(cur.h1 || cur.title || "Untitled") + "</h1>";
    out += '<p class="crm-prev-meta">By Siddharth Enterprises &middot; ' + esc(cur.publish_date) + " &middot; " +
      Math.max(1, Math.round(wordCount(cur.blocks) / 200)) + " min read</p>";
    if (cur.summary || cur.description) out += '<p class="crm-prev-lead">' + esc(cur.summary || cur.description) + "</p>";
    cur.blocks.forEach(function (b) {
      if (b.t === "h2" && b.v) out += "<h2>" + esc(b.v) + "</h2>";
      else if (b.t === "h3" && b.v) out += "<h3>" + esc(b.v) + "</h3>";
      else if (b.t === "p" && b.v) out += "<p>" + rich(b.v) + "</p>";
      else if (b.t === "note" && b.v) out += '<p class="crm-prev-note">' + rich(b.v) + "</p>";
      else if (b.t === "table" && b.head && b.head.length) {
        out += "<table><thead><tr>" + b.head.map(function (h) { return "<th>" + rich(h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          b.rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + rich(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table>";
      }
      else if (b.t === "steps" && b.v.length) out += "<ol>" + b.v.map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + "</ol>";
      else if (b.t === "list" && b.v.length) out += "<ul>" + b.v.map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + "</ul>";
      else if (b.t === "faq" && b.v.length) {
        out += "<h2>Frequently asked questions</h2>" + b.v.map(function (f) {
          return "<h3>" + esc(f.q) + "</h3><p>" + rich(f.a) + "</p>";
        }).join("");
      } else if (b.t === "links" && b.v.length) {
        out += '<p class="crm-prev-links">' + b.v.map(function (l) { return "<span>" + esc(l[0]) + " &rarr;</span>"; }).join("") + "</p>";
      }
    });
    return out + "</article>";
  }

  function closePreview() {
    $("previewModal").classList.add("crm-hidden");
    $("previewOverlay").classList.add("crm-hidden");
  }
  $("blogPreviewBtn").addEventListener("click", function () {
    $("previewBody").innerHTML = previewHtml();
    $("previewModal").classList.remove("crm-hidden");
    $("previewOverlay").classList.remove("crm-hidden");
  });
  $("previewClose").addEventListener("click", closePreview);
  $("previewOverlay").addEventListener("click", closePreview);

  window.addEventListener("beforeunload", function (e) {
    if (dirty && cur) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------------- import ---------------- */

  var importTarget = "new";      // "new" = start a new article, "editor" = fill the open one

  function openImport(target) {
    importTarget = target;
    $("importText").value = "";
    $("importStatus").textContent = "";
    $("importModal").classList.remove("crm-hidden");
    $("importOverlay").classList.remove("crm-hidden");
  }
  function closeImport() {
    $("importModal").classList.add("crm-hidden");
    $("importOverlay").classList.add("crm-hidden");
  }
  function importMsg(text, bad) {
    var el = $("importStatus");
    el.style.color = bad ? "#b91c1c" : "#047857";
    el.textContent = text || "";
  }

  function summaryOf(r) {
    var c = r.counts, parts = [];
    if (c.h) parts.push(c.h + (c.h === 1 ? " heading" : " headings"));
    if (c.p) parts.push(c.p + (c.p === 1 ? " paragraph" : " paragraphs"));
    if (c.list) parts.push(c.list + (c.list === 1 ? " bullet list" : " bullet lists"));
    if (c.steps) parts.push(c.steps + (c.steps === 1 ? " numbered list" : " numbered lists"));
    if (c.table) parts.push(c.table + (c.table === 1 ? " table" : " tables"));
    if (c.note) parts.push(c.note + (c.note === 1 ? " note" : " notes"));
    if (c.faq) parts.push("FAQ with " + c.faqQ + (c.faqQ === 1 ? " question" : " questions"));
    return parts.join(", ");
  }

  function applyImport(r) {
    var a = r.article;
    if (!a.blocks.length) { importMsg("No readable content was found in this file.", true); return; }
    var post;
    if (importTarget === "editor" && cur) {
      collect();
      var hasBody = cur.blocks.some(function (b) { return (typeof b.v === "string" && b.v.trim()) || (Array.isArray(b.v) && b.v.length) || b.t === "table"; });
      var replace = true;
      if (hasBody) replace = window.confirm("Replace the current article body with the imported content?\n\nOK = replace, Cancel = add the imported content at the end.");
      post = cur;
      post.blocks = replace ? a.blocks : post.blocks.concat(a.blocks);
    } else {
      post = emptyPost();
      post.blocks = a.blocks;
    }
    /* only fill fields that are still empty, so nothing already typed is lost */
    if (!post.title && a.title) post.title = a.title;
    if (!post.h1 && a.h1) post.h1 = a.h1;
    if (!post.summary && a.summary) post.summary = a.summary;
    if (!post.description && a.description) post.description = a.description;
    if (a.category && ["Guide", "GST", "TDS", "Product update", "News"].indexOf(a.category) !== -1 && (importTarget === "new" || !post.id)) post.category = a.category;
    if (!post.slug && post.status !== "published") post.slug = a.slug || slugify(post.title);
    if (a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) && !post.id) post.publish_date = a.date;
    if (a.time && /^\d{2}:\d{2}$/.test(a.time) && !post.id) post.publish_time = a.time;
    if (!post.cover_alt && a.cover_alt) post.cover_alt = a.cover_alt;
    if (a.related && a.related.length && !post.id) post.related = a.related;
    post.slugTouched = !!post.slug;
    closeImport();
    openEditor(post);
    dirty = true;
    var msg = "Imported: " + summaryOf(r) + ".";
    if (r.warnings.length) msg += " " + r.warnings.join(" ");
    msg += " Now add the cover image, check the title and description, and Publish.";
    status(msg, r.warnings.length > 0);
    toast("Article imported. Please review it before publishing.", "success");
  }

  function runImport(promise) {
    importMsg("Reading the file...");
    promise.then(applyImport).catch(function (e) { importMsg(e.message || "Could not read that file.", true); });
  }

  $("blogImportBtn").addEventListener("click", function () { openImport("new"); });
  $("blogEditorImportBtn").addEventListener("click", function () { openImport("editor"); });
  $("importClose").addEventListener("click", closeImport);
  $("importOverlay").addEventListener("click", closeImport);
  $("importFile").addEventListener("change", function () {
    var f = this.files && this.files[0];
    this.value = "";
    if (f) runImport(window.CRM_IMPORT.fromFile(f));
  });
  $("importGo").addEventListener("click", function () {
    var text = $("importText").value;
    if (!text.trim()) { importMsg("Paste the article text first, or choose a file.", true); return; }
    runImport(new Promise(function (resolve) { resolve(window.CRM_IMPORT.fromText(text)); }));
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    $("importDrop").addEventListener(ev, function (e) { e.preventDefault(); this.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    $("importDrop").addEventListener(ev, function (e) { e.preventDefault(); this.classList.remove("is-over"); });
  });
  $("importDrop").addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) runImport(window.CRM_IMPORT.fromFile(f));
  });

  /* ---------------- register ---------------- */

  app.registerView("blog", {
    show: function () {
      if (cur) return;           // keep the open editor as it is
      $("blogEditor").classList.add("crm-hidden");
      $("blogList").classList.remove("crm-hidden");
      loadList();
    }
  });
})();
