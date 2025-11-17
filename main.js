// ======================== НАСТРОЙКА API ========================

// ЛОКАЛЬНО:
//   - фронт (VS Code Live Server) → http://127.0.0.1:5500
//   - сервер (Node/Express)      → http://localhost:5050
//
// ПРОД (Render):
//   - всё на одном домене, API = /api

let API_BASE;
if (
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
) {
  API_BASE = "http://localhost:5050/api";
} else {
  API_BASE = "/api";
}
console.log("API_BASE =", API_BASE);

// ======================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ========================

let map;                 // ymaps.Map
let markersLayer;        // ymaps.GeoObjectCollection
let currentRoute = null; // ymaps.multiRouter.MultiRoute или route

let allOrders = [];
let filteredOrders = [];

let editingOrderId = null;

// админ
let isAdmin = false;
let adminToken = null;

// ======================== СТАРТ ПРИ ЗАГРУЗКЕ ========================

document.addEventListener("DOMContentLoaded", () => {
  setupUi();
  initMap();
  restoreAdminState();
  loadOrders();
});

// ======================== ИНИЦИАЛИЗАЦИЯ КАРТЫ ========================

function initMap() {
  if (!window.ymaps) {
    console.error("Yandex Maps API не загружен");
    return;
  }

  ymaps.ready(() => {
    map = new ymaps.Map("map", {
      center: [48.7, 44.5],
      zoom: 6,
      controls: ["zoomControl", "typeSelector", "fullscreenControl"],
    });

    markersLayer = new ymaps.GeoObjectCollection();
    map.geoObjects.add(markersLayer);

    refreshMapSize();
  });
}

// Подстроить карту под размер контейнера
function refreshMapSize() {
  if (map && map.container && map.container.fitToViewport) {
    map.container.fitToViewport();
  }
}

window.addEventListener("resize", refreshMapSize);

// ======================== UI, КНОПКИ, ФОРМЫ ========================

function setupUi() {
  const applyFilterBtn   = document.getElementById("applyFilter");
  const resetFilterBtn   = document.getElementById("resetFilter");
  const toggleSidebarBtn = document.getElementById("toggleSidebar");
  const toggleFormBtn    = document.getElementById("toggleForm");
  const downloadCsvBtn   = document.getElementById("downloadCsvBtn");
  const addOrderForm     = document.getElementById("addOrderForm");
  const editOrderForm    = document.getElementById("editOrderForm");
  const editCancelBtn    = document.getElementById("editCancelBtn");
  const adminLoginBtn    = document.getElementById("adminLoginBtn");

  if (applyFilterBtn) {
    applyFilterBtn.addEventListener("click", applyCurrentFilterAndRender);
  }

  if (resetFilterBtn) {
    resetFilterBtn.addEventListener("click", () => {
      const cargoFilter = document.getElementById("cargoFilter");
      const minPrice    = document.getElementById("minPrice");
      if (cargoFilter) cargoFilter.value = "";
      if (minPrice)    minPrice.value    = "";
      applyCurrentFilterAndRender();
    });
  }

  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener("click", () => {
      const sidebar = document.getElementById("sidebar");
      if (!sidebar) return;
      sidebar.classList.toggle("hidden");
      toggleSidebarBtn.textContent = sidebar.classList.contains("hidden")
        ? "Показать список заявок"
        : "Свернуть список заявок";
      refreshMapSize();
    });
  }

  if (toggleFormBtn) {
    toggleFormBtn.addEventListener("click", () => {
      const addOrderSection = document.querySelector(".add-order");
      if (!addOrderSection) return;
      addOrderSection.classList.toggle("hidden");
      toggleFormBtn.textContent = addOrderSection.classList.contains("hidden")
        ? "Показать форму"
        : "Свернуть форму";
      refreshMapSize();
    });
  }

  if (downloadCsvBtn) {
    downloadCsvBtn.addEventListener("click", () => {
      const data =
        filteredOrders && filteredOrders.length ? filteredOrders : allOrders;
      downloadCsv(data);
    });
  }

  if (addOrderForm) {
    addOrderForm.addEventListener("submit", onAddOrderSubmit);
  }

  if (editOrderForm) {
    editOrderForm.addEventListener("submit", onEditOrderSubmit);
  }

  if (editCancelBtn) {
    editCancelBtn.addEventListener("click", closeEditModal);
  }

  if (adminLoginBtn) {
    adminLoginBtn.addEventListener("click", onAdminLoginClick);
  }
}

// ======================== АДМИН-РЕЖИМ ========================

function restoreAdminState() {
  const stored = localStorage.getItem("adminToken");
  if (stored) {
    adminToken = stored;
    isAdmin = true;
  }
  updateAdminUi();
}

function updateAdminUi() {
  const adminBtn        = document.getElementById("adminLoginBtn");
  const addOrderSection = document.querySelector(".add-order");
  const toggleFormBtn   = document.getElementById("toggleForm");
  const actionsHeader   = document.querySelector(
    "#ordersTable thead th:last-child"
  );

  if (adminBtn) {
    adminBtn.textContent = isAdmin
      ? "Выйти из админ режима"
      : "Войти как админ";
  }

  // форма добавления заявки
  if (addOrderSection) {
    addOrderSection.style.display = isAdmin ? "" : "none";
  }

  // кнопка "Свернуть форму"
  if (toggleFormBtn) {
    toggleFormBtn.style.display = isAdmin ? "" : "none";
  }

  // заголовок последнего столбца (Действия)
  if (actionsHeader) {
    actionsHeader.style.display = isAdmin ? "" : "none";
  }

  // последняя ячейка в каждой строке
  const rows = document.querySelectorAll("#ordersTable tbody tr");
  rows.forEach((tr) => {
    const lastTd = tr.querySelector("td:last-child");
    if (lastTd) {
      lastTd.style.display = isAdmin ? "" : "none";
    }
  });
}

async function onAdminLoginClick() {
  if (isAdmin) {
    // выходим
    isAdmin = false;
    adminToken = null;
    localStorage.removeItem("adminToken");
    updateAdminUi();
    applyCurrentFilterAndRender();
    return;
  }

  const password = prompt("Введите пароль администратора:");
  if (!password) return;

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      throw new Error("Неверный пароль");
    }

    const data = await res.json();
    adminToken = data.token;
    isAdmin = true;
    localStorage.setItem("adminToken", adminToken);
    updateAdminUi();
    applyCurrentFilterAndRender();
  } catch (err) {
    console.error(err);
    alert("Неверный пароль администратора.");
  }
}

// ======================== ЗАГРУЗКА ЗАЯВОК ========================

async function loadOrders() {
  try {
    const res = await fetch(`${API_BASE}/orders`);
    if (!res.ok) {
      throw new Error("Server error: " + res.status);
    }
    const data = await res.json();

    allOrders = data || [];
    updateTotalOrdersCounter(allOrders.length);

    applyCurrentFilterAndRender();
  } catch (err) {
    console.error(err);
    alert("Не удалось загрузить заявки с сервера. См. консоль.");
  }
}

function updateTotalOrdersCounter(total) {
  const el = document.getElementById("totalOrders");
  if (el) {
    el.textContent = total;
  }
}

// ======================== ФИЛЬТР + ОТРИСОВКА ========================

function applyCurrentFilterAndRender() {
  const cargoFilterEl = document.getElementById("cargoFilter");
  const minPriceEl    = document.getElementById("minPrice");

  const cargoFilter = cargoFilterEl ? cargoFilterEl.value.trim() : "";
  const minPrice    = minPriceEl ? Number(minPriceEl.value) || 0 : 0;

  filteredOrders = allOrders.filter((order) => {
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

// ======================== ТАБЛИЦА ЗАЯВОК ========================

function renderOrdersTable(orders) {
  const tbody = document.querySelector("#ordersTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  orders.forEach((order, index) => {
    const tr = document.createElement("tr");

    const tdId       = document.createElement("td");
    const tdCargo    = document.createElement("td");
    const tdPrice    = document.createElement("td");
    const tdFrom     = document.createElement("td");
    const tdTo       = document.createElement("td");
    const tdComment  = document.createElement("td");
    const tdAct      = document.createElement("td");

    // 🔹 делаем столбец действий узким и настраиваемым по CSS
    tdAct.classList.add("actions-cell");

    tdId.textContent       = index + 1;
    tdCargo.textContent    = order.cargo || "";
    tdPrice.textContent    = order.pricePerTon != null ? order.pricePerTon : "";
    tdFrom.textContent     = order.from || "";
    tdTo.textContent       = order.to || "";
    tdComment.textContent  = order.comment || "";

    if (isAdmin) {
      const editBtn = document.createElement("button");
      editBtn.textContent = "Ред.";            // было "Редактировать"
      editBtn.className = "edit-btn";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditModal(order);
      });

      const delBtn = document.createElement("button");
      delBtn.textContent = "Удал.";            // было "Удалить"
      delBtn.className = "delete-btn";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteOrder(order._id);
      });

      tdAct.appendChild(editBtn);
      tdAct.appendChild(delBtn);
    }

    tr.appendChild(tdId);
    tr.appendChild(tdCargo);
    tr.appendChild(tdPrice);
    tr.appendChild(tdFrom);
    tr.appendChild(tdTo);
    tr.appendChild(tdComment);
    tr.appendChild(tdAct);

    // клик по строке — центрируем карту и строим маршрут
    tr.addEventListener("click", () => {
      if (map && order.lat != null && order.lon != null && window.ymaps) {
        map.setCenter([order.lat, order.lon], 7, { duration: 300 });
      }
      drawYandexRoute(order);
    });

    tbody.appendChild(tr);
  });

  // после перерисовки таблицы обновляем отображение для админа/не-админа
  updateAdminUi();
}


// ======================== МАРКЕРЫ НА КАРТЕ ========================

function renderMarkers(orders) {
  if (!markersLayer || !window.ymaps) return;

  markersLayer.removeAll();

  orders.forEach((order) => {
    if (order.lat == null || order.lon == null) return;

    const commentLine = order.comment
      ? `<br/>Комментарий: ${order.comment}`
      : "";

    const placemark = new ymaps.Placemark(
      [order.lat, order.lon],
      {
        balloonContent: `
          <b>${order.cargo || "Груз"}</b><br/>
          Загрузка: ${order.from || "-"}<br/>
          Выгрузка: ${order.to || "-"}<br/>
          Цена: ${
            order.pricePerTon != null ? order.pricePerTon + " ₽/т" : "-"
          }<br/>
          Расстояние: ${
            order.distanceKm != null ? order.distanceKm + " км" : "-"
          }${commentLine}
        `,
      },
      {
        preset: "islands#blueIcon",
      }
    );

    placemark.events.add("click", () => {
      drawYandexRoute(order);
    });

    markersLayer.add(placemark);
  });

  refreshMapSize();
}

// ======================== МАРШРУТ ПО ДОРОГЕ ========================

function drawYandexRoute(order) {
  if (!map || !window.ymaps) return;

  if (currentRoute) {
    map.geoObjects.remove(currentRoute);
    currentRoute = null;
  }

  if (
    order.lat == null ||
    order.lon == null ||
    order.unloadLat == null ||
    order.unloadLon == null
  ) {
    return;
  }

  const fromPoint = [order.lat, order.lon];
  const toPoint   = [order.unloadLat, order.unloadLon];

  ymaps
    .route([fromPoint, toPoint])
    .then((route) => {
      currentRoute = route;

      const paths = route.getPaths();
      paths.options.set({
        strokeWidth: 4,
        strokeColor: "#ff5500", // тут можно менять цвет маршрута
        opacity: 0.85,
      });

      map.geoObjects.add(route);

      const bounds = route.getBounds();
      if (bounds) {
        map.setBounds(bounds, {
          checkZoomRange: true,
          zoomMargin: 30,
        });
      }
    })
    .catch((err) => {
      console.error("Ошибка построения маршрута:", err);
    });
}

// ======================== ГЕОКОДИНГ АДРЕСА ========================

function geocodeAddress(address) {
  if (!window.ymaps) {
    return Promise.reject(new Error("Yandex Maps API не загружен"));
  }

  return ymaps
    .geocode(address, { results: 1 })
    .then((res) => {
      const geoObject = res.geoObjects.get(0);
      if (!geoObject) return null;
      return geoObject.geometry.getCoordinates(); // [lat, lon]
    })
    .catch((err) => {
      console.error("Ошибка геокодирования:", err);
      return null;
    });
}

// ======================== ДОБАВЛЕНИЕ ЗАЯВКИ ========================

async function onAddOrderSubmit(e) {
  e.preventDefault();

  const fromInput    = document.getElementById("fromInput");
  const toInput      = document.getElementById("toInput");
  const cargoInput   = document.getElementById("cargoInput");
  const priceInput   = document.getElementById("priceInput");
  const commentInput = document.getElementById("commentInput");

  const from    = fromInput?.value.trim() || "";
  const to      = toInput?.value.trim() || "";
  const cargo   = cargoInput?.value.trim() || "";
  const price   = Number(priceInput?.value) || 0;
  const comment = commentInput?.value.trim() || "";

  if (!from || !to || !cargo || !price) {
    alert('Заполните поля "Загрузка", "Выгрузка", "Груз" и "Цена".');
    return;
  }

  if (!window.ymaps) {
    alert("Карты ещё не загрузились, попробуйте через пару секунд.");
    return;
  }

  try {
    const fromCoords = await geocodeAddress(from);
    const toCoords   = await geocodeAddress(to);

    if (!fromCoords || !toCoords) {
      alert(
        "Не удалось определить координаты по введённым адресам. Попробуйте уточнить адрес."
      );
      return;
    }

    const route          = await ymaps.route([fromCoords, toCoords]);
    const distanceMeters = route.getLength();
    const distanceKm     = Math.round(distanceMeters / 1000);

    const newOrder = {
      from,
      to,
      cargo,
      pricePerTon: price,
      distanceKm,
      lat: fromCoords[0],
      lon: fromCoords[1],
      unloadLat: toCoords[0],
      unloadLon: toCoords[1],
      comment,
    };

    const headers = { "Content-Type": "application/json" };
    if (adminToken) {
      headers["Authorization"] = "Bearer " + adminToken;
    }

    const res = await fetch(`${API_BASE}/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify(newOrder),
    });

    if (!res.ok) {
      throw new Error("Failed to create order");
    }

    fromInput.value    = "";
    toInput.value      = "";
    cargoInput.value   = "";
    priceInput.value   = "";
    if (commentInput) commentInput.value = "";

    await loadOrders();
  } catch (err) {
    console.error(err);
    alert("Не удалось добавить заявку или рассчитать маршрут. См. консоль.");
  }
}

// ======================== УДАЛЕНИЕ ЗАЯВКИ ========================

async function deleteOrder(id) {
  if (!id) return;
  const ok = confirm("Удалить заявку?");
  if (!ok) return;

  try {
    const headers = {};
    if (adminToken) {
      headers["Authorization"] = "Bearer " + adminToken;
    }

    const res = await fetch(`${API_BASE}/orders/${id}`, {
      method: "DELETE",
      headers,
    });
    if (!res.ok) {
      throw new Error("Failed to delete");
    }
    await loadOrders();
  } catch (err) {
    console.error(err);
    alert("Не удалось удалить заявку.");
  }
}

// ======================== РЕДАКТИРОВАНИЕ ЗАЯВКИ ========================

function openEditModal(order) {
  editingOrderId = order._id;

  document.getElementById("editFromInput").value    = order.from || "";
  document.getElementById("editToInput").value      = order.to || "";
  document.getElementById("editCargoInput").value   = order.cargo || "";
  document.getElementById("editPriceInput").value   =
    order.pricePerTon != null ? order.pricePerTon : "";
  document.getElementById("editDistanceInput").value =
    order.distanceKm != null ? order.distanceKm : "";

  const editCommentInput = document.getElementById("editCommentInput");
  if (editCommentInput) {
    editCommentInput.value = order.comment || "";
  }

  const modal = document.getElementById("editModal");
  if (modal) {
    modal.classList.remove("hidden");
  }
}

function closeEditModal() {
  const modal = document.getElementById("editModal");
  if (modal) {
    modal.classList.add("hidden");
  }
  editingOrderId = null;
}

async function onEditOrderSubmit(e) {
  e.preventDefault();
  if (!editingOrderId) return;

  const fromInput      = document.getElementById("editFromInput");
  const toInput        = document.getElementById("editToInput");
  const cargoInput     = document.getElementById("editCargoInput");
  const priceInput     = document.getElementById("editPriceInput");
  const distanceInput  = document.getElementById("editDistanceInput");
  const commentInput   = document.getElementById("editCommentInput");

  const from     = fromInput.value.trim();
  const to       = toInput.value.trim();
  const cargo    = cargoInput.value.trim();
  const price    = Number(priceInput.value) || 0;
  const distance = distanceInput.value ? Number(distanceInput.value) : null;
  const comment  = commentInput ? commentInput.value.trim() : "";

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
    comment,
  };

  try {
    const headers = { "Content-Type": "application/json" };
    if (adminToken) {
      headers["Authorization"] = "Bearer " + adminToken;
    }

    const res = await fetch(`${API_BASE}/orders/${editingOrderId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(updated),
    });
    if (!res.ok) {
      throw new Error("Failed to update");
    }
    closeEditModal();
    await loadOrders();
  } catch (err) {
    console.error(err);
    alert("Не удалось сохранить изменения.");
  }
}

// ======================== ВЫГРУЗКА В CSV ========================

function downloadCsv(orders) {
  if (!orders || !orders.length) {
    alert("Нет данных для выгрузки.");
    return;
  }

  const header = [
    "ID",
    "Груз",
    "Цена_Р_т",
    "Загрузка",
    "Выгрузка",
    "Комментарий",
    "Расстояние_км",
    "lat_загрузка",
    "lon_загрузка",
    "lat_выгрузка",
    "lon_выгрузка",
  ];

  const rows = orders.map((o, index) => [
    index + 1,
    o.cargo || "",
    o.pricePerTon != null ? o.pricePerTon : "",
    (o.from || "").replace(/;/g, ","),
    (o.to || "").replace(/;/g, ","),
    (o.comment || "").replace(/;/g, ","),
    o.distanceKm != null ? o.distanceKm : "",
    o.lat != null ? o.lat : "",
    o.lon != null ? o.lon : "",
    o.unloadLat != null ? o.unloadLat : "",
    o.unloadLon != null ? o.unloadLon : "",
  ]);

  const csvLines = [header.join(";"), ...rows.map((r) => r.join(";"))];

  const csvContent = csvLines.join("\n");
  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
