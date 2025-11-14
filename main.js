// Базовый адрес API (Node-сервер)
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:5050/api'
  : '/api';


let map;
let markersLayer;

let allOrders = [];      // все заявки с сервера
let filteredOrders = []; // заявки после фильтра

let editingOrderId = null; // id заявки, которую редактируем

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupUi();
    loadOrders();
});


// ======================= ИНИЦИАЛИЗАЦИЯ КАРТЫ =======================

function initMap() {
    // Стартовый центр — можно подправить под свой регион
    map = L.map('map').setView([48.7, 44.5], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);

    // Клик по карте — подставляем координаты в форму
    map.on('click', e => {
        const latInput = document.getElementById('latInput');
        const lonInput = document.getElementById('lonInput');
        if (!latInput || !lonInput) return;
        latInput.value = e.latlng.lat.toFixed(6);
        lonInput.value = e.latlng.lng.toFixed(6);
    });
}


// ======================= НАСТРОЙКА UI =======================

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
}


// ======================= ЗАГРУЗКА С СЕРВЕРА =======================

async function loadOrders() {
    try {
        const res = await fetch(`${API_BASE}/orders`);
        if (!res.ok) {
            throw new Error('Server error: ' + res.status);
        }
        const data = await res.json();

        allOrders = data || [];
        // обновляем счётчик
        updateTotalOrdersCounter(allOrders.length);

        // применяем фильтр и отрисовываем
        applyCurrentFilterAndRender();
    } catch (err) {
        console.error(err);
        alert('Не удалось загрузить заявки с сервера. См. консоль.');
    }
}


// ======================= СЧЁТЧИК "ВСЕГО ЗАЯВОК" =======================

function updateTotalOrdersCounter(total) {
    const el = document.getElementById('totalOrders');
    if (el) {
        el.textContent = total;
    }
}


// ======================= ФИЛЬТР И ОТРИСОВКА =======================

function applyCurrentFilterAndRender() {
    const cargoFilterEl = document.getElementById('cargoFilter');
    const minPriceEl    = document.getElementById('minPrice');

    const cargoFilter = cargoFilterEl ? cargoFilterEl.value.trim() : '';
    const minPrice    = minPriceEl ? Number(minPriceEl.value) || 0 : 0;

    filteredOrders = allOrders.filter(order => {
        if (cargoFilter && order.cargo !== cargoFilter) {
            return false;
        }
        if (minPrice && Number(order.pricePerTon || 0) < minPrice) {
            return false;
        }
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

        // ID в таблице — просто порядковый номер
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

        // Кнопки "Редактировать" и "Удалить"
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

        tr.appendChild(tdId);
        tr.appendChild(tdCargo);
        tr.appendChild(tdPrice);
        tr.appendChild(tdFrom);
        tr.appendChild(tdTo);
        tr.appendChild(tdAct);

        // Клик по строке — перейти к точке на карте
        tr.addEventListener('click', () => {
            if (order.lat != null && order.lon != null) {
                map.setView([order.lat, order.lon], 8);
            }
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
            Откуда: ${order.from || '-'}<br>
            Куда: ${order.to || '-'}<br>
            Цена: ${order.pricePerTon != null ? order.pricePerTon + ' ₽/т' : '-'}<br>
            Расстояние: ${order.distanceKm != null ? order.distanceKm + ' км' : '-'}
        `;

        marker.bindPopup(popupHtml);
        marker.addTo(markersLayer);
    });
}


// ======================= ДОБАВЛЕНИЕ ЗАЯВКИ =======================

async function onAddOrderSubmit(e) {
    e.preventDefault();

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
    const lat       = latInput?.value ? Number(latInput.value) : null;
    const lon       = lonInput?.value ? Number(lonInput.value) : null;

    if (!from || !to || !cargo || !price) {
        alert('Заполните поля "Откуда", "Куда", "Груз" и "Цена".');
        return;
    }

    if (lat == null || lon == null) {
        alert('Нужно кликнуть по карте, чтобы задать координаты.');
        return;
    }

    const newOrder = {
        from,
        to,
        cargo,
        pricePerTon: price,
        distanceKm: distance,
        lat,
        lon
    };

    try {
        console.log('Отправляем новую заявку на сервер:', newOrder);

        const res = await fetch(`${API_BASE}/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newOrder)
        });

        if (!res.ok) {
            const errorText = await res.text(); // читаем текст ошибки с сервера
            console.error('Ответ сервера при создании заявки:', res.status, errorText);
            throw new Error(errorText || `Failed to create order, status ${res.status}`);
        }

        // Если нужно, можно прочитать созданную заявку:
        // const created = await res.json();
        // console.log('Созданная заявка с сервера:', created);

        // очищаем форму
        fromInput.value = '';
        toInput.value = '';
        cargoInput.value = '';
        priceInput.value = '';
        distanceInput.value = '';
        latInput.value = '';
        lonInput.value = '';

        await loadOrders();
    } catch (err) {
        console.error('Ошибка при добавлении заявки:', err);
        alert('Не удалось добавить заявку. Детали ошибки смотрите в консоли (F12 → Console).');
    }
}



// ======================= УДАЛЕНИЕ ЗАЯВКИ =======================

async function deleteOrder(id) {
    if (!id) return;
    const ok = confirm('Удалить заявку?');
    if (!ok) return;

    try {
        const res = await fetch(`${API_BASE}/orders/${id}`, {
            method: 'DELETE'
        });
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
        alert('Заполните поля "Откуда", "Куда", "Груз" и "Цена".');
        return;
    }

    const updated = {
        from,
        to,
        cargo,
        pricePerTon: price,
        distanceKm: distance
    };

    try {
        const res = await fetch(`${API_BASE}/orders/${editingOrderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated)
        });
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
        'Откуда',
        'Куда',
        'Расстояние_км',
        'Широта',
        'Долгота'
    ];

    const rows = orders.map((o, index) => [
        index + 1,
        o.cargo || '',
        o.pricePerTon != null ? o.pricePerTon : '',
        (o.from || '').replace(/;/g, ','),
        (o.to || '').replace(/;/g, ','),
        o.distanceKm != null ? o.distanceKm : '',
        o.lat != null ? o.lat : '',
        o.lon != null ? o.lon : ''
    ]);

    const csvLines = [
        header.join(';'),
        ...rows.map(r => r.join(';'))
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
