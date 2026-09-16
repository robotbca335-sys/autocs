import initAuth from './modules/auth.js';
import { initData, initTabSwitching, renderData } from './modules/data.js';
import { renderLogs, initLogs } from './modules/logs.js';
import { initDeco, loadDecoImages, loadBackground, loadLiveChatBg, updateOnlineStats, showSessionEmail } from './modules/deco.js';
import { initPrediksi } from './modules/prediksi.js';
import { initPanduan } from './modules/panduan.js';
import { initAIChat } from './modules/ai-chat.js';
import { initParlay } from './modules/parlay.js';
import { initHadiah } from './modules/hadiah.js';
import { initJadwal } from './modules/jadwal.js';
import { initMemo } from './modules/memo.js';
import { initTyping } from './modules/typing.js';
import { $, getData, setData, showToast } from './modules/shared.js';
import { APP_VERSION } from './config.js';

initAuth();
initData();
initLogs();
initDeco();
initPrediksi();
initParlay();
initHadiah();
initJadwal();
initPanduan();
if (typeof window.initGeneratorBola === 'function') window.initGeneratorBola();
initAIChat();
initMemo();
initTyping();
initTabSwitching();
initLiteMode();

async function renderAll() {
  await Promise.all([renderData(), renderLogs(), loadDecoImages(), loadBackground(), loadLiveChatBg()]);
}
renderAll();
updateOnlineStats();
showSessionEmail();

function saveDashboardState() {
  var userIn = $('#qa-user'), kodeIn = $('#qa-kode'), kode2In = $('#qa-kode-2'), btn2x = $('#btn-2x');
  var dual = btn2x && btn2x.classList.contains('active');
  setData({ formState: { user: userIn ? userIn.value : '', kode: kodeIn ? kodeIn.value : '', kode2: dual && kode2In ? kode2In.value : '', dualMode: dual } });
}
document.addEventListener('input', function(e) {
  if (e.target.id === 'qa-user' || e.target.id === 'qa-kode' || e.target.id === 'qa-kode-2') saveDashboardState();
});

setInterval(function () {
  if ($('#pane-data') && $('#pane-data').classList.contains('active')) renderData();
  if ($('#pane-logs') && $('#pane-logs').classList.contains('active')) renderLogs();
}, 10000);
setInterval(function () { if (!document.hidden) updateOnlineStats(); }, 600000);

function initLiteMode() {
  const toggle = $('#lite-toggle');
  if (!toggle) return;
  getData('liteMode').then(function (result) { toggle.checked = !!result.liteMode; });
  toggle.addEventListener('change', function () {
    const val = this.checked;
    setData({ liteMode: val });
    showToast(val ? 'Mode Lite aktif' : 'Mode Lite nonaktif');
  });
}

getData('postedUpdateVersions').then(function(d) {
  var posted = d.postedUpdateVersions || [];
  if (!posted.includes(APP_VERSION)) {
    showToast('AUTO RELAX v' + APP_VERSION + ' siap digunakan');
    posted.push(APP_VERSION);
    setData({ postedUpdateVersions: posted });
  }
});