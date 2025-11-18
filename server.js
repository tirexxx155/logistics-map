// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

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
  },
  { timestamps: true }
);



const Order = mongoose.model('Order', orderSchema);

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
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/orders error:', err);
    res
      .status(500)
      .json({ message: 'Ошибка сервера при удалении заявки' });
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