/* TaxPower CRM - friendly dropdowns.
 * Replaces the browser's plain select popup with a styled list. The real <select> stays in the page
 * (hidden), so every screen keeps reading and writing .value and listening for "change" as before.
 */
(function () {
  "use strict";

  var openDd = null;

  function closeOpen() {
    if (!openDd) return;
    openDd.menu.parentNode && openDd.menu.parentNode.removeChild(openDd.menu);
    openDd.btn.setAttribute("aria-expanded", "false");
    openDd = null;
  }

  function enhance(select) {
    if (select.__dd || select.multiple || select.size > 1) return;
    var wrap = document.createElement("span");
    wrap.className = "crm-dd" + (select.closest(".crm-field") ? " crm-dd-block" : "") + (select.classList.contains("crm-select-sm") ? " crm-dd-sm" : "");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "crm-dd-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    var label = document.createElement("span");
    label.className = "crm-dd-label";
    btn.appendChild(label);
    wrap.appendChild(btn);
    select.parentNode.insertBefore(wrap, select.nextSibling);
    select.classList.add("crm-dd-native");
    select.setAttribute("tabindex", "-1");
    select.setAttribute("aria-hidden", "true");
    var idLabel = select.id ? document.querySelector('label[for="' + select.id + '"]') : null;
    if (idLabel) btn.setAttribute("aria-labelledby", idLabel.id || "");
    select.__dd = { wrap: wrap, btn: btn };

    function refresh() {
      var opt = select.options[select.selectedIndex];
      label.textContent = opt ? opt.textContent : "";
      btn.disabled = select.disabled;
      wrap.classList.toggle("is-disabled", select.disabled);
    }

    /* keep the label right when other code sets select.value or selectedIndex */
    ["value", "selectedIndex"].forEach(function (prop) {
      var d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
      if (!d || !d.set) return;
      Object.defineProperty(select, prop, {
        configurable: true,
        get: function () { return d.get.call(this); },
        set: function (v) { d.set.call(this, v); refresh(); }
      });
    });
    select.addEventListener("change", refresh);
    new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected"] });
    var form = select.form;
    if (form) form.addEventListener("reset", function () { setTimeout(refresh, 0); });
    refresh();

    function choose(index) {
      if (index < 0 || index >= select.options.length) return;
      var changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      refresh();
      if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function open() {
      if (select.disabled) return;
      closeOpen();
      var menu = document.createElement("ul");
      menu.className = "crm-dd-menu";
      menu.setAttribute("role", "listbox");
      var active = select.selectedIndex;
      Array.prototype.forEach.call(select.options, function (o, i) {
        var li = document.createElement("li");
        li.setAttribute("role", "option");
        li.dataset.i = i;
        li.textContent = o.textContent;
        if (o.disabled) li.className = "is-disabled";
        if (i === select.selectedIndex) { li.classList.add("is-selected"); li.setAttribute("aria-selected", "true"); }
        menu.appendChild(li);
      });
      document.body.appendChild(menu);
      var r = btn.getBoundingClientRect();
      menu.style.left = "0px";
      menu.style.top = "0px";
      menu.style.minWidth = r.width + "px";
      var h = menu.offsetHeight;
      var below = window.innerHeight - r.bottom, up = r.top > h + 12 && below < h + 12;
      menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + "px";
      menu.style.top = (up ? r.top - h - 6 : r.bottom + 6) + "px";
      if (h > below - 16 && !up) menu.style.maxHeight = Math.max(120, below - 16) + "px";
      btn.setAttribute("aria-expanded", "true");
      openDd = { menu: menu, btn: btn, select: select, setActive: setActive };
      var sel = menu.querySelector(".is-selected");
      if (sel) sel.scrollIntoView({ block: "nearest" });

      function setActive(i) {
        var items = menu.children;
        if (i < 0 || i >= items.length) return;
        Array.prototype.forEach.call(items, function (n) { n.classList.remove("is-active"); });
        items[i].classList.add("is-active");
        items[i].scrollIntoView({ block: "nearest" });
        active = i;
      }
      setActive(active);

      menu.addEventListener("mousedown", function (e) { e.preventDefault(); });
      menu.addEventListener("click", function (e) {
        var li = e.target.closest ? e.target.closest("li") : null;
        if (!li || li.classList.contains("is-disabled")) return;
        choose(Number(li.dataset.i));
        closeOpen();
        btn.focus();
      });
      menu.addEventListener("mousemove", function (e) {
        var li = e.target.closest ? e.target.closest("li") : null;
        if (li) setActive(Number(li.dataset.i));
      });
      menu.__keys = function (e) {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(select.options.length - 1, active + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(0, active - 1)); }
        else if (e.key === "Home") { e.preventDefault(); setActive(0); }
        else if (e.key === "End") { e.preventDefault(); setActive(select.options.length - 1); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); closeOpen(); }
        else if (e.key === "Escape") { e.preventDefault(); closeOpen(); }
        else if (e.key === "Tab") { closeOpen(); }
        else if (e.key.length === 1) {
          var ch = e.key.toLowerCase();
          for (var k = 1; k <= select.options.length; k++) {
            var idx = (active + k) % select.options.length;
            if ((select.options[idx].textContent || "").trim().toLowerCase().charAt(0) === ch) { setActive(idx); break; }
          }
        }
      };
    }

    btn.addEventListener("click", function () {
      if (openDd && openDd.btn === btn) closeOpen(); else open();
    });
    btn.addEventListener("keydown", function (e) {
      if (openDd && openDd.btn === btn) { openDd.menu.__keys(e); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  }

  document.addEventListener("mousedown", function (e) {
    if (!openDd) return;
    if (openDd.menu.contains(e.target) || openDd.btn.contains(e.target)) return;
    closeOpen();
  });
  window.addEventListener("resize", closeOpen);
  window.addEventListener("scroll", function (e) { if (openDd && !openDd.menu.contains(e.target)) closeOpen(); }, true);

  function scan(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll("select"), enhance);
  }
  scan();
  /* selects drawn later (for example the role list in the team table) */
  new MutationObserver(function (list) {
    list.forEach(function (m) {
      Array.prototype.forEach.call(m.addedNodes, function (n) {
        if (n.nodeType !== 1) return;
        if (n.tagName === "SELECT") enhance(n); else if (n.querySelectorAll) scan(n);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });

  window.CRM_SELECT = { scan: scan };
})();
