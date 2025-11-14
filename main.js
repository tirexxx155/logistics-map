// ====== НАСТРОЙКИ API ======
const API_BASE = 'http://localhost:5050/api';

// ====== СОЗДАНИЕ КАРТЫ ======
const map = L.map('map').setView([50.5, 40.0], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// ====== ГЛОБАЛЬНОЕ СОСТОЯНИЕ ======
let orders = [];          // заявки с сервера
let currentMarkers = [];  // маркеры на карте
let markersById = {};     // id → маркер
let editingOrderId = null;

// ====== НОРМАЛИЗАЦИЯ ЗАЯВКИ ======
function normalizeOrder(o) {
    return {
        id: o._id, // Mongo ObjectId
        lat: o.lat,
        lon: o.lon,
        from: o.from,
        to: o.to,
        cargo: o.cargo,
        pricePerTon: o.pricePerTon,
        distanceKm: o.distanceKm
    };
}

// ====== API-ФУНКЦИИ ======

async function fetchOrdersFromServer() {
    const resp = await fetch(`${API_BASE}/orders`);
    if (!resp.ok) {
        throw new Error('Не удалось загрузить заявки с сервера');
    }
    const data = await resp.json();
    return data.map(normalizeOrder);
}

async function createOrderOnServer(orderData) {
    const resp = await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(orderData)
    });
    if (!resp.ok) {
        throw new Error('Ошибка при добавлении заявки на сервер');
    }
    const created = await resp.json();
    return normalizeOrder(created);
}

async function deleteOrderOnServer(id) {
    const resp = await fetch(`${API_BASE}/orders/${id}`, {
        method: 'DELETE'
    });
    if (!resp.ok) {
        throw new Error('Ошибка при удалении заявки на сервере');
    }
    return resp.json();
}

async function updateOrderOnServer(id, updatedData) {
    const resp = await fetch(`${API_BASE}/orders/${id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatedData)
    });
    if (!resp.ok) {
        throw new Error('Ошибка при обновлении заявки на сервере');
    }
    const updated = await resp.json();
    return normalizeOrder(updated);
}

// ====== ОТРИСОВКА ======

function renderMarkers(list) {
    currentMarkers.forEach(m => map.removeLayer(m));
    currentMarkers = [];
    markersById = {};

    list.forEach(order => {
        const marker = L.marker([order.lat, order.lon]).addTo(map);

        const popupHtml = `
            <b>${order.cargo}</b><br>
            Тариф: <b>${order.pricePerTon} ₽/т</b><br>
            Расстояние: ${order.distanceKm} км<br>
            Откуда: ${order.from}<br>
            Куда: ${order.to}
        `;

        marker.bindPopup(popupHtml);
        currentMarkers.push(marker);
        markersById[order.id] = marker;
    });
}

function renderTable(list) {
    const tbody = document.querySelector('#ordersTable tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    list.forEach(order => {
        const tr = document.createElement('tr');
        tr.dataset.id = order.id;

        tr.innerHTML = `
            <td>${order.id}</td>
            <td>${order.cargo}</td>
            <td>${order.pricePerTon}</td>
            <td>${order.from}</td>
            <td>${order.to}</td>
            <td>
                <button class="edit-btn" data-id="${order.id}">Редактировать</button>
                <button class="delete-btn" data-id="${order.id}">Удалить</button>
            </td>
        `;

        tbody.appendChild(tr);
    });
}

function renderAll(list) {
    renderMarkers(list);
    renderTable(list);
}

// ====== ФИЛЬТРЫ ======

const cargoFilter = document.getElementById('cargoFilter');
const minPriceInput = document.getElementById('minPrice');
const applyBtn = document.getElementById('applyFilter');
const resetBtn = document.getElementById('resetFilter');

function getFilteredOrders() {
    const cargo = cargoFilter.value;
    const minPrice = Number(minPriceInput.value) || 0;

    return orders.filter(o => {
        const cargoOk = !cargo || o.cargo === cargo;
        const priceOk = o.pricePerTon >= minPrice;
        return cargoOk && priceOk;
    });
}

function applyFilter() {
    const filtered = getFilteredOrders();
    renderAll(filtered);
}

applyBtn.addEventListener('click', applyFilter);

resetBtn.addEventListener('click', () => {
    cargoFilter.value = "";
    minPriceInput.value = "";
    renderAll(orders);
});

// ====== ТАБЛИЦА: КЛИКИ ======

const tableBody = document.querySelector('#ordersTable tbody');

tableBody.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        const ok = confirm(`Удалить заявку #${id}?`);
        if (!ok) return;

        try {
            await deleteOrderOnServer(id);
            orders = orders.filter(o => o.id !== id);

            const isFilterActive = cargoFilter.value || Number(minPriceInput.value);
            if (isFilterActive) {
                applyFilter();
            } else {
                renderAll(orders);
            }
        } catch (err) {
            console.error(err);
            alert('Не удалось удалить заявку. См. консоль.');
        }
        return;
    }

    const editBtn = e.target.closest('.edit-btn');
    if (editBtn) {
        const id = editBtn.dataset.id;
        const order = orders.find(o => o.id === id);
        if (order) {
            openEditModal(order);
        }
        return;
    }

    const tr = e.target.closest('tr');
    if (!tr) return;

    const id = tr.dataset.id;
    const marker = markersById[id];
    if (!marker) return;

    const latLng = marker.getLatLng();
    map.setView(latLng, 7);
    marker.openPopup();
});

// ====== ФОРМА ДОБАВЛЕНИЯ ======

const fromInput = document.getElementById('fromInput');
const toInput = document.getElementById('toInput');
const cargoInput = document.getElementById('cargoInput');
const priceInput = document.getElementById('priceInput');
const distanceInput = document.getElementById('distanceInput');
const latInput = document.getElementById('latInput');
const lonInput = document.getElementById('lonInput');
const addForm = document.getElementById('addOrderForm');

map.on('click', (e) => {
    latInput.value = e.latlng.lat.toFixed(5);
    lonInput.value = e.latlng.lng.toFixed(5);
});

addForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const lat = parseFloat(latInput.value);
    const lon = parseFloat(lonInput.value);
    const from = fromInput.value.trim();
    const to = toInput.value.trim();
    const cargo = cargoInput.value;
    const price = Number(priceInput.value);
    const distance = Number(distanceInput.value) || 0;

    if (isNaN(lat) || isNaN(lon)) {
        alert('Сначала кликните по карте, чтобы выбрать координаты.');
        return;
    }
    if (!from || !to || !cargo || !price) {
        alert('Заполните поля: Откуда, Куда, Груз, Цена.');
        return;
    }

    const newOrderData = {
        lat,
        lon,
        from,
        to,
        cargo,
        pricePerTon: price,
        distanceKm: distance
    };

    try {
        const created = await createOrderOnServer(newOrderData);
        orders.push(created);

        const isFilterActive = cargoFilter.value || Number(minPriceInput.value);
        if (isFilterActive) {
            applyFilter();
        } else {
            renderAll(orders);
        }

        fromInput.value = '';
        toInput.value = '';
        cargoInput.value = '';
        priceInput.value = '';
        distanceInput.value = '';
    } catch (err) {
        console.error(err);
        alert('Не удалось добавить заявку. См. консоль.');
    }
});

// ====== МОДАЛКА РЕДАКТИРОВАНИЯ ======

const editModal = document.getElementById('editModal');
const editForm = document.getElementById('editOrderForm');
const editFromInput = document.getElementById('editFromInput');
const editToInput = document.getElementById('editToInput');
const editCargoInput = document.getElementById('editCargoInput');
const editPriceInput = document.getElementById('editPriceInput');
const editDistanceInput = document.getElementById('editDistanceInput');
const editCancelBtn = document.getElementById('editCancelBtn');

function openEditModal(order) {
    editingOrderId = order.id;
    editFromInput.value = order.from || '';
    editToInput.value = order.to || '';
    editCargoInput.value = order.cargo || '';
    editPriceInput.value = order.pricePerTon ?? '';
    editDistanceInput.value = order.distanceKm ?? '';

    editModal.classList.remove('hidden');
}

function closeEditModal() {
    editingOrderId = null;
    editModal.classList.add('hidden');
}

editCancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    closeEditModal();
});

editForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!editingOrderId) {
        closeEditModal();
        return;
    }

    const from = editFromInput.value.trim();
    const to = editToInput.value.trim();
    const cargo = editCargoInput.value;
    const price = Number(editPriceInput.value);
    const distance = Number(editDistanceInput.value) || 0;

    if (!from || !to || !cargo || !price) {
        alert('Заполните поля: Откуда, Куда, Груз, Цена.');
        return;
    }

    const original = orders.find(o => o.id === editingOrderId);
    if (!original) {
        alert('Не найдена исходная заявка.');
        closeEditModal();
        return;
    }

    const updatedData = {
        lat: original.lat,
        lon: original.lon,
        from,
        to,
        cargo,
        pricePerTon: price,
        distanceKm: distance
    };

    try {
        const updated = await updateOrderOnServer(editingOrderId, updatedData);
        orders = orders.map(o => o.id === editingOrderId ? updated : o);

        const isFilterActive = cargoFilter.value || Number(minPriceInput.value);
        if (isFilterActive) {
            applyFilter();
        } else {
            renderAll(orders);
        }

        closeEditModal();
    } catch (err) {
        console.error(err);
        alert('Не удалось обновить заявку. См. консоль.');
    }
});

// ====== ВЫГРУЗКА В CSV ======

const downloadCsvBtn = document.getElementById('downloadCsvBtn');

function ordersToCsv(list) {
    const header = [
        'id',
        'lat',
        'lon',
        'from',
        'to',
        'cargo',
        'pricePerTon',
        'distanceKm'
    ];

    const rows = list.map(o => {
        const from = (`${o.from || ''}`).replace(/"/g, '""');
        const to = (`${o.to || ''}`).replace(/"/g, '""');
        const cargo = (`${o.cargo || ''}`).replace(/"/g, '""');

        return [
            o.id,
            o.lat,
            o.lon,
            `"${from}"`,
            `"${to}"`,
            `"${cargo}"`,
            o.pricePerTon,
            o.distanceKm
        ].join(';');
    });

    return '\uFEFF' + header.join(';') + '\n' + rows.join('\n');
}

if (downloadCsvBtn) {
    downloadCsvBtn.addEventListener('click', () => {
        const csvStr = ordersToCsv(orders);
        const blob = new Blob([csvStr], {
            type: 'text/csv;charset=utf-8;'
        });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `orders_${dateStr}.csv`;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}

// ====== СВЁРТКА ПАНЕЛЕЙ ======

const sidebar = document.getElementById('sidebar');
const addOrderBlock = document.querySelector('.add-order');
const toggleSidebarBtn = document.getElementById('toggleSidebar');
const toggleFormBtn = document.getElementById('toggleForm');

function refreshMapSize() {
    setTimeout(() => {
        map.invalidateSize();
    }, 200);
}

toggleSidebarBtn.addEventListener('click', () => {
    const hidden = sidebar.classList.toggle('hidden');
    toggleSidebarBtn.textContent = hidden
        ? 'Показать список заявок'
        : 'Свернуть список заявок';

    refreshMapSize();
});

toggleFormBtn.addEventListener('click', () => {
    const hidden = addOrderBlock.classList.toggle('hidden');
    toggleFormBtn.textContent = hidden
        ? 'Показать форму'
        : 'Свернуть форму';

    refreshMapSize();
});

// ====== ИНИЦИАЛИЗАЦИЯ ======

async function init() {
    try {
        orders = await fetchOrdersFromServer();
        renderAll(orders);
    } catch (err) {
        console.error(err);
        alert('Не удалось загрузить заявки с сервера. См. консоль.');
    }
}

init();
