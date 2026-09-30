/* 브라우저 저장소 — 설정·열 매핑만 localStorage 에 둡니다(시험 데이터는 저장하지 않음).
   localStorage 가 막혀 있으면 메모리로만 동작합니다. */
(function (root) {
  'use strict';
  var KEY_SETTINGS = 'data09-06.settings';
  var KEY_IMPORT = 'data09-06.import';
  var KEY_VIEW = 'data09-06.view';   // 화면 설정(그래프 높이·즉시 다시 계산)
  var memory = {};
  var ok = true;
  function get(k) {
    try { return root.localStorage.getItem(k); } catch (e) { ok = false; return memory[k] == null ? null : memory[k]; }
  }
  function set(k, v) {
    try { root.localStorage.setItem(k, v); } catch (e) { ok = false; memory[k] = v; }
  }
  function del(k) {
    try { root.localStorage.removeItem(k); } catch (e) { ok = false; delete memory[k]; }
  }
  function getJson(k) { try { return JSON.parse(get(k) || 'null'); } catch (e) { return null; } }
  root.OAStore = {
    getSettings: function () { return getJson(KEY_SETTINGS); },
    setSettings: function (s) { set(KEY_SETTINGS, JSON.stringify(s)); },
    // 마지막으로 쓴 가져오기 설정(구분자·머리행·배치·열 매핑·고정값)
    getImport: function () { return getJson(KEY_IMPORT); },
    setImport: function (c) { set(KEY_IMPORT, JSON.stringify(c)); },
    getView: function () { return getJson(KEY_VIEW) || {}; },
    setView: function (patch) { var v = getJson(KEY_VIEW) || {}; Object.keys(patch).forEach(function (k) { v[k] = patch[k]; }); set(KEY_VIEW, JSON.stringify(v)); },
    clear: function () { del(KEY_SETTINGS); del(KEY_IMPORT); del(KEY_VIEW); },
    available: function () { get(KEY_SETTINGS); return ok; }
  };
})(window);
