/* TaxPower CRM */
(function () {
  "use strict";

  var cfg = window.CRM_CONFIG || {};
  var client = null;
  if (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf("http") === 0) {
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
  }

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    leads: [], view: "dashboard", search: "", status: "all", product: "all", followupOnly: false,
    selectedId: null, mode: "edit", user: null, role: "staff",
    perms: { can_add_leads: false, can_edit_leads: false, can_convert_leads: false, can_export: false, can_manage_blog: false }
  };

  var PERM_KEYS = [
    ["can_add_leads", "Add new leads"],
    ["can_edit_leads", "Edit leads, notes and follow-ups"],
    ["can_convert_leads", "Convert leads into clients"],
    ["can_export", "Export leads & clients to CSV"],
    ["can_manage_blog", "Write and publish blog articles"]
  ];

  var NEW_STAFF_DEFAULTS = { can_add_leads: false, can_edit_leads: true, can_convert_leads: true, can_export: false, can_manage_blog: false };

  function renderNewStaffPerms() {
    $("staffPermsChecks").innerHTML = PERM_KEYS.map(function (k) {
      return '<label><input type="checkbox" data-new-perm="' + k[0] + '"' + (NEW_STAFF_DEFAULTS[k[0]] ? " checked" : "") + " /> " + esc(k[1]) + "</label>";
    }).join("");
  }

  function syncNewStaffPerms() {
    $("staffPermsBox").classList.toggle("crm-hidden", $("staffRole").value === "admin");
  }

  function can(key) {
    return state.role === "admin" || !!state.perms[key];
  }

  var STATUS = ["new", "contacted", "converted", "closed"];
  var STATUS_LABEL = { new: "New", contacted: "Contacted", converted: "Converted", closed: "Closed" };

  var VIEW_TEXT = {
    dashboard: ["Dashboard", "Overview of today's leads and follow-ups"],
    leads: ["Leads", "Manage all enquiries in one place"],
    clients: ["Clients", "Manage converted clients and purchase details"],
    profile: ["My profile", "Manage your role, permissions and security settings"],
    activity: ["Activity", "Audit trail of every change and deleted lead"],
    blog: ["Blog", "Write, preview and publish articles on taxpower.co"],
    team: ["Team", "Logins, roles and what each person is allowed to do"]
  };

  /* Extra screens (blog ...) register themselves here. */
  var extraViews = {};
  var toastTimer = null;

  function toast(message, kind) {
    var el = $("crmToast");
    el.textContent = message;
    el.className = "crm-toast" + (kind ? " is-" + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add("crm-hidden"); }, kind === "error" ? 7000 : 4500);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function todayKey() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }

  function dateKey(value) {
    var d = new Date(value);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }

  function fmtWhen(lead) {
    if (lead.submitted_at_text) return lead.submitted_at_text;
    var d = new Date(lead.submitted_at);
    return isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN");
  }

  /* ---------------- auth ---------------- */

  function showLogin(message) {
    $("loginScreen").classList.remove("crm-hidden");
    $("appShell").classList.add("crm-hidden");
    $("loginForm").classList.remove("crm-hidden");
    $("passwordSetupForm").classList.add("crm-hidden");
    $("resetRequestForm").classList.add("crm-hidden");
    $("loginError").textContent = message || "";
  }

  function showResetRequest() {
    $("loginForm").classList.add("crm-hidden");
    $("passwordSetupForm").classList.add("crm-hidden");
    $("resetRequestForm").classList.remove("crm-hidden");
    $("resetError").textContent = "";
    $("resetNote").textContent = "";
    $("resetEmail").value = $("loginEmail").value.trim();
  }

  function showPasswordSetup() {
    $("loginScreen").classList.remove("crm-hidden");
    $("appShell").classList.add("crm-hidden");
    $("loginForm").classList.add("crm-hidden");
    $("resetRequestForm").classList.add("crm-hidden");
    $("passwordSetupForm").classList.remove("crm-hidden");
    $("passwordSetupError").textContent = "";
  }

  function showApp(email) {
    $("loginScreen").classList.add("crm-hidden");
    $("appShell").classList.remove("crm-hidden");
    $("userChip").textContent = email || "";
    loadProfile();
  }

  /* ---------------- password visibility ---------------- */

  document.addEventListener("click", function (event) {
    var btn = event.target.closest ? event.target.closest(".crm-eye") : null;
    if (!btn) return;
    var input = $(btn.getAttribute("data-toggle"));
    if (!input) return;
    var show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.classList.toggle("is-on", show);
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });

  /* ---------------- password reset ---------------- */

  $("forgotBtn").addEventListener("click", showResetRequest);
  $("backToLoginBtn").addEventListener("click", function () { showLogin(""); });

  function sendResetEmail(email) {
    return client.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + "/?type=recovery"
    });
  }

  $("resetRequestForm").addEventListener("submit", function (event) {
    event.preventDefault();
    if (!client) return;
    var email = $("resetEmail").value.trim();
    var btn = $("resetBtn");
    $("resetError").textContent = "";
    $("resetNote").textContent = "";
    btn.disabled = true;
    btn.textContent = "Sending...";
    sendResetEmail(email).then(function (res) {
      if (res.error) throw res.error;
      $("resetNote").textContent = "If an account exists for " + email + ", a reset link is on its way.";
    }).catch(function (err) {
      $("resetError").textContent = err.message || "Reset link could not be sent.";
    }).then(function () {
      btn.disabled = false;
      btn.textContent = "Send reset link";
    });
  });

  /* ---------------- profile ---------------- */

  function loadProfile() {
    if (!client) return;
    client.auth.getUser().then(function (res) {
      var user = res.data && res.data.user;
      if (!user) return;
      state.user = user;
      $("profileEmail").textContent = user.email || "-";
      $("profileId").textContent = user.id;
      $("profileLastLogin").textContent = user.last_sign_in_at
        ? new Date(user.last_sign_in_at).toLocaleString("en-IN")
        : "-";
      return client.from("user_roles").select("role").eq("user_id", user.id).then(function (roleRes) {
        var roles = (roleRes.data || []).map(function (r) { return r.role; });
        state.role = roles.indexOf("admin") !== -1 ? "admin" : (roles[0] || "staff");
        return client.from("staff_permissions").select("*").eq("user_id", user.id).maybeSingle();
      }).then(function (permRes) {
        var row = (permRes && permRes.data) || {};
        PERM_KEYS.forEach(function (p) { state.perms[p[0]] = !!row[p[0]]; });
        applyPermissions();
        renderProfile();
        return client.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
      }).then(function (profRes) {
        var name = (profRes && profRes.data && profRes.data.display_name) || "";
        $("profileName").textContent = name || (state.user.email || "").split("@")[0];
        $("profileNameInput").value = name;
        $("profileAvatar").textContent = ($("profileName").textContent || "T").slice(0, 2).toUpperCase();
        if (state.view === "dashboard") renderDashboard();
        if (state.view === "dashboard") $("pageSubtitle").textContent = greeting();
      });
    });
  }

  function applyPermissions() {
    $("navActivity").classList.toggle("crm-hidden", state.role !== "admin");
    $("navTeam").classList.toggle("crm-hidden", state.role !== "admin");
    $("navBlog").classList.toggle("crm-hidden", !can("can_manage_blog"));
    $("dashActivityPanel").classList.toggle("crm-hidden", state.role !== "admin");
    $("addLeadBtn").classList.toggle("crm-hidden", !can("can_add_leads") || state.view === "clients");
    $("exportBtn").classList.toggle("crm-hidden", !can("can_export"));
  }

  function renderProfile() {
    var role = state.role;
    var badge = $("profileRole");
    badge.textContent = role === "admin" ? "Administrator" : "Staff";
    badge.className = "crm-role-badge" + (role === "admin" ? " is-admin" : "");
    var list = [["View dashboard & reports", true], ["View all leads", true]]
      .concat(PERM_KEYS.map(function (p) { return [p[1], can(p[0])]; }))
      .concat([["Delete leads", role === "admin"], ["Manage staff accounts", role === "admin"]]);
    $("permList").innerHTML = list.map(function (p) {
      return '<li class="' + (p[1] ? "is-allowed" : "is-denied") + '"><span>' + (p[1] ? "&#10003;" : "&#10005;") +
        "</span>" + esc(p[0]) + "</li>";
    }).join("");
  }

  /* ---------------- staff permission matrix (admin only) ---------------- */

  function renderPermMatrix(users) {
    client.from("staff_permissions").select("*").then(function (res) {
      var rows = res.data || [];
      var byId = {};
      rows.forEach(function (r) { byId[r.user_id] = r; });
      var staff = users.filter(function (u) { return u.role !== "admin"; });
      $("permMatrix").innerHTML = staff.length
        ? staff.map(function (u) {
          var p = byId[u.id] || {};
          return '<div class="crm-perm-row"><strong>' +
            esc(u.display_name || (u.email || "").split("@")[0]) + "</strong><small>" + esc(u.email || "") +
            "</small><div class='crm-perm-checks'>" + PERM_KEYS.map(function (k) {
              return '<label><input type="checkbox" data-perm-user="' + esc(u.id) + '" data-perm-key="' + k[0] +
                '"' + (p[k[0]] ? " checked" : "") + " /> " + esc(k[1]) + "</label>";
            }).join("") + "</div></div>";
        }).join("")
        : '<p class="crm-empty">No staff accounts yet.</p>';
    });
  }

  $("permMatrix").addEventListener("change", function (event) {
    var box = event.target;
    if (!box.getAttribute || !box.getAttribute("data-perm-user")) return;
    var status = $("permMatrixStatus");
    var patch = { user_id: box.getAttribute("data-perm-user") };
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-perm-user="' + patch.user_id + '"]'),
      function (input) { patch[input.getAttribute("data-perm-key")] = input.checked; }
    );
    status.style.color = "";
    status.textContent = "Saving...";
    client.from("staff_permissions").upsert(patch, { onConflict: "user_id" }).then(function (res) {
      if (res.error) {
        status.style.color = "#b91c1c";
        status.textContent = res.error.message;
        return;
      }
      status.style.color = "#047857";
      status.textContent = "Permissions updated.";
    });
  });

  /* ---------------- team accounts (admin only) ---------------- */

  function staffApi(method, body) {
    return client.auth.getSession().then(function (res) {
      var token = res.data && res.data.session && res.data.session.access_token;
      return fetch("/api/public/staff", {
        method: method,
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + (token || "")
        },
        body: body ? JSON.stringify(body) : undefined
      });
    }).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok) throw new Error(data.error || resp.statusText || "Request failed");
        return data;
      });
    });
  }

  function loadStaff() {
    if (state.role !== "admin") return;
    staffApi("GET").then(function (data) {
      var me = state.user ? state.user.id : "";
      var users = data.users || [];
      $("teamCount").textContent = users.length + (users.length === 1 ? " person" : " people");
      $("staffList").innerHTML = users.map(function (u) {
        var self = u.id === me;
        var active = u.active !== false;
        var name = u.display_name || (u.email || "").split("@")[0];
        return '<tr data-user="' + esc(u.id) + '"><td><strong>' + esc(name) + (self ? " <em>(you)</em>" : "") +
          "</strong><small>" + esc(u.email || "") + "</small></td>" +
          "<td>" + (self
            ? '<span class="crm-role-badge is-admin">Administrator</span>'
            : '<select class="crm-select crm-select-sm" data-user-role="' + esc(u.id) + '"><option value="staff"' +
              (u.role === "staff" ? " selected" : "") + '>Staff</option><option value="admin"' +
              (u.role === "admin" ? " selected" : "") + ">Administrator</option></select>") + "</td>" +
          '<td><span class="crm-pill ' + (active ? "crm-pill-converted" : "crm-pill-closed") + '">' +
          (active ? "Active" : "Disabled") + "</span></td>" +
          "<td>" + esc(u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("en-IN") : "Never") + "</td>" +
          '<td class="crm-row-actions">' +
          '<button type="button" class="crm-link-btn" data-user-password="' + esc(u.id) + '">Set password</button>' +
          (self ? "" : '<button type="button" class="crm-link-btn" data-user-toggle="' + esc(u.id) + '" data-active="' +
            (active ? "1" : "0") + '">' + (active ? "Disable" : "Enable") + "</button>" +
            '<button type="button" class="crm-link-btn crm-link-danger" data-remove-user="' + esc(u.id) + '">Remove</button>') +
          "</td></tr>";
      }).join("") || '<tr><td colspan="5">No accounts yet.</td></tr>';
      renderPermMatrix(users);
    }).catch(function (err) {
      $("staffList").innerHTML = '<tr><td colspan="5">' + esc(err.message) + "</td></tr>";
    });
  }

  function teamStatus(message, bad) {
    var el = $("teamStatus");
    el.style.color = bad ? "#b91c1c" : "#047857";
    el.textContent = message;
  }

  $("genPasswordBtn").addEventListener("click", function () {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$";
    var out = "";
    for (var i = 0; i < 12; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    var input = $("staffPassword");
    input.value = out;
    input.type = "text";
    $("createStaffStatus").style.color = "";
    $("createStaffStatus").textContent = "Password generated — copy it before creating the login.";
  });

  renderNewStaffPerms();
  syncNewStaffPerms();
  $("staffRole").addEventListener("change", syncNewStaffPerms);

  $("createStaffForm").addEventListener("submit", function (event) {
    event.preventDefault();
    var status = $("createStaffStatus");
    var btn = $("createStaffBtn");
    var email = $("staffEmail").value.trim();
    var password = $("staffPassword").value;
    status.style.color = "";
    if (password.length < 8) {
      status.style.color = "#b91c1c";
      status.textContent = "Password must be at least 8 characters.";
      return;
    }
    btn.disabled = true;
    status.textContent = "Creating login...";
    staffApi("POST", {
      email: email,
      password: password,
      display_name: $("staffName").value.trim(),
      role: $("staffRole").value,
      permissions: (function () {
        var out = {};
        Array.prototype.forEach.call(document.querySelectorAll("[data-new-perm]"), function (i) { out[i.getAttribute("data-new-perm")] = i.checked; });
        return out;
      })()
    }).then(function () {
      status.style.color = "#047857";
      status.textContent = "Login created for " + email + ". Share the password with them.";
      $("staffEmail").value = "";
      $("staffName").value = "";
      $("staffPassword").value = "";
      loadStaff();
    }).catch(function (err) {
      status.style.color = "#b91c1c";
      status.textContent = err.message;
    }).then(function () { btn.disabled = false; });
  });

  $("staffList").addEventListener("click", function (event) {
    var t = event.target.closest ? event.target.closest("button") : null;
    if (!t) return;
    var id;
    if ((id = t.getAttribute("data-remove-user"))) {
      if (!window.confirm("Remove this account permanently? They will no longer be able to sign in.")) return;
      staffApi("DELETE", { id: id }).then(function () { teamStatus("Account removed."); loadStaff(); })
        .catch(function (err) { teamStatus(err.message, true); });
    } else if ((id = t.getAttribute("data-user-toggle"))) {
      var enable = t.getAttribute("data-active") === "0";
      if (!enable && !window.confirm("Disable this login? They will be signed out and cannot sign in until you enable it again.")) return;
      staffApi("PATCH", { id: id, active: enable }).then(function () {
        teamStatus(enable ? "Login enabled." : "Login disabled.");
        loadStaff();
      }).catch(function (err) { teamStatus(err.message, true); });
    } else if ((id = t.getAttribute("data-user-password"))) {
      var pw = window.prompt("Type a new password for this person (at least 8 characters):", "");
      if (pw === null) return;
      staffApi("PATCH", { id: id, password: pw }).then(function () {
        teamStatus("Password changed. Share it with them.");
      }).catch(function (err) { teamStatus(err.message, true); });
    }
  });

  $("staffList").addEventListener("change", function (event) {
    var sel = event.target;
    var id = sel.getAttribute && sel.getAttribute("data-user-role");
    if (!id) return;
    staffApi("PATCH", { id: id, role: sel.value }).then(function () {
      teamStatus("Role updated.");
      loadStaff();
    }).catch(function (err) { teamStatus(err.message, true); loadStaff(); });
  });

  $("profileSaveBtn").addEventListener("click", function () {
    if (!client || !state.user) return;
    var btn = this;
    var status = $("profileStatus");
    btn.disabled = true;
    status.style.color = "";
    status.textContent = "Saving...";
    client.from("profiles").update({ display_name: $("profileNameInput").value.trim() }).eq("id", state.user.id)
      .then(function (res) {
        btn.disabled = false;
        if (res.error) {
          status.style.color = "#b91c1c";
          status.textContent = res.error.message;
          return;
        }
        status.style.color = "#047857";
        status.textContent = "Profile updated.";
        loadProfile();
      });
  });

  $("changePasswordForm").addEventListener("submit", function (event) {
    event.preventDefault();
    if (!client || !state.user) return;
    var status = $("changePasswordStatus");
    var btn = $("changePasswordBtn");
    var current = $("currentPassword").value;
    var next = $("changeNewPassword").value;
    status.style.color = "";
    if (next.length < 8) {
      status.style.color = "#b91c1c";
      status.textContent = "New password must be at least 8 characters.";
      return;
    }
    btn.disabled = true;
    status.textContent = "Updating...";
    client.auth.signInWithPassword({ email: state.user.email, password: current }).then(function (res) {
      if (res.error) throw new Error("Current password is incorrect.");
      return client.auth.updateUser({ password: next });
    }).then(function (res) {
      if (res && res.error) throw res.error;
      status.style.color = "#047857";
      status.textContent = "Password updated.";
      $("currentPassword").value = "";
      $("changeNewPassword").value = "";
    }).catch(function (err) {
      status.style.color = "#b91c1c";
      status.textContent = err.message || "Password could not be updated.";
    }).then(function () { btn.disabled = false; });
  });

  $("sendResetBtn").addEventListener("click", function () {
    if (!client || !state.user) return;
    var status = $("changePasswordStatus");
    status.style.color = "";
    status.textContent = "Sending reset link...";
    sendResetEmail(state.user.email).then(function (res) {
      if (res.error) throw res.error;
      status.style.color = "#047857";
      status.textContent = "Reset link sent to " + state.user.email + ".";
    }).catch(function (err) {
      status.style.color = "#b91c1c";
      status.textContent = err.message || "Could not send reset link.";
    });
  });

  $("loginForm").addEventListener("submit", function (event) {
    event.preventDefault();
    $("loginError").textContent = "";
    if (!client) {
      $("loginError").textContent = "The CRM service is not configured. Please contact your administrator.";
      return;
    }
    var btn = $("loginBtn");
    btn.disabled = true;
    btn.textContent = "Signing in...";
    client.auth
      .signInWithPassword({ email: $("loginEmail").value.trim(), password: $("loginPassword").value })
      .then(function (res) {
        if (res.error) throw res.error;
        showApp(res.data.user && res.data.user.email);
        loadLeads();
      })
      .catch(function (err) {
        $("loginError").textContent = err.message || "Unable to log in. Please check your credentials and try again.";
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = "Login";
      });
  });

  $("passwordSetupForm").addEventListener("submit", function (event) {
    event.preventDefault();
    var password = $("newPassword").value;
    var confirmation = $("confirmPassword").value;
    var error = $("passwordSetupError");
    error.textContent = "";
    if (password.length < 8) {
      error.textContent = "Password must be at least 8 characters.";
      return;
    }
    if (password !== confirmation) {
      error.textContent = "Passwords do not match.";
      return;
    }
    var btn = $("passwordSetupBtn");
    btn.disabled = true;
    btn.textContent = "Saving...";
    client.auth.updateUser({ password: password }).then(function (res) {
      if (res.error) throw res.error;
      history.replaceState(null, "", location.pathname);
      showApp(res.data.user && res.data.user.email);
      loadLeads();
    }).catch(function (err) {
      error.textContent = err.message || "Password could not be saved.";
    }).then(function () {
      btn.disabled = false;
      btn.textContent = "Save password";
    });
  });

  $("logoutBtn").addEventListener("click", function () {
    if (!client) return;
    client.auth.signOut().then(function () {
      state.leads = [];
      showLogin("");
    });
  });

  /* ---------------- data ---------------- */

  function loadLeads() {
    if (!client) return;
    client
      .from("leads")
      .select("*")
      .order("submitted_at", { ascending: false })
      .then(function (res) {
        if (res.error) {
          $("emptyMsg").textContent = res.error.message;
          $("emptyMsg").classList.remove("crm-hidden");
          return;
        }
        var known = state.leadsLoaded ? state.leads.map(function (l) { return l.id; }) : null;
        state.leads = res.data || [];
        if (known) {
          var fresh = state.leads.filter(function (l) { return known.indexOf(l.id) === -1; });
          if (fresh.length) {
            toast(fresh.length === 1
              ? "New enquiry from " + (fresh[0].name || "a visitor") + (fresh[0].product ? " for " + fresh[0].product : "")
              : fresh.length + " new enquiries have arrived", "info");
          }
        }
        state.leadsLoaded = true;
        if (state.view !== "profile" && state.view !== "blog" && state.view !== "team" && state.view !== "activity") render();
      });
  }

  // New website enquiries show up without refreshing the page.
  setInterval(function () {
    if (document.hidden || !state.user || $("appShell").classList.contains("crm-hidden")) return;
    loadLeads();
  }, 45000);

  function saveLead(patch) {
    var id = patch.id;
    delete patch.id;
    return client.from("leads").update(patch).eq("id", id);
  }

  function deleteLead(id) {
    return client.from("leads").delete().eq("id", id);
  }

  /* ---------------- navigation ---------------- */

  Array.prototype.forEach.call(document.querySelectorAll(".crm-nav-item"), function (btn) {
    btn.addEventListener("click", function () {
      state.view = btn.getAttribute("data-view");
      Array.prototype.forEach.call(document.querySelectorAll(".crm-nav-item"), function (other) {
        other.classList.toggle("is-active", other === btn);
      });
      $("sidebar").classList.remove("is-open");
      render();
    });
  });

  $("menuBtn").addEventListener("click", function () { $("sidebar").classList.add("is-open"); });
  $("sidebarClose").addEventListener("click", function () { $("sidebar").classList.remove("is-open"); });

  $("searchInput").addEventListener("input", function () { state.search = this.value.toLowerCase(); render(); });
  $("statusFilter").addEventListener("change", function () { state.status = this.value; render(); });
  $("productFilter").addEventListener("change", function () { state.product = this.value; render(); });
  $("followupOnly").addEventListener("change", function () { state.followupOnly = this.checked; render(); });

  /* ---------------- render ---------------- */

  var SECTION = {
    dashboard: "viewDashboard", profile: "viewProfile", activity: "viewActivity",
    team: "viewTeam", blog: "viewBlog", leads: "viewDirectory", clients: "viewDirectory"
  };

  function render() {
    if ((state.view === "team" || state.view === "activity") && state.role !== "admin") state.view = "dashboard";
    if (state.view === "blog" && !can("can_manage_blog")) state.view = "dashboard";
    var text = VIEW_TEXT[state.view] || VIEW_TEXT.dashboard;
    $("pageTitle").textContent = text[0];
    $("pageSubtitle").textContent = state.view === "dashboard" ? greeting() : text[1];
    Array.prototype.forEach.call(document.querySelectorAll(".crm-nav-item[data-view]"), function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-view") === state.view);
    });
    var shown = SECTION[state.view] || "viewDashboard";
    ["viewDashboard", "viewProfile", "viewActivity", "viewTeam", "viewBlog", "viewDirectory"].forEach(function (id) {
      $(id).classList.toggle("crm-hidden", id !== shown);
    });
    applyPermissions();
    if (state.view === "profile") renderProfile();
    else if (state.view === "activity") loadActivityView();
    else if (state.view === "team") loadStaff();
    else if (state.view === "blog") { if (extraViews.blog) extraViews.blog.show(); }
    else if (state.view === "dashboard") renderDashboard();
    else renderTable();
  }

  function greeting() {
    var hour = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
    var word = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    var name = ($("profileName").textContent || "").replace(/^-$/, "");
    return word + (name ? ", " + name : "") + ". Here is how your leads look today.";
  }

  /* ---------------- activity & archive ---------------- */

  function fmtStamp(value) {
    var d = new Date(value);
    return isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN");
  }

  var ACTION_LABEL = { created: "Created", updated: "Edited", converted: "Converted to client", deleted: "Deleted" };

  function activityRow(a) {
    return '<div class="crm-activity-item is-' + esc(a.action) + '"><div><strong>' +
      esc(ACTION_LABEL[a.action] || a.action) + " &mdash; " + esc(a.lead_name || "(no name)") +
      "</strong><small>" + esc(a.details || "") + "</small></div><div class='crm-activity-meta'>" +
      esc(a.actor_name || "System") + "<br><small>" + esc(fmtStamp(a.created_at)) + "</small></div></div>";
  }

  function loadActivityView() {
    client.from("lead_activities").select("*").order("created_at", { ascending: false }).limit(100)
      .then(function (res) {
        var rows = res.data || [];
        $("activityFeed").innerHTML = rows.length
          ? rows.map(activityRow).join("")
          : '<p class="crm-empty">No activity recorded yet.</p>';
      });
    client.from("deleted_leads").select("*").order("deleted_at", { ascending: false }).limit(100)
      .then(function (res) {
        var rows = res.data || [];
        $("archiveList").innerHTML = rows.length
          ? rows.map(function (d) {
            var s = d.snapshot || {};
            return '<div class="crm-activity-item is-deleted"><div><strong>' + esc(d.lead_name || "(no name)") +
              "</strong><small>" + esc([s.company, s.mobile, s.email, s.product].filter(Boolean).join(" · ")) +
              "</small><small>Reason: " + esc(d.reason || "not provided") + "</small></div>" +
              "<div class='crm-activity-meta'>Deleted by " + esc(d.deleted_by_name || "System") +
              "<br><small>" + esc(fmtStamp(d.deleted_at)) + "</small></div></div>";
          }).join("")
          : '<p class="crm-empty">No leads have been deleted.</p>';
      });
  }

  function rankBars(el, rows, emptyText) {
    var max = rows.length ? rows[0][1] : 0;
    el.innerHTML = rows.length
      ? rows.map(function (r) {
        return '<div class="crm-bar-row"><div class="crm-bar-label"><span title="' + esc(r[0]) + '">' + esc(r[0]) +
          "</span><span>" + r[1] + '</span></div><div class="crm-bar-track"><div class="crm-bar-fill" style="width:' +
          Math.max(4, Math.round((r[1] / max) * 100)) + '%"></div></div></div>';
      }).join("")
      : '<p class="crm-empty">' + emptyText + "</p>";
  }

  function tally(leads, pick) {
    var map = {};
    leads.forEach(function (l) {
      var values = pick(l);
      (Array.isArray(values) ? values : [values]).forEach(function (v) {
        v = String(v || "").trim();
        if (v) map[v] = (map[v] || 0) + 1;
      });
    });
    return Object.keys(map).map(function (k) { return [k, map[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6);
  }

  function pagePath(url) {
    try {
      var u = new URL(url);
      return (u.pathname === "/" ? "Home" : u.pathname.replace(/^\//, "").replace(/\/$/, "")) || "Home";
    } catch (e) { return url ? String(url).slice(0, 40) : ""; }
  }

  function drawChart(leads) {
    var days = [];
    var counts = {};
    var base = new Date();
    for (var i = 29; i >= 0; i--) {
      var d = new Date(base.getTime() - i * 86400000);
      var key = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      days.push({ key: key, label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) });
      counts[key] = 0;
    }
    leads.forEach(function (l) { var k = dateKey(l.submitted_at); if (k in counts) counts[k]++; });
    var max = Math.max.apply(null, days.map(function (d) { return counts[d.key]; }).concat([3]));
    var W = Math.max(280, $("leadChart").clientWidth || 900), H = 200, padL = 28, padB = 26, padT = 10;
    var every = Math.max(5, Math.ceil(days.length / Math.floor((W - padL) / 62)));
    var bw = (W - padL) / days.length;
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" class="crm-chart-svg">';
    [0, 0.5, 1].forEach(function (f) {
      var y = padT + (H - padT - padB) * (1 - f);
      svg += '<line x1="' + padL + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" class="crm-chart-grid"/>' +
        '<text x="0" y="' + (y + 4) + '" class="crm-chart-axis">' + Math.round(max * f) + "</text>";
    });
    days.forEach(function (d, i) {
      var h = (H - padT - padB) * (counts[d.key] / max);
      var x = padL + i * bw + bw * 0.18;
      var y = H - padB - h;
      svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) +
        '" height="' + Math.max(counts[d.key] ? h : 2, 2).toFixed(1) + '" rx="3" class="crm-chart-bar' +
        (counts[d.key] ? "" : " is-empty") + '"><title>' + d.label + ": " + counts[d.key] + " lead" +
        (counts[d.key] === 1 ? "" : "s") + "</title></rect>";
      if ((days.length - 1 - i) % every === 0) {
        var last = i === days.length - 1;
        svg += '<text x="' + (last ? W - 2 : x + bw * 0.32).toFixed(1) + '" y="' + (H - 8) + '" class="crm-chart-axis" text-anchor="' + (last ? "end" : "middle") + '">' + d.label + "</text>";
      }
    });
    $("leadChart").innerHTML = svg + "</svg>";
    var total = days.reduce(function (n, d) { return n + counts[d.key]; }, 0);
    $("chartNote").textContent = total + " in 30 days";
  }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (state.view === "dashboard" && state.leads.length) drawChart(state.leads); }, 200);
  });

  function renderDashboard() {
    var leads = state.leads;
    var today = todayKey();
    var weekAgo = new Date(Date.now() - 6 * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    var c = { total: leads.length, today: 0, week: 0, followups: 0, overdue: 0, revenue: 0 };
    STATUS.forEach(function (st) { c[st] = 0; });
    leads.forEach(function (lead) {
      c[lead.status] = (c[lead.status] || 0) + 1;
      var k = dateKey(lead.submitted_at);
      if (k === today) c.today++;
      if (k >= weekAgo) c.week++;
      if (lead.followup_date && lead.status !== "converted" && lead.status !== "closed") {
        c.followups++;
        if (lead.followup_date < today) c.overdue++;
      }
      if (lead.status === "converted" && lead.purchase_amount) c.revenue += Number(lead.purchase_amount) || 0;
    });
    var web = leads.filter(function (l) { return l.source === "Website form"; }).length;

    $("statToday").textContent = c.today;
    $("statWeek").textContent = c.week;
    $("statTotal").textContent = c.total;
    $("statTotalNote").textContent = web ? web + " from the website" : "";
    $("statNew").textContent = c["new"] || 0;
    $("statFollowups").textContent = c.followups;
    $("statOverdue").textContent = c.overdue;
    $("statConverted").textContent = c.converted;
    $("statRate").textContent = c.total ? Math.round((c.converted / c.total) * 100) + "% of all leads" : "";
    $("statRevenue").innerHTML = "&#8377;" + c.revenue.toLocaleString("en-IN");
    document.querySelector(".crm-stat-warn").classList.toggle("is-alert", c.overdue > 0);

    drawChart(leads);

    $("statusBars").innerHTML = STATUS.map(function (st) {
      var value = c[st] || 0;
      var pct = c.total ? Math.round((value / c.total) * 100) : 0;
      return '<div class="crm-bar-row"><div class="crm-bar-label"><span>' + STATUS_LABEL[st] +
        "</span><span>" + value + " (" + pct + '%)</span></div><div class="crm-bar-track">' +
        '<div class="crm-bar-fill crm-fill-' + st + '" style="width:' + pct + '%"></div></div></div>';
    }).join("");

    rankBars($("topProducts"), tally(leads, function (l) { return String(l.product || "").split(","); }), "No product data yet.");
    rankBars($("topPages"), tally(leads, function (l) { return l.source === "Website form" || l.page ? pagePath(l.page) : ""; }), "No website enquiries yet.");
    rankBars($("topCities"), tally(leads, function (l) { return l.city; }), "No city data yet.");

    var due = leads
      .filter(function (l) { return l.followup_date && l.status !== "converted" && l.status !== "closed"; })
      .sort(function (a, b) { return a.followup_date < b.followup_date ? -1 : 1; })
      .slice(0, 8);
    $("dueList").innerHTML = due.length
      ? due.map(function (l) {
        var overdue = l.followup_date < today;
        return miniRow(l, '<span class="' + (overdue ? "crm-overdue" : "") + '">' + (overdue ? "Overdue · " : "") +
          esc(l.followup_date) + "</span><br>" + esc(l.followup_note || ""));
      }).join("")
      : '<p class="crm-empty">No follow-ups are currently pending.</p>';

    $("recentList").innerHTML = leads.slice(0, 8).map(function (l) {
      return miniRow(l, esc(fmtWhen(l)) + "<br>" + pill(l.status));
    }).join("") || '<p class="crm-empty">No leads are currently available.</p>';

    bindRowClicks($("dueList"));
    bindRowClicks($("recentList"));

    if (state.role === "admin") {
      client.from("lead_activities").select("*").order("created_at", { ascending: false }).limit(6).then(function (res) {
        var rows = res.data || [];
        $("dashActivity").innerHTML = rows.length ? rows.map(activityRow).join("") : '<p class="crm-empty">No activity yet.</p>';
      });
    }
  }

  function miniRow(lead, right) {
    return '<div class="crm-mini-row" data-id="' + lead.id + '"><div><strong>' +
      esc(lead.name || "(no name)") + "</strong><small>" + esc(lead.company || lead.mobile || "") +
      '</small></div><div class="crm-mini-right">' + right + "</div></div>";
  }

  function pill(status) {
    return '<span class="crm-pill crm-pill-' + status + '">' + (STATUS_LABEL[status] || status) + "</span>";
  }

  function visibleLeads() {
    var isClients = state.view === "clients";
    return state.leads.filter(function (lead) {
      if (isClients && lead.status !== "converted") return false;
      if (!isClients && state.status !== "all" && lead.status !== state.status) return false;
      if (!isClients && state.followupOnly && !lead.followup_date) return false;
      if (state.product && state.product !== "all") {
        var field = (isClients ? lead.purchase_product : lead.product) || "";
        if (field !== state.product) return false;
      }
      if (!state.search) return true;
      var blob = [lead.name, lead.company, lead.mobile, lead.email, lead.gstin, lead.city, lead.state,
        lead.product, lead.purpose, lead.notes, lead.followup_note, lead.purchase_product, lead.invoice_no]
        .join(" ").toLowerCase();
      return blob.indexOf(state.search) !== -1;
    }).sort(function (a, b) {
      if (!isClients) return 0;
      return (b.converted_at || "") > (a.converted_at || "") ? 1 : -1;
    });
  }

  function refreshProductFilter(isClients) {
    var select = $("productFilter");
    var seen = {};
    var options = [];
    state.leads.forEach(function (l) {
      if (isClients && l.status !== "converted") return;
      var value = (isClients ? l.purchase_product : l.product) || "";
      if (!value || seen[value]) return;
      seen[value] = true;
      options.push(value);
    });
    options.sort();
    if (options.indexOf(state.product) === -1) state.product = "all";
    select.innerHTML = '<option value="all">All products</option>' + options.map(function (p) {
      return '<option value="' + esc(p) + '"' + (p === state.product ? " selected" : "") + ">" + esc(p) + "</option>";
    }).join("");
    select.value = state.product;
  }

  function renderTable() {
    var isClients = state.view === "clients";
    $("statusFilter").classList.toggle("crm-hidden", isClients);
    $("followupOnly").parentNode.classList.toggle("crm-hidden", isClients);
    refreshProductFilter(isClients);

    var headers = isClients
      ? ["#", "Client", "Company", "Mobile", "Product purchased", "Amount", "Invoice", "Converted on", "Updated by"]
      : ["#", "Received", "Name", "Company", "Mobile", "Product interested", "Source", "Follow-up", "Status", "Updated by", ""];
    $("tableHead").innerHTML = "<tr>" + headers.map(function (h, i) {
      return '<th' + (i === 0 ? ' class="crm-sn"' : "") + ">" + h + "</th>";
    }).join("") + "</tr>";

    var rows = visibleLeads();
    var today = todayKey();
    $("emptyMsg").classList.toggle("crm-hidden", rows.length > 0);
    $("countChip").textContent = rows.length + (rows.length === 1 ? " record" : " records");

    $("tableBody").innerHTML = rows.map(function (l, index) {
      var sn = '<td class="crm-sn">' + (index + 1) + "</td>";
      var by = "<td>" + esc(l.updated_by_name || "-") + "</td>";
      if (isClients) {
        return '<tr data-id="' + l.id + '">' + sn + "<td><strong>" + esc(l.name) + "</strong></td><td>" +
          esc(l.company) + "</td><td>" + esc(l.mobile) + "</td><td>" + esc(l.purchase_product) +
          "</td><td>" + (l.purchase_amount ? "&#8377;" + esc(l.purchase_amount) : "-") + "</td><td>" +
          esc(l.invoice_no || "-") + "</td><td>" + esc(l.converted_at ? dateKey(l.converted_at) : "-") + "</td>" +
          by + "</tr>";
      }
      var fu = l.followup_date
        ? '<span class="' + (l.followup_date < today && l.status !== "converted" ? "crm-overdue" : "") + '">' +
        esc(l.followup_date) + "</span>"
        : "-";
      return '<tr data-id="' + l.id + '">' + sn + "<td>" + esc(fmtWhen(l)) + "</td><td><strong>" + esc(l.name) +
        "</strong></td><td>" + esc(l.company) + "</td><td>" + esc(l.mobile) + "</td><td>" +
        esc(l.product) + "</td><td>" + esc(l.source || pagePath(l.page) || "-") + "</td><td>" + fu + "</td><td>" + pill(l.status) +
        "</td>" + by + '<td>' + (l.status === "converted"
          ? '<span class="crm-pill crm-pill-converted">Client</span>'
          : (can("can_convert_leads")
            ? '<button class="crm-btn crm-btn-success crm-convert" data-convert="' + l.id + '">Convert to client</button>'
            : "-")) +
        "</td></tr>";
    }).join("");

    bindRowClicks($("tableBody"));
  }


  function bindRowClicks(container) {
    Array.prototype.forEach.call(container.querySelectorAll("[data-id]"), function (row) {
      row.addEventListener("click", function (event) {
        var convertId = event.target.getAttribute && event.target.getAttribute("data-convert");
        if (convertId) {
          event.stopPropagation();
          openDetail(convertId);
          markConvert();
          return;
        }
        openDetail(row.getAttribute("data-id"));
      });
    });
  }

  /* ---------------- detail panel ---------------- */

  var LEAD_FIELDS = [
    ["Name", "name"], ["Company", "company"], ["Mobile", "mobile"], ["Email", "email"],
    ["GSTIN", "gstin"], ["City", "city"], ["State", "state"], ["Address", "address"],
    ["Product interested", "product"], ["Purpose", "purpose"], ["Page", "page"]
  ];

  function openDetail(id) {
    var creating = !id;
    var lead = creating ? {} : state.leads.filter(function (l) { return l.id === id; })[0];
    if (!lead) return;
    state.selectedId = id || null;
    state.mode = creating ? "create" : "edit";
    $("detailName").textContent = creating ? "New lead" : (lead.name || "Lead details");
    $("detailMeta").textContent = creating
      ? "Add a lead you received directly"
      : "Received " + fmtWhen(lead) + (lead.source ? " via " + lead.source : "") + (lead.updated_by_name ? " · Last updated by " + lead.updated_by_name : "");
    $("detailStatus").textContent = "";

    $("detailEditable").innerHTML = LEAD_FIELDS.map(function (f) {
      return '<label class="crm-field"><span>' + f[0] + '</span><input type="text" data-lead-field="' +
        f[1] + '" value="' + esc(lead[f[1]] || "") + '" /></label>';
    }).join("");

    $("fStatus").value = lead.status || "new";
    $("fDate").value = lead.followup_date || "";
    $("fRemark").value = lead.followup_note || "";
    $("fNotes").value = lead.notes || "";
    $("fProduct").value = lead.purchase_product || "";
    $("fAmount").value = lead.purchase_amount == null ? "" : lead.purchase_amount;
    $("fInvoice").value = lead.invoice_no || "";

    $("deleteLeadBtn").classList.toggle("crm-hidden", creating || state.role !== "admin");
    $("convertBtn").classList.toggle("crm-hidden", creating || !can("can_convert_leads"));
    $("saveBtn").textContent = creating ? "Create lead" : "Save details";
    $("saveBtn").classList.toggle("crm-hidden", !creating && !can("can_edit_leads"));
    $("activityFieldset").classList.toggle("crm-hidden", creating);
    if (!creating) loadLeadActivity(id);

    $("detailOverlay").classList.remove("crm-hidden");
    $("detailPanel").classList.remove("crm-hidden");
  }

  function loadLeadActivity(id) {
    $("detailActivity").innerHTML = '<p class="crm-empty">Loading...</p>';
    client.from("lead_activities").select("*").eq("lead_id", id)
      .order("created_at", { ascending: false }).limit(50)
      .then(function (res) {
        var rows = res.data || [];
        $("detailActivity").innerHTML = rows.length
          ? rows.map(activityRow).join("")
          : '<p class="crm-empty">No changes recorded yet.</p>';
      });
  }

  $("addLeadBtn").addEventListener("click", function () { openDetail(null); });

  function closeDetail() {
    state.selectedId = null;
    state.mode = "edit";
    $("detailOverlay").classList.add("crm-hidden");
    $("detailPanel").classList.add("crm-hidden");
  }

  $("detailClose").addEventListener("click", closeDetail);
  $("cancelBtn").addEventListener("click", closeDetail);
  $("detailOverlay").addEventListener("click", closeDetail);

  $("deleteLeadBtn").addEventListener("click", function () {
    if (!client || !state.selectedId || state.role !== "admin") return;
    var id = state.selectedId;
    var lead = state.leads.filter(function (l) { return l.id === id; })[0];
    var name = (lead && lead.name) || "this lead";
    var reason = window.prompt("Why are you deleting " + name + "? (Recorded in the archive)", "");
    if (reason === null) return;
    if (!window.confirm("Delete " + name + "? A copy is kept in the deleted leads archive.")) return;
    var btn = $("deleteLeadBtn");
    btn.disabled = true;
    btn.textContent = "Deleting...";
    client.from("deleted_leads").insert({
      lead_id: id,
      lead_name: name,
      snapshot: lead || {},
      reason: reason.trim(),
      deleted_by: state.user ? state.user.id : null,
      deleted_by_name: $("profileName").textContent || ""
    }).then(function () {
      return deleteLead(id);
    }).then(function (res) {
      btn.disabled = false;
      btn.textContent = "Delete lead";
      if (res && res.error) {
        window.alert(res.error.message || "Could not delete the lead.");
        return;
      }
      closeDetail();
      loadLeads();
    });
  });

  function collectPatch(convert) {
    var amount = $("fAmount").value === "" ? null : Number($("fAmount").value);
    var patch = {
      id: state.selectedId,
      status: convert ? "converted" : $("fStatus").value,
      followup_date: $("fDate").value || null,
      followup_note: $("fRemark").value,
      notes: $("fNotes").value,
      purchase_product: $("fProduct").value,
      purchase_amount: amount,
      invoice_no: $("fInvoice").value
    };
    Array.prototype.forEach.call(document.querySelectorAll("#detailEditable [data-lead-field]"), function (input) {
      patch[input.getAttribute("data-lead-field")] = input.value.trim();
    });
    var existing = state.leads.filter(function (l) { return l.id === state.selectedId; })[0];
    if (patch.status === "converted") patch.converted_at = (existing && existing.status === "converted" && existing.converted_at) || new Date().toISOString();
    else patch.converted_at = null;
    return patch;
  }

  function createLead() {
    var patch = collectPatch(false);
    delete patch.id;
    if (!patch.name) {
      $("detailStatus").style.color = "#b91c1c";
      $("detailStatus").textContent = "Please enter a name.";
      return;
    }
    patch.page = patch.page || "Added manually in CRM";
    patch.source = "Added in CRM";
    patch.submitted_at = new Date().toISOString();
    var btn = $("saveBtn");
    btn.disabled = true;
    btn.textContent = "Creating...";
    client.from("leads").insert(patch).then(function (res) {
      if (res.error && /source/i.test(res.error.message || "")) {
        delete patch.source; // older database without the source column
        return client.from("leads").insert(patch);
      }
      return res;
    }).then(function (res) {
      btn.disabled = false;
      btn.textContent = "Create lead";
      if (res.error) {
        $("detailStatus").style.color = "#b91c1c";
        $("detailStatus").textContent = res.error.message;
        return;
      }
      $("detailStatus").style.color = "#047857";
      $("detailStatus").textContent = "Lead added successfully.";
      loadLeads();
      setTimeout(closeDetail, 600);
    });
  }

  function persist(convert) {
    if (!client) return;
    if (state.mode === "create") return createLead();
    if (!state.selectedId) return;
    var btn = convert ? $("convertBtn") : $("saveBtn");
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Saving...";
    saveLead(collectPatch(convert)).then(function (res) {
      btn.disabled = false;
      btn.textContent = original;
      if (res.error) {
        $("detailStatus").style.color = "#b91c1c";
        $("detailStatus").textContent = res.error.message;
        return;
      }
      $("detailStatus").style.color = "#047857";
      $("detailStatus").textContent = convert ? "Lead converted to a client successfully." : "Details saved successfully.";
      loadLeads();
      if (convert) setTimeout(closeDetail, 700);
    });
  }

  function markConvert() { persist(true); }

  $("detailForm").addEventListener("submit", function (event) {
    event.preventDefault();
    persist(false);
  });
  $("convertBtn").addEventListener("click", function () { persist(true); });

  /* ---------------- export ---------------- */

  $("exportBtn").addEventListener("click", function () {
    var rows = visibleLeads();
    var cols = ["submitted_at", "name", "company", "mobile", "email", "gstin", "address", "city", "state",
      "product", "purpose", "status", "followup_date", "followup_note", "notes",
      "purchase_product", "purchase_amount", "invoice_no", "converted_at"];
    var csv = [cols.join(",")].concat(rows.map(function (lead) {
      return cols.map(function (key) {
        return '"' + String(lead[key] == null ? "" : lead[key]).replace(/"/g, '""') + '"';
      }).join(",");
    })).join("\n");
    var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    var link = document.createElement("a");
    link.href = url;
    link.download = (state.view === "clients" ? "taxpower-clients" : "taxpower-leads") + ".csv";
    link.click();
    URL.revokeObjectURL(url);
  });

  /* ---------------- shared helpers for extra screens ---------------- */

  window.CRM_APP = {
    client: client, state: state, $: $, esc: esc, can: can, toast: toast, staffApi: staffApi, fmtStamp: fmtStamp,
    registerView: function (name, view) { extraViews[name] = view; },
    token: function () {
      return client.auth.getSession().then(function (res) {
        return (res.data && res.data.session && res.data.session.access_token) || "";
      });
    }
  };

  /* ---------------- boot ---------------- */

  if (!client) {
    showLogin("The CRM service is not configured. Please contact your administrator.");
    return;
  }

  var authFlow = new URLSearchParams(location.hash.replace(/^#/, "")).get("type") ||
    new URLSearchParams(location.search).get("type");

  client.auth.getSession().then(function (res) {
    var session = res.data && res.data.session;
    if (session && (authFlow === "invite" || authFlow === "recovery")) {
      showPasswordSetup();
    } else if (session) {
      showApp(session.user && session.user.email);
      loadLeads();
    } else {
      showLogin("");
    }
  });
})();
