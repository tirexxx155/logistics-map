const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// Порт: в облаке задаётся через переменную окружения, локально — 5050
const PORT = process.env.PORT || 5050;

// Строка подключения к MongoDB:
// - в облаке будем класть в MONGODB_URI
// - локально используем твой mongodb://127.0.0.1:27017/logistics_map
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/logistics_map';

// ==== Миддлвары ====
app.use(cors());
app.use(express.json());
// Отдаём статические файлы (index.html, main.js, style.css, картинки)
// __dirname — это папка, где лежит server.js (и твой фронт)
app.use(express.static(__dirname));


// ==== Подключение к MongoDB ====
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('✅ MongoDB подключена:', MONGODB_URI))
    .catch(err => console.error('❌ Ошибка подключения к MongoDB:', err));

// ==== Схема и модель ====
const orderSchema = new mongoose.Schema({
    lat: Number,
    lon: Number,
    from: String,
    to: String,
    cargo: String,
    pricePerTon: Number,
    distanceKm: Number,
}, { timestamps: true });

const Order = mongoose.model('Order', orderSchema);

// ==== Проверка, что сервер жив ====
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


// ==== API: получить все заявки ====
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: 1 });
        res.json(orders);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==== API: добавить заявку ====
app.post('/api/orders', async (req, res) => {
    try {
        const order = new Order(req.body);
        await order.save();
        res.status(201).json(order);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Bad data' });
    }
});

// ==== API: обновить заявку ====
app.put('/api/orders/:id', async (req, res) => {
    try {
        const updated = await Order.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        if (!updated) {
            return res.status(404).json({ error: 'Not found' });
        }
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Bad data' });
    }
});

// ==== API: удалить заявку ====
app.delete('/api/orders/:id', async (req, res) => {
    try {
        await Order.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Bad id' });
    }
});

// ==== Запуск сервера ====
app.listen(PORT, () => {
    console.log(`🚚 Сервер запущен на http://localhost:${PORT}`);
});
