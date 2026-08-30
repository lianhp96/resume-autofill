const RECORDS_STORAGE_KEY = 'autumnRecruitmentTracker.records.v1';
const SETTINGS_STORAGE_KEY = 'autumnRecruitmentTracker.settings.v1';

async function loadStats() {
  try {
    const res = await chrome.storage.local.get([RECORDS_STORAGE_KEY]);
    const records = Array.isArray(res[RECORDS_STORAGE_KEY]) ? res[RECORDS_STORAGE_KEY] : [];
    const todayStr = new Date().toISOString().slice(0, 10);
    return {
      total: records.length,
      today: records.filter(r => r.applicationDate === todayStr || (r.updatedAt && new Date(r.updatedAt).toISOString().slice(0, 10) === todayStr)).length,
      active: records.filter(r => !['Offer', '已结束', '待投递'].includes(r.stage)).length,
      offer: records.filter(r => r.stage === 'Offer').length
    };
  } catch (err) {
    console.error('读取投递统计失败', err);
    return { total: 0, today: 0, active: 0, offer: 0 };
  }
}

function renderStats(stats) {
  document.getElementById('popupTotal').textContent = stats.total;
  document.getElementById('popupToday').textContent = stats.today;
  document.getElementById('popupActive').textContent = stats.active;
  document.getElementById('popupOffer').textContent = stats.offer;
}

document.querySelectorAll('.popup-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const targetHash = item.getAttribute('data-target') || '';
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD', targetHash }, () => {
      window.close();
    });
  });
});

async function loadSettings() {
  try {
    const res = await chrome.storage.local.get([SETTINGS_STORAGE_KEY]);
    return res[SETTINGS_STORAGE_KEY] || {};
  } catch (err) {
    console.error('读取设置失败', err);
    return {};
  }
}

async function persistSetting(key, value, revertEl) {
  try {
    const settings = await loadSettings();
    settings[key] = value;
    await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
  } catch (err) {
    console.error('保存设置失败', err);
    revertEl.checked = !revertEl.checked;
  }
}

const capsuleToggle = document.getElementById('capsuleToggle');
const freeDragToggle = document.getElementById('freeDragToggle');

loadSettings().then(settings => {
  capsuleToggle.checked = settings.capsuleEnabled !== false;
  freeDragToggle.checked = settings.capsuleFreeDrag === true;
});

capsuleToggle.addEventListener('change', () => {
  persistSetting('capsuleEnabled', capsuleToggle.checked, capsuleToggle);
});

freeDragToggle.addEventListener('change', () => {
  persistSetting('capsuleFreeDrag', freeDragToggle.checked, freeDragToggle);
});

loadStats().then(renderStats);
