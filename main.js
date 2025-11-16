// main.js

// Базовый адрес API (Node-сервер)
const API_BASE =
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5050/api'
    : '/api';

let map;
let markersLayer;
let routeLayer; // слой для дуг маршрутов

let allOrders = [];      // все заявки
let filteredOrders = []; // отфильтрованные заявки

let editingOrderId = null;

// Админ и токен
let isAdmin = false;
let adminToken = null;

// Временные точки при создании заявки
let currentLoadPoint = null;   // { lat, lon } — точка ЗАГРУЗКИ
let currentUnloadPoint = null; // { lat, lon } — точка ВЫГРУЗКИ
let tempLoadMarker = null;
let tempUnloadMarker = null;

document.addEventListener('DOMContentLoaded', () => {
    // наша текущая Leaflet-карта
    initMap();
    setupUi();
    loadOrders();

    // если скрипт Яндекса загрузился — ждём готовности инициализации
    if (window.ymaps) {
        ymaps.ready(initYandexMap);
    }
});



// ======================= АДМИН-АВТОРИЗАЦИЯ =======================

function getAuthHeaders(extra = {}) {
  const headers = { ...extra };
  if (adminToken) {
    headers['Authorization'] = `Bearer ${adminToken}`;
  }
  return headers;
}

function restoreAdminFromStorage() {
  const token = localStorage.getItem('adminToken');
  if (!token) return;
  adminToken = token;
  isAdmin = true;
  updateAdminUi();
}

function updateAdminUi() {
  // секция "Добавить заявку"
  const addOrderSection = document.querySelector('.add-order');
  if (addOrderSection) {
    if (isAdmin) {
      addOrderSection.classList.remove('hidden');
    } else {
      addOrderSection.classList.add('hidden');
    }
  }

  // кнопка "Свернуть форму"
  const toggleFormBtn = document.getElementById('toggleForm');
  if (toggleFormBtn) {
    toggleFormBtn.style.display = isAdmin ? '' : 'none';
  }

  // заголовок последней колонки
  const thead = document.querySelector('#ordersTable thead');
  if (thead) {
    const lastTh = thead.querySelector('tr th:last-child');
    if (lastTh) {
      lastTh.textContent = isAdmin ? 'Действия' : '';
    }
  }

  // кнопка входа/выхода
  const adminBtn = document.getElementById('adminLoginBtn');
  if (adminBtn) {
    adminBtn.textContent = isAdmin ? 'Выйти (админ)' : 'Войти как админ';
  }

  refreshMapSize();
}

async function onAdminButtonClick() {
  // если уже админ — выходим
  if (isAdmin) {
    adminToken = null;
    isAdmin = false;
    localStorage.removeItem('adminToken');
    updateAdminUi();
    alert('Вы вышли из режима администратора.');
    return;
  }

  const password = prompt('Введите пароль администратора:');
  if (!password) return;

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.message || 'Неверный пароль.');
      return;
    }

    adminToken = data.token;
    isAdmin = true;
    localStorage.setItem('adminToken', adminToken);
    updateAdminUi();
    alert('Вы вошли как администратор.');
  } catch (err) {
    console.error(err);
    alert('Ошибка при входе. См. консоль.');
  }
}


// ======================= КАРТА =======================

function initMap() {
  map = L.map('map').setView([48.7, 44.5], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);

  // клики по карте — выбор точек загрузки/выгрузки
  map.on('click', onMapClickForNewOrder);

  setTimeout(() => map.invalidateSize(), 300);
}

function onMapClickForNewOrder(e) {
  if (!isAdmin) return; // только админ создаёт заявки

  const { lat, lng } = e.latlng;
  const latStr = lat.toFixed(6);
  const lonStr = lng.toFixed(6);

  const latInput = document.getElementById('latInput');
  const lonInput = document.getElementById('lonInput');

  // 1-й клик — ЗАГРУЗКА, 2-й и дальше — ВЫГРУЗКА
  if (!currentLoadPoint) {
    currentLoadPoint = { lat, lon: lng };

    if (latInput) latInput.value = latStr;
    if (lonInput) lonInput.value = lonStr;

    // маркер точки загрузки
    if (tempLoadMarker) {
      map.removeLayer(tempLoadMarker);
    }
    tempLoadMarker = L.marker([lat, lng]).addTo(map);
  } else {
    currentUnloadPoint = { lat, lon: lng };

    // маркер точки выгрузки (кружок)
    if (tempUnloadMarker) {
      map.removeLayer(tempUnloadMarker);
    }
    tempUnloadMarker = L.circleMarker([lat, lng], {
      radius: 6,
      color: '#ff6600',
      fillColor: '#ff6600',
      fillOpacity: 0.9,
    }).addTo(map);
  }
}

function refreshMapSize() {
  if (!map) return;
  setTimeout(() => {
    map.invalidateSize();
  }, 200);
}


// ======================= UI =======================

function setupUi() {
  const applyFilterBtn   = document.getElementById('applyFilter');
  const resetFilterBtn   = document.getElementById('resetFilter');
  const toggleSidebarBtn = document.getElementById('toggleSidebar');
  const toggleFormBtn    = document.getElementById('toggleForm');
  const downloadCsvBtn   = document.getElementById('downloadCsvBtn');
  const addOrderForm     = document.getElementById('addOrderForm');
  const editOrderForm    = document.getElementById('editOrderForm');
  const editCancelBtn    = document.getElementById('editCancelBtn');

  if (applyFilterBtn) {
    applyFilterBtn.addEventListener('click', () => {
      applyCurrentFilterAndRender();
    });
  }

  if (resetFilterBtn) {
    resetFilterBtn.addEventListener('click', () => {
      const cargoFilter = document.getElementById('cargoFilter');
      const minPrice    = document.getElementById('minPrice');
      if (cargoFilter) cargoFilter.value = '';
      if (minPrice)    minPrice.value    = '';
      applyCurrentFilterAndRender();
    });
  }

  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      if (!sidebar) return;
      sidebar.classList.toggle('hidden');
      toggleSidebarBtn.textContent = sidebar.classList.contains('hidden')
        ? 'Показать список заявок'
        : 'Свернуть список заявок';

      refreshMapSize();
    });
  }

  if (toggleFormBtn) {
    toggleFormBtn.addEventListener('click', () => {
      const addOrderSection = document.querySelector('.add-order');
      if (!addOrderSection) return;
      addOrderSection.classList.toggle('hidden');
      toggleFormBtn.textContent = addOrderSection.classList.contains('hidden')
        ? 'Показать форму'
        : 'Свернуть форму';

      refreshMapSize();
    });
  }

  if (downloadCsvBtn) {
    downloadCsvBtn.addEventListener('click', () => {
      const data = (filteredOrders && filteredOrders.length)
        ? filteredOrders
        : allOrders;
      downloadCsv(data);
    });
  }

  if (addOrderForm) {
    addOrderForm.addEventListener('submit', onAddOrderSubmit);
  }

  if (editOrderForm) {
    editOrderForm.addEventListener('submit', onEditOrderSubmit);
  }

  if (editCancelBtn) {
    editCancelBtn.addEventListener('click', closeEditModal);
  }

  setupAdminButton();
  updateAdminUi();
}

function setupAdminButton() {
  const stats = document.querySelector('.header-stats');
  if (!stats) return;

  let btn = document.getElementById('adminLoginBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'adminLoginBtn';
    btn.className = 'btn btn-ghost small';
    stats.appendChild(btn);
  }

  btn.textContent = isAdmin ? 'Выйти (админ)' : 'Войти как админ';
  btn.addEventListener('click', onAdminButtonClick);
}


// ======================= ЗАГРУЗКА ЗАЯВОК =======================

async function loadOrders() {
  try {
    const res = await fetch(`${API_BASE}/orders`);

    if (!res.ok) {
      throw new Error('Server error: ' + res.status);
    }

    const data = await res.json();

    allOrders = data || [];
    updateTotalOrdersCounter(allOrders.length);
    applyCurrentFilterAndRender();
  } catch (err) {
    console.error(err);
    alert('Не удалось загрузить заявки с сервера.');
  }
}

function updateTotalOrdersCounter(total) {
  const el = document.getElementById('totalOrders');
  if (el) {
    el.textContent = total;
  }
}


// ======================= ФИЛЬТР + ОТРИСОВКА =======================

function applyCurrentFilterAndRender() {
  const cargoFilterEl = document.getElementById('cargoFilter');
  const minPriceEl    = document.getElementById('minPrice');

  const cargoFilter = cargoFilterEl ? cargoFilterEl.value.trim() : '';
  const minPrice    = minPriceEl ? Number(minPriceEl.value) || 0 : 0;

  filteredOrders = allOrders.filter(order => {
    if (cargoFilter && order.cargo !== cargoFilter) return false;
    if (minPrice && Number(order.pricePerTon || 0) < minPrice) return false;
    return true;
  });

  renderOrdersTable(filteredOrders);
  renderMarkers(filteredOrders);
}

function renderOrdersTable(orders) {
  const tbody = document.querySelector('#ordersTable tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  orders.forEach((order, index) => {
    const tr = document.createElement('tr');

    const tdId    = document.createElement('td');
    const tdCargo = document.createElement('td');
    const tdPrice = document.createElement('td');
    const tdFrom  = document.createElement('td');
    const tdTo    = document.createElement('td');
    const tdAct   = document.createElement('td');

    tdId.textContent    = index + 1;
    tdCargo.textContent = order.cargo || '';
    tdPrice.textContent = order.pricePerTon != null ? order.pricePerTon : '';
    tdFrom.textContent  = order.from || '';
    tdTo.textContent    = order.to || '';

    if (isAdmin) {
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Редактировать';
      editBtn.className = 'edit-btn';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(order);
      });

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Удалить';
      delBtn.className = 'delete-btn';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteOrder(order._id);
      });

      tdAct.appendChild(editBtn);
      tdAct.appendChild(delBtn);
    } else {
      tdAct.textContent = '—';
    }

    tr.appendChild(tdId);
    tr.appendChild(tdCargo);
    tr.appendChild(tdPrice);
    tr.appendChild(tdFrom);
    tr.appendChild(tdTo);
    tr.appendChild(tdAct);

    // Клик по строке — центрируемся и рисуем дугу
    tr.addEventListener('click', () => {
      if (order.lat != null && order.lon != null) {
        map.setView([order.lat, order.lon], 7);
      }
      drawOrderRoute(order);
    });

    tbody.appendChild(tr);
  });
}

function renderMarkers(orders) {
  if (!markersLayer) return;
  markersLayer.clearLayers();

  orders.forEach(order => {
    if (order.lat == null || order.lon == null) return;
    const marker = L.marker([order.lat, order.lon]);

    const popupHtml = `
      <b>${order.cargo || 'Груз'}</b><br>
      Загрузка: ${order.from || '-'}<br>
      Выгрузка: ${order.to || '-'}<br>
      Цена: ${order.pricePerTon != null ? order.pricePerTon + ' ₽/т' : '-'}<br>
      Расстояние: ${order.distanceKm != null ? order.distanceKm + ' км' : '-'}
    `;

    marker.bindPopup(popupHtml);

    // 👉 Новое: при клике по маркеру рисуем маршрут этой заявки
    marker.on('click', () => {
      drawOrderRoute(order);        // дуга
      // можно чуть приблизить:
      // map.setView([order.lat, order.lon], 7);
    });

    marker.addTo(markersLayer);
  });
}


// ======================= ДУГА МЕЖДУ ЗАГРУЗКОЙ И ВЫГРУЗКОЙ =======================

function drawOrderRoute(order) {
  if (!routeLayer) return;
  routeLayer.clearLayers();

  if (
    order.lat == null ||
    order.lon == null ||
    order.unloadLat == null ||
    order.unloadLon == null
  ) {
    return; // нет данных о выгрузке
  }

  const points = buildArcPoints(
    order.lat,
    order.lon,
    order.unloadLat,
    order.unloadLon
  );

  const polyline = L.polyline(points, {
    color: '#ff6600',
    weight: 3,
    opacity: 0.9,
  });

  polyline.addTo(routeLayer);

  // маркер точки выгрузки
  const unloadPoint = L.circleMarker(
    [order.unloadLat, order.unloadLon],
    {
      radius: 6,
      color: '#ff6600',
      fillColor: '#ff6600',
      fillOpacity: 0.9,
    }
  );
  unloadPoint.addTo(routeLayer);
}

function buildArcPoints(lat1, lon1, lat2, lon2) {
  const points = [];

  const x1 = lon1;
  const y1 = lat1;
  const x2 = lon2;
  const y2 = lat2;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy) || 0.000001;

  // перпендикуляр к отрезку A-B
  const nx = -dy / dist;
  const ny = dx / dist;

  // коэффициент "кривизны"
  const k = 0.3;
  const offset = dist * k;

  const cx = (x1 + x2) / 2 + nx * offset;
  const cy = (y1 + y2) / 2 + ny * offset;

  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const xt =
      (1 - t) * (1 - t) * x1 +
      2 * (1 - t) * t * cx +
      t * t * x2;
    const yt =
      (1 - t) * (1 - t) * y1 +
      2 * (1 - t) * t * cy +
      t * t * y2;

    points.push([yt, xt]); // lat, lon
  }

  return points;
}


// ======================= ДОБАВЛЕНИЕ ЗАЯВКИ =======================

async function onAddOrderSubmit(e) {
  e.preventDefault();

  if (!isAdmin) {
    alert('Добавлять заявки может только администратор.');
    return;
  }

  const fromInput      = document.getElementById('fromInput');
  const toInput        = document.getElementById('toInput');
  const cargoInput     = document.getElementById('cargoInput');
  const priceInput     = document.getElementById('priceInput');
  const distanceInput  = document.getElementById('distanceInput');
  const latInput       = document.getElementById('latInput');
  const lonInput       = document.getElementById('lonInput');

  const from      = fromInput?.value.trim() || '';
  const to        = toInput?.value.trim() || '';
  const cargo     = cargoInput?.value.trim() || '';
  const price     = Number(priceInput?.value) || 0;
  const distance  = distanceInput?.value ? Number(distanceInput.value) : null;

  if (!from || !to || !cargo || !price) {
    alert('Заполните поля "Загрузка", "Выгрузка", "Груз" и "Цена".');
    return;
  }

  if (!currentLoadPoint || !currentUnloadPoint) {
    alert('Нужно кликнуть по карте точку ЗАГРУЗКИ (первый клик) и ВЫГРУЗКИ (второй клик).');
    return;
  }

  const loadLat = currentLoadPoint.lat;
  const loadLon = currentLoadPoint.lon;
  const unloadLat = currentUnloadPoint.lat;
  const unloadLon = currentUnloadPoint.lon;

  if (
    loadLat == null || loadLon == null ||
    unloadLat == null || unloadLon == null
  ) {
    alert('Координаты загрузки и выгрузки заданы некорректно.');
    return;
  }

  const newOrder = {
    from,
    to,
    cargo,
    pricePerTon: price,
    distanceKm: distance,
    lat: loadLat,
    lon: loadLon,
    unloadLat,
    unloadLon,
  };

  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(newOrder),
    });

    if (res.status === 401) {
      alert('Нет прав на добавление (нужен админ).');
      return;
    }

    if (!res.ok) {
      throw new Error('Failed to create order');
    }

    // очистка формы
    if (fromInput) fromInput.value = '';
    if (toInput) toInput.value = '';
    if (cargoInput) cargoInput.value = '';
    if (priceInput) priceInput.value = '';
    if (distanceInput) distanceInput.value = '';
    if (latInput) latInput.value = '';
    if (lonInput) lonInput.value = '';

    // сброс временных точек и маркеров
    currentLoadPoint = null;
    currentUnloadPoint = null;
    if (tempLoadMarker) {
      map.removeLayer(tempLoadMarker);
      tempLoadMarker = null;
    }
    if (tempUnloadMarker) {
      map.removeLayer(tempUnloadMarker);
      tempUnloadMarker = null;
    }

    await loadOrders();
  } catch (err) {
    console.error(err);
    alert('Не удалось добавить заявку.');
  }
}


// ======================= УДАЛЕНИЕ ЗАЯВКИ =======================

async function deleteOrder(id) {
  if (!isAdmin) {
    alert('Удалять заявки может только администратор.');
    return;
  }
  if (!id) return;
  const ok = confirm('Удалить заявку?');
  if (!ok) return;

  try {
    const res = await fetch(`${API_BASE}/orders/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (res.status === 401) {
      alert('Нет прав на удаление (нужен админ).');
      return;
    }
    if (!res.ok) {
      throw new Error('Failed to delete');
    }
    await loadOrders();
  } catch (err) {
    console.error(err);
    alert('Не удалось удалить заявку.');
  }
}


// ======================= РЕДАКТИРОВАНИЕ ЗАЯВКИ =======================

function openEditModal(order) {
  editingOrderId = order._id;

  document.getElementById('editFromInput').value     = order.from || '';
  document.getElementById('editToInput').value       = order.to || '';
  document.getElementById('editCargoInput').value    = order.cargo || '';
  document.getElementById('editPriceInput').value    =
    order.pricePerTon != null ? order.pricePerTon : '';
  document.getElementById('editDistanceInput').value =
    order.distanceKm != null ? order.distanceKm : '';

  const modal = document.getElementById('editModal');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

function closeEditModal() {
  const modal = document.getElementById('editModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  editingOrderId = null;
}

async function onEditOrderSubmit(e) {
  e.preventDefault();
  if (!editingOrderId) return;

  if (!isAdmin) {
    alert('Редактировать заявки может только администратор.');
    return;
  }

  const fromInput     = document.getElementById('editFromInput');
  const toInput       = document.getElementById('editToInput');
  const cargoInput    = document.getElementById('editCargoInput');
  const priceInput    = document.getElementById('editPriceInput');
  const distanceInput = document.getElementById('editDistanceInput');

  const from     = fromInput.value.trim();
  const to       = toInput.value.trim();
  const cargo    = cargoInput.value.trim();
  const price    = Number(priceInput.value) || 0;
  const distance = distanceInput.value ? Number(distanceInput.value) : null;

  if (!from || !to || !cargo || !price) {
    alert('Заполните поля "Загрузка", "Выгрузка", "Груз" и "Цена".');
    return;
  }

  const updated = {
    from,
    to,
    cargo,
    pricePerTon: price,
    distanceKm: distance,
    // координаты загрузки/выгрузки не трогаем — остаются прежними
  };

  try {
    const res = await fetch(`${API_BASE}/orders/${editingOrderId}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(updated),
    });
    if (res.status === 401) {
      alert('Нет прав на редактирование (нужен админ).');
      return;
    }
    if (!res.ok) {
      throw new Error('Failed to update');
    }
    closeEditModal();
    await loadOrders();
  } catch (err) {
    console.error(err);
    alert('Не удалось сохранить изменения.');
  }
}


// ======================= ВЫГРУЗКА В CSV =======================

function downloadCsv(orders) {
  if (!orders || !orders.length) {
    alert('Нет данных для выгрузки.');
    return;
  }

  const header = [
    'ID',
    'Груз',
    'Цена_Р_т',
    'Загрузка',
    'Выгрузка',
    'Расстояние_км',
    'Широта_загрузки',
    'Долгота_загрузки',
  ];

  const rows = orders.map((o, index) => [
    index + 1,
    o.cargo || '',
    o.pricePerTon != null ? o.pricePerTon : '',
    (o.from || '').replace(/;/g, ','),
    (o.to || '').replace(/;/g, ','),
    o.distanceKm != null ? o.distanceKm : '',
    o.lat != null ? o.lat : '',
    o.lon != null ? o.lon : '',
  ]);

  const csvLines = [
    header.join(';'),
    ...rows.map(r => r.join(';')),
  ];

  const csvContent = csvLines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
// ======================= ЯНДЕКС-КАРТА (первый тест) =======================

let yaMap; // объект карты Яндекс

function initYandexMap() {
    // Создаём карту в контейнере #yamap
    yaMap = new ymaps.Map('yamap', {
        center: [48.7, 44.5], // центр карты (пока такой же, как у Leaflet)
        zoom: 6,
        controls: ['zoomControl', 'typeSelector']
    });

    // Тестовая метка, чтобы убедиться, что всё работает
    const placemark = new ymaps.Placemark(
        [48.7, 44.5],
        {
            balloonContent: 'Яндекс-карта подключена ✅'
        },
        {
            preset: 'islands#blueCircleDotIcon'
        }
    );

    yaMap.geoObjects.add(placemark);
}
