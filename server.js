// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

// если локально будешь использовать .env – это не мешает на Render
try {
  require('dotenv').config();
} catch (_) {}

const app = express();
const PORT = process.env.PORT || 5050;

// ------------ БАЗОВЫЕ MIDDLEWARE ------------
app.use(cors());
app.use(express.json());

// статика: index.html, main.js, style.css и т.д.
app.use(express.static(__dirname));

// ------------ ПОДКЛЮЧЕНИЕ К MONGODB ------------
const mongoUri =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/logistics_map';

mongoose
  .connect(mongoUri)
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
  });

// ------------ МОДЕЛЬ ЗАЯВКИ ------------
const orderSchema = new mongoose.Schema(
  {
    from: String,
    to: String,
    cargo: String,
    pricePerTon: Number,
    distanceKm: Number,
    lat: Number,
    lon: Number,
    unloadLat: Number,
    unloadLon: Number,
    norm: String,
    volume: String,
    comment: String,          // <-- новое поле
    loadingDate: Date,        // <-- дата загрузки для календаря
    client: String,           // <-- клиент
  },
  { timestamps: true }
);



const Order = mongoose.model('Order', orderSchema);

// ------------ МОДЕЛЬ РАСПИСАНИЯ ЗАГРУЗКИ ------------
const scheduleItemSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    loadingDate: { type: Date, required: true },
    requiredTons: { type: Number, required: true }, // необходимое количество тонн
    shippedTons: { type: Number, default: 0 },      // отправленное количество тонн
    comment: String,                                 // комментарий для этой даты
    logistician: String,                             // логист, который отправляет тонны
    clientPrice: Number,                             // цена клиента
    ourPrice: Number,                                // наша цена
  },
  { timestamps: true }
);

// Индекс для быстрого поиска по дате
scheduleItemSchema.index({ loadingDate: 1 });

const ScheduleItem = mongoose.model('ScheduleItem', scheduleItemSchema);

// ------------ МОДЕЛЬ АКТИВНОСТИ ------------
const activitySchema = new mongoose.Schema(
  {
    type: { 
      type: String, 
      required: true,
      enum: ['order_created', 'order_updated', 'schedule_created', 'schedule_updated', 'tons_shipped', 'schedule_completed']
    },
    message: { type: String, required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'ScheduleItem' },
    logistician: String,
    tons: Number,
    date: Date,
  },
  { timestamps: true }
);

// Индекс для сортировки по времени
activitySchema.index({ createdAt: -1 });

const Activity = mongoose.model('Activity', activitySchema);

// ------------ МОДЕЛЬ ВОДИТЕЛЯ ------------
const driverSchema = new mongoose.Schema(
  {
    address: { type: String, required: true },
    comment: String,
    lat: Number,
    lon: Number,
  },
  { timestamps: true }
);

const Driver = mongoose.model('Driver', driverSchema);

// ------------ TELEGRAM ИНТЕГРАЦИЯ ------------

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8588186081:AAEgiznswcPK0UIkEgBKTs-NY_wL1nfK6CI';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003225004952';

// Функция для отправки сообщений в Telegram
async function sendToTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('⚠️ Telegram не настроен: отсутствует TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
    };

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const response = await new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(JSON.stringify(data));
      req.end();
    });

    console.log('✅ Сообщение отправлено в Telegram');
  } catch (error) {
    // Логируем ошибку, но не выбрасываем её дальше, чтобы не ломать основной процесс
    console.error('❌ Ошибка отправки в Telegram (не критично):', error.message);
    // НЕ выбрасываем ошибку, чтобы не прерывать сохранение данных
  }
}

// ------------ ПРОСТАЯ АДМИН-АВТОРИЗАЦИЯ ------------


const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'admin123').trim();

// просто лог для проверки, что видит сервер
console.log('🔐 ADMIN_PASSWORD on server =', JSON.stringify(ADMIN_PASSWORD));

// токен = sha256(пароля) — чтобы в браузере не светить сам пароль
function getAdminToken() {
  return crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');
}

// Вход: POST /api/login ИЛИ /api/admin/login  { password }
app.post(['/api/login', '/api/admin/login'], (req, res) => {
  const password = (req.body && req.body.password
    ? String(req.body.password).trim()
    : '');

  console.log('💬 Login attempt, got password =', JSON.stringify(password));

  if (!password || password !== ADMIN_PASSWORD) {
    return res
      .status(401)
      .json({ message: 'Неверный пароль администратора' });
  }

  const token = getAdminToken();
  return res.json({ token });
});

// middleware: проверка, что запрос пришёл от админа
function requireAdmin(req, res, next) {
  const authHeader =
    req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token || token !== getAdminToken()) {
    return res
      .status(401)
      .json({ message: 'Только администратор может изменять заявки' });
  }

  next();
}

// ------------ API -------------

// GET /api/orders — доступен всем (и обычным пользователям тоже)
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error('GET /api/orders error:', err);
    res.status(500).json({ message: 'Ошибка сервера при получении заявок' });
  }
});

// POST /api/orders — только админ
app.post('/api/orders', requireAdmin, async (req, res) => {
  try {
    const order = new Order(req.body);
    const saved = await order.save();
    
    // Создаем запись активности
    const activity = new Activity({
      type: 'order_created',
      message: `Появилась новая заявка: ${saved.cargo || 'Груз'} от ${saved.from || 'Поставщик'} → ${saved.to || 'Выгрузка'}`,
      orderId: saved._id,
    });
    await activity.save();
    
    // Отправляем в Telegram
    await sendToTelegram(`🆕 <b>Новая заявка</b>\n\n` +
      `${saved.client ? `Клиент: ${saved.client}\n` : ''}` +
      `Груз: ${saved.cargo || 'Не указан'}\n` +
      `Откуда: ${saved.from || 'Не указано'}\n` +
      `Куда: ${saved.to || 'Не указано'}\n` +
      `${saved.norm ? `Тип загрузки: ${saved.norm}\n` : ''}` +
      `${saved.distanceKm ? `Расстояние: ${saved.distanceKm} км` : ''}`);
    
    res.status(201).json(saved);
  } catch (err) {
    console.error('POST /api/orders error:', err);
    res
      .status(500)
      .json({ message: 'Ошибка сервера при создании заявки' });
  }
});

// PUT /api/orders/:id — только админ
app.put('/api/orders/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Order.findByIdAndUpdate(id, req.body, {
      new: true,
    });
    if (!updated) {
      return res.status(404).json({ message: 'Заявка не найдена' });
    }
    
   
    
    // Создаем запись активности
    const activity = new Activity({
      type: 'order_updated',
      message: `Заявка обновлена: ${updated.cargo || 'Груз'} от ${updated.from || 'Поставщик'} → ${updated.to || 'Выгрузка'}`,
      orderId: updated._id,
    });
    await activity.save();
    
    // Отправляем в Telegram
    await sendToTelegram(`✏️ <b>Заявка обновлена</b>\n\n` +
      `${updated.client ? `Клиент: ${updated.client}\n` : ''}` +
      `Груз: ${updated.cargo || 'Не указан'}\n` +
      `Откуда: ${updated.from || 'Не указано'}\n` +
      `Куда: ${updated.to || 'Не указано'}\n` +
      `${updated.norm ? `Тип загрузки: ${updated.norm}\n` : ''}` +
      `${updated.distanceKm ? `Расстояние: ${updated.distanceKm} км` : ''}`);
    
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/orders error:', err);
    res
      .status(500)
      .json({ message: 'Ошибка сервера при обновлении заявки' });
  }
});

// DELETE /api/orders/:id — только админ
app.delete('/api/orders/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Order.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Заявка не найдена' });
    }
    
    // Удаляем все связанные записи расписания (каскадное удаление)
    await ScheduleItem.deleteMany({ orderId: id });
    
    // Удаляем связанные записи активности
    await Activity.deleteMany({ orderId: id });
    
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/orders error:', err);
    res
      .status(500)
      .json({ message: 'Ошибка сервера при удалении заявки' });
  }
});

// ------------ API ДЛЯ РАСПИСАНИЯ ЗАГРУЗОК ------------

// GET /api/schedule — получить все назначения (с заявками)
app.get('/api/schedule', async (req, res) => {
  try {
    const schedule = await ScheduleItem.find().populate('orderId').sort({ loadingDate: 1 });
    // Фильтруем записи, у которых заявка была удалена (orderId === null)
    const filteredSchedule = schedule.filter(item => item.orderId !== null);
    res.json(filteredSchedule);
  } catch (err) {
    console.error('GET /api/schedule error:', err);
    res.status(500).json({ message: 'Ошибка сервера при получении расписания' });
  }
});

// GET /api/schedule/date/:date — получить назначения на конкретную дату
app.get('/api/schedule/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);
    
    const schedule = await ScheduleItem.find({
      loadingDate: { $gte: startDate, $lte: endDate }
    }).populate('orderId');
    
    // Фильтруем записи, у которых заявка была удалена (orderId === null)
    const filteredSchedule = schedule.filter(item => item.orderId !== null);
    
    res.json(filteredSchedule);
  } catch (err) {
    console.error('GET /api/schedule/date error:', err);
    res.status(500).json({ message: 'Ошибка сервера при получении расписания' });
  }
});

// POST /api/schedule — создать новое назначение (только админ)
app.post('/api/schedule', requireAdmin, async (req, res) => {
  try {
    const scheduleItem = new ScheduleItem(req.body);
    const saved = await scheduleItem.save();
    const populated = await ScheduleItem.findById(saved._id).populate('orderId');
    
    // Создаем запись активности
    const order = populated.orderId;
    const loadingDate = new Date(populated.loadingDate).toLocaleDateString('ru-RU');
    const clientInfo = order.client ? ` (Клиент: ${order.client})` : '';
    const activity = new Activity({
      type: 'schedule_created',
      message: `Появилась новая загрузка на ${loadingDate}: ${order.cargo || 'Груз'} (${populated.requiredTons} т) от ${order.from || 'Поставщик'}${clientInfo}`,
      orderId: order._id,
      scheduleId: populated._id,
      date: populated.loadingDate,
      tons: populated.requiredTons,
    });
    await activity.save();
    
    // Отправляем в Telegram
    await sendToTelegram(`📅 <b>Новая загрузка</b>\n\n` +
      `${order.client ? `Клиент: ${order.client}\n` : ''}` +
      `Дата: ${loadingDate}\n` +
      `Груз: ${order.cargo || 'Не указан'}\n` +
      `Откуда: ${order.from || 'Не указано'}\n` +
      `Куда: ${order.to || 'Не указано'}\n` +
      `Необходимо: ${populated.requiredTons} т\n` +
      `${populated.clientPrice != null ? `Цена клиента: ${populated.clientPrice} ₽/т\n` : ''}` +
      `${populated.ourPrice != null ? `Наша цена: ${populated.ourPrice} ₽/т\n` : ''}` +
      `${populated.comment ? `Комментарий: ${populated.comment}` : ''}`);
    
    res.status(201).json(populated);
  } catch (err) {
    console.error('POST /api/schedule error:', err);
    res.status(500).json({ message: 'Ошибка сервера при создании назначения' });
  }
});

// PUT /api/schedule/:id — обновить назначение
// Обновление shippedTons доступно всем, остальные поля - только админу
app.put('/api/schedule/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const oldItem = await ScheduleItem.findById(id).populate('orderId');
    if (!oldItem) {
      return res.status(404).json({ message: 'Назначение не найдено' });
    }
    
    // Проверяем, что пользователь пытается изменить только shippedTons и logistician
    // Если пытается изменить другие поля - требуется авторизация админа
    const isOnlyShippingUpdate = Object.keys(req.body).every(key => 
      key === 'shippedTons' || key === 'logistician'
    );
    
    if (!isOnlyShippingUpdate) {
      // Если пытается изменить другие поля, проверяем авторизацию админа
      const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'admin123').trim();
      const adminToken = require('crypto').createHash('sha256').update(ADMIN_PASSWORD).digest('hex');
      
      if (!token || token !== adminToken) {
        return res.status(401).json({ message: 'Только администратор может изменять назначение' });
      }
    }
    
    const updated = await ScheduleItem.findByIdAndUpdate(id, req.body, { new: true })
      .populate('orderId');
    if (!updated) {
      return res.status(404).json({ message: 'Назначение не найдено' });
    }
    
    // Создаем запись активности при изменении отправленных тонн
    if (req.body.shippedTons !== undefined && req.body.shippedTons !== oldItem.shippedTons) {
      const order = updated.orderId;
      const loadingDate = new Date(updated.loadingDate).toLocaleDateString('ru-RU');
      const logistician = req.body.logistician || updated.logistician || 'Логист';
      const tonsDiff = req.body.shippedTons - (oldItem.shippedTons || 0);
      
      let activityType = 'tons_shipped';
      let message = '';
      
      if (updated.shippedTons >= updated.requiredTons) {
        activityType = 'schedule_completed';
        message = `Загрузка на ${loadingDate} полностью выполнена: ${order.cargo || 'Груз'} (${updated.requiredTons} т) от ${order.from || 'Поставщик'}`;
      } else {
        message = `${logistician} отправил ${tonsDiff.toFixed(2)} т по заявке "${order.cargo || 'Груз'}" на ${loadingDate}. Всего отправлено: ${updated.shippedTons.toFixed(2)} т из ${updated.requiredTons.toFixed(2)} т`;
      }
      
      const activity = new Activity({
        type: activityType,
        message,
        orderId: order._id,
        scheduleId: updated._id,
        logistician: logistician,
        tons: tonsDiff,
        date: updated.loadingDate,
      });
      await activity.save();
      
      // Отправляем в Telegram
      if (activityType === 'schedule_completed') {
        await sendToTelegram(`✅ <b>Загрузка полностью выполнена</b>\n\n` +
          `${order.client ? `Клиент: ${order.client}\n` : ''}` +
          `Дата: ${loadingDate}\n` +
          `Груз: ${order.cargo || 'Не указан'}\n` +
          `Откуда: ${order.from || 'Не указано'}\n` +
          `Куда: ${order.to || 'Не указано'}\n` +
          `Отправлено: ${updated.shippedTons.toFixed(2)} т из ${updated.requiredTons.toFixed(2)} т\n` +
          `${updated.clientPrice != null ? `Цена клиента: ${updated.clientPrice} ₽/т\n` : ''}` +
          `${updated.ourPrice != null ? `Наша цена: ${updated.ourPrice} ₽/т\n` : ''}` +
          `${updated.comment ? `Комментарий: ${updated.comment}` : ''}`);
      } else {
        await sendToTelegram(`🚚 <b>Отправил груз</b>\n\n` +
          `${order.client ? `Клиент: ${order.client}\n` : ''}` +
          `Логист: ${logistician || 'Не указан'}\n` +
          `Дата: ${loadingDate}\n` +
          `Груз: ${order.cargo || 'Не указан'}\n` +
          `Откуда: ${order.from || 'Не указано'}\n` +
          `Куда: ${order.to || 'Не указано'}\n` +
          `Отправлено: ${tonsDiff.toFixed(2)} т\n` +
          `Всего: ${updated.shippedTons.toFixed(2)} т из ${updated.requiredTons.toFixed(2)} т\n` +
          `Остаток: ${(updated.requiredTons - updated.shippedTons).toFixed(2)} т\n` +
          `${updated.clientPrice != null ? `Цена клиента: ${updated.clientPrice} ₽/т\n` : ''}` +
          `${updated.ourPrice != null ? `Наша цена: ${updated.ourPrice} ₽/т\n` : ''}` +
          `${updated.comment ? `Комментарий: ${updated.comment}` : ''}`);
      }
    }
    
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/schedule error:', err);
    res.status(500).json({ message: 'Ошибка сервера при обновлении назначения' });
  }
});

// DELETE /api/schedule/:id — удалить назначение (только админ)
app.delete('/api/schedule/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await ScheduleItem.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Назначение не найдено' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/schedule error:', err);
    res.status(500).json({ message: 'Ошибка сервера при удалении назначения' });
  }
});

// ------------ API ДЛЯ ВОДИТЕЛЕЙ ------------

// GET /api/drivers — получить всех водителей
app.get('/api/drivers', async (req, res) => {
  try {
    const drivers = await Driver.find();
    res.json(drivers);
  } catch (err) {
    console.error('GET /api/drivers error:', err);
    res.status(500).json({ message: 'Ошибка сервера при получении водителей' });
  }
});

// POST /api/drivers — создать нового водителя (только админ)
app.post('/api/drivers', requireAdmin, async (req, res) => {
  try {
    const driver = new Driver(req.body);
    const saved = await driver.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error('POST /api/drivers error:', err);
    res.status(500).json({ message: 'Ошибка сервера при создании водителя' });
  }
});

// DELETE /api/drivers/:id — удалить водителя (только админ)
app.delete('/api/drivers/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Driver.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Водитель не найден' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/drivers error:', err);
    res.status(500).json({ message: 'Ошибка сервера при удалении водителя' });
  }
});

// ------------ API ДЛЯ АКТИВНОСТИ ------------

// GET /api/activities — получить последние записи активности
app.get('/api/activities', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const activities = await Activity.find()
      .populate('orderId')
      .populate('scheduleId')
      .sort({ createdAt: -1 })
      .limit(limit);
    res.json(activities);
  } catch (err) {
    console.error('GET /api/activities error:', err);
    res.status(500).json({ message: 'Ошибка сервера при получении активности' });
  }
});

// главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ------------ ЗАПУСК СЕРВЕРА ------------
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});