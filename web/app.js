(function () {
  const SIZE = 8192;
  const CRS = L.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(1 / 32, 0, 1 / 32, 0)
  });

  const bounds = [[0, 0], [SIZE, SIZE]];
  const maxBounds = [[-2500, -2500], [SIZE + 2500, SIZE + 2500]];

  const map = L.map('map', {
    crs: CRS,
    minZoom: 0,
    maxZoom: 5,
    zoomSnap: 0.1,
    zoomDelta: 0.5,
    maxBounds: maxBounds,
    maxBoundsViscosity: 0.8,
    attributionControl: true
  });

  const bgColors = {
    atlas: '#0fa8d2',
    satelite: '#142738',
    grid: '#0b1019'
  };

  function createLayer(style) {
    return L.tileLayer('https://viruxe.github.io/gtav-map-tiles/' + style + '/{z}/{x}-{y}.webp', {
      minZoom: 0,
      maxZoom: 5,
      noWrap: true,
      bounds: bounds,
      attribution: 'Map tiles &copy; Rockstar Games / VIRUXE'
    });
  }

  const layers = {
    atlas: createLayer('atlas'),
    satelite: createLayer('satelite'),
    grid: createLayer('grid')
  };

  let currentStyle = 'atlas';
  layers[currentStyle].addTo(map);

  const mapElement = document.getElementById('map');
  if (mapElement) {
    mapElement.style.backgroundColor = bgColors[currentStyle];
  }

  map.fitBounds(bounds);
  window.map = map;

  // Style buttons toggle
  const styleBtns = document.querySelectorAll('.style-btn');
  styleBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const selected = btn.getAttribute('data-style');
      if (selected === currentStyle || !layers[selected]) return;

      map.removeLayer(layers[currentStyle]);
      layers[selected].addTo(map);
      currentStyle = selected;

      if (mapElement) {
        mapElement.style.backgroundColor = bgColors[currentStyle];
      }

      styleBtns.forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
    });
  });

  // Action buttons
  const zoomInBtn = document.getElementById('btn-zoom-in');
  const zoomOutBtn = document.getElementById('btn-zoom-out');
  const recenterBtn = document.getElementById('btn-recenter');

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', function () {
      map.zoomIn();
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', function () {
      map.zoomOut();
    });
  }
  if (recenterBtn) {
    recenterBtn.addEventListener('click', function () {
      map.fitBounds(bounds, { animate: true });
    });
  }

  // Footer indicators
  const coordVal = document.getElementById('coord-val');
  const zoomVal = document.getElementById('zoom-val');

  map.on('mousemove', function (e) {
    if (!coordVal) return;
    const x = Math.round(e.latlng.lng);
    const y = Math.round(e.latlng.lat);
    coordVal.textContent = 'X: ' + x + ' | Y: ' + y;
  });

  function updateZoom() {
    if (!zoomVal) return;
    zoomVal.textContent = map.getZoom().toFixed(1) + 'x';
  }

  map.on('zoomend', updateZoom);
  updateZoom();

  // ==========================================
  // Multi-Timer Marker System & Clustering
  // ==========================================
  const STORAGE_KEY = 'gtav_custom_markers';
  let markersData = [];
  const leafletMarkers = {}; // id -> L.marker
  let pendingClickLatLng = null;
  let editingMarkerId = null;

  function loadLocalMarkers() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const raw = JSON.parse(saved);
        return raw.map(function (m) {
          if (!m.timers || !Array.isArray(m.timers)) {
            m.timers = [
              {
                id: 't_' + Date.now() + '_0',
                label: 'ตัวนับเวลา 1',
                duration: m.duration || 300,
                targetTime: m.targetTime || Date.now() + 300000
              }
            ];
          }
          return m;
        });
      }
    } catch (e) {
      return [];
    }
    return [];
  }

  function saveLocalMarkers() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(markersData));
    } catch (e) {
      console.warn('Failed to save markers locally:', e);
    }
  }

  function updateSyncBadge(online) {
    const badge = document.getElementById('sync-status-badge');
    if (!badge) return;
    if (online) {
      badge.classList.remove('sync-offline');
      badge.querySelector('.sync-text').textContent = 'ออนไลน์';
    } else {
      badge.classList.add('sync-offline');
      badge.querySelector('.sync-text').textContent = 'ออฟไลน์';
    }
  }

  async function syncToServer() {
    saveLocalMarkers();
    try {
      const res = await fetch('/api/markers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markers: markersData })
      });
      if (res.ok) {
        updateSyncBadge(true);
      } else {
        updateSyncBadge(false);
      }
    } catch (err) {
      updateSyncBadge(false);
    }
  }

  async function fetchServerMarkers() {
    try {
      const res = await fetch('/api/markers');
      if (res.ok) {
        const data = await res.json();
        updateSyncBadge(true);
        const serverMarkers = data.markers || [];

        // Check if server is empty but we have local markers, sync them up
        if (serverMarkers.length === 0 && markersData.length > 0) {
          syncToServer();
          return;
        }

        // Compare stringified data to see if anything changed from other clients
        const serverJson = JSON.stringify(serverMarkers);
        const localJson = JSON.stringify(markersData);

        if (serverJson !== localJson) {
          syncMarkersFromRemote(serverMarkers);
        }
      } else {
        updateSyncBadge(false);
      }
    } catch (err) {
      updateSyncBadge(false);
    }
  }

  function syncMarkersFromRemote(remoteList) {
    // Remove markers that no longer exist
    const remoteIds = new Set(remoteList.map(function (m) { return m.id; }));
    Object.keys(leafletMarkers).forEach(function (id) {
      if (!remoteIds.has(id)) {
        map.removeLayer(leafletMarkers[id]);
        delete leafletMarkers[id];
      }
    });

    markersData = remoteList;
    saveLocalMarkers();

    // Render or update icons
    markersData.forEach(function (m) {
      if (!leafletMarkers[m.id]) {
        renderMarker(m);
      } else {
        leafletMarkers[m.id].setIcon(createMarkerIcon(m));
        if (leafletMarkers[m.id].isPopupOpen()) {
          leafletMarkers[m.id].setPopupContent(getPopupHtml(m));
        }
      }
    });
  }

  function formatTime(seconds) {
    if (seconds <= 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  function getTimerRemaining(timer) {
    return Math.max(0, Math.ceil((timer.targetTime - Date.now()) / 1000));
  }

  function getMarkerOverallState(marker) {
    if (!marker.timers || marker.timers.length === 0) {
      return { isDone: true, activeCount: 0, totalCount: 0, minRemaining: 0, nearestLabel: '' };
    }

    let minRemaining = Infinity;
    let nearestLabel = '';
    let countingCount = 0;

    marker.timers.forEach(function (t) {
      const rem = getTimerRemaining(t);
      if (rem > 0) {
        countingCount++;
        if (rem < minRemaining) {
          minRemaining = rem;
          nearestLabel = t.label;
        }
      }
    });

    const isDone = countingCount === 0;
    return {
      isDone: isDone,
      countingCount: countingCount,
      totalCount: marker.timers.length,
      doneCount: marker.timers.length - countingCount,
      minRemaining: isDone ? 0 : minRemaining,
      nearestLabel: nearestLabel || marker.timers[0].label
    };
  }

  function createMarkerIcon(marker) {
    const overall = getMarkerOverallState(marker);
    const stateClass = overall.isDone ? 'state-done' : 'state-counting';

    let timeText = '';
    if (overall.isDone) {
      timeText = overall.totalCount > 1 ? '✓ ครบ (' + overall.totalCount + ')' : '✓ ครบเวลา';
    } else {
      if (overall.totalCount > 1) {
        timeText = formatTime(overall.minRemaining) + ' (' + overall.doneCount + '/' + overall.totalCount + ')';
      } else {
        timeText = formatTime(overall.minRemaining);
      }
    }

    const html =
      '<div class="custom-map-marker ' + stateClass + '" id="marker-wrap-' + marker.id + '">' +
        '<div class="marker-badge">' +
          '<span class="badge-name" id="badge-name-' + marker.id + '">' + escapeHtml(marker.name) + '</span>' +
          '<span class="badge-timer" id="timer-' + marker.id + '">' + timeText + '</span>' +
        '</div>' +
        '<div class="marker-pin-wrapper">' +
          '<div class="marker-dot"></div>' +
          '<div class="marker-pulse"></div>' +
        '</div>' +
      '</div>';

    return L.divIcon({
      className: 'custom-map-icon-container',
      html: html,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // Find other markers placed near this one
  function getNearbyMarkers(marker, thresholdPixels) {
    thresholdPixels = thresholdPixels || 40;
    const currentPoint = map.latLngToLayerPoint([marker.lat, marker.lng]);
    const nearby = [];

    markersData.forEach(function (other) {
      const otherPoint = map.latLngToLayerPoint([other.lat, other.lng]);
      const dist = currentPoint.distanceTo(otherPoint);
      if (dist <= thresholdPixels) {
        nearby.push(other);
      }
    });

    return nearby;
  }

  function getPopupHtml(marker) {
    const nearby = getNearbyMarkers(marker);

    let nearbyHeaderHtml = '';
    if (nearby.length > 1) {
      let tabsHtml = '';
      nearby.forEach(function (n) {
        const isActive = n.id === marker.id;
        tabsHtml +=
          '<button type="button" class="nearby-tab-btn ' + (isActive ? 'active' : '') + '" ' +
            'onclick="window.switchPopupMarker(\'' + n.id + '\')">' +
            escapeHtml(n.name) +
          '</button>';
      });

      nearbyHeaderHtml =
        '<div class="popup-nearby-bar">' +
          '<span>📍 มี ' + nearby.length + ' จุดบริเวณนี้:</span>' +
        '</div>' +
        '<div class="popup-nearby-tabs">' + tabsHtml + '</div>';
    }

    let timersListHtml = '<div class="popup-timers-list">';
    (marker.timers || []).forEach(function (t) {
      const rem = getTimerRemaining(t);
      const isDone = rem <= 0;
      const dotClass = isDone ? 'done' : 'counting';
      const timeClass = isDone ? 'done' : 'counting';
      const timeDisplay = isDone ? '✓ ครบแล้ว' : formatTime(rem);

      timersListHtml +=
        '<div class="popup-timer-item">' +
          '<div class="timer-item-left">' +
            '<span class="timer-item-dot ' + dotClass + '"></span>' +
            '<span class="timer-item-label">' + escapeHtml(t.label) + '</span>' +
          '</div>' +
          '<div class="timer-item-right">' +
            '<span class="timer-item-time ' + timeClass + '" id="ptimer-' + marker.id + '-' + t.id + '">' + timeDisplay + '</span>' +
            '<button type="button" class="timer-item-reset-btn" title="รีเซ็ตเวลานี้" onclick="window.resetTimer(\'' + marker.id + '\', \'' + t.id + '\')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-1.19"/></svg></button>' +
          '</div>' +
        '</div>';
    });
    timersListHtml += '</div>';

    return (
      '<div class="marker-popup-card">' +
        nearbyHeaderHtml +
        '<div class="popup-title">' + escapeHtml(marker.name) + '</div>' +
        timersListHtml +
        '<div class="popup-extra-actions">' +
          '<button type="button" class="popup-btn-nearby" onclick="window.addMarkerNearby(\'' + marker.id + '\')">➕ วางจุดใหม่ข้างๆ จุดนี้</button>' +
        '</div>' +
        '<div class="popup-actions">' +
          '<button type="button" class="popup-btn-edit" id="edit-btn-' + marker.id + '"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> แก้ไข</button>' +
          '<button type="button" class="popup-btn-del" id="del-btn-' + marker.id + '"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> ลบจุดนี้</button>' +
        '</div>' +
      '</div>'
    );
  }

  window.switchPopupMarker = function (targetId) {
    const lMarker = leafletMarkers[targetId];
    if (lMarker) {
      lMarker.openPopup();
    }
  };

  window.resetTimer = function (markerId, timerId) {
    const m = markersData.find(function (x) { return x.id === markerId; });
    if (!m) return;
    const t = (m.timers || []).find(function (x) { return x.id === timerId; });
    if (!t) return;

    t.targetTime = Date.now() + t.duration * 1000;
    syncToServer();
    updateMarkerVisual(m);
    if (leafletMarkers[m.id]) {
      leafletMarkers[m.id].setPopupContent(getPopupHtml(m));
    }
  };

  window.addMarkerNearby = function (markerId) {
    const m = markersData.find(function (x) { return x.id === markerId; });
    if (!m) return;

    if (leafletMarkers[markerId]) {
      leafletMarkers[markerId].closePopup();
    }

    // Offset slightly by 30 units
    const offsetLatLng = L.latLng(m.lat - 35, m.lng + 35);
    openCreateModal(offsetLatLng);
  };

  function updateMarkerVisual(marker) {
    const overall = getMarkerOverallState(marker);
    const wrapEl = document.getElementById('marker-wrap-' + marker.id);
    const timerEl = document.getElementById('timer-' + marker.id);
    const nameEl = document.getElementById('badge-name-' + marker.id);

    if (nameEl) nameEl.textContent = marker.name;

    if (timerEl) {
      if (overall.isDone) {
        timerEl.textContent = overall.totalCount > 1 ? '✓ ครบ (' + overall.totalCount + ')' : '✓ ครบเวลา';
      } else {
        if (overall.totalCount > 1) {
          timerEl.textContent = formatTime(overall.minRemaining) + ' (' + overall.doneCount + '/' + overall.totalCount + ')';
        } else {
          timerEl.textContent = formatTime(overall.minRemaining);
        }
      }
    }

    if (wrapEl) {
      if (overall.isDone) {
        wrapEl.classList.remove('state-counting');
        wrapEl.classList.add('state-done');
      } else {
        wrapEl.classList.remove('state-done');
        wrapEl.classList.add('state-counting');
      }
    }
  }

  function renderMarker(marker) {
    const icon = createMarkerIcon(marker);
    const lMarker = L.marker([marker.lat, marker.lng], { icon: icon }).addTo(map);

    lMarker.bindPopup(getPopupHtml(marker));

    lMarker.on('popupopen', function () {
      lMarker.setPopupContent(getPopupHtml(marker));

      const delBtn = document.getElementById('del-btn-' + marker.id);
      if (delBtn) {
        delBtn.onclick = function () {
          removeMarker(marker.id);
        };
      }

      const editBtn = document.getElementById('edit-btn-' + marker.id);
      if (editBtn) {
        editBtn.onclick = function () {
          lMarker.closePopup();
          openEditModal(marker);
        };
      }
    });

    leafletMarkers[marker.id] = lMarker;
  }

  function removeMarker(id) {
    if (leafletMarkers[id]) {
      map.removeLayer(leafletMarkers[id]);
      delete leafletMarkers[id];
    }
    markersData = markersData.filter(function (m) {
      return m.id !== id;
    });
    syncToServer();
  }

  window.removeMarker = removeMarker;

  // ==========================================
  // Modal Dialog Form Management
  // ==========================================
  const modal = document.getElementById('marker-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const btnCancelMarker = document.getElementById('btn-cancel-marker');
  const btnSubmitMarker = document.getElementById('btn-create-marker');
  const markerForm = document.getElementById('marker-form');
  const markerNameInput = document.getElementById('marker-name');
  const timersContainer = document.getElementById('timers-container');
  const btnAddTimerRow = document.getElementById('btn-add-timer-row');

  let timerRowCounter = 0;

  function createTimerRowElement(label, durationSec) {
    timerRowCounter++;
    const rowId = 'tr_' + timerRowCounter;
    durationSec = durationSec || 300;
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;

    const row = document.createElement('div');
    row.className = 'timer-row-card';
    row.id = rowId;

    row.innerHTML =
      '<div class="timer-row-top">' +
        '<input type="text" class="timer-row-label-input" placeholder="ชื่อตัวนับเวลา (เช่น บอส, แร่)" value="' + escapeHtml(label || 'ตัวนับเวลา ' + timerRowCounter) + '" required maxlength="25">' +
        '<button type="button" class="timer-row-del-btn" title="ลบตัวนับนี้">&times;</button>' +
      '</div>' +
      '<div class="timer-row-bottom">' +
        '<div class="timer-time-box">' +
          '<input type="number" class="t-min" min="0" max="180" value="' + mins + '">' +
          '<span>น.</span>' +
          '<input type="number" class="t-sec" min="0" max="59" value="' + secs + '">' +
          '<span>วิ.</span>' +
        '</div>' +
        '<div class="timer-row-presets">' +
          '<button type="button" class="mini-preset-btn" data-sec="60">1น</button>' +
          '<button type="button" class="mini-preset-btn" data-sec="180">3น</button>' +
          '<button type="button" class="mini-preset-btn" data-sec="300">5น</button>' +
          '<button type="button" class="mini-preset-btn" data-sec="600">10น</button>' +
        '</div>' +
      '</div>';

    const delBtn = row.querySelector('.timer-row-del-btn');
    delBtn.onclick = function () {
      if (timersContainer.querySelectorAll('.timer-row-card').length > 1) {
        row.remove();
      }
    };

    const presetBtns = row.querySelectorAll('.mini-preset-btn');
    presetBtns.forEach(function (pb) {
      pb.onclick = function () {
        const secTotal = parseInt(pb.getAttribute('data-sec'), 10) || 300;
        row.querySelector('.t-min').value = Math.floor(secTotal / 60);
        row.querySelector('.t-sec').value = secTotal % 60;
      };
    });

    return row;
  }

  if (btnAddTimerRow) {
    btnAddTimerRow.addEventListener('click', function () {
      const count = timersContainer.querySelectorAll('.timer-row-card').length + 1;
      timersContainer.appendChild(createTimerRowElement('ตัวนับเวลา ' + count, 300));
    });
  }

  function openCreateModal(latlng) {
    editingMarkerId = null;
    pendingClickLatLng = latlng;
    if (modalTitle) modalTitle.textContent = '📍 เพิ่มจุดมาร์คใหม่';
    if (btnSubmitMarker) btnSubmitMarker.textContent = 'บันทึกและเริ่มนับเวลา';
    markerNameInput.value = '';

    timersContainer.innerHTML = '';
    timerRowCounter = 0;
    timersContainer.appendChild(createTimerRowElement('ตัวนับเวลา 1', 300));

    modal.classList.add('open');
    setTimeout(function () {
      markerNameInput.focus();
    }, 100);
  }

  function openEditModal(marker) {
    editingMarkerId = marker.id;
    pendingClickLatLng = null;
    if (modalTitle) modalTitle.textContent = '✏️ แก้ไขจุดมาร์ค';
    if (btnSubmitMarker) btnSubmitMarker.textContent = 'บันทึกการแก้ไข';

    markerNameInput.value = marker.name;

    timersContainer.innerHTML = '';
    timerRowCounter = 0;

    (marker.timers || []).forEach(function (t) {
      const rem = getTimerRemaining(t);
      const secToUse = rem > 0 ? rem : t.duration;
      timersContainer.appendChild(createTimerRowElement(t.label, secToUse));
    });

    if (timersContainer.children.length === 0) {
      timersContainer.appendChild(createTimerRowElement('ตัวนับเวลา 1', 300));
    }

    modal.classList.add('open');
    setTimeout(function () {
      markerNameInput.focus();
      markerNameInput.select();
    }, 100);
  }

  function closeModal() {
    modal.classList.remove('open');
    pendingClickLatLng = null;
    editingMarkerId = null;
  }

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
  if (btnCancelMarker) btnCancelMarker.addEventListener('click', closeModal);

  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  markerForm.addEventListener('submit', function (e) {
    e.preventDefault();

    const name = markerNameInput.value.trim() || 'จุดมาร์ค';
    const rowCards = timersContainer.querySelectorAll('.timer-row-card');
    const newTimers = [];

    rowCards.forEach(function (card, index) {
      const label = card.querySelector('.timer-row-label-input').value.trim() || ('ตัวนับเวลา ' + (index + 1));
      const mins = parseInt(card.querySelector('.t-min').value, 10) || 0;
      const secs = parseInt(card.querySelector('.t-sec').value, 10) || 0;
      const totalSec = Math.max(1, mins * 60 + secs);

      newTimers.push({
        id: 't_' + Date.now() + '_' + index,
        label: label,
        duration: totalSec,
        targetTime: Date.now() + totalSec * 1000
      });
    });

    if (newTimers.length === 0) {
      newTimers.push({
        id: 't_' + Date.now() + '_0',
        label: 'ตัวนับเวลา 1',
        duration: 300,
        targetTime: Date.now() + 300000
      });
    }

    if (editingMarkerId) {
      const marker = markersData.find(function (m) {
        return m.id === editingMarkerId;
      });

      if (marker) {
        marker.name = name;
        marker.timers = newTimers;
        syncToServer();

        if (leafletMarkers[marker.id]) {
          leafletMarkers[marker.id].setIcon(createMarkerIcon(marker));
          leafletMarkers[marker.id].setPopupContent(getPopupHtml(marker));
        }
      }
    } else {
      if (!pendingClickLatLng) return;

      const newMarker = {
        id: 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        name: name,
        lat: pendingClickLatLng.lat,
        lng: pendingClickLatLng.lng,
        timers: newTimers
      };

      markersData.push(newMarker);
      syncToServer();
      renderMarker(newMarker);
    }

    closeModal();
  });

  // Map Click to Add Marker
  map.on('click', function (e) {
    openCreateModal(e.latlng);
  });

  // Also support Right Click (Desktop) to place marker directly
  map.on('contextmenu', function (e) {
    openCreateModal(e.latlng);
  });

  // Initial load
  markersData = loadLocalMarkers();
  markersData.forEach(function (m) {
    renderMarker(m);
  });
  fetchServerMarkers();

  // Poll server every 2 seconds for real-time synchronization with friends
  setInterval(fetchServerMarkers, 2000);

  // Global Timer Tick (every 1 second)
  setInterval(function () {
    markersData.forEach(function (m) {
      updateMarkerVisual(m);

      // If popup is currently open for this marker, update timer numbers live
      (m.timers || []).forEach(function (t) {
        const pTimerEl = document.getElementById('ptimer-' + m.id + '-' + t.id);
        if (pTimerEl) {
          const rem = getTimerRemaining(t);
          pTimerEl.textContent = rem <= 0 ? '✓ ครบแล้ว' : formatTime(rem);
          if (rem <= 0) {
            pTimerEl.className = 'timer-item-time done';
          } else {
            pTimerEl.className = 'timer-item-time counting';
          }
        }
      });
    });
  }, 1000);
})();
