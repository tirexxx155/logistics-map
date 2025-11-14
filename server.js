const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// Render сам задаёт PORT через переменную среды
const PORT = process.env.PORT || 5050;

// --- middleware ---
app.use(cors());
app.use(express.json());

// отдаём статические файлы: index.html, main.js, style.css, картинки
app.use(express.static(__dirname));

// --- подключение к MongoDB ---
// Локально можно использовать mongodb://127.0.0.1:27017/logistics_map
// На Render берётся строка из MONGODB_URI
const mongoUri =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/logistics_map';

mongoose
  .connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// --- схема и модель ЗАЯВОК ---
// Без обязательных (required) полей, чтобы ничего не валилось на валидации
const orderSchema = new mongoose.Schema(
  {
    lat: Number,
    lon: Number,
    from: String,
    to: String,
    cargo: String,
    pricePerTon: Number,
    distanceKm: Number,
  },
  { timestamps: true }
);

const Order = mongoose.model('Order', orderSchema);

// --- API ---
// Получить все заявки
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error('GET /api/orders error:', err);
    res.status(500).json({ error: 'Server error while loading orders' });
  }
});

// Создать заявку
app.post('/api/orders', async (req, res) => {
  try {
    console.log('POST /api/orders body:', req.body);
    const order = new Order(req.body);
    await order.save();
    res.status(201).json(order);
  } catch (err) {
    console.error('POST /api/orders error:', err);
    res.status(500).json({ error: 'Server error while creating order' });
  }
});

// Обновить заявку
app.put('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(order);
  } catch (err) {
    console.error('PUT /api/orders error:', err);
    res.status(500).json({ error: 'Server error while updating order' });
  }
});

// Удалить заявку
app.delete('/api/orders/:id', async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/orders error:', err);
    res.status(500).json({ error: 'Server error while deleting order' });
  }
});

// Отдаём главную страницу с картой
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
