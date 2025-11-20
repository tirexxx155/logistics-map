// Базовый адрес API (локально -> localhost, в интернете -> /api)
const API_BASE =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:5050/api"
    : "/api";

let map;                 // ymaps.Map
let markersLayer;        // ymaps.GeoObjectCollection
let currentRoute = null; // текущий маршрут (ymaps.route)

let allOrders = [];
let filteredOrders = [];
let scheduleItems = []; // расписание загрузок
let drivers = []; // водители
let driversLayer = null; // слой маркеров водителей
let showDrivers = true; // показывать ли водителей на карте

let editingOrderId = null;
let assigningOrderId = null; // ID заявки, которую назначаем на дату

// админ
let isAdmin = false;
let adminToken = null;

/* ======================== СТАРТ ======================== */

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  setupUi();
  setupTabs();      // ← НОВОЕ
  initCalendar();   // ← НОВОЕ (простой календарь)
  setupScheduleUi(); // ← НОВОЕ (UI для работы с расписанием)
  setupActivityFeed(); // ← НОВОЕ (лента активности)
  initSidebarResizer(); // ← Инициализация resize для сайдбара
  restoreAdminState();
  loadOrders();
  loadSchedule();   // ← НОВОЕ (загрузка расписания)
  loadActivities(); // ← НОВОЕ (загрузка активности)
  loadDrivers();    // ← НОВОЕ (загрузка водителей)
  setupAutoRefresh(); // ← Автоматическое обновление данных
});


/* ======================== КАРТА YANDEX ======================== */

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
// Подсказки адресов для полей "Загрузка" и "Выгрузка"
    const fromInput = document.getElementById("fromInput");
    const toInput   = document.getElementById("toInput");
    if (fromInput) {
      new ymaps.SuggestView("fromInput", {
        results: 5,
        boundedBy: [[45, 35], [56, 50]], // Примерные границы России (можно расширить)
        strictBounds: false
      });
    }
    if (toInput) {
      new ymaps.SuggestView("toInput", {
        results: 5,
        boundedBy: [[45, 35], [56, 50]], // Примерные границы России (можно расширить)
        strictBounds: false
      });
    }
    
    // Подсказки для полей редактирования (инициализируем сразу, если элементы существуют)
    const editFromInput = document.getElementById("editFromInput");
    const editToInput = document.getElementById("editToInput");
    if (editFromInput && !editSuggestViewFrom) {
      editSuggestViewFrom = new ymaps.SuggestView("editFromInput", {
        results: 5,
        boundedBy: [[45, 35], [56, 50]],
        strictBounds: false
      });
    }
    if (editToInput && !editSuggestViewTo) {
      editSuggestViewTo = new ymaps.SuggestView("editToInput", {
        results: 5,
        boundedBy: [[45, 35], [56, 50]],
        strictBounds: false
      });
    }
    
    // Коллекция маркеров заявок
    markersLayer = new ymaps.GeoObjectCollection();
    map.geoObjects.add(markersLayer);
    
    // Коллекция маркеров водителей (зеленые флажки)
    driversLayer = new ymaps.GeoObjectCollection();
    map.geoObjects.add(driversLayer);
    
    // Подсказки для адреса водителя
    const driverAddressInput = document.getElementById("driverAddressInput");
    if (driverAddressInput) {
      new ymaps.SuggestView("driverAddressInput", {
        results: 5,
        boundedBy: [[45, 35], [56, 50]],
        strictBounds: false
      });
    }

    // если данные уже загружены к этому моменту — отрисуем
    if (allOrders.length) {
      const data = filteredOrders.length ? filteredOrders : allOrders;
      renderMarkers(data);
    }
    
    // Если водители уже загружены, отрисуем их
    if (drivers.length) {
      renderDrivers();
    }

    refreshMapSize();
  });
}

// подстроить карту под размер контейнера
function refreshMapSize() {
  if (map && map.container && map.container.fitToViewport) {
    map.container.fitToViewport();
  }
}

// при изменении размера окна — тоже подстроить
window.addEventListener("resize", refreshMapSize);

/* ======================== UI, КНОПКИ, ФОРМЫ ======================== */

function setupUi() {
  const applyFilterBtn   = document.getElementById("applyFilter");
  const resetFilterBtn   = document.getElementById("resetFilter");
  const toggleSidebarBtn = document.getElementById("toggleSidebar");
  const toggleFormBtn    = document.getElementById("toggleForm");
  const addOrderForm     = document.getElementById("addOrderForm");
  const editOrderForm    = document.getElementById("editOrderForm");
  const editCancelBtn    = document.getElementById("editCancelBtn");
  const adminLoginBtn    = document.getElementById("adminLoginBtn");

  if (applyFilterBtn) {
    applyFilterBtn.addEventListener("click", () => {
      applyCurrentFilterAndRender();
    });
  }

  if (resetFilterBtn) {
  resetFilterBtn.addEventListener("click", () => {
    const cargoFilter = document.getElementById("cargoFilter");
    const minPrice    = document.getElementById("minPrice");
    const typeFilter  = document.getElementById("typeFilter"); // ← новый

    if (cargoFilter) cargoFilter.value = "";
    if (minPrice)    minPrice.value    = "";
    if (typeFilter)  typeFilter.value  = ""; // ← очищаем тип загрузки

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
      const addDriverSection = document.querySelector(".add-driver");
      if (!addOrderSection) return;
      
      const isHidden = addOrderSection.classList.contains("hidden");
      addOrderSection.classList.toggle("hidden");
      
      // Сворачиваем/разворачиваем и форму водителя вместе с формой заявок
      if (addDriverSection) {
        if (isHidden) {
          // Если форма заявок была скрыта, показываем форму водителя
          addDriverSection.classList.remove("hidden");
        } else {
          // Если форма заявок была видна, скрываем форму водителя
          addDriverSection.classList.add("hidden");
        }
      }
      
      toggleFormBtn.textContent = addOrderSection.classList.contains("hidden")
        ? "Показать форму заявок"
        : "Свернуть форму заявок";

      refreshMapSize();
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
  
  // Форма добавления водителя
  const addDriverForm = document.getElementById("addDriverForm");
  if (addDriverForm) {
    addDriverForm.addEventListener("submit", onAddDriverSubmit);
  }
  
  // Кнопка переключения видимости водителей
  const toggleDriversBtn = document.getElementById("toggleDrivers");
  if (toggleDriversBtn) {
    // Устанавливаем начальное состояние кнопки
    toggleDriversBtn.textContent = showDrivers ? "Скрыть водителей" : "Показать водителей";
    
    toggleDriversBtn.addEventListener("click", () => {
      showDrivers = !showDrivers;
      toggleDriversBtn.textContent = showDrivers ? "Скрыть водителей" : "Показать водителей";
      renderDrivers();
    });
  }
}

/* ======================== ТАБЫ: КАРТА / КАЛЕНДАРЬ ======================== */

function setupTabs() {
  const tabMap       = document.getElementById("tab-map");
  const tabCalendar  = document.getElementById("tab-calendar");
  const layout       = document.getElementById("layout");
  const calendarView = document.getElementById("calendarView");
  const themeToggle  = document.getElementById("themeToggle");

  if (!tabMap || !tabCalendar || !layout || !calendarView) return;
  
  // Настройка переключения темы
  if (themeToggle) {
    // Загружаем сохраненную тему из localStorage
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      document.body.classList.add('dark-theme');
      themeToggle.querySelector('.theme-icon').textContent = '☀️';
    }
    
    themeToggle.addEventListener('click', () => {
      const isDark = document.body.classList.toggle('dark-theme');
      themeToggle.querySelector('.theme-icon').textContent = isDark ? '☀️' : '🌙';
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });
  }

  function activate(view) {
    const mapActive = view === "map";

    // показываем/прячем карту и календарь
    if (mapActive) {
      layout.classList.remove("hidden");
      calendarView.classList.add("hidden");
      layout.style.display = "flex";
      calendarView.style.display = "none";
      document.body.classList.remove("calendar-view-active");
    } else {
      layout.classList.add("hidden");
      calendarView.classList.remove("hidden");
      layout.style.display = "none";
      calendarView.style.display = "block";
      document.body.classList.add("calendar-view-active");
    }

    tabMap.classList.toggle("tab-button--active", mapActive);
    tabCalendar.classList.toggle("tab-button--active", !mapActive);

    // когда возвращаемся на карту — подгоняем размер
    if (mapActive) {
      refreshMapSize();
    } else {
      // когда переключаемся на календарь — перерисовываем его
      if (renderCalendarFn) {
        setTimeout(() => renderCalendarFn(), 0);
      }
    }
  }

  tabMap.addEventListener("click", () => activate("map"));
  tabCalendar.addEventListener("click", () => activate("calendar"));

  // по умолчанию — карта
  activate("map");
}

/* ======================== АДМИН-РЕЖИМ ======================== */

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
  const actionsHeader   = document.querySelector("#ordersTable thead th:last-child");

  // текст на кнопке входа/выхода
  if (adminBtn) {
    adminBtn.textContent = isAdmin
      ? "Выйти из админ режима"
      : "Войти как админ";
  }

  // форма добавления заявки видна только админу
  if (addOrderSection) {
    addOrderSection.style.display = isAdmin ? "" : "none";
  }

  // кнопка "Свернуть форму" только для админа
  if (toggleFormBtn) {
    toggleFormBtn.style.display = isAdmin ? "" : "none";
  }
  
  // форма добавления водителей только для админа
  const addDriverSection = document.querySelector(".add-driver");
  if (addDriverSection) {
    addDriverSection.style.display = isAdmin ? "" : "none";
  }
  
  // кнопка переключения водителей только для админа
  const toggleDriversBtn = document.getElementById("toggleDrivers");
  if (toggleDriversBtn) {
    toggleDriversBtn.style.display = isAdmin ? "" : "none";
  }

  // заголовок столбца "Действия" (последний th)
  if (actionsHeader) {
    actionsHeader.style.display = isAdmin ? "" : "none";
  }

  // последняя ячейка в каждой строке таблицы
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

/* ======================== ЗАГРУЗКА ЗАЯВОК ======================== */

async function loadOrders(silent = false) {
  try {
    const res = await fetch(`${API_BASE}/orders`);
    if (!res.ok) {
      throw new Error("Server error: " + res.status);
    }
    const data = await res.json();

    allOrders = data || [];
    updateTotalOrdersCounter(allOrders.length);

    applyCurrentFilterAndRender();
    
    // Перезагружаем расписание, чтобы обновить календарь
    await loadSchedule(silent); // Передаем silent дальше
  } catch (err) {
    console.error(err);
    // Показываем alert только если это не автоматическое обновление
    if (!silent) {
      alert("Не удалось загрузить заявки с сервера. См. консоль.");
    }
  }
}

/* ======================== РАСПИСАНИЕ ЗАГРУЗОК ======================== */

async function loadSchedule(silent = false) {
  try {
    const res = await fetch(`${API_BASE}/schedule`);
    if (!res.ok) {
      throw new Error("Server error: " + res.status);
    }
    const data = await res.json();
    scheduleItems = data || [];
    
    // Перерисовываем календарь
    if (renderCalendarFn) {
      renderCalendarFn();
    }
  } catch (err) {
    console.error("Ошибка при загрузке расписания:", err);
    // Не показываем alert при автоматическом обновлении
  }
}

let editingScheduleId = null;

function setupScheduleUi() {
  const assignForm = document.getElementById("assignOrderForm");
  const assignCancelBtn = document.getElementById("assignCancelBtn");
  const assignModal = document.getElementById("assignOrderModal");

  if (assignForm) {
    assignForm.addEventListener("submit", onAssignOrderSubmit);
  }

  if (assignCancelBtn) {
    assignCancelBtn.addEventListener("click", () => {
      if (assignModal) {
        assignModal.classList.add("hidden");
      }
      assigningOrderId = null;
    });
  }

  // Закрытие по клику на backdrop
  if (assignModal) {
    const backdrop = assignModal.querySelector(".modal-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", () => {
        assignModal.classList.add("hidden");
        assigningOrderId = null;
      });
    }
  }

  // Обработчики для модального окна редактирования назначения
  const editScheduleForm = document.getElementById("editScheduleForm");
  const editScheduleCancelBtn = document.getElementById("editScheduleCancelBtn");
  const editScheduleModal = document.getElementById("editScheduleModal");

  if (editScheduleForm) {
    editScheduleForm.addEventListener("submit", onEditScheduleSubmit);
  }

  if (editScheduleCancelBtn) {
    editScheduleCancelBtn.addEventListener("click", () => {
      if (editScheduleModal) {
        editScheduleModal.classList.add("hidden");
      }
      editingScheduleId = null;
    });
  }

  // Закрытие по клику на backdrop
  if (editScheduleModal) {
    const backdrop = editScheduleModal.querySelector(".modal-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", () => {
        editScheduleModal.classList.add("hidden");
        editingScheduleId = null;
      });
    }
  }
}

function openEditScheduleModal(scheduleItem) {
  editingScheduleId = scheduleItem._id;
  const modal = document.getElementById("editScheduleModal");
  const dateInput = document.getElementById("editScheduleDateInput");
  const tonsInput = document.getElementById("editScheduleTonsInput");
  const commentInput = document.getElementById("editScheduleCommentInput");

  if (!modal || !dateInput || !tonsInput) return;

  const loadingDate = new Date(scheduleItem.loadingDate);
  dateInput.value = loadingDate.toISOString().split('T')[0];
  tonsInput.value = scheduleItem.requiredTons || 0;
  if (commentInput) {
    commentInput.value = scheduleItem.comment || "";
  }

  modal.classList.remove("hidden");
}

async function onEditScheduleSubmit(e) {
  e.preventDefault();
  if (!editingScheduleId) return;

  const dateInput = document.getElementById("editScheduleDateInput");
  const tonsInput = document.getElementById("editScheduleTonsInput");
  const commentInput = document.getElementById("editScheduleCommentInput");

  if (!dateInput || !tonsInput) return;

  // Создаем дату в локальном времени (начало дня)
  const dateValue = dateInput.value; // формат: YYYY-MM-DD
  const [year, month, day] = dateValue.split('-').map(Number);
  const loadingDate = new Date(year, month - 1, day, 12, 0, 0); // 12:00 для избежания проблем с часовыми поясами
  const requiredTons = Number(tonsInput.value) || 0;
  const comment = commentInput ? commentInput.value.trim() : "";

  if (requiredTons <= 0) {
    alert("Укажите количество тонн больше нуля");
    return;
  }

  if (!dateValue) {
    alert("Укажите дату загрузки");
    return;
  }

  try {
    const headers = { "Content-Type": "application/json" };
    if (adminToken) {
      headers["Authorization"] = "Bearer " + adminToken;
    }

    const updateData = {
      loadingDate: loadingDate.toISOString(),
      requiredTons,
      comment,
    };

    const res = await fetch(`${API_BASE}/schedule/${editingScheduleId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(updateData),
    });

    if (!res.ok) {
      throw new Error("Failed to update schedule item");
    }

    // Закрываем модальное окно
    const modal = document.getElementById("editScheduleModal");
    if (modal) {
      modal.classList.add("hidden");
    }
    editingScheduleId = null;

    // Перезагружаем расписание
    await loadSchedule();
    await loadActivities();
    
    // Обновляем календарь
    if (window.renderCalendar) {
      window.renderCalendar();
    }

    // Обновляем модальное окно дня, если оно открыто
    const dayModal = document.getElementById("dayOrdersModal");
    if (dayModal && !dayModal.classList.contains("hidden")) {
      const title = document.getElementById("dayOrdersTitle");
      if (title) {
        const dateMatch = title.textContent.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
        if (dateMatch) {
          const day = parseInt(dateMatch[1]);
          const monthNames = ["января", "февраля", "марта", "апреля", "мая", "июня",
                             "июля", "августа", "сентября", "октября", "ноября", "декабря"];
          const month = monthNames.indexOf(dateMatch[2].toLowerCase());
          const year = parseInt(dateMatch[3]);
          if (month !== -1) {
            const date = new Date(year, month, day);
            const dayScheduleItems = window.getScheduleItemsForDate ? window.getScheduleItemsForDate(date) : [];
            showDayOrdersModal(date, dayScheduleItems);
          }
        }
      }
    }
  } catch (err) {
    console.error("Ошибка при обновлении назначения:", err);
    alert("Не удалось обновить назначение. См. консоль.");
  }
}

function openAssignModal(order) {
  assigningOrderId = order._id;
  const modal = document.getElementById("assignOrderModal");
  const dateInput = document.getElementById("assignDateInput");
  const tonsInput = document.getElementById("assignTonsInput");
  const commentInput = document.getElementById("assignCommentInput");

  if (!modal || !dateInput) return;

  // Устанавливаем сегодняшнюю дату по умолчанию
  const today = new Date();
  dateInput.value = today.toISOString().split('T')[0];
  
  if (tonsInput) tonsInput.value = "";
  if (commentInput) commentInput.value = "";

  modal.classList.remove("hidden");
}

async function onAssignOrderSubmit(e) {
  e.preventDefault();
  if (!assigningOrderId) return;

  const dateInput = document.getElementById("assignDateInput");
  const tonsInput = document.getElementById("assignTonsInput");
  const commentInput = document.getElementById("assignCommentInput");

  if (!dateInput || !tonsInput) return;

  // Создаем дату в локальном времени (начало дня)
  const dateValue = dateInput.value; // формат: YYYY-MM-DD
  const [year, month, day] = dateValue.split('-').map(Number);
  const loadingDate = new Date(year, month - 1, day, 12, 0, 0); // 12:00 для избежания проблем с часовыми поясами
  const requiredTons = Number(tonsInput.value) || 0;
  const comment = commentInput ? commentInput.value.trim() : "";

  if (requiredTons <= 0) {
    alert("Укажите количество тонн больше нуля");
    return;
  }

  if (!dateValue) {
    alert("Укажите дату загрузки");
    return;
  }

  try {
    const headers = { "Content-Type": "application/json" };
    if (adminToken) {
      headers["Authorization"] = "Bearer " + adminToken;
    }

    const scheduleItem = {
      orderId: assigningOrderId,
      loadingDate: loadingDate.toISOString(),
      requiredTons,
      shippedTons: 0,
      comment,
    };

    const res = await fetch(`${API_BASE}/schedule`, {
      method: "POST",
      headers,
      body: JSON.stringify(scheduleItem),
    });

    if (!res.ok) {
      throw new Error("Failed to create schedule item");
    }

    // Закрываем модальное окно
    const modal = document.getElementById("assignOrderModal");
    if (modal) {
      modal.classList.add("hidden");
    }
    assigningOrderId = null;

    // Перезагружаем расписание
    await loadSchedule();
    // Перезагружаем активность
    await loadActivities();
    
    // Обновляем календарь
    if (window.renderCalendar) {
      window.renderCalendar();
    }
  } catch (err) {
    console.error("Ошибка при назначении заявки:", err);
    const errorText = err.message || "Неизвестная ошибка";
    alert(`Не удалось назначить заявку на дату: ${errorText}. См. консоль.`);
  }
}

function updateTotalOrdersCounter(total) {
  const el = document.getElementById("totalOrders");
  if (el) {
    el.textContent = total;
  }
}

/* ======================== ФИЛЬТР + ОТРИСОВКА ======================== */

function applyCurrentFilterAndRender() {
  const cargoFilterEl = document.getElementById("cargoFilter");
  const minPriceEl    = document.getElementById("minPrice");
const typeFilterEl = document.getElementById("typeFilter");
  const cargoFilter = cargoFilterEl ? cargoFilterEl.value.trim() : "";
  const minPrice    = minPriceEl ? Number(minPriceEl.value) || 0 : 0;
    
const typeFilter = typeFilterEl ? typeFilterEl.value.trim() : "";

  filteredOrders = allOrders.filter((order) => {
    if (cargoFilter && order.cargo !== cargoFilter) {
      return false;
    }
    if (minPrice && Number(order.pricePerTon || 0) < minPrice) {
      return false;
      
    }
    if (typeFilter && order.norm !== typeFilter) {
    return false;
}

  

    return true;
  });

  renderOrdersTable(filteredOrders);
  renderMarkers(filteredOrders);
}

/* ======================== ТАБЛИЦА ЗАЯВОК ======================== */

function renderOrdersTable(orders) {
  const tbody = document.querySelector("#ordersTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  orders.forEach((order, index) => {
    const tr = document.createElement("tr");
    // привязываем строку к id заявки из MongoDB
    if (order._id) {
      tr.dataset.orderId = order._id;
    }

    const tdId      = document.createElement("td");
    const tdCargo   = document.createElement("td");
    const tdPrice   = document.createElement("td");
    const tdFrom    = document.createElement("td");
    const tdTo      = document.createElement("td");
    const tdDistance = document.createElement("td");
    const tdNorm    = document.createElement("td");
    const tdVolume  = document.createElement("td");
    const tdComment = document.createElement("td");
    const tdAct     = document.createElement("td");

    tdId.textContent      = index + 1;
    tdCargo.textContent   = order.cargo || "";
    tdPrice.textContent   = order.pricePerTon != null ? order.pricePerTon : "";
    tdFrom.textContent    = order.from || "";
    tdTo.textContent      = order.to || "";
    tdDistance.textContent = order.distanceKm != null ? order.distanceKm + " км" : "";
    tdNorm.textContent    = order.norm || "";
    tdVolume.textContent  = order.volume != null ? order.volume : "";
    tdComment.textContent = order.comment || "";

    if (isAdmin) {
      const editBtn = document.createElement("button");
      editBtn.textContent = "Редактировать";
      editBtn.className = "edit-btn";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditModal(order);
      });

      const assignBtn = document.createElement("button");
      assignBtn.textContent = "На дату";
      assignBtn.className = "edit-btn";
      assignBtn.style.background = "#fef3c7";
      assignBtn.style.color = "#92400e";
      assignBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openAssignModal(order);
      });

      const delBtn = document.createElement("button");
      delBtn.textContent = "Удалить";
      delBtn.className = "delete-btn";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteOrder(order._id);
      });

      tdAct.appendChild(editBtn);
      tdAct.appendChild(assignBtn);
      tdAct.appendChild(delBtn);
      tdAct.classList.add("actions-cell");
    }

    tr.appendChild(tdId);
    tr.appendChild(tdCargo);
    tr.appendChild(tdPrice);
    tr.appendChild(tdFrom);
    tr.appendChild(tdTo);
    tr.appendChild(tdDistance);
    tr.appendChild(tdNorm);
    tr.appendChild(tdVolume);
    tr.appendChild(tdComment);
    tr.appendChild(tdAct);

    // клик по строке — центрируем карту и строим маршрут
     tr.addEventListener("click", () => {
      // подсветить эту строку
      if (order._id) {
        highlightOrderRow(order._id);
      }

      // центрировать карту и показать маршрут
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
// ======================== ПОДСВЕТКА СТРОКИ В ТАБЛИЦЕ ========================

function highlightOrderRow(orderId) {
  const rows = document.querySelectorAll("#ordersTable tbody tr");

  // снимаем выделение со всех строк
  rows.forEach(tr => tr.classList.remove("row-selected"));

  // ищем строку с нужным data-order-id
  const target = document.querySelector(
    `#ordersTable tbody tr[data-order-id="${orderId}"]`
  );

  if (target) {
    target.classList.add("row-selected");
    // плавно прокручиваем список, чтобы заявка попала в зону видимости
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/* ======================== МАРКЕРЫ НА КАРТЕ ======================== */

function renderMarkers(orders) {
  if (!markersLayer || !window.ymaps) return;

  markersLayer.removeAll();

  orders.forEach((order) => {
    if (order.lat == null || order.lon == null) return;

    const commentLine = order.comment
      ? `<br/>Комментарий: ${order.comment}`
      : "";

    const normLine = order.norm
      ? `<br/>Тип загрузки: ${order.norm}`
      : "";

    const volumeLine =
      order.volume != null
        ? `<br/>Объём: ${order.volume}`
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
          }${normLine}${volumeLine}${commentLine}
        `,
      },
      {
        preset: "islands#blueIcon",
      }
    );

        placemark.events.add("click", () => {
      // подсветить строку в таблице
      if (order._id) {
        highlightOrderRow(order._id);
      }

      // построить маршрут
      drawYandexRoute(order);
    });


    markersLayer.add(placemark);
  });

  refreshMapSize();
}
// подстроить карту под размер контейнера
function refreshMapSize() {
  if (map && map.container && map.container.fitToViewport) {
    map.container.fitToViewport();
  }
}

// Ресайз сайдбара мышкой
function initSidebarResizer() {
  const sidebar = document.getElementById("sidebar");
  const resizer = document.getElementById("sidebarResizer");
  const layout  = document.getElementById("layout");

  if (!sidebar || !resizer || !layout) return;

  let isDragging = false;
  const MIN_WIDTH = 160; // минимальная ширина таблицы, px
  const MAX_WIDTH = 1000; // максимальная ширина таблицы, px

  resizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    isDragging = true;
    document.body.classList.add("sidebar-resize-active");
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    const layoutRect = layout.getBoundingClientRect();
    let newWidth = e.clientX - layoutRect.left;

    if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
    if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH;

    // Устанавливаем ширину в пикселях
    sidebar.style.width = newWidth + "px";
    sidebar.style.maxWidth = newWidth + "px"; // также устанавливаем max-width
    sidebar.style.flexShrink = "0"; // предотвращаем сжатие

    refreshMapSize();
  });

  window.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    document.body.classList.remove("sidebar-resize-active");
  });
}

/* ======================== МАРШРУТ ПО ДОРОГЕ ======================== */

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
        strokeColor: "#51e00e", // зелёный маршрут
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

/* ======================== ГЕОКОДИНГ АДРЕСА ======================== */

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

/* ======================== ДОБАВЛЕНИЕ ЗАЯВКИ ======================== */

async function onAddOrderSubmit(e) {
  e.preventDefault();

  const fromInput    = document.getElementById("fromInput");
  const toInput      = document.getElementById("toInput");
  const cargoInput   = document.getElementById("cargoInput");
  const priceInput   = document.getElementById("priceInput");
  const normInput    = document.getElementById("normInput");
  const volumeInput  = document.getElementById("volumeInput");
  const commentInput = document.getElementById("commentInput");

  const from    = fromInput?.value.trim() || "";
  const to      = toInput?.value.trim() || "";
  const cargo   = cargoInput?.value.trim() || "";
  const price   = Number(priceInput?.value) || 0;
  const norm    = normInput?.value.trim() || "";
  const volume  = volumeInput?.value.trim() || "";
  const comment = commentInput?.value.trim() || "";

  if (!from || !to || !cargo || !price || !norm) {
    alert('Заполните поля "Загрузка", "Выгрузка", "Груз", "Цена" и "Тип загрузки".');
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
      norm,
      volume,
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
    if (normInput)        normInput.value        = "";
    if (volumeInput)      volumeInput.value      = "";
    if (commentInput)     commentInput.value     = "";

    await loadOrders();
    await loadActivities();
  } catch (err) {
    console.error(err);
    alert("Не удалось добавить заявку или рассчитать маршрут. См. консоль.");
  }
}

/* ======================== УДАЛЕНИЕ ЗАЯВКИ ======================== */

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
    await loadActivities();
  } catch (err) {
    console.error(err);
    alert("Не удалось удалить заявку.");
  }
}

/* ======================== РЕДАКТИРОВАНИЕ ЗАЯВКИ ======================== */

// Переменные для хранения экземпляров SuggestView для полей редактирования
let editSuggestViewFrom = null;
let editSuggestViewTo = null;

function openEditModal(order) {
  editingOrderId = order._id;

  const editFromInput = document.getElementById("editFromInput");
  const editToInput = document.getElementById("editToInput");
  
  if (editFromInput) {
    editFromInput.value = order.from || "";
  }
  
  if (editToInput) {
    editToInput.value = order.to || "";
  }
  
  document.getElementById("editCargoInput").value  = order.cargo || "";
  document.getElementById("editPriceInput").value  =
    order.pricePerTon != null ? order.pricePerTon : "";
  document.getElementById("editDistanceInput").value =
    order.distanceKm != null ? order.distanceKm : "";

  const editNormInput = document.getElementById("editNormInput");
  if (editNormInput) {
    editNormInput.value = order.norm || "";
  }

  const editVolumeInput = document.getElementById("editVolumeInput");
  if (editVolumeInput) {
    editVolumeInput.value = order.volume != null ? order.volume : "";
  }

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

  const fromInput        = document.getElementById("editFromInput");
  const toInput          = document.getElementById("editToInput");
  const cargoInput       = document.getElementById("editCargoInput");
  const priceInput       = document.getElementById("editPriceInput");
  const distanceInput    = document.getElementById("editDistanceInput");
  const normInput        = document.getElementById("editNormInput");
  const volumeInput      = document.getElementById("editVolumeInput");
  const commentInput     = document.getElementById("editCommentInput");
  const loadingDateInput = document.getElementById("editLoadingDateInput");

  const from        = fromInput.value.trim();
  const to          = toInput.value.trim();
  const cargo       = cargoInput.value.trim();
  const price       = Number(priceInput.value) || 0;
  const distance    = distanceInput.value ? Number(distanceInput.value) : null;
  const norm        = normInput ? normInput.value.trim() : "";
  const volume      = volumeInput ? volumeInput.value.trim() : "";
  const comment = commentInput ? commentInput.value.trim() : "";

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
    norm,
    volume,
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
    await loadActivities();
  } catch (err) {
    console.error(err);
    alert("Не удалось сохранить изменения.");
  }
}

/* ======================== ВЫГРУЗКА В CSV ======================== */

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
    "Тип_загрузки",
    "Объем",
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
    o.norm || "",
    o.volume != null ? o.volume : "",
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

/* ======================== ПРОСТОЙ КАЛЕНДАРЬ ======================== */

let renderCalendarFn = null; // Глобальная функция для перерисовки календаря

function initCalendar() {
  const titleEl = document.getElementById("calTitle");
  const tbody   = document.querySelector("#calendar tbody");
  const btnPrev = document.getElementById("calPrev");
  const btnNext = document.getElementById("calNext");

  if (!titleEl || !tbody || !btnPrev || !btnNext) {
    console.error("initCalendar: не найдены необходимые элементы");
    return;
  }

  // работаем с "первым числом месяца"
  let current = new Date();
  current.setDate(1);

  const monthNames = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
  ];

  function renderCalendar() {
    const year  = current.getFullYear();
    const month = current.getMonth();

    titleEl.textContent = `${monthNames[month]} ${year}`;

    // Очищаем tbody
    tbody.innerHTML = "";

    // день недели первого числа (0–6, где 0 — понедельник)
    let firstDay = current.getDay(); // 0=вс, 1=пн...
    firstDay = (firstDay + 6) % 7;   // сдвиг, чтобы 0=пн

    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let day = 1;
    const today = new Date();
    const isCurrentMonth =
      today.getFullYear() === year && today.getMonth() === month;

    for (let row = 0; row < 6; row++) {
      const tr = document.createElement("tr");

      for (let col = 0; col < 7; col++) {
        const td = document.createElement("td");

        if ((row === 0 && col < firstDay) || day > daysInMonth) {
          // Пустая ячейка
          td.textContent = "";
        } else {
          // Создаем контейнер для дня
          const dayContainer = document.createElement("div");
          dayContainer.className = "calendar-day-container";
          
          const dayNumber = document.createElement("div");
          dayNumber.className = "calendar-day-number";
          dayNumber.textContent = String(day);
          dayContainer.appendChild(dayNumber);

          // Получаем назначения на этот день из расписания
          const dayDate = new Date(year, month, day);
          const dayScheduleItems = window.getScheduleItemsForDate ? window.getScheduleItemsForDate(dayDate) : [];
          
          if (dayScheduleItems.length > 0) {
            td.classList.add("calendar-has-orders");
            
            // Подсчитываем общий объем
            let totalRequiredTons = 0;
            let totalShippedTons = 0;
            let completedCount = 0; // Счетчик выполненных заявок
            
            dayScheduleItems.forEach(item => {
              totalRequiredTons += item.requiredTons || 0;
              totalShippedTons += item.shippedTons || 0;
              // Проверяем, выполнена ли заявка (отправлено >= необходимо)
              if ((item.shippedTons || 0) >= (item.requiredTons || 0) && (item.requiredTons || 0) > 0) {
                completedCount++;
              }
            });

            // Показываем информацию о заявках
            const ordersInfo = document.createElement("div");
            ordersInfo.className = "calendar-orders-info";
            ordersInfo.innerHTML = `
              <div class="calendar-orders-count">${dayScheduleItems.length} заявок</div>
              ${totalRequiredTons > 0 ? `<div class="calendar-orders-volume">${totalRequiredTons} т</div>` : ''}
              ${totalShippedTons > 0 ? `<div class="calendar-orders-shipped">Отправлено: ${totalShippedTons} т</div>` : ''}
              ${completedCount > 0 ? `<div class="calendar-orders-completed">✅ Выполнено: ${completedCount} из ${dayScheduleItems.length}</div>` : ''}
            `;
            dayContainer.appendChild(ordersInfo);

            // Добавляем обработчик клика
            td.addEventListener("click", () => showDayOrdersModal(dayDate, dayScheduleItems));
            td.style.cursor = "pointer";
          }

          td.classList.add("calendar-day");

          if (isCurrentMonth && day === today.getDate()) {
            td.classList.add("calendar-today");
          }

          td.appendChild(dayContainer);
          day++;
        }

        tr.appendChild(td);
      }

      tbody.appendChild(tr);

      if (day > daysInMonth) break;
    }
  }

  // Функция для получения назначений на определенную дату (глобальная)
  window.getScheduleItemsForDate = function(date) {
    if (!scheduleItems || scheduleItems.length === 0) return [];
    
    // Нормализуем целевую дату (начало дня в локальном времени)
    const targetYear = date.getFullYear();
    const targetMonth = date.getMonth();
    const targetDay = date.getDate();
    
    return scheduleItems.filter(item => {
      if (!item.loadingDate) return false;
      const itemDate = new Date(item.loadingDate);
      const itemYear = itemDate.getFullYear();
      const itemMonth = itemDate.getMonth();
      const itemDay = itemDate.getDate();
      
      // Сравниваем год, месяц и день
      return itemYear === targetYear && itemMonth === targetMonth && itemDay === targetDay;
    });
  };

  // Функция для показа модального окна с заявками на день
  function showDayOrdersModal(date, scheduleItemsForDay) {
    const modal = document.getElementById("dayOrdersModal");
    const title = document.getElementById("dayOrdersTitle");
    const list = document.getElementById("dayOrdersList");
    const closeBtn = document.getElementById("dayOrdersCloseBtn");

    if (!modal || !title || !list) return;

    const dateStr = date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });

    title.textContent = `Заявки на загрузку: ${dateStr}`;

    if (scheduleItemsForDay.length === 0) {
      list.innerHTML = "<p>На этот день нет назначенных заявок.</p>";
    } else {
      // Подсчитываем общие показатели
      let totalRequiredTons = 0;
      let totalShippedTons = 0;

      scheduleItemsForDay.forEach(item => {
        totalRequiredTons += item.requiredTons || 0;
        totalShippedTons += item.shippedTons || 0;
      });

      const totalRemaining = totalRequiredTons - totalShippedTons;

      let html = `<div class="day-orders-summary">
        <p><strong>Всего заявок:</strong> ${scheduleItemsForDay.length}</p>
        <p><strong>Необходимо отправить:</strong> ${totalRequiredTons.toFixed(2)} т</p>
        <p><strong>Уже загружено:</strong> ${totalShippedTons.toFixed(2)} т</p>
        <p><strong>Остаток:</strong> <span style="color: ${totalRemaining > 0 ? '#dc2626' : '#059669'}; font-weight: 600;">${totalRemaining.toFixed(2)} т</span></p>
      </div>`;

      html += '<div class="day-orders-list">';
      
      scheduleItemsForDay.forEach((item, index) => {
        const order = item.orderId;
        if (!order) return;

        const remaining = (item.requiredTons || 0) - (item.shippedTons || 0);
        const itemId = item._id;

        html += `<div class="day-orders-item" data-schedule-id="${itemId}">
          <div class="day-orders-item-header">
            <h3>${order.cargo || "Груз не указан"}</h3>
          </div>
          
          <div class="day-orders-item-info">
            <div class="info-grid">
              <div><strong>Поставщик:</strong> ${order.from || "Не указан"}</div>
              <div><strong>Выгрузка:</strong> ${order.to || "Не указана"}</div>
              ${order.pricePerTon ? `<div><strong>Цена:</strong> ${order.pricePerTon} ₽/т</div>` : ''}
              ${order.distanceKm ? `<div><strong>Расстояние:</strong> ${order.distanceKm} км</div>` : ''}
              ${order.norm ? `<div><strong>Тип загрузки:</strong> ${order.norm}</div>` : ''}
              ${order.volume ? `<div><strong>Объём:</strong> ${order.volume}</div>` : ''}
              ${order.comment ? `<div><strong>Комментарий к заявке:</strong> ${order.comment}</div>` : ''}
            </div>
          </div>
          
          <div class="day-orders-item-schedule">
            <div class="schedule-row">
              <label>Необходимо отправить, т:</label>
              ${isAdmin ? `
                <input type="number" 
                       class="required-tons-input" 
                       value="${(item.requiredTons || 0).toFixed(2)}" 
                       min="0" 
                       step="0.01"
                       data-schedule-id="${itemId}">
              ` : `
                <span class="schedule-value">${(item.requiredTons || 0).toFixed(2)}</span>
              `}
            </div>
            <div class="schedule-row">
              <label>Логист:</label>
              <input type="text" 
                     class="logistician-input" 
                     value="" 
                     placeholder="Имя логиста"
                     data-schedule-id="${itemId}">
            </div>
            <div class="schedule-row">
              <label>Загружаю, т:</label>
              <input type="number" 
                     class="shipped-tons-input" 
                     value="" 
                     min="0" 
                     step="0.01"
                     data-schedule-id="${itemId}"
                     placeholder="0.00">
            </div>
            <div class="schedule-row">
              <label>Остаток, т:</label>
              ${isAdmin ? `
                <input type="number" 
                       class="remaining-input" 
                       value="${remaining.toFixed(2)}" 
                       min="0" 
                       step="0.01"
                       data-schedule-id="${itemId}"
                       style="color: ${remaining > 0 ? '#dc2626' : '#059669'}; font-weight: 600; border-color: ${remaining > 0 ? '#dc2626' : '#059669'};">
              ` : `
                <span class="schedule-value remaining" 
                      data-schedule-id="${itemId}"
                      style="color: ${remaining > 0 ? '#dc2626' : '#059669'}; font-weight: 600;">
                  ${remaining.toFixed(2)}
                </span>
              `}
            </div>
            ${item.comment ? `<div class="schedule-comment"><strong>Комментарий к загрузке:</strong> ${item.comment}</div>` : ''}
          </div>
          <div class="day-orders-item-footer">
            <div class="day-orders-item-actions">
              ${isAdmin ? `
                <button type="button" class="btn btn-ghost small delete-schedule-btn" data-schedule-id="${itemId}" style="background: #fee2e2; color: #991b1b;">
                  Удалить
                </button>
              ` : ''}
              <button type="button" class="btn btn-primary ship-tons-btn" data-schedule-id="${itemId}">
                Отправить
              </button>
            </div>
          </div>
        </div>`;
      });

      html += '</div>';

      list.innerHTML = html;

      // Добавляем обработчики для редактирования необходимых тонн (инлайн)
      if (isAdmin) {
        const requiredTonsInputs = list.querySelectorAll('.required-tons-input');
        requiredTonsInputs.forEach(input => {
          input.addEventListener('change', async (e) => {
            const scheduleId = e.target.dataset.scheduleId;
            const newRequiredTons = parseFloat(e.target.value) || 0;
            if (newRequiredTons <= 0) {
              alert("Количество тонн должно быть больше нуля");
              const item = scheduleItemsForDay.find(item => item._id === scheduleId);
              e.target.value = (item?.requiredTons || 0).toFixed(2);
              return;
            }
            await updateRequiredTons(scheduleId, newRequiredTons);
          });
          
          // Пересчитываем остаток при изменении необходимых тонн
          input.addEventListener('input', (e) => {
            const scheduleId = e.target.dataset.scheduleId;
            const itemElement = e.target.closest('.day-orders-item');
            const remainingSpan = itemElement.querySelector('.remaining');
            const shippedTonsInput = itemElement.querySelector('.shipped-tons-input');
            
            const newRequiredTons = parseFloat(e.target.value) || 0;
            const shippedTons = shippedTonsInput ? parseFloat(shippedTonsInput.value) || 0 : 0;
            const currentShipped = scheduleItemsForDay.find(item => item._id === scheduleId)?.shippedTons || 0;
            const totalShipped = shippedTons > 0 ? shippedTons : currentShipped;
            const remaining = newRequiredTons - totalShipped;
            
            if (remainingSpan) {
              remainingSpan.textContent = remaining.toFixed(2);
              remainingSpan.style.color = remaining > 0 ? '#dc2626' : '#059669';
            }
          });
        });
        
        // Добавляем обработчики для редактирования остатка
        const remainingInputs = list.querySelectorAll('.remaining-input');
        remainingInputs.forEach(input => {
          input.addEventListener('change', async (e) => {
            const scheduleId = e.target.dataset.scheduleId;
            const newRemaining = parseFloat(e.target.value) || 0;
            const item = scheduleItemsForDay.find(item => item._id === scheduleId);
            if (!item) return;
            
            const requiredTons = item.requiredTons || 0;
            const shippedTons = item.shippedTons || 0;
            // Остаток = Необходимо - Отправлено, поэтому изменяем необходимое
            const newRequiredTons = newRemaining + shippedTons;
            
            if (newRequiredTons < shippedTons) {
              alert("Остаток не может быть отрицательным");
              e.target.value = (requiredTons - shippedTons).toFixed(2);
              return;
            }
            
            await updateRequiredTons(scheduleId, newRequiredTons);
          });
        });
      }

      // Добавляем обработчики для пересчета остатка при вводе в поле "Загружаю, т"
      const shippedTonsInputs = list.querySelectorAll('.shipped-tons-input');
      shippedTonsInputs.forEach(input => {
        input.addEventListener('input', (e) => {
          const scheduleId = e.target.dataset.scheduleId;
          const itemElement = e.target.closest('.day-orders-item');
          const remainingSpan = itemElement.querySelector('.remaining');
          const requiredTonsInput = itemElement.querySelector('.required-tons-input');
          
          const shippedTons = parseFloat(e.target.value) || 0;
          const requiredTons = requiredTonsInput ? parseFloat(requiredTonsInput.value) || 0 : 
                               (scheduleItemsForDay.find(item => item._id === scheduleId)?.requiredTons || 0);
          const currentShipped = scheduleItemsForDay.find(item => item._id === scheduleId)?.shippedTons || 0;
          const totalShipped = shippedTons > 0 ? (currentShipped + shippedTons) : currentShipped;
          const remaining = requiredTons - totalShipped;
          
          if (remainingSpan) {
            remainingSpan.textContent = remaining.toFixed(2);
            remainingSpan.style.color = remaining > 0 ? '#dc2626' : '#059669';
          }
        });
      });

      // Обработчики для кнопки удаления (только для админа)
      if (isAdmin) {
        const deleteScheduleBtns = list.querySelectorAll('.delete-schedule-btn');
        deleteScheduleBtns.forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const scheduleId = e.target.dataset.scheduleId;
            if (!scheduleId) return;
            
            if (!confirm("Удалить заявку на загрузку из календаря?")) {
              return;
            }
            
            await deleteSchedule(scheduleId, date);
          });
        });
      }

      // Обработчики для кнопки отправки (доступны всем)
      const shipTonsBtns = list.querySelectorAll('.ship-tons-btn');
      shipTonsBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const scheduleId = e.target.dataset.scheduleId;
          const itemElement = e.target.closest('.day-orders-item');
          const shippedInput = itemElement.querySelector('.shipped-tons-input');
          const logisticianInput = itemElement.querySelector('.logistician-input');
          
          const shippedTons = shippedInput ? parseFloat(shippedInput.value) || 0 : 0;
          const logistician = logisticianInput ? logisticianInput.value.trim() : '';
          
          if (!logistician) {
            alert("Укажите имя логиста");
            return;
          }
          
          if (shippedTons <= 0) {
            alert("Укажите количество загружаемых тонн");
            return;
          }
          
          // Получаем текущее значение отправленных тонн и добавляем новое
          const currentItem = scheduleItemsForDay.find(item => item._id === scheduleId);
          const currentShippedTons = currentItem?.shippedTons || 0;
          const newTotalShippedTons = currentShippedTons + shippedTons;
          
          // Проверяем, не превышает ли новое значение необходимое количество
          const requiredTons = currentItem?.requiredTons || 0;
          if (newTotalShippedTons > requiredTons) {
            alert(`Нельзя отправить больше, чем необходимо. Максимум: ${requiredTons.toFixed(2)} т (уже отправлено: ${currentShippedTons.toFixed(2)} т)`);
            return;
          }
          
          await updateShippedTons(scheduleId, newTotalShippedTons, logistician);
          
          // Очищаем поля после успешного сохранения
          shippedInput.value = "";
          logisticianInput.value = "";
        });
      });
    }

    modal.classList.remove("hidden");

    if (closeBtn) {
      closeBtn.onclick = () => {
        modal.classList.add("hidden");
      };
    }

    // Закрытие по клику на backdrop
    const backdrop = modal.querySelector(".modal-backdrop");
    if (backdrop) {
      backdrop.onclick = () => {
        modal.classList.add("hidden");
      };
    }
  }

  // Функция для обновления отправленных тонн (доступна всем)
  async function updateShippedTons(scheduleId, shippedTons, logistician = '') {
    try {
      const headers = { "Content-Type": "application/json" };
      // Авторизация не требуется для отправки груза

      const updateData = { shippedTons };
      if (logistician) {
        updateData.logistician = logistician;
      }

      const res = await fetch(`${API_BASE}/schedule/${scheduleId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(updateData),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to update shipped tons");
      }

      // Перезагружаем расписание и обновляем календарь
      try {
        await loadSchedule();
      } catch (e) {
        console.warn("Ошибка при перезагрузке расписания (не критично):", e);
      }
      
      // Перезагружаем активность
      try {
        await loadActivities();
      } catch (e) {
        console.warn("Ошибка при перезагрузке активности (не критично):", e);
      }
      
      // Обновляем модальное окно, если оно открыто
      try {
        const modal = document.getElementById("dayOrdersModal");
        if (modal && !modal.classList.contains("hidden")) {
          // Находим текущую дату из заголовка
          const title = document.getElementById("dayOrdersTitle");
          if (title) {
            // Парсим дату из заголовка и переоткрываем модальное окно
            const dateMatch = title.textContent.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
            if (dateMatch) {
              const day = parseInt(dateMatch[1]);
              const monthNames = ["января", "февраля", "марта", "апреля", "мая", "июня",
                                 "июля", "августа", "сентября", "октября", "ноября", "декабря"];
              const month = monthNames.indexOf(dateMatch[2].toLowerCase());
              const year = parseInt(dateMatch[3]);
              if (month !== -1) {
                const date = new Date(year, month, day);
                const dayScheduleItems = window.getScheduleItemsForDate ? window.getScheduleItemsForDate(date) : [];
                showDayOrdersModal(date, dayScheduleItems);
              }
            }
          }
        }
      } catch (e) {
        console.warn("Ошибка при обновлении модального окна (не критично):", e);
      }
    } catch (err) {
      console.error("Ошибка при обновлении отправленных тонн:", err);
      // Показываем alert только при реальной ошибке сервера
      if (err.message && !err.message.includes('loadSchedule') && !err.message.includes('loadActivities')) {
        alert("Не удалось обновить отправленные тонны. См. консоль.");
      }
    }
  }

  // Функция для удаления заявки на загрузку из календаря
  async function deleteSchedule(scheduleId, date) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (adminToken) {
        headers["Authorization"] = "Bearer " + adminToken;
      }

      const res = await fetch(`${API_BASE}/schedule/${scheduleId}`, {
        method: "DELETE",
        headers,
      });

      if (!res.ok) {
        throw new Error("Failed to delete schedule item");
      }

      // Перезагружаем расписание и обновляем календарь
      try {
        await loadSchedule();
      } catch (e) {
        console.warn("Ошибка при перезагрузке расписания (не критично):", e);
      }
      
      // Перезагружаем активность
      try {
        await loadActivities();
      } catch (e) {
        console.warn("Ошибка при перезагрузке активности (не критично):", e);
      }
      
      // Обновляем модальное окно, если оно открыто
      try {
        const modal = document.getElementById("dayOrdersModal");
        if (modal && !modal.classList.contains("hidden")) {
          const dayScheduleItems = window.getScheduleItemsForDate ? window.getScheduleItemsForDate(date) : [];
          if (dayScheduleItems.length === 0) {
            // Если заявок не осталось, закрываем модальное окно
            modal.classList.add("hidden");
          } else {
            // Иначе обновляем содержимое
            showDayOrdersModal(date, dayScheduleItems);
          }
        }
      } catch (e) {
        console.warn("Ошибка при обновлении модального окна (не критично):", e);
      }
      
      // Обновляем календарь
      if (window.renderCalendar) {
        window.renderCalendar();
      }
    } catch (err) {
      console.error("Ошибка при удалении заявки на загрузку:", err);
      alert("Не удалось удалить заявку на загрузку. См. консоль.");
    }
  }

  // Функция для обновления необходимых тонн
  async function updateRequiredTons(scheduleId, requiredTons) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (adminToken) {
        headers["Authorization"] = "Bearer " + adminToken;
      }

      const res = await fetch(`${API_BASE}/schedule/${scheduleId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ requiredTons }),
      });

      if (!res.ok) {
        throw new Error("Failed to update required tons");
      }

      // Перезагружаем расписание и обновляем календарь
      await loadSchedule();
      await loadActivities();
      
      // Обновляем модальное окно, если оно открыто
      const modal = document.getElementById("dayOrdersModal");
      if (modal && !modal.classList.contains("hidden")) {
        const title = document.getElementById("dayOrdersTitle");
        if (title) {
          const dateMatch = title.textContent.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
          if (dateMatch) {
            const day = parseInt(dateMatch[1]);
            const monthNames = ["января", "февраля", "марта", "апреля", "мая", "июня",
                               "июля", "августа", "сентября", "октября", "ноября", "декабря"];
            const month = monthNames.indexOf(dateMatch[2].toLowerCase());
            const year = parseInt(dateMatch[3]);
            if (month !== -1) {
              const date = new Date(year, month, day);
              const dayScheduleItems = window.getScheduleItemsForDate ? window.getScheduleItemsForDate(date) : [];
              showDayOrdersModal(date, dayScheduleItems);
            }
          }
        }
      }
    } catch (err) {
      console.error("Ошибка при обновлении необходимых тонн:", err);
      alert("Не удалось обновить необходимые тонны. См. консоль.");
    }
  }

  btnPrev.addEventListener("click", () => {
    current.setMonth(current.getMonth() - 1);
    renderCalendar();
  });

  btnNext.addEventListener("click", () => {
    current.setMonth(current.getMonth() + 1);
    renderCalendar();
  });

  // Сохраняем функцию для глобального доступа
  renderCalendarFn = renderCalendar;

  // Вызываем рендеринг сразу
  renderCalendar();
}

/* ======================== ЛЕНТА АКТИВНОСТИ ======================== */

let activities = [];

async function loadActivities(silent = false) {
  try {
    const res = await fetch(`${API_BASE}/activities?limit=100`);
    if (!res.ok) {
      throw new Error("Server error: " + res.status);
    }
    const data = await res.json();
    activities = data || [];
    renderActivities();
  } catch (err) {
    console.error("Ошибка при загрузке активности:", err);
    // Не показываем alert при автоматическом обновлении
  }
}

function renderActivities() {
  const list = document.getElementById("activityList");
  if (!list) return;

  if (activities.length === 0) {
    list.innerHTML = "<p class='activity-empty'>Нет активности</p>";
    return;
  }

  let html = "";
  activities.forEach(activity => {
    const date = new Date(activity.createdAt);
    const dateStr = date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    let icon = "📋";
    let className = "activity-item";
    
    switch(activity.type) {
      case 'order_created':
        icon = "➕";
        className += " activity-order-created";
        break;
      case 'order_updated':
        icon = "✏️";
        className += " activity-order-updated";
        break;
      case 'schedule_created':
        icon = "📅";
        className += " activity-schedule-created";
        break;
      case 'tons_shipped':
        icon = "🚚";
        className += " activity-tons-shipped";
        break;
      case 'schedule_completed':
        icon = "✅";
        className += " activity-schedule-completed";
        break;
    }

    // Формируем детальное сообщение
    let detailedMessage = activity.message;
    let details = [];
    
    if (activity.orderId && typeof activity.orderId === 'object') {
      const order = activity.orderId;
      if (order.from) details.push(`<strong>Откуда:</strong> ${order.from}`);
      if (order.to) details.push(`<strong>Куда:</strong> ${order.to}`);
      if (order.cargo) details.push(`<strong>Груз:</strong> ${order.cargo}`);
    }
    
    if (activity.logistician) {
      details.push(`<strong>Логист:</strong> ${activity.logistician}`);
    }
    
    if (activity.tons) {
      details.push(`<strong>Тонн:</strong> ${activity.tons.toFixed(2)} т`);
    }
    
    if (activity.date) {
      const loadingDate = new Date(activity.date).toLocaleDateString('ru-RU');
      details.push(`<strong>Дата загрузки:</strong> ${loadingDate}`);
    }
    
    // Если есть scheduleId, получаем информацию о расписании
    if (activity.scheduleId && typeof activity.scheduleId === 'object') {
      const schedule = activity.scheduleId;
      if (schedule.requiredTons) {
        details.push(`<strong>Необходимо:</strong> ${schedule.requiredTons.toFixed(2)} т`);
      }
      if (schedule.shippedTons !== undefined) {
        details.push(`<strong>Отправлено:</strong> ${schedule.shippedTons.toFixed(2)} т`);
        const remaining = (schedule.requiredTons || 0) - (schedule.shippedTons || 0);
        details.push(`<strong>Остаток:</strong> ${remaining.toFixed(2)} т`);
      }
    }

    html += `<div class="${className}">
      <div class="activity-icon">${icon}</div>
      <div class="activity-content">
        <div class="activity-message">${detailedMessage}</div>
        ${details.length > 0 ? `<div class="activity-details">${details.join(' • ')}</div>` : ''}
        <div class="activity-time">${dateStr}</div>
      </div>
    </div>`;
  });

  list.innerHTML = html;
}

function setupActivityFeed() {
  // Функция больше не нужна, так как автообновление вынесено в setupAutoRefresh
}

// ======================== АВТОМАТИЧЕСКОЕ ОБНОВЛЕНИЕ ДАННЫХ ========================

let autoRefreshInterval = null;
let isAutoRefreshEnabled = true;

function setupAutoRefresh() {
  // Останавливаем предыдущий интервал, если он был
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }

  // Функция для обновления всех данных
  async function refreshAllData() {
    if (!isAutoRefreshEnabled) return;
    
    try {
      // Обновляем заявки (это также обновит расписание через loadOrders)
      await loadOrders(true); // silent = true для автообновления
      
      // Обновляем активность
      await loadActivities(true); // silent = true для автообновления
      
      // Расписание уже обновляется в loadOrders, но на всякий случай обновим отдельно
      await loadSchedule(true); // silent = true для автообновления
      
      // Обновляем водителей
      await loadDrivers();
    } catch (err) {
      console.error("Ошибка при автообновлении данных:", err);
    }
  }

  // Обновляем данные каждые 10 секунд
  autoRefreshInterval = setInterval(refreshAllData, 10000);
  
  // Также обновляем при возврате фокуса на вкладку (если пользователь переключился)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && isAutoRefreshEnabled) {
      refreshAllData();
    }
  });
  
  // Обновляем при возврате фокуса на окно
  window.addEventListener("focus", () => {
    if (isAutoRefreshEnabled) {
      refreshAllData();
    }
  });
}

// Функция для остановки автообновления (если понадобится)
function stopAutoRefresh() {
  isAutoRefreshEnabled = false;
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Функция для возобновления автообновления
function startAutoRefresh() {
  isAutoRefreshEnabled = true;
  setupAutoRefresh();
}

// ======================== ВОДИТЕЛИ ========================

async function loadDrivers() {
  try {
    const res = await fetch(`${API_BASE}/drivers`);
    if (!res.ok) {
      throw new Error("Server error: " + res.status);
    }
    const data = await res.json();
    drivers = data || [];
    renderDrivers();
  } catch (err) {
    console.error("Ошибка при загрузке водителей:", err);
  }
}

function renderDrivers() {
  if (!map || !window.ymaps) {
    return;
  }
  
  // Если driversLayer еще не создан, создаем его
  if (!driversLayer) {
    driversLayer = new ymaps.GeoObjectCollection();
    map.geoObjects.add(driversLayer);
  }
  
  // Очищаем существующие маркеры водителей
  driversLayer.removeAll();
  
  if (!showDrivers) {
    return;
  }
  
  drivers.forEach(driver => {
    if (!driver.lat || !driver.lon) return;
    
    // Создаем зеленый флажок для водителя
    const deleteButton = isAdmin ? `<br><button onclick="deleteDriver('${driver._id}')" style="margin-top: 8px; padding: 4px 12px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;">Удалить водителя</button>` : '';
    
    const marker = new ymaps.Placemark(
      [driver.lat, driver.lon],
      {
        balloonContent: `<div style="padding: 8px;">
          <strong>Водитель</strong><br>
          <strong>Адрес:</strong> ${driver.address || 'Не указан'}<br>
          ${driver.comment ? `<strong>Комментарий:</strong> ${driver.comment}` : ''}
          ${deleteButton}
        </div>`,
        hintContent: driver.address || 'Водитель'
      },
      {
        preset: 'islands#greenDotIcon', // зеленая точка
        iconColor: '#10b981', // яркий зеленый цвет
        draggable: false
      }
    );
    
    // При клике открываем балун с комментарием
    marker.events.add('click', () => {
      marker.balloon.open();
    });
    
    driversLayer.add(marker);
  });
}

async function onAddDriverSubmit(e) {
  e.preventDefault();
  
  const addressInput = document.getElementById("driverAddressInput");
  const commentInput = document.getElementById("driverCommentInput");
  
  const address = addressInput?.value.trim() || "";
  const comment = commentInput?.value.trim() || "";
  
  if (!address) {
    alert("Укажите адрес водителя");
    return;
  }
  
  try {
    // Геокодируем адрес
    const coords = await geocodeAddress(address);
    if (!coords) {
      alert("Не удалось определить координаты по адресу. Попробуйте уточнить адрес.");
      return;
    }
    
    const newDriver = {
      address,
      comment: comment || undefined,
      lat: coords[0],
      lon: coords[1],
    };
    
    const headers = { "Content-Type": "application/json" };
    if (adminToken) {
      headers["Authorization"] = "Bearer " + adminToken;
    }
    
    const res = await fetch(`${API_BASE}/drivers`, {
      method: "POST",
      headers,
      body: JSON.stringify(newDriver),
    });
    
    if (!res.ok) {
      throw new Error("Failed to create driver");
    }
    
    // Очищаем форму
    if (addressInput) addressInput.value = "";
    if (commentInput) commentInput.value = "";
    
    // Перезагружаем водителей
    await loadDrivers();
  } catch (err) {
    console.error(err);
    alert("Не удалось добавить водителя. См. консоль.");
  }
}

// Функция для удаления водителя (вызывается из балуна)
async function deleteDriver(driverId) {
  if (!isAdmin) {
    alert("Только администратор может удалять водителей");
    return;
  }
  
  if (!confirm("Удалить водителя?")) {
    return;
  }
  
  try {
    const headers = { "Content-Type": "application/json" };
    if (adminToken) {
      headers["Authorization"] = "Bearer " + adminToken;
    }
    
    const res = await fetch(`${API_BASE}/drivers/${driverId}`, {
      method: "DELETE",
      headers,
    });
    
    if (!res.ok) {
      throw new Error("Failed to delete driver");
    }
    
    // Перезагружаем водителей
    await loadDrivers();
    
    // Закрываем все открытые балуны
    if (map && driversLayer) {
      driversLayer.each((marker) => {
        if (marker.balloon && marker.balloon.isOpen()) {
          marker.balloon.close();
        }
      });
    }
  } catch (err) {
    console.error(err);
    alert("Не удалось удалить водителя. См. консоль.");
  }
}

// Делаем функцию глобальной для вызова из HTML
window.deleteDriver = deleteDriver;

// ======================== ВОДИТЕЛИ ========================

async function loadDrivers() {
  try {
    const res = await fetch(`${API_BASE}/drivers`);
    if (!res.ok) {
      throw new Error("Server error: " + res.status);
    }
    const data = await res.json();
    drivers = data || [];
    renderDrivers();
  } catch (err) {
    console.error("Ошибка при загрузке водителей:", err);
  }
}

function renderDrivers() {
  if (!map || !window.ymaps) {
    return;
  }
  
  // Если driversLayer еще не создан, создаем его
  if (!driversLayer) {
    driversLayer = new ymaps.GeoObjectCollection();
    map.geoObjects.add(driversLayer);
  }
  
  // Очищаем существующие маркеры водителей
  driversLayer.removeAll();
  
  if (!showDrivers) {
    return;
  }
  
  drivers.forEach(driver => {
    if (!driver.lat || !driver.lon) return;
    
    // Создаем зеленый флажок для водителя
    const deleteButton = isAdmin ? `<br><button onclick="deleteDriver('${driver._id}')" style="margin-top: 8px; padding: 4px 12px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;">Удалить водителя</button>` : '';
    
    const marker = new ymaps.Placemark(
      [driver.lat, driver.lon],
      {
        balloonContent: `<div style="padding: 8px;">
          <strong>Водитель</strong><br>
          <strong>Адрес:</strong> ${driver.address || 'Не указан'}<br>
          ${driver.comment ? `<strong>Комментарий:</strong> ${driver.comment}` : ''}
          ${deleteButton}
        </div>`,
        hintContent: driver.address || 'Водитель'
      },
      {
        preset: 'islands#greenDotIcon', // зеленая точка
        iconColor: '#10b981', // яркий зеленый цвет
        draggable: false
      }
    );
    
    // При клике открываем балун с комментарием
    marker.events.add('click', () => {
      marker.balloon.open();
    });
    
    driversLayer.add(marker);
  });
}

async function onAddDriverSubmit(e) {
  e.preventDefault();
  
  const addressInput = document.getElementById("driverAddressInput");
  const commentInput = document.getElementById("driverCommentInput");
  
  const address = addressInput?.value.trim() || "";
  const comment = commentInput?.value.trim() || "";
  
  if (!address) {
    alert("Укажите адрес водителя");
    return;
  }
  
  try {
    // Геокодируем адрес
    const coords = await geocodeAddress(address);
    if (!coords) {
      alert("Не удалось определить координаты по адресу. Попробуйте уточнить адрес.");
      return;
    }
    
    const newDriver = {
      address,
      comment: comment || undefined,
      lat: coords[0],
      lon: coords[1],
    };
    
    const headers = { "Content-Type": "application/json" };
    if (adminToken) {
      headers["Authorization"] = "Bearer " + adminToken;
    }
    
    const res = await fetch(`${API_BASE}/drivers`, {
      method: "POST",
      headers,
      body: JSON.stringify(newDriver),
    });
    
    if (!res.ok) {
      throw new Error("Failed to create driver");
    }
    
    // Очищаем форму
    if (addressInput) addressInput.value = "";
    if (commentInput) commentInput.value = "";
    
    // Перезагружаем водителей
    await loadDrivers();
  } catch (err) {
    console.error(err);
    alert("Не удалось добавить водителя. См. консоль.");
  }
}